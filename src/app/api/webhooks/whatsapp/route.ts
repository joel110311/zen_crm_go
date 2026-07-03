import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchMetaMedia, getMetaWebhookVerifyToken, verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";
import { MESSAGE_SOURCE_META } from "@/lib/message-source";
import { buildPhoneMatchClauses, normalizePhoneDigits, uniquePhoneCandidates } from "@/lib/phone";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { processInboundMessage, type InboundMediaPayload } from "@/app/actions/chat";

type MetaWebhookPayload = {
    object?: string;
    entry?: Array<{
        id?: string;
        changes?: Array<{
            field?: string;
            value?: MetaMessagesValue | MetaTemplateStatusValue;
        }>;
    }>;
};

type MetaMessagesValue = {
    messaging_product?: string;
    metadata?: {
        display_phone_number?: string;
        phone_number_id?: string;
    };
    contacts?: Array<{
        wa_id?: string;
        profile?: {
            name?: string;
        };
    }>;
    messages?: MetaInboundMessage[];
    message_echoes?: MetaInboundMessage[];
    statuses?: MetaMessageStatus[];
};

type MetaInboundMessage = {
    from?: string;
    to?: string;
    recipient_id?: string;
    id?: string;
    is_echo?: boolean;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
    image?: MetaMediaObject;
    video?: MetaMediaObject;
    audio?: MetaMediaObject;
    document?: MetaMediaObject & { filename?: string };
    sticker?: MetaMediaObject;
    button?: { text?: string };
    interactive?: {
        button_reply?: { title?: string };
        list_reply?: { title?: string };
    };
};

type MetaMediaObject = {
    id?: string;
    mime_type?: string;
    caption?: string;
};

type MetaMessageStatus = {
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
    errors?: Array<{
        code?: number;
        title?: string;
        message?: string;
        error_data?: { details?: string };
    }>;
};

type MetaTemplateStatusValue = {
    event?: string;
    message_template_id?: string | number;
    message_template_name?: string;
    message_template_language?: string;
    reason?: string | null;
};

const MEDIA_EXT_BY_MIME: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "application/pdf": ".pdf",
};

const META_STATUS_MAP: Record<string, string> = {
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
};

function asMessagesValue(value: MetaMessagesValue | MetaTemplateStatusValue | undefined): MetaMessagesValue {
    return (value || {}) as MetaMessagesValue;
}

function asTemplateStatusValue(value: MetaMessagesValue | MetaTemplateStatusValue | undefined): MetaTemplateStatusValue {
    return (value || {}) as MetaTemplateStatusValue;
}

