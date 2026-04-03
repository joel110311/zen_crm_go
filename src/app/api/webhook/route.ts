import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { processInboundMessage } from "@/app/actions/chat";
import { buildPhoneMatchClauses, normalizePhoneDigits, uniquePhoneCandidates } from "@/lib/phone";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { downloadWuzapiMedia } from "@/lib/wuzapi";
import { refreshWhatsAppAvatarForContact } from "@/lib/whatsapp-avatar";

type JsonObject = Record<string, unknown>;

type WuzapiWebhookEvent = JsonObject & {
    Info?: JsonObject;
    Message?: unknown;
    PushName?: string;
};

type WuzapiWebhookPayload = {
    token?: string;
    type?: string;
    event?: WuzapiWebhookEvent;
    base64?: string;
    mimeType?: string;
    fileName?: string;
    s3?: {
        url?: string;
        mimeType?: string;
        fileName?: string;
    };
};

function asRecord(value: unknown): JsonObject | null {
    return typeof value === "object" && value !== null ? (value as JsonObject) : null;
}

function getString(record: JsonObject | null, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === "string" ? value : undefined;
}

function getNumber(record: JsonObject | null, key: string): number | undefined {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function getBoolean(record: JsonObject | null, key: string): boolean | undefined {
    const value = record?.[key];
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
    }
    return undefined;
}

function normalizeCustomerNameValue(value: string | null | undefined): string | undefined {
    if (!value) return undefined;

    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) return undefined;

    if (/^(unknown|desconocido|sin nombre|null|undefined|n\/a|na)$/i.test(normalized)) {
        return undefined;
    }

    return normalized;
}

function getNestedRecord(record: JsonObject | null, key: string): JsonObject | null {
    return asRecord(record?.[key]);
}

function resolveCustomerName(payload: WuzapiWebhookPayload, info: JsonObject) {
    const eventRecord = asRecord(payload.event);
    const candidates = [
        getString(info, "PushName"),
        getString(info, "pushName"),
        getString(info, "SenderName"),
        getString(info, "senderName"),
        getString(info, "Notify"),
        getString(info, "notify"),
        getString(info, "VerifiedName"),
        getString(info, "verifiedName"),
        getString(info, "FullName"),
        getString(info, "fullName"),
        getString(eventRecord, "PushName"),
        getString(eventRecord, "pushName"),
        getString(eventRecord, "SenderName"),
        getString(eventRecord, "senderName"),
        getString(eventRecord, "Notify"),
        getString(eventRecord, "notify"),
    ];

    return candidates
        .map((candidate) => normalizeCustomerNameValue(candidate))
        .find(Boolean);
}

type MediaPayload = {
    type?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaFileName?: string;
};

type DownloadRequestPayload = {
    Url: string;
    DirectPath?: string;
    MediaKey: string;
    Mimetype: string;
    FileEncSHA256?: string;
    FileSHA256: string;
    FileLength: number;
};

type ExtractedMessageDetails = {
    text: string;
    type: "text" | "image" | "document" | "audio" | "video";
    mimeType?: string;
    fileName?: string;
    ignore?: boolean;
    downloadKind?: "image" | "audio" | "video" | "document" | "sticker";
    downloadPayload?: DownloadRequestPayload;
    previewDataUrl?: string;
};

function isLidAddress(value: unknown) {
    if (!value) return false;

    if (typeof value === "string") {
        return normalizeJidValue(value).toLowerCase().includes("@lid");
    }

    if (typeof value === "object") {
        const maybeObject = value as Record<string, unknown>;
        const server = maybeObject.Server || maybeObject.server || maybeObject.RawServer || maybeObject.rawServer;
        if (typeof server === "string" && server.toLowerCase().includes("lid")) {
            return true;
        }

        const jidString = maybeObject.String || maybeObject.string;
        if (typeof jidString === "string" && isLidAddress(jidString)) {
            return true;
        }
    }

    return false;
}

function normalizeJidValue(value: string) {
    return value.replace(/:\d+@/, "@").trim();
}

function extractJidPhone(value: unknown): string {
    if (!value) return "";
    if (isLidAddress(value)) return "";

    if (typeof value === "string") {
        const normalized = normalizeJidValue(value);
        const candidate = normalized.includes("@")
            ? normalized.split("@")[0]
            : normalized;
        return normalizePhoneDigits(candidate);
    }

    if (typeof value === "object") {
        const maybeObject = value as Record<string, unknown>;
        const user = maybeObject.User || maybeObject.user;
        if (typeof user === "string") {
            return normalizePhoneDigits(user);
        }

        const jidString = maybeObject.String || maybeObject.string;
        if (typeof jidString === "string") {
            return extractJidPhone(jidString);
        }
    }

    return "";
}

