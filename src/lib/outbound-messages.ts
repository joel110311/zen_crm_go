import { prisma } from "@/lib/db";
import { resolveMediaToDataUrl } from "@/lib/media-data-url";
import {
    normalizeMessageSourceType,
    resolveMessageSourceId,
    type MessageSourceType,
} from "@/lib/message-source";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { sendWuzapiMediaMessage, sendWuzapiTextMessage } from "@/lib/wuzapi";
import { sendYCloudMediaMessage, sendYCloudTextMessage } from "@/lib/ycloud";

export type OutboundMessageType = "text" | "image" | "document" | "audio" | "video";

export type SendOutboundConversationMessageParams = {
    conversationId: string;
    content?: string | null;
    type?: OutboundMessageType;
    sourceType?: MessageSourceType | null;
    sourceId?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
    currentUserId?: string | null;
    senderType?: string | null;
    preserveBotActive?: boolean;
    botActiveOverride?: boolean;
};

export async function findOrCreateActiveConversationForContact(contactId: string) {
    const existingConversation = await prisma.conversation.findFirst({
        where: {
            contactId,
            status: "active",
        },
    });

    if (existingConversation) {
        return existingConversation;
    }

    return prisma.conversation.create({
        data: {
            contactId,
            status: "active",
        },
    });
}

export async function sendOutboundConversationMessage(
    params: SendOutboundConversationMessageParams,
) {
    const type = params.type || "text";
    const content = typeof params.content === "string" ? params.content.trim() : "";

    if (!params.conversationId || (!content && !params.mediaUrl)) {
        throw new Error("conversationId and content or mediaUrl are required");
    }

    let conversation = await prisma.conversation.findUnique({
        where: { id: params.conversationId },
        include: { contact: true },
    });

    if (!conversation) {
        const contactById = await prisma.contact.findUnique({
            where: { id: params.conversationId },
            select: { id: true },
        });

        if (!contactById) {
            throw new Error("Conversation not found");
        }

        const ensuredConversation = await findOrCreateActiveConversationForContact(contactById.id);
        conversation = await prisma.conversation.findUnique({
            where: { id: ensuredConversation.id },
            include: { contact: true },
        });
    }

    if (!conversation) {
        throw new Error("Conversation not found");
    }
    const settings = await getSystemSettingsOrDefaults();
    const selectedSourceType = normalizeMessageSourceType(params.sourceType);
    const selectedSourceId =
        params.sourceId?.trim() ||
        resolveMessageSourceId(selectedSourceType, settings);

    const message = await prisma.message.create({
        data: {
            conversationId: conversation.id,
            content: content || `[${type}]`,
            direction: "outbound",
            status: "sending",
            type,
            sourceType: selectedSourceType,
            sourceId: selectedSourceId,
            mediaUrl: params.mediaUrl || null,
            mediaType: params.mediaType || null,
            mediaFileName: params.mediaFileName || null,
            senderType: params.senderType || "human",
        },
    });

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
            updatedAt: new Date(),
            botActive: typeof params.botActiveOverride === "boolean"
                ? params.botActiveOverride
                : params.preserveBotActive
                    ? conversation.botActive
                    : false,
            assignedUserId: params.currentUserId || conversation.assignedUserId,
        },
    });

    try {
        if (conversation.contact?.phone) {
            let providerMessageId: string | null = null;

            if (type === "text") {
                const result = selectedSourceType === "ycloud"
                    ? await sendYCloudTextMessage(conversation.contact.phone, content)
                    : await sendWuzapiTextMessage(conversation.contact.phone, content);
                providerMessageId = result?.Id || null;
            } else if (params.mediaUrl) {
                let result: { Id?: string | null } | null = null;

                if (selectedSourceType === "ycloud") {
                    const appBaseUrl = (process.env.APP_BASE_URL || process.env.AUTH_URL || "").trim();
                    const isAbsoluteMediaUrl = /^https?:\/\//i.test(params.mediaUrl);
                    if (!isAbsoluteMediaUrl && !appBaseUrl) {
                        throw new Error("APP_BASE_URL o AUTH_URL es requerido para enviar multimedia por YCloud.");
                    }

                    const publicMediaUrl = isAbsoluteMediaUrl
                        ? params.mediaUrl
                        : `${appBaseUrl.replace(/\/+$/, "")}${params.mediaUrl.startsWith("/") ? "" : "/"}${params.mediaUrl}`;

                    result = await sendYCloudMediaMessage({
                        to: conversation.contact.phone,
                        mediaType: type,
                        link: publicMediaUrl,
                        caption: content && content !== `[${type}]` ? content : undefined,
                        fileName: params.mediaFileName || undefined,
                    });
                } else {
                    const resolvedMedia = await resolveMediaToDataUrl(params.mediaUrl, params.mediaType);
                    result = await sendWuzapiMediaMessage({
                        phone: conversation.contact.phone,
                        mediaCategory: type,
                        dataUrl: resolvedMedia.dataUrl,
                        caption: content && content !== `[${type}]` ? content : undefined,
                        fileName: params.mediaFileName || resolvedMedia.fileName,
                        mimeType: params.mediaType || resolvedMedia.mimeType,
                    });
                }

                providerMessageId = result?.Id || null;
            }

            const updatedMessage = await prisma.message.update({
                where: { id: message.id },
                data: {
                    status: "sent",
                    providerMessageId,
                },
            });

            return {
                message: updatedMessage,
                conversation,
            };
        }

        const updatedMessage = await prisma.message.update({
            where: { id: message.id },
            data: { status: "sent" },
        });

        return {
            message: updatedMessage,
            conversation,
        };
    } catch (error) {
        await prisma.message.update({
            where: { id: message.id },
            data: { status: "failed" },
        });

        throw error;
    }
}