function sanitizeFilename(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function mediaExtension(mimeType: string | null | undefined) {
    return (mimeType && MEDIA_EXT_BY_MIME[mimeType]) || ".bin";
}

function mediaNodeForMessage(message: MetaInboundMessage): MetaMediaObject | (MetaMediaObject & { filename?: string }) | null {
    if (message.type === "image") return message.image || null;
    if (message.type === "video") return message.video || null;
    if (message.type === "audio") return message.audio || null;
    if (message.type === "document") return message.document || null;
    if (message.type === "sticker") return message.sticker || null;
    return null;
}

function textForMessage(message: MetaInboundMessage) {
    if (message.type === "text") return message.text?.body || "";
    if (message.type === "button") return message.button?.text || "";
    if (message.type === "interactive") {
        return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
    }

    const media = mediaNodeForMessage(message);
    return media?.caption || `[${message.type || "mensaje"}]`;
}

async function saveInboundMedia(message: MetaInboundMessage): Promise<InboundMediaPayload | undefined> {
    const media = mediaNodeForMessage(message);
    if (!media?.id || !message.type) return undefined;

    const mediaType = message.type === "sticker" ? "image" : message.type;
    if (!["image", "audio", "video", "document"].includes(mediaType)) return undefined;

    try {
        const downloaded = await fetchMetaMedia(media.id);
        const mimeType = media.mime_type || downloaded.mimeType;
        const originalName = message.document?.filename || `${message.id || crypto.randomUUID()}${mediaExtension(mimeType)}`;
        const safeName = `${Date.now()}-${sanitizeFilename(originalName)}`;
        const uploadsDir = path.join(process.cwd(), "public", "uploads");
        await mkdir(uploadsDir, { recursive: true });
        await writeFile(path.join(uploadsDir, safeName), downloaded.buffer);

        return {
            type: mediaType as InboundMediaPayload["type"],
            mediaUrl: `/uploads/${safeName}`,
            mediaType: mimeType,
            mediaFileName: originalName,
        };
    } catch (error) {
        console.warn("[Meta Webhook] No se pudo descargar el medio entrante:", error);
        return {
            type: mediaType as InboundMediaPayload["type"],
            mediaType: media.mime_type || undefined,
            mediaFileName: message.document?.filename || undefined,
        };
    }
}

function contactNameFor(value: MetaMessagesValue, from: string) {
    return value.contacts?.find((contact) => contact.wa_id === from)?.profile?.name;
}

function normalizeContactName(name?: string | null) {
    const normalized = (name || "").trim();
    return normalized.length > 0 ? normalized : undefined;
}

function resolveEchoCustomerPhone(value: MetaMessagesValue, message: MetaInboundMessage) {
    const businessPhone = normalizePhoneDigits(value.metadata?.display_phone_number || "");
    const from = normalizePhoneDigits(message.from || "");
    const candidates = uniquePhoneCandidates([
        message.to,
        message.recipient_id,
        value.contacts?.[0]?.wa_id,
        from && from !== businessPhone ? from : null,
    ]);

    return candidates[0] || "";
}

async function findContactByPhoneCandidates(candidates: string[]) {
    const phoneClauses = buildPhoneMatchClauses(candidates);
    if (phoneClauses.length === 0) return null;

    return prisma.contact.findFirst({
        where: {
            OR: phoneClauses,
        },
    });
}

async function storeMetaOutboundEcho(value: MetaMessagesValue, message: MetaInboundMessage, phoneNumberId: string) {
    const providerMessageId = message.id || "";
    const customerPhone = resolveEchoCustomerPhone(value, message);

    if (!providerMessageId || !customerPhone) {
        console.warn("[Meta Webhook] Eco saliente ignorado: faltan identificadores", {
            providerMessageId,
            customerPhone,
            type: message.type,
        });
        return;
    }

    const existingMessage = await prisma.message.findFirst({
        where: {
            providerMessageId,
            sourceType: MESSAGE_SOURCE_META,
        },
    });

    if (existingMessage) {
        await prisma.message.update({
            where: { id: existingMessage.id },
            data: {
                status: existingMessage.status === "sent" ? existingMessage.status : "sent",
            },
        });
        await prisma.conversation.update({
            where: { id: existingMessage.conversationId },
            data: {
                updatedAt: new Date(),
                botActive: false,
            },
        });
        return;
    }

    const normalizedCandidates = uniquePhoneCandidates([customerPhone]);
    if (normalizedCandidates.length === 0) return;

    const contactName = normalizeContactName(value.contacts?.[0]?.profile?.name);
    let contact = await findContactByPhoneCandidates(normalizedCandidates);

    if (!contact) {
        try {
            contact = await prisma.contact.create({
                data: {
                    phone: normalizedCandidates[0],
                    name: contactName,
                    status: "lead",
                },
            });
        } catch (error) {
            console.warn("[Meta Webhook] No se pudo crear contacto para eco saliente, reintentando busqueda", {
                providerMessageId,
                phone: normalizedCandidates[0],
                error,
            });
            contact = await findContactByPhoneCandidates(normalizedCandidates);
        }
    } else if (contactName && !normalizeContactName(contact.name)) {
        contact = await prisma.contact.update({
            where: { id: contact.id },
            data: { name: contactName },
        });
    }

    if (!contact) {
        console.warn("[Meta Webhook] Eco saliente ignorado: contacto no resuelto", {
            providerMessageId,
            phoneCandidates: normalizedCandidates,
        });
        return;
    }

    const sourceId = phoneNumberId || null;
    const conversation = await findOrCreateActiveConversationForContactSource({
        contactId: contact.id,
        sourceType: MESSAGE_SOURCE_META,
        sourceId,
        defaults: {
            botActive: false,
        },
    });

    const media = await saveInboundMedia(message);
    const content = textForMessage(message);
    const type = media?.type || "text";

    const recentDuplicate = await prisma.message.findFirst({
        where: {
            conversationId: conversation.id,
            sourceType: MESSAGE_SOURCE_META,
            direction: "outbound",
            type,
            content,
            createdAt: { gte: new Date(Date.now() - 15000) },
        },
    });

    if (recentDuplicate) {
        await prisma.message.update({
            where: { id: recentDuplicate.id },
            data: {
                providerMessageId: recentDuplicate.providerMessageId || providerMessageId,
                status: recentDuplicate.status === "sent" ? recentDuplicate.status : "sent",
            },
        });
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                updatedAt: new Date(),
                botActive: false,
            },
        });
        return;
    }

    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            content,
            direction: "outbound",
            status: "sent",
            type,
            mediaUrl: media?.mediaUrl || null,
            mediaType: media?.mediaType || null,
            mediaFileName: media?.mediaFileName || null,
            senderType: "human",
            providerMessageId,
            sourceType: MESSAGE_SOURCE_META,
            sourceId,
        },
    });

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
            updatedAt: new Date(),
            botActive: false,
        },
    });
}