function pickPreferredPhoneSource(info: JsonObject) {
    const candidates = [
        info["Chat"],
        info["chat"],
        info["SenderAlt"],
        info["senderAlt"],
        info["RecipientAlt"],
        info["recipientAlt"],
        info["Sender"],
        info["sender"],
    ];

    return (
        candidates.find((candidate) => candidate && !isLidAddress(candidate)) ||
        candidates.find(Boolean) ||
        ""
    );
}

function pickPreferredOutboundPhoneSource(info: JsonObject) {
    const candidates = [
        info["RecipientAlt"],
        info["recipientAlt"],
        info["Recipient"],
        info["recipient"],
        info["Chat"],
        info["chat"],
        info["RemoteJid"],
        info["remoteJid"],
        info["SenderAlt"],
        info["senderAlt"],
    ];

    return (
        candidates.find((candidate) => candidate && !isLidAddress(candidate)) ||
        candidates.find(Boolean) ||
        ""
    );
}

function unwrapMessageNode(node: unknown): unknown {
    const record = asRecord(node);
    if (!record) return node;

    const deviceSentMessage = getNestedRecord(record, "deviceSentMessage");
    if (deviceSentMessage?.message) return unwrapMessageNode(deviceSentMessage.message);

    const editedMessage = getNestedRecord(record, "editedMessage");
    if (editedMessage?.message) return unwrapMessageNode(editedMessage.message);

    const ephemeralMessage = getNestedRecord(record, "ephemeralMessage");
    if (ephemeralMessage?.message) return unwrapMessageNode(ephemeralMessage.message);

    const viewOnceMessage = getNestedRecord(record, "viewOnceMessage");
    if (viewOnceMessage?.message) return unwrapMessageNode(viewOnceMessage.message);

    const viewOnceMessageV2 = getNestedRecord(record, "viewOnceMessageV2");
    if (viewOnceMessageV2?.message) return unwrapMessageNode(viewOnceMessageV2.message);

    return record;
}

function extFromMimeType(mimeType: string) {
    if (mimeType.includes("jpeg")) return ".jpg";
    if (mimeType.includes("png")) return ".png";
    if (mimeType.includes("webp")) return ".webp";
    if (mimeType.includes("pdf")) return ".pdf";
    if (mimeType.includes("ogg")) return ".ogg";
    if (mimeType.includes("mpeg")) return ".mp3";
    if (mimeType.includes("mp4")) return ".mp4";
    if (mimeType.includes("quicktime")) return ".mov";
    if (mimeType.includes("plain")) return ".txt";
    return "";
}

function buildDownloadPayload(record: JsonObject | null): DownloadRequestPayload | undefined {
    if (!record) return undefined;

    const url = getString(record, "URL");
    const mediaKey = getString(record, "mediaKey");
    const mimeType = getString(record, "mimetype");
    const fileSha256 = getString(record, "fileSHA256");
    const fileLength = getNumber(record, "fileLength");

    if (!url || !mediaKey || !mimeType || !fileSha256 || !fileLength) {
        return undefined;
    }

    return {
        Url: url,
        DirectPath: getString(record, "directPath"),
        MediaKey: mediaKey,
        Mimetype: mimeType,
        FileEncSHA256: getString(record, "fileEncSHA256"),
        FileSHA256: fileSha256,
        FileLength: fileLength,
    };
}

function decodeDataUrl(dataUrl: string) {
    const [, base64 = ""] = dataUrl.split(",", 2);
    return Buffer.from(base64, "base64");
}

