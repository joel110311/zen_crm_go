import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchMetaMedia, getMetaWebhookVerifyToken, verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";
import { MESSAGE_SOURCE_META } from "@/lib/message-source";
import {
    buildPhoneMatchClauses,
    isPlausiblePhoneDigits,
    normalizePhoneDigits,
    uniquePhoneCandidates,
} from "@/lib/phone";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { processInboundMessage, type InboundMediaPayload } from "@/app/actions/chat";

type MetaWebhookPayload = {
    object?: string;
    entry?: Array<{
        id?: string;
        changes?: Array<{
            field?: string;
            value?: MetaWebhookValue;
        }>;
    }>;
};

type UnknownRecord = Record<string, unknown>;

type MetaWebhookValue = MetaMessagesValue | MetaTemplateStatusValue | UnknownRecord;

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
    status?: string;
    direction?: string;
    history_context?: {
        status?: string;
    };
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

type MetaHistoryRecord = {
    message: MetaInboundMessage;
    phoneNumberId: string;
    businessPhone: string;
    threadPhone: string;
    contactName?: string;
};

type MetaHistoryContext = {
    phoneNumberId: string;
    businessPhone: string;
    threadPhone: string;
    contactName?: string;
};

type MetaSyncedContact = {
    phone: string;
    name?: string;
    removed: boolean;
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

function asMessagesValue(value: MetaWebhookValue | undefined): MetaMessagesValue {
    return (value || {}) as MetaMessagesValue;
}

function asTemplateStatusValue(value: MetaWebhookValue | undefined): MetaTemplateStatusValue {
    return (value || {}) as MetaTemplateStatusValue;
}

function isRecord(value: unknown): value is UnknownRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function parseMetaTimestamp(value: unknown) {
    const raw = typeof value === "number" ? String(value) : stringValue(value);
    if (!raw) return new Date();

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
        const parsed = new Date(milliseconds);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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

function provisionalContactName(name: string | null | undefined, phone: string) {
    const normalized = normalizeContactName(name);
    if (!normalized) return true;

    const normalizedDigits = normalizePhoneDigits(normalized);
    const phoneDigits = normalizePhoneDigits(phone);
    const lowerName = normalized.toLowerCase();

    return (
        /^[+\d\s().-]+$/.test(normalized)
        || (normalizedDigits.length >= 8 && phoneDigits.endsWith(normalizedDigits))
        || ["contacto", "whatsapp user", "usuario de whatsapp", "sin nombre"].includes(lowerName)
    );
}

async function findOrCreateMetaContact(phone: string, name?: string) {
    const candidates = uniquePhoneCandidates([phone]);
    if (candidates.length === 0) return null;

    let contact = await findContactByPhoneCandidates(candidates);
    if (!contact) {
        try {
            contact = await prisma.contact.create({
                data: {
                    phone: candidates[0],
                    name: normalizeContactName(name),
                    status: "lead",
                },
            });
        } catch (error) {
            console.warn("[Meta Webhook] No se pudo crear contacto sincronizado, reintentando busqueda", {
                phone: candidates[0],
                error,
            });
            contact = await findContactByPhoneCandidates(candidates);
        }
    }

    const normalizedName = normalizeContactName(name);
    if (contact && normalizedName && provisionalContactName(contact.name, contact.phone)) {
        contact = await prisma.contact.update({
            where: { id: contact.id },
            data: { name: normalizedName },
        });
    }

    return contact;
}

function contactNameFromRecord(record: UnknownRecord) {
    const profile = isRecord(record.profile) ? record.profile : null;
    const profileName = profile ? stringValue(profile.name) : "";
    const directName = stringValue(record.full_name) || stringValue(record.name);
    const composedName = [stringValue(record.first_name), stringValue(record.last_name)].filter(Boolean).join(" ");
    return normalizeContactName(profileName || directName || composedName);
}

function phoneFromRecord(record: UnknownRecord, includeId = false) {
    const raw = [record.wa_id, record.phone_number, record.phone, record.msisdn]
        .map(stringValue)
        .find((value) => isPlausiblePhoneDigits(normalizePhoneDigits(value)));
    if (raw) return normalizePhoneDigits(raw);

    if (includeId) {
        const id = normalizePhoneDigits(stringValue(record.id));
        if (isPlausiblePhoneDigits(id)) return id;
    }

    return "";
}

function historyContextForNode(node: UnknownRecord, parent: MetaHistoryContext): MetaHistoryContext {
    const metadata = isRecord(node.metadata) ? node.metadata : null;
    const phoneNumberId = metadata
        ? stringValue(metadata.phone_number_id) || parent.phoneNumberId
        : parent.phoneNumberId;
    const businessPhone = metadata
        ? normalizePhoneDigits(stringValue(metadata.display_phone_number)) || parent.businessPhone
        : parent.businessPhone;

    const hasMessages = Array.isArray(node.messages);
    const directPhone = phoneFromRecord(node, hasMessages);
    const contacts = Array.isArray(node.contacts) ? node.contacts.filter(isRecord) : [];
    const contactRecord = contacts.find((contact) => phoneFromRecord(contact, true) === directPhone) || contacts[0];
    const contactPhone = contactRecord ? phoneFromRecord(contactRecord, true) : "";
    const contactName = contactRecord ? contactNameFromRecord(contactRecord) : contactNameFromRecord(node);

    return {
        phoneNumberId,
        businessPhone,
        threadPhone: directPhone || contactPhone || parent.threadPhone,
        contactName: contactName || parent.contactName,
    };
}

function looksLikeHistoryMessage(node: UnknownRecord) {
    return Boolean(
        stringValue(node.id)
        && stringValue(node.type)
        && (stringValue(node.timestamp) || stringValue(node.from) || stringValue(node.to)),
    );
}

function collectHistoryRecords(
    node: unknown,
    parent: MetaHistoryContext,
    output: MetaHistoryRecord[],
    seenProviderIds: Set<string>,
) {
    if (Array.isArray(node)) {
        for (const item of node) collectHistoryRecords(item, parent, output, seenProviderIds);
        return;
    }
    if (!isRecord(node)) return;

    const context = historyContextForNode(node, parent);
    if (looksLikeHistoryMessage(node)) {
        const providerMessageId = stringValue(node.id);
        if (!seenProviderIds.has(providerMessageId)) {
            seenProviderIds.add(providerMessageId);
            output.push({
                message: node as MetaInboundMessage,
                ...context,
            });
        }
        return;
    }

    if (Array.isArray(node.messages)) {
        for (const rawMessage of node.messages) {
            if (!isRecord(rawMessage) || !looksLikeHistoryMessage(rawMessage)) continue;
            const providerMessageId = stringValue(rawMessage.id);
            if (seenProviderIds.has(providerMessageId)) continue;
            seenProviderIds.add(providerMessageId);
            output.push({
                message: rawMessage as MetaInboundMessage,
                ...context,
            });
        }
    }

    for (const key of ["history", "threads", "data", "value", "items"]) {
        if (key in node) collectHistoryRecords(node[key], context, output, seenProviderIds);
    }
}

function resolveHistoryDirection(record: MetaHistoryRecord) {
    const message = record.message;
    const explicitDirection = (message.direction || "").toLowerCase();
    if (explicitDirection === "outbound" || explicitDirection === "sent") return "outbound";
    if (explicitDirection === "inbound" || explicitDirection === "received") return "inbound";

    const from = normalizePhoneDigits(message.from || "");
    const to = normalizePhoneDigits(message.to || message.recipient_id || "");
    if (record.businessPhone && from === record.businessPhone) return "outbound";
    if (record.businessPhone && to === record.businessPhone) return "inbound";
    if (record.threadPhone && to === record.threadPhone) return "outbound";

    const historicalStatus = (message.history_context?.status || message.status || "").toLowerCase();
    if (["sent", "delivered", "read", "failed"].includes(historicalStatus)) return "outbound";
    return "inbound";
}

function resolveHistoryCustomerPhone(record: MetaHistoryRecord, direction: "inbound" | "outbound") {
    const message = record.message;
    const candidates = direction === "outbound"
        ? [message.to, message.recipient_id, record.threadPhone]
        : [message.from, record.threadPhone, message.to];

    return uniquePhoneCandidates(candidates)[0] || "";
}

function historicalMediaForMessage(message: MetaInboundMessage) {
    const media = mediaNodeForMessage(message);
    const mediaType = message.type === "sticker" ? "image" : message.type;
    if (!media || !mediaType || !["image", "audio", "video", "document"].includes(mediaType)) {
        return null;
    }

    return {
        type: mediaType,
        mediaType: media.mime_type || null,
        mediaFileName: message.document?.filename || null,
    };
}

async function handleHistorySync(value: MetaWebhookValue | undefined) {
    const rawValue = isRecord(value) ? value : {};
    const messagesValue = asMessagesValue(value);
    const initialContext: MetaHistoryContext = {
        phoneNumberId: messagesValue.metadata?.phone_number_id || "",
        businessPhone: normalizePhoneDigits(messagesValue.metadata?.display_phone_number || ""),
        threadPhone: "",
    };
    const records: MetaHistoryRecord[] = [];
    collectHistoryRecords(rawValue, initialContext, records, new Set<string>());

    const conversationActivity = new Map<string, {
        latestMessageAt: Date;
        originalUpdatedAt: Date;
        sessionExpiresAt: Date | null;
    }>();
    let imported = 0;

    for (const record of records) {
        const message = record.message;
        const providerMessageId = message.id || "";
        if (!providerMessageId || message.type === "reaction") continue;

        const existingMessage = await prisma.message.findFirst({
            where: {
                providerMessageId,
                sourceType: MESSAGE_SOURCE_META,
            },
            select: { id: true },
        });
        if (existingMessage) continue;

        const direction = resolveHistoryDirection(record);
        const customerPhone = resolveHistoryCustomerPhone(record, direction);
        if (!customerPhone) continue;

        const contact = await findOrCreateMetaContact(customerPhone, record.contactName);
        if (!contact) continue;

        const sourceId = record.phoneNumberId || null;
        const existingConversation = await prisma.conversation.findFirst({
            where: {
                contactId: contact.id,
                status: "active",
                sourceType: MESSAGE_SOURCE_META,
                sourceId,
            },
            orderBy: { updatedAt: "desc" },
        });
        const conversation = existingConversation || await findOrCreateActiveConversationForContactSource({
            contactId: contact.id,
            sourceType: MESSAGE_SOURCE_META,
            sourceId,
        });

        const createdAt = parseMetaTimestamp(message.timestamp);
        const media = historicalMediaForMessage(message);
        const rawStatus = (message.history_context?.status || message.status || "").toLowerCase();
        const status = direction === "outbound"
            ? META_STATUS_MAP[rawStatus] || rawStatus || "sent"
            : "delivered";

        await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: textForMessage(message) || `[${message.type || "mensaje"} importado]`,
                direction,
                status,
                type: media?.type || "text",
                mediaType: media?.mediaType || null,
                mediaFileName: media?.mediaFileName || null,
                senderType: direction === "outbound" ? "human" : "contact",
                providerMessageId,
                sourceType: MESSAGE_SOURCE_META,
                sourceId,
                createdAt,
            },
        });

        const currentActivity = conversationActivity.get(conversation.id);
        const inboundExpiry = direction === "inbound"
            ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
            : null;
        conversationActivity.set(conversation.id, {
            latestMessageAt: currentActivity && currentActivity.latestMessageAt > createdAt
                ? currentActivity.latestMessageAt
                : createdAt,
            originalUpdatedAt: currentActivity?.originalUpdatedAt || conversation.updatedAt,
            sessionExpiresAt: [currentActivity?.sessionExpiresAt, conversation.sessionExpiresAt, inboundExpiry]
                .filter((date): date is Date => Boolean(date))
                .sort((left, right) => right.getTime() - left.getTime())[0] || null,
        });
        imported += 1;
    }

    for (const [conversationId, activity] of conversationActivity) {
        const updatedAt = activity.originalUpdatedAt > activity.latestMessageAt
            ? activity.originalUpdatedAt
            : activity.latestMessageAt;
        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                updatedAt,
                ...(activity.sessionExpiresAt && activity.sessionExpiresAt > new Date()
                    ? { sessionExpiresAt: activity.sessionExpiresAt }
                    : {}),
            },
        });
    }

    if (records.length > 0) {
        console.info("[Meta Webhook] Historial de coexistencia procesado", {
            received: records.length,
            imported,
        });
    }
    return imported;
}