async function handleStatusUpdate(status: MetaMessageStatus) {
    if (!status.id || !status.status) return;

    const crmStatus = META_STATUS_MAP[status.status] || status.status;
    await prisma.message.updateMany({
        where: {
            providerMessageId: status.id,
            sourceType: MESSAGE_SOURCE_META,
        },
        data: {
            status: crmStatus,
        },
    });
}

async function handleTemplateStatus(value: MetaTemplateStatusValue) {
    const name = typeof value.message_template_name === "string" ? value.message_template_name.trim() : "";
    const language = typeof value.message_template_language === "string" ? value.message_template_language.trim() : "";
    if (!name) return;

    const event = (value.event || "").toLowerCase();
    const nextStatus = event === "approved"
        ? "approved"
        : event === "rejected"
            ? "rejected"
            : event === "disabled"
                ? "disabled"
                : event || "pending";

    await prisma.template.updateMany({
        where: {
            name,
            ...(language ? { language } : {}),
        },
        data: {
            status: nextStatus,
        },
    });
}

async function processMetaWebhookPayload(payload: MetaWebhookPayload) {
    if (payload.object !== "whatsapp_business_account") return;

    for (const entry of payload.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field === "message_template_status_update") {
                await handleTemplateStatus(asTemplateStatusValue(change.value));
                continue;
            }

            if (change.field !== "messages" && change.field !== "smb_message_echoes") continue;

            const value = asMessagesValue(change.value);
            const phoneNumberId = value.metadata?.phone_number_id || "";

            for (const status of value.statuses || []) {
                await handleStatusUpdate(status);
            }

            if (change.field === "smb_message_echoes") {
                const echoMessages = [...(value.message_echoes || []), ...(value.messages || [])];
                for (const message of echoMessages) {
                    await storeMetaOutboundEcho(value, message, phoneNumberId);
                }
                continue;
            }

            for (const message of value.messages || []) {
                if (message.is_echo) {
                    await storeMetaOutboundEcho(value, message, phoneNumberId);
                    continue;
                }

                const from = message.from || "";
                const providerMessageId = message.id || "";
                if (!from || !providerMessageId) continue;

                const media = await saveInboundMedia(message);
                await processInboundMessage(
                    from,
                    textForMessage(message),
                    contactNameFor(value, from),
                    media,
                    providerMessageId,
                    undefined,
                    {
                        sourceType: MESSAGE_SOURCE_META,
                        sourceId: phoneNumberId || null,
                    },
                );
            }
        }
    }

    revalidatePath("/dashboard/inbox");
    revalidatePath("/dashboard/contacts");
}

export async function GET(request: NextRequest) {
    const mode = request.nextUrl.searchParams.get("hub.mode");
    const token = request.nextUrl.searchParams.get("hub.verify_token");
    const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
    const expectedToken = await getMetaWebhookVerifyToken();

    if (mode === "subscribe" && expectedToken && token === expectedToken) {
        return new NextResponse(challenge, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
        });
    }

    return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    if (!(await verifyMetaWebhookSignature(rawBody, signature))) {
        return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    let payload: MetaWebhookPayload;
    try {
        payload = JSON.parse(rawBody) as MetaWebhookPayload;
    } catch {
        return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }

    await processMetaWebhookPayload(payload);
    return NextResponse.json({});
}