function extractMessageDetails(messageNode: unknown): ExtractedMessageDetails {
    const message = asRecord(unwrapMessageNode(messageNode));

    if (!message) {
        return {
            text: "[Mensaje de WhatsApp]",
            type: "text" as const,
            ignore: true,
        };
    }

    const protocolMessage = getNestedRecord(message, "protocolMessage");
    if (protocolMessage) {
        return {
            text: "[Evento de sistema de WhatsApp]",
            type: "text" as const,
            ignore: true,
        };
    }

    const conversation = getString(message, "conversation");
    if (conversation) {
        return { text: conversation, type: "text" as const };
    }

    const extendedTextMessage = getNestedRecord(message, "extendedTextMessage");
    const extendedText = getString(extendedTextMessage, "text");
    if (extendedText) {
        return { text: extendedText, type: "text" as const };
    }

    const imageMessage = getNestedRecord(message, "imageMessage");
    if (imageMessage) {
        return {
            text: getString(imageMessage, "caption") || "[Imagen]",
            type: "image" as const,
            mimeType: getString(imageMessage, "mimetype"),
            fileName: getString(imageMessage, "fileName"),
            downloadKind: "image",
            downloadPayload: buildDownloadPayload(imageMessage),
            previewDataUrl: getString(imageMessage, "JPEGThumbnail")
                ? `data:image/jpeg;base64,${getString(imageMessage, "JPEGThumbnail")}`
                : undefined,
        };
    }

    const documentMessage = getNestedRecord(message, "documentMessage");
    if (documentMessage) {
        return {
            text: getString(documentMessage, "caption") || getString(documentMessage, "fileName") || "[Documento]",
            type: "document" as const,
            mimeType: getString(documentMessage, "mimetype"),
            fileName: getString(documentMessage, "fileName"),
            downloadKind: "document",
            downloadPayload: buildDownloadPayload(documentMessage),
        };
    }

    const audioMessage = getNestedRecord(message, "audioMessage");
    if (audioMessage) {
        return {
            text: "[Audio]",
            type: "audio" as const,
            mimeType: getString(audioMessage, "mimetype"),
            downloadKind: "audio",
            downloadPayload: buildDownloadPayload(audioMessage),
        };
    }

    const videoMessage = getNestedRecord(message, "videoMessage");
    if (videoMessage) {
        return {
            text: getString(videoMessage, "caption") || "[Video]",
            type: "video" as const,
            mimeType: getString(videoMessage, "mimetype"),
            fileName: getString(videoMessage, "fileName"),
            downloadKind: "video",
            downloadPayload: buildDownloadPayload(videoMessage),
        };
    }

    const stickerMessage = getNestedRecord(message, "stickerMessage");
    if (stickerMessage) {
        return {
            text: "[Sticker]",
            type: "image" as const,
            mimeType: getString(stickerMessage, "mimetype"),
            downloadKind: "sticker",
            downloadPayload: buildDownloadPayload(stickerMessage),
        };
    }

    return {
        text: "[Mensaje de WhatsApp]",
        type: "text",
        ignore: true,
    };
}

function resolvePhoneFromInfo(info: JsonObject, isFromMe: boolean) {
    return resolvePhoneCandidatesFromInfo(info, isFromMe)[0] || "";
}

function resolvePhoneCandidatesFromInfo(info: JsonObject, isFromMe: boolean) {
    const candidates = isFromMe
        ? [
            info["RecipientAlt"],
            info["recipientAlt"],
            info["Recipient"],
            info["recipient"],
            info["Chat"],
            info["chat"],
            info["RemoteJid"],
            info["remoteJid"],
        ]
        : [
            info["Chat"],
            info["chat"],
            info["SenderAlt"],
            info["senderAlt"],
            info["RecipientAlt"],
            info["recipientAlt"],
            info["Sender"],
            info["sender"],
        ];

    return uniquePhoneCandidates(candidates.map((candidate) => extractJidPhone(candidate)));
}

async function findContactByPhoneCandidates(phoneCandidates: string[]) {
    const phoneClauses = buildPhoneMatchClauses(phoneCandidates);
    if (phoneClauses.length === 0) return null;

    return prisma.contact.findFirst({
        where: {
            OR: phoneClauses,
        },
    });
}

function resolveProviderMessageId(info: JsonObject) {
    return (
        getString(info, "ID") ||
        getString(info, "Id") ||
        getString(info, "id") ||
        getString(info, "MessageID") ||
        getString(info, "messageId") ||
        ""
    ).trim();
}

function stringContainsNonDirectJid(value: string) {
    const normalized = normalizeJidValue(value).toLowerCase();
    return normalized.includes("@g.us") || normalized.includes("@broadcast") || normalized.includes("@newsletter");
}

function valueContainsNonDirectJid(value: unknown): boolean {
    if (!value) return false;

    if (typeof value === "string") {
        return stringContainsNonDirectJid(value);
    }

    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        return Object.values(record).some((entry) => valueContainsNonDirectJid(entry));
    }

    return false;
}