function collectSyncedContacts(
    node: unknown,
    inheritedRemoved: boolean,
    output: Map<string, MetaSyncedContact>,
) {
    if (Array.isArray(node)) {
        for (const item of node) collectSyncedContacts(item, inheritedRemoved, output);
        return;
    }
    if (!isRecord(node)) return;

    const action = [node.action, node.operation, node.event, node.change_type]
        .map(stringValue)
        .find(Boolean)
        ?.toLowerCase() || "";
    const removed = inheritedRemoved || ["delete", "deleted", "remove", "removed"].some((term) => action.includes(term));
    const contactLike = Boolean(
        node.wa_id
        || node.phone_number
        || node.phone
        || node.msisdn
        || node.profile
        || node.full_name
        || node.first_name,
    );
    const phone = phoneFromRecord(node, contactLike);
    if (phone) {
        const candidate = {
            phone,
            name: contactNameFromRecord(node),
            removed,
        };
        const previous = output.get(phone);
        output.set(phone, {
            phone,
            name: candidate.name || previous?.name,
            removed: candidate.removed || previous?.removed || false,
        });
    }

    for (const key of ["state_sync", "contacts", "contact", "data", "changes", "items", "value"]) {
        if (key in node) collectSyncedContacts(node[key], removed, output);
    }
}

async function handleAppStateSync(value: MetaWebhookValue | undefined) {
    const candidates = new Map<string, MetaSyncedContact>();
    collectSyncedContacts(value, false, candidates);

    let synchronized = 0;
    for (const candidate of candidates.values()) {
        // A deletion in the phone must never erase CRM history or its contact.
        if (candidate.removed) continue;
        if (await findOrCreateMetaContact(candidate.phone, candidate.name)) synchronized += 1;
    }

    if (candidates.size > 0) {
        console.info("[Meta Webhook] Estado de contactos de coexistencia procesado", {
            received: candidates.size,
            synchronized,
        });
    }
    return synchronized;
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
            if (change.field === "history") {
                await handleHistorySync(change.value);
                continue;
            }

            if (change.field === "smb_app_state_sync") {
                await handleAppStateSync(change.value);
                continue;
            }

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
