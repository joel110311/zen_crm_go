import { MESSAGE_SOURCE_YCLOUD } from "@/lib/message-source";

export type YCloudInboundMediaPayload = {
    type: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaFileName?: string;
};

export type YCloudNormalizedMessage = {
    direction: "inbound" | "outbound";
    contactPhone: string;
    text: string;
    customerName?: string;
    providerMessageId?: string;
    media?: YCloudInboundMediaPayload;
    sourceType: typeof MESSAGE_SOURCE_YCLOUD;
    sourceId: string | null;
};

export type YCloudWebhookNormalizedEvent =
    | { kind: "message"; message: YCloudNormalizedMessage }
    | { kind: "status"; providerMessageId: string; status: string; sourceId: string | null }
    | { kind: "ignore"; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function pickString(...values: unknown[]) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}

function normalizePhone(value: string) {
    const digits = value.replace(/\D/g, "");
    if (!digits) return "";

    if (digits.length === 10) {
        return `52${digits}`;
    }

    return digits;
}

function resolveSourceId(payload: Record<string, unknown>, message: Record<string, unknown>, fallback: string | null) {
    const sourceId = pickString(
        message.wabaId,
        message.wabaID,
        message.phoneNumberId,
        message.phone_number_id,
        message.businessPhone,
        payload.wabaId,
        payload.wabaID,
        payload.phoneNumberId,
        payload.phone_number_id,
        fallback,
    );

    return sourceId || null;
}

function extractMessageContent(message: Record<string, unknown>) {
    const messageType = pickString(message.type).toLowerCase() || "text";

    if (messageType === "text") {
        const textRecord = asRecord(message.text);
        return {
            text: pickString(textRecord?.body) || "",
            media: undefined,
        };
    }

    if (messageType === "image") {
        const image = asRecord(message.image);
        return {
            text: pickString(image?.caption) || "[Imagen]",
            media: {
                type: "image",
                mediaUrl: pickString(image?.link),
                mediaType: pickString(image?.mimeType) || "image/jpeg",
                mediaFileName: pickString(image?.filename) || undefined,
            } satisfies YCloudInboundMediaPayload,
        };
    }

    if (messageType === "document") {
        const document = asRecord(message.document);
        return {
            text: pickString(document?.caption, document?.filename) || "[Documento]",
            media: {
                type: "document",
                mediaUrl: pickString(document?.link),
                mediaType: pickString(document?.mimeType) || "application/octet-stream",
                mediaFileName: pickString(document?.filename) || undefined,
            } satisfies YCloudInboundMediaPayload,
        };
    }

    if (messageType === "audio") {
        const audio = asRecord(message.audio);
        return {
            text: "[Audio]",
            media: {
                type: "audio",
                mediaUrl: pickString(audio?.link),
                mediaType: pickString(audio?.mimeType) || "audio/ogg",
                mediaFileName: pickString(audio?.filename) || undefined,
            } satisfies YCloudInboundMediaPayload,
        };
    }

    if (messageType === "video") {
        const video = asRecord(message.video);
        return {
            text: pickString(video?.caption) || "[Video]",
            media: {
                type: "video",
                mediaUrl: pickString(video?.link),
                mediaType: pickString(video?.mimeType) || "video/mp4",
                mediaFileName: pickString(video?.filename) || undefined,
            } satisfies YCloudInboundMediaPayload,
        };
    }

    if (messageType === "sticker") {
        const sticker = asRecord(message.sticker);
        return {
            text: "[Sticker]",
            media: {
                type: "image",
                mediaUrl: pickString(sticker?.link),
                mediaType: pickString(sticker?.mimeType) || "image/webp",
                mediaFileName: pickString(sticker?.filename) || undefined,
            } satisfies YCloudInboundMediaPayload,
        };
    }

    return {
        text: `[${messageType}]`,
        media: {
            type: messageType,
        } satisfies YCloudInboundMediaPayload,
    };
}

export function normalizeYCloudWebhookPayload(
    rawPayload: unknown,
    options?: { fallbackSourceId?: string | null },
): YCloudWebhookNormalizedEvent {
    const payload = asRecord(rawPayload);
    if (!payload) {
        return { kind: "ignore", reason: "invalid_payload" };
    }

    const eventType = pickString(payload.type).toLowerCase();
    if (!eventType) {
        return { kind: "ignore", reason: "missing_event_type" };
    }

    const inboundMessage = asRecord(payload.whatsappInboundMessage);
    if (eventType === "whatsapp.inbound_message.received" && inboundMessage) {
        const from = normalizePhone(pickString(inboundMessage.from));
        if (!from) {
            return { kind: "ignore", reason: "missing_inbound_from" };
        }

        const { text, media } = extractMessageContent(inboundMessage);
        const customerProfile = asRecord(inboundMessage.customerProfile);

        return {
            kind: "message",
            message: {
                direction: "inbound",
                contactPhone: from,
                text: text || "[Mensaje]",
                customerName: pickString(customerProfile?.name) || undefined,
                providerMessageId: pickString(inboundMessage.wamid, inboundMessage.id) || undefined,
                media,
                sourceType: MESSAGE_SOURCE_YCLOUD,
                sourceId: resolveSourceId(payload, inboundMessage, options?.fallbackSourceId || null),
            },
        };
    }

    if (eventType === "whatsapp.smb.message.echoes" && inboundMessage) {
        const to = normalizePhone(pickString(inboundMessage.to, inboundMessage.from));
        if (!to) {
            return { kind: "ignore", reason: "missing_echo_to" };
        }

        const { text, media } = extractMessageContent(inboundMessage);

        return {
            kind: "message",
            message: {
                direction: "outbound",
                contactPhone: to,
                text: text || "[Mensaje]",
                customerName: undefined,
                providerMessageId: pickString(inboundMessage.wamid, inboundMessage.id) || undefined,
                media,
                sourceType: MESSAGE_SOURCE_YCLOUD,
                sourceId: resolveSourceId(payload, inboundMessage, options?.fallbackSourceId || null),
            },
        };
    }

    if (eventType === "whatsapp.message.updated") {
        const messageStatus = asRecord(payload.whatsappMessage) || asRecord(payload.whatsappMessageStatus);
        const providerMessageId = pickString(messageStatus?.id, messageStatus?.wamid);
        const status = pickString(messageStatus?.status).toLowerCase();

        if (!providerMessageId || !status) {
            return { kind: "ignore", reason: "invalid_status_payload" };
        }

        return {
            kind: "status",
            providerMessageId,
            status,
            sourceId: resolveSourceId(payload, messageStatus || {}, options?.fallbackSourceId || null),
        };
    }

    return { kind: "ignore", reason: `unsupported_event:${eventType}` };
}