function isNonDirectChat(info: JsonObject) {
    const explicitGroupFlag = getBoolean(info, "IsGroup") ?? getBoolean(info, "isGroup");
    if (explicitGroupFlag) {
        return true;
    }

    const candidates = [
        info["Chat"],
        info["chat"],
        info["RemoteJid"],
        info["remoteJid"],
        info["Sender"],
        info["sender"],
        info["Recipient"],
        info["recipient"],
        info["MessageSource"],
        info["messageSource"],
    ];

    return candidates.some((candidate) => valueContainsNonDirectJid(candidate));
}

function normalizeIncomingPayload(raw: unknown): WuzapiWebhookPayload {
    const payload = asRecord(raw);
    if (!payload) {
        return {};
    }

    const jsonData = getString(payload, "jsonData");
    if (!jsonData) {
        return payload as WuzapiWebhookPayload;
    }

    try {
        const parsed = JSON.parse(jsonData) as WuzapiWebhookPayload;
        return {
            ...parsed,
            token: getString(payload, "token") || getString(payload, "Token") || parsed.token,
            base64: getString(payload, "base64") || parsed.base64,
            mimeType: getString(payload, "mimeType") || parsed.mimeType,
            fileName: getString(payload, "fileName") || parsed.fileName,
            s3: parsed.s3,
        };
    } catch {
        return payload as WuzapiWebhookPayload;
    }
}

