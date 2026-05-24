import { revalidatePath } from "next/cache";
import { processInboundMessage } from "@/app/actions/chat";
import { prisma } from "@/lib/db";
import { MESSAGE_SOURCE_YCLOUD, resolveMessageSourceId } from "@/lib/message-source";
import { buildPhoneMatchClauses, uniquePhoneCandidates } from "@/lib/phone";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { normalizeYCloudWebhookPayload, type YCloudNormalizedMessage } from "@/lib/ycloud-webhook";

function mapYCloudStatus(status: string) {
    const normalized = status.trim().toLowerCase();

    if (normalized === "read") return "read";
    if (normalized === "delivered") return "delivered";
    if (normalized === "failed") return "failed";
    if (normalized === "sent" || normalized === "accepted" || normalized === "queued") return "sent";

    return "sent";
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

async function storeYCloudOutboundEcho(message: YCloudNormalizedMessage) {
    const phoneCandidates = uniquePhoneCandidates([message.contactPhone]);
    if (phoneCandidates.length === 0) {
        return;
    }

    if (message.providerMessageId) {
        const existingMessage = await prisma.message.findFirst({
            where: {
                providerMessageId: message.providerMessageId,
                sourceType: MESSAGE_SOURCE_YCLOUD,
            },
            select: {
                id: true,
                conversationId: true,
                senderType: true,
                status: true,
                type: true,
            },
        });

        if (existingMessage) {
            const shouldPauseBot = existingMessage.senderType !== "bot";

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
                    ...(existingMessage.type === "template"
                        ? { sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                        : {}),
                    ...(shouldPauseBot ? { botActive: false } : {}),
                },
            });

            revalidatePath("/dashboard/inbox");
            return;
        }
    }

    let contact = await findContactByPhoneCandidates(phoneCandidates);

    if (!contact) {
        const primaryPhone = phoneCandidates[0];
        contact = await prisma.contact.create({
            data: {
                phone: primaryPhone,
                name: message.customerName || null,
                status: "lead",
            },
        });
    } else if (message.customerName && !contact.name) {
        contact = await prisma.contact.update({
            where: { id: contact.id },
            data: {
                name: message.customerName,
            },
        });
    }

    const conversation = await findOrCreateActiveConversationForContactSource({
        contactId: contact.id,
        sourceType: MESSAGE_SOURCE_YCLOUD,
        sourceId: message.sourceId,
        defaults: {
            botActive: false,
        },
    });

    const duplicate = await prisma.message.findFirst({
        where: {
            conversationId: conversation.id,
            sourceType: MESSAGE_SOURCE_YCLOUD,
            OR: [
                ...(message.providerMessageId ? [{ providerMessageId: message.providerMessageId }] : []),
                {
                    content: message.text,
                    direction: "outbound",
                    type: message.media?.type || "text",
                    createdAt: {
                        gte: new Date(Date.now() - 15000),
                    },
                },
            ],
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    if (duplicate) {
        if (message.providerMessageId && !duplicate.providerMessageId) {
            await prisma.message.update({
                where: { id: duplicate.id },
                data: {
                    providerMessageId: message.providerMessageId,
                },
            });
        }

        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                updatedAt: new Date(),
                ...(message.media?.type === "template"
                    ? { sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                    : {}),
                ...(duplicate.senderType !== "bot" ? { botActive: false } : {}),
            },
        });

        return;
    }

    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            content: message.text,
            direction: "outbound",
            status: "sent",
            type: message.media?.type || "text",
            mediaUrl: message.media?.mediaUrl || null,
            mediaType: message.media?.mediaType || null,
            mediaFileName: message.media?.mediaFileName || null,
            senderType: "human",
            providerMessageId: message.providerMessageId || null,
            sourceType: MESSAGE_SOURCE_YCLOUD,
            sourceId: message.sourceId,
        },
    });

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
            updatedAt: new Date(),
            ...(message.media?.type === "template"
                ? { sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                : {}),
            botActive: false,
        },
    });

    revalidatePath("/dashboard/inbox");
}

async function applyYCloudStatus(params: {
    providerMessageId: string;
    status: string;
    sourceId: string | null;
}) {
    const where = {
        providerMessageId: params.providerMessageId,
        sourceType: MESSAGE_SOURCE_YCLOUD,
        ...(params.sourceId ? { sourceId: params.sourceId } : {}),
    };

    let target = await prisma.message.findFirst({
        where,
        select: { id: true, conversationId: true, status: true },
        orderBy: { createdAt: "desc" },
    });

    if (!target) {
        target = await prisma.message.findFirst({
            where: {
                providerMessageId: params.providerMessageId,
                sourceType: MESSAGE_SOURCE_YCLOUD,
            },
            select: { id: true, conversationId: true, status: true },
            orderBy: { createdAt: "desc" },
        });
    }

    if (!target) return;

    const mappedStatus = mapYCloudStatus(params.status);
    if (target.status === mappedStatus) return;

    await prisma.message.update({
        where: { id: target.id },
        data: {
            status: mappedStatus,
        },
    });

    await prisma.conversation.update({
        where: { id: target.conversationId },
        data: { updatedAt: new Date() },
    });

    revalidatePath("/dashboard/inbox");
}

export function looksLikeYCloudWebhookPayload(rawPayload: unknown) {
    if (!rawPayload || typeof rawPayload !== "object") return false;

    const payload = rawPayload as Record<string, unknown>;
    const type = typeof payload.type === "string" ? payload.type.trim().toLowerCase() : "";

    return (
        type.startsWith("whatsapp.") ||
        Boolean(payload.whatsappInboundMessage) ||
        Boolean(payload.whatsappMessage) ||
        Boolean(payload.whatsappMessageStatus)
    );
}

export async function handleYCloudWebhookPayload(rawPayload: unknown) {
    const settings = await getSystemSettingsOrDefaults();
    const fallbackSourceId = resolveMessageSourceId(MESSAGE_SOURCE_YCLOUD, settings);

    const normalizedEvent = normalizeYCloudWebhookPayload(rawPayload, {
        fallbackSourceId,
    });

    if (normalizedEvent.kind === "ignore") {
        return { ok: true, ignored: normalizedEvent.reason };
    }

    if (normalizedEvent.kind === "status") {
        await applyYCloudStatus({
            providerMessageId: normalizedEvent.providerMessageId,
            status: normalizedEvent.status,
            sourceId: normalizedEvent.sourceId || fallbackSourceId,
        });
        return { ok: true, statusUpdated: true };
    }

    if (normalizedEvent.message.direction === "inbound") {
        await processInboundMessage(
            normalizedEvent.message.contactPhone,
            normalizedEvent.message.text,
            normalizedEvent.message.customerName,
            normalizedEvent.message.media,
            normalizedEvent.message.providerMessageId,
            undefined,
            {
                sourceType: MESSAGE_SOURCE_YCLOUD,
                sourceId: normalizedEvent.message.sourceId || fallbackSourceId,
            },
        );
        return { ok: true, stored: "inbound" };
    }

    await storeYCloudOutboundEcho({
        ...normalizedEvent.message,
        sourceId: normalizedEvent.message.sourceId || fallbackSourceId,
    });

    return { ok: true, stored: "outbound" };
}