async function saveIncomingMedia(payload: WuzapiWebhookPayload, details: ExtractedMessageDetails) {
    const fileName =
        payload.s3?.fileName ||
        payload.fileName ||
        details.fileName ||
        `wa-${Date.now()}${extFromMimeType(payload.s3?.mimeType || payload.mimeType || details.mimeType || "")}`;
    const mimeType = payload.s3?.mimeType || payload.mimeType || details.mimeType || undefined;

    if (payload.s3?.url) {
        return {
            type: details.type,
            mediaUrl: payload.s3.url,
            mediaType: mimeType,
            mediaFileName: fileName,
        } satisfies MediaPayload;
    }

    if (!payload.base64) {
        if (details.downloadKind && details.downloadPayload) {
            try {
                const downloaded = await downloadWuzapiMedia(details.downloadKind, details.downloadPayload);
                if (downloaded.Data) {
                    const uploadsDir = path.join(process.cwd(), "public", "uploads");
                    await mkdir(uploadsDir, { recursive: true });
                    const downloadedMimeType = downloaded.Mimetype || mimeType || details.downloadPayload.Mimetype;
                    const extension = path.extname(fileName) || extFromMimeType(downloadedMimeType || "") || "";
                    const safeFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
                    const absoluteFilePath = path.join(uploadsDir, safeFileName);
                    await writeFile(absoluteFilePath, decodeDataUrl(downloaded.Data));

                    return {
                        type: details.type,
                        mediaUrl: `/uploads/${safeFileName}`,
                        mediaType: downloadedMimeType,
                        mediaFileName: fileName,
                    } satisfies MediaPayload;
                }
            } catch (error) {
                console.error("[Webhook] Failed to download media from WuzAPI:", error);
            }
        }

        if (details.previewDataUrl) {
            const uploadsDir = path.join(process.cwd(), "public", "uploads");
            await mkdir(uploadsDir, { recursive: true });
            const extension = path.extname(fileName) || ".jpg";
            const safeFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
            const absoluteFilePath = path.join(uploadsDir, safeFileName);
            await writeFile(absoluteFilePath, decodeDataUrl(details.previewDataUrl));

            return {
                type: details.type,
                mediaUrl: `/uploads/${safeFileName}`,
                mediaType: mimeType || "image/jpeg",
                mediaFileName: fileName,
            } satisfies MediaPayload;
        }

        return {
            type: details.type,
            mediaType: mimeType,
            mediaFileName: fileName,
        } satisfies MediaPayload;
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const extension = path.extname(fileName) || extFromMimeType(mimeType || "") || "";
    const safeFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`;
    const absoluteFilePath = path.join(uploadsDir, safeFileName);
    const buffer = Buffer.from(payload.base64, "base64");
    await writeFile(absoluteFilePath, buffer);

    return {
        type: details.type,
        mediaUrl: `/uploads/${safeFileName}`,
        mediaType: mimeType,
        mediaFileName: fileName,
    } satisfies MediaPayload;
}

async function storeOutboundEcho(
    phoneCandidates: string[],
    text: string,
    media: MediaPayload,
    customerName?: string,
    providerMessageId?: string,
) {
    if (providerMessageId) {
        const existingMessage = await prisma.message.findFirst({
            where: { providerMessageId },
            include: { conversation: true },
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

            revalidatePath("/dashboard/inbox");
            return;
        }
    }

    const normalizedCandidates = uniquePhoneCandidates(phoneCandidates);
    if (normalizedCandidates.length === 0) return;

    const normalizedCustomerName = normalizeCustomerNameValue(customerName);
    let contact = await findContactByPhoneCandidates(normalizedCandidates);

    if (!contact) {
        const primaryPhone = normalizedCandidates[0];
        try {
            contact = await prisma.contact.create({
                data: {
                    phone: primaryPhone,
                    name: normalizedCustomerName,
                    status: "lead",
                },
            });
        } catch (error) {
            console.warn("[Webhook] Failed to create contact from outbound echo, retrying lookup", {
                phone: primaryPhone,
                providerMessageId,
                error,
            });
            contact = await findContactByPhoneCandidates(normalizedCandidates);
        }
    } else if (normalizedCustomerName && !normalizeCustomerNameValue(contact.name)) {
        contact = await prisma.contact.update({
            where: { id: contact.id },
            data: { name: normalizedCustomerName },
        });
    }

    if (!contact) {
        console.warn("[Webhook] Outbound echo ignored because contact could not be resolved", {
            providerMessageId,
            phoneCandidates: normalizedCandidates,
        });
        return;
    }

    void refreshWhatsAppAvatarForContact(contact.id).catch((avatarError) => {
        console.warn("[Webhook] Failed to refresh WhatsApp avatar for outbound echo", avatarError);
    });

    let conversation = await prisma.conversation.findFirst({
        where: { contactId: contact.id, status: "active" },
    });

    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: {
                contactId: contact.id,
                status: "active",
                botActive: false,
            },
        });
    }

    const duplicate = await prisma.message.findFirst({
        where: {
            conversationId: conversation.id,
            OR: [
                ...(providerMessageId ? [{ providerMessageId }] : []),
                {
                    content: text,
                    direction: "outbound",
                    type: media.type || "text",
                    createdAt: { gte: new Date(Date.now() - 15000) },
                },
            ],
        },
    });

    if (duplicate) {
        if (providerMessageId && !duplicate.providerMessageId) {
            await prisma.message.update({
                where: { id: duplicate.id },
                data: { providerMessageId },
            });
        }

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
            content: text,
            direction: "outbound",
            status: "sent",
            type: media.type || "text",
            mediaUrl: media.mediaUrl || null,
            mediaType: media.mediaType || null,
            mediaFileName: media.mediaFileName || null,
            senderType: "human",
            providerMessageId: providerMessageId || null,
        },
    });

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
            updatedAt: new Date(),
            botActive: false,
        },
    });

    revalidatePath("/dashboard/inbox");
}

export async function GET() {
    return NextResponse.json({ ok: true, channel: "whatsapp-webhook" });
}

export async function POST(req: NextRequest) {
    try {
        const payload = normalizeIncomingPayload(await req.json());
        const settings = await getSystemSettingsOrDefaults();

        if (settings.whatsappUserToken && payload.token && payload.token !== settings.whatsappUserToken) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        if (payload.type !== "Message" || !payload.event?.Info) {
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const info = payload.event.Info;
        if (isNonDirectChat(info)) {
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const messageDetails = extractMessageDetails(payload.event.Message);
        if (messageDetails.ignore) {
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const media = messageDetails.type !== "text"
            ? await saveIncomingMedia(payload, messageDetails)
            : undefined;

        const isFromMe = getBoolean(info, "IsFromMe") ?? getBoolean(info, "isFromMe") ?? false;
        const phoneCandidates = resolvePhoneCandidatesFromInfo(info, isFromMe);
        const phone = phoneCandidates[0] || "";
        const providerMessageId = resolveProviderMessageId(info);

        if (!phone) {
            console.warn("[Webhook] Ignoring message without resolvable phone", {
                isFromMe,
                chat: getString(info, "Chat") || getString(info, "chat"),
                senderAlt: getString(info, "SenderAlt") || getString(info, "senderAlt"),
                recipientAlt: getString(info, "RecipientAlt") || getString(info, "recipientAlt"),
            });
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        if (isFromMe) {
            const customerName = resolveCustomerName(payload, info);
            await storeOutboundEcho(phoneCandidates, messageDetails.text, media || {}, customerName, providerMessageId);
            return new NextResponse("EVENT_RECEIVED", { status: 200 });
        }

        const customerName = resolveCustomerName(payload, info);

        await processInboundMessage(phone, messageDetails.text, customerName, media, providerMessageId);
        return new NextResponse("EVENT_RECEIVED", { status: 200 });
    } catch (error) {
        console.error("Webhook Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
