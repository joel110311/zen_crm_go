import crypto from "crypto";
import type {
    BulkCampaign,
    BulkCampaignVariant,
    Contact,
    Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
    businessBoundsForDate,
    getNextOpenDate,
    normalizeBusinessHours,
} from "@/lib/calendar/business-hours";
import {
    findOrCreateActiveConversationForContact,
    type OutboundMessageType,
    sendOutboundConversationMessage,
} from "@/lib/outbound-messages";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { listTemplateVariableKeys, renderTemplateContent } from "@/lib/templates";
import {
    MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    type BulkCampaignAudienceFilters,
    type BulkCampaignAudienceMode,
    type BulkCampaignManualEntry,
    normalizeBulkCampaignAudienceFilters,
} from "@/lib/bulk-campaign-audience";
import {
    classifyBulkCampaignReplyIntent,
    type BulkCampaignReplyIntent,
} from "@/lib/bulk-campaign-replies";
import { buildPhoneMatchClauses, normalizePhoneDigits } from "@/lib/phone";

const DEFAULT_VARIANT_LABELS = ["A", "B", "C", "D", "E"];
const WORKER_LOCK_TTL_MS = 60_000;
const ALLOWED_CAMPAIGN_TYPES = new Set<OutboundMessageType>(["text", "image", "document"]);

export type BulkCampaignVariantInput = {
    label: string;
    content: string;
    weight: number;
    sortOrder: number;
    isActive: boolean;
};

export type BulkCampaignUpsertInput = {
    name: string;
    description: string;
    type: OutboundMessageType;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFileName: string | null;
    batchSize: number;
    batchDelayMinutes: number;
    randomDelayMinSeconds: number;
    randomDelayMaxSeconds: number;
    scheduledStartAt: Date | null;
    respectBusinessHours: boolean;
    stopOnReply: boolean;
    followUpCount: number;
    followUpDelayDays: number;
    audienceFilters: BulkCampaignAudienceFilters;
    variants: BulkCampaignVariantInput[];
};

export type BulkCampaignRecord = BulkCampaign & {
    variants: BulkCampaignVariant[];
};

export type BulkCampaignReplyHandlingResult = {
    intent: BulkCampaignReplyIntent;
    stoppedCampaignIds: string[];
    activatedBot: boolean;
    optedOut: boolean;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeOptionalDate(value: unknown) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeCampaignType(value: unknown): OutboundMessageType {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "text";
    if (ALLOWED_CAMPAIGN_TYPES.has(normalized as OutboundMessageType)) {
        return normalized as OutboundMessageType;
    }
    return "text";
}

function buildDefaultVariant(index = 0): BulkCampaignVariantInput {
    return {
        label: DEFAULT_VARIANT_LABELS[index] || `Variante ${index + 1}`,
        content: "",
        weight: 1,
        sortOrder: index,
        isActive: true,
    };
}

export function normalizeBulkCampaignVariants(
    value: unknown,
    type: OutboundMessageType,
): BulkCampaignVariantInput[] {
    if (!Array.isArray(value) || value.length === 0) {
        return [buildDefaultVariant()];
    }

    const normalized = value
        .map((entry, index) => {
            const record = typeof entry === "object" && entry !== null
                ? (entry as Record<string, unknown>)
                : {};
            const label = typeof record.label === "string" && record.label.trim()
                ? record.label.trim()
                : DEFAULT_VARIANT_LABELS[index] || `Variante ${index + 1}`;
            const content = typeof record.content === "string" ? record.content : "";

            return {
                label,
                content,
                weight: clampInteger(record.weight, 1, 1, 20),
                sortOrder: index,
                isActive: record.isActive !== false,
            } satisfies BulkCampaignVariantInput;
        })
        .filter((variant) => variant.isActive || variant.content.trim() || type !== "text");

    return normalized.length > 0 ? normalized : [buildDefaultVariant()];
}

export function normalizeBulkCampaignPayload(value: unknown): BulkCampaignUpsertInput {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const type = normalizeCampaignType(record.type);

    return {
        name: typeof record.name === "string" ? record.name.trim() : "",
        description: typeof record.description === "string" ? record.description.trim() : "",
        type,
        mediaUrl: typeof record.mediaUrl === "string" && record.mediaUrl.trim() ? record.mediaUrl.trim() : null,
        mediaType: typeof record.mediaType === "string" && record.mediaType.trim() ? record.mediaType.trim() : null,
        mediaFileName: typeof record.mediaFileName === "string" && record.mediaFileName.trim() ? record.mediaFileName.trim() : null,
        batchSize: clampInteger(record.batchSize, 3, 1, 100),
        batchDelayMinutes: clampInteger(record.batchDelayMinutes, 5, 0, 24 * 60),
        randomDelayMinSeconds: clampInteger(record.randomDelayMinSeconds, 25, 5, 30 * 60),
        randomDelayMaxSeconds: clampInteger(record.randomDelayMaxSeconds, 75, 5, 30 * 60),
        scheduledStartAt: normalizeOptionalDate(record.scheduledStartAt),
        respectBusinessHours: record.respectBusinessHours !== false,
        stopOnReply: record.stopOnReply !== false,
        followUpCount: clampInteger(record.followUpCount, 0, 0, 12),
        followUpDelayDays: clampInteger(record.followUpDelayDays, 2, 1, 30),
        audienceFilters: normalizeBulkCampaignAudienceFilters(
            record.audienceFilters,
            MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
        ),
        variants: normalizeBulkCampaignVariants(record.variants, type),
    };
}

function ensureCampaignDraftIsValid(input: BulkCampaignUpsertInput) {
    if (!input.name) {
        throw new Error("El nombre de la campaña es obligatorio");
    }

    if (input.type !== "text" && !input.mediaUrl) {
        throw new Error("La campaña requiere un archivo adjunto");
    }

    if (input.randomDelayMaxSeconds < input.randomDelayMinSeconds) {
        throw new Error("El delay máximo debe ser mayor o igual al mínimo");
    }
}

function ensureCampaignCanLaunch(campaign: BulkCampaignRecord) {
    if (!campaign.name.trim()) {
        throw new Error("La campaña no tiene nombre");
    }

    if (campaign.type !== "text" && !campaign.mediaUrl) {
        throw new Error("La campaña necesita un adjunto antes de iniciarse");
    }

    const activeVariants = campaign.variants.filter((variant) => variant.isActive);
    if (activeVariants.length === 0) {
        throw new Error("Agrega al menos una variante activa");
    }

    if (campaign.type === "text" && !activeVariants.some((variant) => variant.content.trim())) {
        throw new Error("Agrega contenido a por lo menos una variante antes de iniciar");
    }
}

function buildAudienceWhere(filters: BulkCampaignAudienceFilters): Prisma.ContactWhereInput {
    const query = filters.query.trim();

    return {
        phone: {
            not: "",
        },
        bulkCampaignOptOutAt: null,
        ...(filters.statuses.length > 0 ? { status: { in: filters.statuses } } : {}),
        ...(filters.tags.length > 0 ? { tags: { hasEvery: filters.tags } } : {}),
        ...(query
            ? {
                OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    { lastName: { contains: query, mode: "insensitive" } },
                    { company: { contains: query, mode: "insensitive" } },
                    { email: { contains: query, mode: "insensitive" } },
                    { phone: { contains: query, mode: "insensitive" } },
                ],
            }
            : {}),
    };
}

const AUDIENCE_CONTACT_SELECT = {
    id: true,
    name: true,
    lastName: true,
    company: true,
    email: true,
    phone: true,
    status: true,
    tags: true,
    bulkCampaignOptOutAt: true,
    updatedAt: true,
    createdAt: true,
} satisfies Prisma.ContactSelect;

type AudienceContactRecord = Prisma.ContactGetPayload<{
    select: typeof AUDIENCE_CONTACT_SELECT;
}>;

export type BulkCampaignAudiencePreviewRecipient = {
    key: string;
    contactId: string | null;
    name: string;
    company: string;
    phone: string;
    status: string | null;
    source: "crm" | "manual";
    matchedBy: "filters" | "selected" | "manual";
};

export type BulkCampaignAudiencePreview = {
    candidates: AudienceContactRecord[];
    selectedContacts: AudienceContactRecord[];
    finalRecipients: BulkCampaignAudiencePreviewRecipient[];
    totals: {
        candidates: number;
        filterMatches: number;
        selectedContacts: number;
        manualRecipients: number;
        finalRecipients: number;
        crmRecipients: number;
    };
    sourceBreakdown: Array<{
        label: string;
        value: number;
    }>;
    statusBreakdown: Array<{
        status: string;
        value: number;
    }>;
};

async function loadFilterAudienceContacts(
    filters: BulkCampaignAudienceFilters,
    take = filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
) {
    return prisma.contact.findMany({
        where: buildAudienceWhere(filters),
        orderBy: [
            { updatedAt: "desc" },
            { createdAt: "desc" },
        ],
        take,
        select: AUDIENCE_CONTACT_SELECT,
    });
}

async function loadSelectedAudienceContacts(selectedContactIds: string[]) {
    if (selectedContactIds.length === 0) {
        return [] as AudienceContactRecord[];
    }

    const contacts = await prisma.contact.findMany({
        where: {
            id: {
                in: selectedContactIds,
            },
            phone: {
                not: "",
            },
            bulkCampaignOptOutAt: null,
        },
        select: AUDIENCE_CONTACT_SELECT,
    });

    const orderMap = new Map(selectedContactIds.map((id, index) => [id, index]));
    return contacts.sort((left, right) => (orderMap.get(left.id) ?? 0) - (orderMap.get(right.id) ?? 0));
}

function buildAudiencePreviewRecipientKey(recipient: {
    contactId?: string | null;
    phone?: string | null;
}) {
    const normalizedPhone = normalizePhoneDigits(recipient.phone);
    if (normalizedPhone) {
        return `phone:${normalizedPhone}`;
    }
    if (recipient.contactId) {
        return `contact:${recipient.contactId}`;
    }
    return crypto.randomUUID();
}

function buildPreviewRecipientFromContact(
    contact: AudienceContactRecord,
    matchedBy: "filters" | "selected",
): BulkCampaignAudiencePreviewRecipient {
    return {
        key: buildAudiencePreviewRecipientKey({ contactId: contact.id, phone: contact.phone }),
        contactId: contact.id,
        name: [contact.name, contact.lastName].filter(Boolean).join(" ").trim() || contact.phone || "Sin nombre",
        company: contact.company || "",
        phone: contact.phone || "",
        status: contact.status || null,
        source: "crm",
        matchedBy,
    };
}

function buildPreviewRecipientFromManualEntry(entry: BulkCampaignManualEntry): BulkCampaignAudiencePreviewRecipient {
    return {
        key: buildAudiencePreviewRecipientKey({ phone: entry.phone }),
        contactId: null,
        name: entry.name || entry.phone,
        company: entry.company || "",
        phone: entry.phone,
        status: null,
        source: "manual",
        matchedBy: "manual",
    };
}

function dedupePreviewRecipients(recipients: BulkCampaignAudiencePreviewRecipient[]) {
    const byKey = new Map<string, BulkCampaignAudiencePreviewRecipient>();

    for (const recipient of recipients) {
        const existing = byKey.get(recipient.key);
        if (!existing) {
            byKey.set(recipient.key, recipient);
            continue;
        }

        if (existing.source === "manual" && recipient.source === "crm") {
            byKey.set(recipient.key, recipient);
        }
    }

    return Array.from(byKey.values());
}

function mergeAudienceContactsByMode(
    mode: BulkCampaignAudienceMode,
    filterContacts: AudienceContactRecord[],
    selectedContacts: AudienceContactRecord[],
) {
    if (mode === "selected") {
        return selectedContacts;
    }

    if (mode === "mixed") {
        const map = new Map<string, AudienceContactRecord>();
        for (const contact of filterContacts) {
            map.set(contact.id, contact);
        }
        for (const contact of selectedContacts) {
            map.set(contact.id, contact);
        }
        return Array.from(map.values());
    }

    return filterContacts;
}

async function countAudienceContacts(filters: BulkCampaignAudienceFilters) {
    const [filterMatchesCount, filterContacts, selectedContacts] = await Promise.all([
        prisma.contact.count({
            where: buildAudienceWhere(filters),
        }),
        filters.mode === "selected"
            ? Promise.resolve([] as AudienceContactRecord[])
            : loadFilterAudienceContacts(filters, filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT),
        loadSelectedAudienceContacts(filters.selectedContactIds),
    ]);

    const recipients = dedupePreviewRecipients([
        ...mergeAudienceContactsByMode(filters.mode, filterContacts, selectedContacts).map((contact) =>
            buildPreviewRecipientFromContact(contact, "filters"),
        ),
        ...filters.manualEntries.map((entry) => buildPreviewRecipientFromManualEntry(entry)),
    ]);

    return {
        totalRecipients: recipients.length,
        filterMatchesCount,
        selectedContactsCount: selectedContacts.length,
        manualRecipientsCount: recipients.filter((recipient) => recipient.source === "manual").length,
    };
}

async function findExistingContactForPhone(phone: string) {
    const phoneClauses = buildPhoneMatchClauses([phone]);
    if (phoneClauses.length === 0) return null;

    return prisma.contact.findFirst({
        where: {
            OR: phoneClauses,
        },
    });
}

async function materializeManualAudienceContacts(entries: BulkCampaignManualEntry[]) {
    const contacts: Contact[] = [];

    for (const entry of entries) {
        const normalizedPhone = normalizePhoneDigits(entry.phone);
        if (!normalizedPhone) continue;

        const existing = await findExistingContactForPhone(normalizedPhone);
        if (existing) {
            const needsUpdate = (!existing.name && entry.name) || (!existing.company && entry.company);
            const contact = needsUpdate
                ? await prisma.contact.update({
                    where: { id: existing.id },
                    data: {
                        ...(entry.name && !existing.name ? { name: entry.name } : {}),
                        ...(entry.company && !existing.company ? { company: entry.company } : {}),
                    },
                })
                : existing;
            contacts.push(contact);
            continue;
        }

        contacts.push(await prisma.contact.create({
            data: {
                phone: normalizedPhone,
                name: entry.name || null,
                company: entry.company || null,
                status: "lead",
            },
        }));
    }

    return contacts;
}

async function resolveBulkCampaignAudienceContacts(filters: BulkCampaignAudienceFilters) {
    const [filterContacts, selectedContacts] = await Promise.all([
        filters.mode === "selected"
            ? Promise.resolve([] as AudienceContactRecord[])
            : loadFilterAudienceContacts(filters, filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT),
        loadSelectedAudienceContacts(filters.selectedContactIds),
    ]);

    const crmContacts = mergeAudienceContactsByMode(filters.mode, filterContacts, selectedContacts);
    const manualContacts = await materializeManualAudienceContacts(filters.manualEntries);
    const deduped = new Map<string, Contact | AudienceContactRecord>();

    for (const contact of crmContacts) {
        deduped.set(buildAudiencePreviewRecipientKey({ contactId: contact.id, phone: contact.phone }), contact);
    }

    for (const contact of manualContacts) {
        const key = buildAudiencePreviewRecipientKey({ contactId: contact.id, phone: contact.phone });
        if (!deduped.has(key)) {
            deduped.set(key, contact);
        }
    }

    return Array.from(deduped.values()).filter((contact) => !contact.bulkCampaignOptOutAt);
}

function buildRecipientQueueRows(
    campaignId: string,
    contactIds: string[],
    followUpCount: number,
    initialPlannedAt: Date,
    followUpDelayDays: number,
) {
    const rows: Array<{
        campaignId: string;
        contactId: string;
        status: "queued";
        sequenceIndex: number;
        attemptNumber: number;
        plannedAt: Date;
    }> = [];

    for (let attemptNumber = 0; attemptNumber <= followUpCount; attemptNumber += 1) {
        const plannedAt = new Date(
            initialPlannedAt.getTime() +
            (attemptNumber * Math.max(1, followUpDelayDays) * 24 * 60 * 60 * 1000),
        );

        for (let index = 0; index < contactIds.length; index += 1) {
            const contactId = contactIds[index];
            if (!contactId) continue;

            rows.push({
                campaignId,
                contactId,
                status: "queued",
                sequenceIndex: attemptNumber * contactIds.length + index,
                attemptNumber,
                plannedAt: new Date(plannedAt),
            });
        }
    }

    return rows;
}

export async function getBulkCampaignAudiencePreview(filters: BulkCampaignAudienceFilters) {
    const [candidateContacts, filterContacts, selectedContacts, filterMatchesCount] = await Promise.all([
        loadFilterAudienceContacts(filters, Math.min(120, filters.limit ?? 120)),
        filters.mode === "selected"
            ? Promise.resolve([] as AudienceContactRecord[])
            : loadFilterAudienceContacts(filters, filters.limit ?? MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT),
        loadSelectedAudienceContacts(filters.selectedContactIds),
        prisma.contact.count({
            where: buildAudienceWhere(filters),
        }),
    ]);

    const previewRecipients = dedupePreviewRecipients([
        ...mergeAudienceContactsByMode(filters.mode, filterContacts, selectedContacts).map((contact) =>
            buildPreviewRecipientFromContact(
                contact,
                filterContacts.some((candidate) => candidate.id === contact.id) ? "filters" : "selected",
            ),
        ),
        ...filters.manualEntries.map((entry) => buildPreviewRecipientFromManualEntry(entry)),
    ]);

    const sourceBreakdown = [
        { label: "CRM", value: previewRecipients.filter((recipient) => recipient.source === "crm").length },
        { label: "Manuales", value: previewRecipients.filter((recipient) => recipient.source === "manual").length },
    ].filter((entry) => entry.value > 0);

    const statusMap = new Map<string, number>();
    for (const recipient of previewRecipients) {
        const key = recipient.status || "manual";
        statusMap.set(key, (statusMap.get(key) || 0) + 1);
    }

    const statusBreakdown = Array.from(statusMap.entries())
        .map(([status, value]) => ({ status, value }))
        .sort((left, right) => right.value - left.value);

    return {
        candidates: candidateContacts,
        selectedContacts,
        finalRecipients: previewRecipients.slice(0, 18),
        totals: {
            candidates: candidateContacts.length,
            filterMatches: filterMatchesCount,
            selectedContacts: selectedContacts.length,
            manualRecipients: previewRecipients.filter((recipient) => recipient.source === "manual").length,
            finalRecipients: previewRecipients.length,
            crmRecipients: previewRecipients.filter((recipient) => recipient.source === "crm").length,
        },
        sourceBreakdown,
        statusBreakdown,
    } satisfies BulkCampaignAudiencePreview;
}

export async function refreshBulkCampaignStats(campaignId: string) {
    const [campaign, distinctRecipients, sentCount, failedCount, distinctReplies, skippedCount, queuedCount] = await prisma.$transaction([
        prisma.bulkCampaign.findUnique({
            where: { id: campaignId },
            select: {
                id: true,
                status: true,
                completedAt: true,
            },
        }),
        prisma.bulkCampaignRecipient.findMany({
            where: { campaignId },
            distinct: ["contactId"],
            select: { contactId: true },
        }),
        prisma.bulkCampaignRecipient.count({ where: { campaignId, sentAt: { not: null } } }),
        prisma.bulkCampaignRecipient.count({ where: { campaignId, status: "failed" } }),
        prisma.bulkCampaignRecipient.findMany({
            where: { campaignId, repliedAt: { not: null } },
            distinct: ["contactId"],
            select: { contactId: true },
        }),
        prisma.bulkCampaignRecipient.count({
            where: {
                campaignId,
                status: {
                    in: ["skipped", "cancelled"],
                },
            },
        }),
        prisma.bulkCampaignRecipient.count({ where: { campaignId, status: "queued" } }),
    ]);

    if (!campaign) {
        return null;
    }

    const shouldMarkCompleted = campaign.status === "running" && queuedCount === 0;

    return prisma.bulkCampaign.update({
        where: { id: campaignId },
        data: {
            totalRecipients: distinctRecipients.length,
            sentCount,
            failedCount,
            repliedCount: distinctReplies.length,
            skippedCount,
            ...(shouldMarkCompleted
                ? {
                    status: "completed",
                    completedAt: campaign.completedAt || new Date(),
                    nextRunAt: null,
                }
                : {}),
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function listBulkCampaigns() {
    return prisma.bulkCampaign.findMany({
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
        orderBy: [
            { updatedAt: "desc" },
            { createdAt: "desc" },
        ],
    });
}

export async function getBulkCampaignById(id: string) {
    return prisma.bulkCampaign.findUnique({
        where: { id },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function createBulkCampaign(input: BulkCampaignUpsertInput, createdById?: string | null) {
    ensureCampaignDraftIsValid(input);
    const estimatedRecipients = await countAudienceContacts(input.audienceFilters);

    return prisma.bulkCampaign.create({
        data: {
            name: input.name,
            description: input.description || null,
            type: input.type,
            mediaUrl: input.mediaUrl,
            mediaType: input.mediaType,
            mediaFileName: input.mediaFileName,
            batchSize: input.batchSize,
            batchDelayMinutes: input.batchDelayMinutes,
            randomDelayMinSeconds: input.randomDelayMinSeconds,
            randomDelayMaxSeconds: input.randomDelayMaxSeconds,
            scheduledStartAt: input.scheduledStartAt,
            respectBusinessHours: input.respectBusinessHours,
            stopOnReply: input.stopOnReply,
            followUpCount: input.followUpCount,
            followUpDelayDays: input.followUpDelayDays,
            audienceFilters: input.audienceFilters,
            totalRecipients: estimatedRecipients.totalRecipients,
            createdById: createdById || null,
            variants: {
                create: input.variants.map((variant) => ({
                    label: variant.label,
                    content: variant.content,
                    weight: variant.weight,
                    sortOrder: variant.sortOrder,
                    isActive: variant.isActive,
                    variables: listTemplateVariableKeys(variant.content),
                })),
            },
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function updateBulkCampaign(id: string, input: BulkCampaignUpsertInput) {
    ensureCampaignDraftIsValid(input);
    const existing = await prisma.bulkCampaign.findUnique({
        where: { id },
        include: {
            variants: true,
        },
    });

    if (!existing) {
        throw new Error("Campaña no encontrada");
    }

    if (existing.status === "running" || existing.status === "paused") {
        throw new Error("Pausa o termina la campaña antes de editar su configuración");
    }

    const estimatedRecipients = await countAudienceContacts(input.audienceFilters);

    await prisma.$transaction(async (tx) => {
        await tx.bulkCampaign.update({
            where: { id },
            data: {
                name: input.name,
                description: input.description || null,
                type: input.type,
                mediaUrl: input.mediaUrl,
                mediaType: input.mediaType,
                mediaFileName: input.mediaFileName,
                batchSize: input.batchSize,
                batchDelayMinutes: input.batchDelayMinutes,
                randomDelayMinSeconds: input.randomDelayMinSeconds,
                randomDelayMaxSeconds: input.randomDelayMaxSeconds,
                scheduledStartAt: input.scheduledStartAt,
                respectBusinessHours: input.respectBusinessHours,
                stopOnReply: input.stopOnReply,
                followUpCount: input.followUpCount,
                followUpDelayDays: input.followUpDelayDays,
                audienceFilters: input.audienceFilters,
                totalRecipients: estimatedRecipients.totalRecipients,
                completedAt: null,
            },
        });

        await tx.bulkCampaignVariant.deleteMany({
            where: { campaignId: id },
        });

        if (input.variants.length > 0) {
            await tx.bulkCampaignVariant.createMany({
                data: input.variants.map((variant) => ({
                    campaignId: id,
                    label: variant.label,
                    content: variant.content,
                    weight: variant.weight,
                    sortOrder: variant.sortOrder,
                    isActive: variant.isActive,
                    variables: listTemplateVariableKeys(variant.content),
                })),
            });
        }
    });

    return getBulkCampaignById(id);
}

export async function startBulkCampaign(id: string) {
    const campaign = await prisma.bulkCampaign.findUnique({
        where: { id },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!campaign) {
        throw new Error("Campaña no encontrada");
    }

    ensureCampaignCanLaunch(campaign);

    const filters = normalizeBulkCampaignAudienceFilters(
        campaign.audienceFilters,
        MAX_BULK_CAMPAIGN_AUDIENCE_LIMIT,
    );
    const contacts = await resolveBulkCampaignAudienceContacts(filters);

    if (contacts.length === 0) {
        throw new Error("No hay contactos que coincidan con la audiencia seleccionada");
    }

    const now = new Date();
    const nextRunAt = campaign.scheduledStartAt && campaign.scheduledStartAt.getTime() > now.getTime()
        ? campaign.scheduledStartAt
        : now;

    await prisma.$transaction(async (tx) => {
        await tx.bulkCampaignRecipient.deleteMany({
            where: { campaignId: id },
        });

        await tx.bulkCampaignRecipient.createMany({
            data: buildRecipientQueueRows(
                id,
                contacts.map((contact) => contact.id),
                Math.max(0, campaign.followUpCount || 0),
                nextRunAt,
                Math.max(1, campaign.followUpDelayDays || 1),
            ),
        });

        await tx.bulkCampaign.update({
            where: { id },
            data: {
                status: "running",
                totalRecipients: contacts.length,
                sentCount: 0,
                failedCount: 0,
                repliedCount: 0,
                skippedCount: 0,
                startedAt: now,
                completedAt: null,
                lastProcessedAt: null,
                nextRunAt,
                workerLockId: null,
                workerLockExpiresAt: null,
            },
        });
    });

    return getBulkCampaignById(id);
}

export async function pauseBulkCampaign(id: string) {
    return prisma.bulkCampaign.update({
        where: { id },
        data: {
            status: "paused",
            nextRunAt: null,
            workerLockId: null,
            workerLockExpiresAt: null,
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function resumeBulkCampaign(id: string) {
    const existing = await prisma.bulkCampaign.findUnique({
        where: { id },
        select: {
            status: true,
            scheduledStartAt: true,
        },
    });

    if (!existing) {
        throw new Error("Campaña no encontrada");
    }

    if (existing.status === "draft") {
        return startBulkCampaign(id);
    }

    return prisma.bulkCampaign.update({
        where: { id },
        data: {
            status: "running",
            completedAt: null,
            nextRunAt: existing.scheduledStartAt && existing.scheduledStartAt.getTime() > Date.now()
                ? existing.scheduledStartAt
                : new Date(),
            workerLockId: null,
            workerLockExpiresAt: null,
        },
        include: {
            variants: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function cancelBulkCampaign(id: string) {
    await prisma.$transaction(async (tx) => {
        await tx.bulkCampaignRecipient.updateMany({
            where: {
                campaignId: id,
                status: "queued",
            },
            data: {
                status: "cancelled",
            },
        });

        await tx.bulkCampaign.update({
            where: { id },
            data: {
                status: "cancelled",
                nextRunAt: null,
                workerLockId: null,
                workerLockExpiresAt: null,
                completedAt: new Date(),
            },
        });
    });

    return getBulkCampaignById(id);
}

export async function deleteBulkCampaign(id: string) {
    await prisma.bulkCampaign.delete({
        where: { id },
    });
}

function chooseVariant(variants: BulkCampaignVariant[], campaignType: OutboundMessageType) {
    const activeVariants = variants.filter((variant) =>
        variant.isActive && (campaignType !== "text" || variant.content.trim()),
    );
    const totalWeight = activeVariants.reduce((sum, variant) => sum + Math.max(1, variant.weight), 0);
    if (totalWeight <= 0) {
        return activeVariants[0] || null;
    }

    let cursor = Math.random() * totalWeight;

    for (const variant of activeVariants) {
        cursor -= Math.max(1, variant.weight);
        if (cursor <= 0) {
            return variant;
        }
    }

    return activeVariants[0] || null;
}

function resolveBulkCampaignRandomDelayMs(
    campaign: Pick<BulkCampaign, "randomDelayMinSeconds" | "randomDelayMaxSeconds">,
) {
    const minSeconds = Math.max(1, campaign.randomDelayMinSeconds || 0);
    const maxSeconds = Math.max(minSeconds, campaign.randomDelayMaxSeconds || minSeconds);

    if (minSeconds === maxSeconds) {
        return minSeconds * 1000;
    }

    const offset = Math.floor(Math.random() * (maxSeconds - minSeconds + 1));
    return (minSeconds + offset) * 1000;
}

async function releaseCampaignLock(campaignId: string, lockId: string, data?: Prisma.BulkCampaignUpdateInput) {
    await prisma.bulkCampaign.updateMany({
        where: {
            id: campaignId,
            workerLockId: lockId,
        },
        data: {
            workerLockId: null,
            workerLockExpiresAt: null,
            ...(data || {}),
        },
    });
}

async function resolveNextCampaignRunAt(campaign: Pick<BulkCampaign, "respectBusinessHours">, now: Date) {
    if (!campaign.respectBusinessHours) {
        return now;
    }

    const settings = await getSystemSettingsOrDefaults();
    const config = normalizeBusinessHours(settings);
    const bounds = businessBoundsForDate(now, config);

    if (!bounds.isOpen) {
        const nextOpenDate = getNextOpenDate(now, config);
        return businessBoundsForDate(nextOpenDate, config).start;
    }

    if (now < bounds.start) {
        return bounds.start;
    }

    if (now >= bounds.end) {
        const tomorrow = new Date(now);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const nextOpenDate = getNextOpenDate(tomorrow, config);
        return businessBoundsForDate(nextOpenDate, config).start;
    }

    return now;
}

async function moveContactDealsToClosedLostStage(contactId: string) {
    const closedLostStage = await prisma.pipelineStage.findFirst({
        where: { isClosedLost: true },
        select: { id: true },
    });

    if (!closedLostStage) {
        return false;
    }

    const openDeals = await prisma.deal.findMany({
        where: {
            contactId,
            stage: {
                isClosedWon: false,
                isClosedLost: false,
            },
        },
        select: { id: true },
    });

    if (openDeals.length === 0) {
        return false;
    }

    await prisma.deal.updateMany({
        where: {
            id: {
                in: openDeals.map((deal) => deal.id),
            },
        },
        data: {
            stageId: closedLostStage.id,
        },
    });

    return true;
}

async function moveContactIncomingDealsToThirdStage(contactId: string) {
    const pipelineStages = await prisma.pipelineStage.findMany({
        where: {
            isClosedWon: false,
            isClosedLost: false,
        },
        orderBy: { order: "asc" },
        select: {
            id: true,
            isIncoming: true,
        },
    });

    const thirdStage = pipelineStages[2];
    if (!thirdStage || thirdStage.isIncoming) {
        return false;
    }

    const incomingDeals = await prisma.deal.findMany({
        where: {
            contactId,
            stage: {
                isIncoming: true,
            },
        },
        select: { id: true },
    });

    if (incomingDeals.length === 0) {
        return false;
    }

    await prisma.deal.updateMany({
        where: {
            id: {
                in: incomingDeals.map((deal) => deal.id),
            },
        },
        data: {
            stageId: thirdStage.id,
        },
    });

    return true;
}

async function getNextQueuedRecipientForCampaign(campaignId: string) {
    return prisma.bulkCampaignRecipient.findFirst({
        where: {
            campaignId,
            status: "queued",
        },
        orderBy: [
            { plannedAt: "asc" },
            { sequenceIndex: "asc" },
        ],
        select: {
            id: true,
            plannedAt: true,
            sequenceIndex: true,
        },
    });
}

async function releaseCampaignLockForNextRecipient(
    campaign: Pick<BulkCampaign, "id" | "batchSize" | "batchDelayMinutes" | "randomDelayMinSeconds" | "randomDelayMaxSeconds" | "totalRecipients">,
    lockId: string,
    processedSequenceIndex: number | null,
    now = new Date(),
) {
    const nextQueuedRecipient = await getNextQueuedRecipientForCampaign(campaign.id);

    if (!nextQueuedRecipient) {
        const refreshed = await refreshBulkCampaignStats(campaign.id);
        await releaseCampaignLock(campaign.id, lockId, {
            status: "completed",
            completedAt: refreshed?.completedAt || now,
            nextRunAt: null,
            lastProcessedAt: now,
        });
        return;
    }

    if (nextQueuedRecipient.plannedAt.getTime() > now.getTime()) {
        await releaseCampaignLock(campaign.id, lockId, {
            nextRunAt: nextQueuedRecipient.plannedAt,
            lastProcessedAt: now,
        });
        return;
    }

    const perWaveRecipientCount = Math.max(1, campaign.totalRecipients || 1);
    const currentWaveOffset = processedSequenceIndex === null
        ? null
        : processedSequenceIndex % perWaveRecipientCount;
    const processedBoundary = currentWaveOffset !== null &&
        (currentWaveOffset + 1) % Math.max(1, campaign.batchSize) === 0;
    const usesBatchPause = processedBoundary && Math.max(0, campaign.batchDelayMinutes) > 0;

    await releaseCampaignLock(campaign.id, lockId, {
        nextRunAt: new Date(
            now.getTime() + (
                usesBatchPause
                    ? Math.max(0, campaign.batchDelayMinutes) * 60_000
                    : resolveBulkCampaignRandomDelayMs(campaign)
            ),
        ),
        lastProcessedAt: now,
    });
}

async function processClaimedCampaign(campaignId: string, lockId: string) {
    const campaign = await prisma.bulkCampaign.findUnique({
        where: { id: campaignId },
        include: {
            variants: {
                where: {
                    isActive: true,
                },
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!campaign || campaign.workerLockId !== lockId || campaign.status !== "running") {
        return;
    }

    try {
        if (campaign.variants.length === 0) {
            await releaseCampaignLock(campaignId, lockId, {
                status: "failed",
                nextRunAt: null,
                lastProcessedAt: new Date(),
            });
            return;
        }

        const now = new Date();
        const nextAllowedRunAt = await resolveNextCampaignRunAt(campaign, now);
        if (nextAllowedRunAt.getTime() > now.getTime()) {
            await releaseCampaignLock(campaignId, lockId, {
                nextRunAt: nextAllowedRunAt,
                lastProcessedAt: now,
            });
            return;
        }

        const recipients = await prisma.bulkCampaignRecipient.findMany({
            where: {
                campaignId,
                status: "queued",
                plannedAt: {
                    lte: now,
                },
            },
            include: {
                contact: true,
            },
            orderBy: [
                { plannedAt: "asc" },
                { sequenceIndex: "asc" },
            ],
            take: 1,
        });

        if (recipients.length === 0) {
            const nextQueuedRecipient = await getNextQueuedRecipientForCampaign(campaignId);
            if (!nextQueuedRecipient) {
                await refreshBulkCampaignStats(campaignId);
                await releaseCampaignLock(campaignId, lockId, {
                    status: "completed",
                    completedAt: new Date(),
                    nextRunAt: null,
                    lastProcessedAt: now,
                });
                return;
            }

            await releaseCampaignLock(campaignId, lockId, {
                nextRunAt: nextQueuedRecipient.plannedAt,
                lastProcessedAt: now,
            });
            return;
        }

        const recipient = recipients[0];
        if (!recipient) {
            await releaseCampaignLock(campaignId, lockId, {
                status: "completed",
                completedAt: new Date(),
                nextRunAt: null,
                lastProcessedAt: now,
            });
            return;
        }

        let skipReason: string | null = null;

        if (recipient.contact.bulkCampaignOptOutAt) {
            skipReason = "Contacto bloqueado para envios masivos por solicitud STOP";
            await prisma.bulkCampaignRecipient.updateMany({
                where: {
                    contactId: recipient.contactId,
                    status: "queued",
                },
                data: {
                    status: "skipped",
                    lastError: skipReason,
                },
            });
        } else if (recipient.attemptNumber > 0) {
            const previousAttempt = await prisma.bulkCampaignRecipient.findUnique({
                where: {
                    campaignId_contactId_attemptNumber: {
                        campaignId,
                        contactId: recipient.contactId,
                        attemptNumber: recipient.attemptNumber - 1,
                    },
                },
                select: {
                    status: true,
                    sentAt: true,
                    repliedAt: true,
                },
            });

            if (!previousAttempt?.sentAt || previousAttempt.status !== "sent" || previousAttempt.repliedAt) {
                skipReason = previousAttempt?.status === "replied" || previousAttempt?.repliedAt
                    ? "Seguimiento detenido porque el lead ya respondio"
                    : "Seguimiento omitido porque el intento anterior no se envio correctamente";

                await prisma.bulkCampaignRecipient.updateMany({
                    where: {
                        campaignId,
                        contactId: recipient.contactId,
                        status: "queued",
                        attemptNumber: {
                            gte: recipient.attemptNumber,
                        },
                    },
                    data: {
                        status: "skipped",
                        lastError: skipReason,
                    },
                });
            }
        }

        if (skipReason) {
            await refreshBulkCampaignStats(campaignId);
            await releaseCampaignLockForNextRecipient(
                campaign,
                lockId,
                recipient.sequenceIndex,
                new Date(),
            );
            return;
        }

        const settings = await getSystemSettingsOrDefaults();
        const variant = chooseVariant(campaign.variants, campaign.type as OutboundMessageType);

        if (!variant) {
            await prisma.bulkCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "failed",
                    lastError: "No hay variantes activas disponibles",
                },
            });
        } else {
            try {
                const conversation = recipient.conversationId
                    ? await prisma.conversation.findUnique({ where: { id: recipient.conversationId } })
                    : await findOrCreateActiveConversationForContact(recipient.contactId);
                const activeConversation = conversation || await findOrCreateActiveConversationForContact(recipient.contactId);
                const renderedContent = renderTemplateContent(variant.content || "", {
                    contact: {
                        name: recipient.contact.name,
                        company: recipient.contact.company,
                        phone: recipient.contact.phone,
                    },
                    agentName: settings.agentName,
                });

                const result = await sendOutboundConversationMessage({
                    conversationId: activeConversation.id,
                    content: renderedContent,
                    type: campaign.type as OutboundMessageType,
                    mediaUrl: campaign.type === "text" ? null : campaign.mediaUrl,
                    mediaType: campaign.type === "text" ? null : campaign.mediaType,
                    mediaFileName: campaign.type === "text" ? null : campaign.mediaFileName,
                    senderType: "human",
                    botActiveOverride: true,
                });

                await prisma.bulkCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: {
                        status: "sent",
                        conversationId: activeConversation.id,
                        variantId: variant.id,
                        renderedContent,
                        providerMessageId: result.message.providerMessageId || null,
                        sentAt: new Date(),
                        lastError: null,
                    },
                });

                if (recipient.attemptNumber === 0) {
                    try {
                        await moveContactIncomingDealsToThirdStage(recipient.contactId);
                    } catch (stageMoveError) {
                        console.warn(
                            "[BulkCampaigns] Failed to move incoming deals to third stage after initial bulk send",
                            stageMoveError,
                        );
                    }
                }
            } catch (error) {
                await prisma.bulkCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: {
                        status: "failed",
                        lastError: error instanceof Error ? error.message : "No se pudo enviar el mensaje",
                    },
                });
            }
        }

        await refreshBulkCampaignStats(campaignId);
        await releaseCampaignLockForNextRecipient(
            campaign,
            lockId,
            recipient.sequenceIndex,
            new Date(),
        );
    } catch (error) {
        console.error("[BulkCampaigns] Failed to process campaign", campaignId, error);
        await releaseCampaignLock(campaignId, lockId, {
            status: "failed",
            nextRunAt: null,
            lastProcessedAt: new Date(),
        });
    }
}

export async function processDueBulkCampaigns(limit = 3) {
    const now = new Date();
    const candidates = await prisma.bulkCampaign.findMany({
        where: {
            status: "running",
            nextRunAt: {
                lte: now,
            },
            OR: [
                { workerLockExpiresAt: null },
                { workerLockExpiresAt: { lt: now } },
            ],
        },
        orderBy: { nextRunAt: "asc" },
        take: Math.max(1, limit),
    });

    for (const campaign of candidates) {
        const lockId = crypto.randomUUID();
        const claimed = await prisma.bulkCampaign.updateMany({
            where: {
                id: campaign.id,
                status: "running",
                OR: [
                    { workerLockExpiresAt: null },
                    { workerLockExpiresAt: { lt: now } },
                ],
            },
            data: {
                workerLockId: lockId,
                workerLockExpiresAt: new Date(Date.now() + WORKER_LOCK_TTL_MS),
            },
        });

        if (claimed.count === 1) {
            await processClaimedCampaign(campaign.id, lockId);
        }
    }
}

export async function markBulkCampaignReplyForContact(
    contactId: string,
    conversationId: string | null,
    rawText: string,
    repliedAt = new Date(),
) {
    const intent = classifyBulkCampaignReplyIntent(rawText);
    const shouldStopAllQueued = intent === "stop" || intent === "interest";

    const sentRecipients = await prisma.bulkCampaignRecipient.findMany({
        where: {
            contactId,
            sentAt: { not: null },
            repliedAt: null,
            ...(intent !== "neutral"
                ? {}
                : {
                    campaign: {
                        stopOnReply: true,
                    },
                }),
        },
        select: {
            id: true,
            campaignId: true,
        },
    });

    const queuedRecipients = await prisma.bulkCampaignRecipient.findMany({
        where: {
            contactId,
            status: "queued",
            ...(shouldStopAllQueued
                ? {}
                : {
                    campaignId: {
                        in: sentRecipients.map((recipient) => recipient.campaignId),
                    },
                }),
        },
        select: {
            id: true,
            campaignId: true,
        },
    });

    if (
        sentRecipients.length === 0 &&
        queuedRecipients.length === 0 &&
        intent !== "stop"
    ) {
        return {
            intent,
            stoppedCampaignIds: [],
            activatedBot: false,
            optedOut: false,
        } satisfies BulkCampaignReplyHandlingResult;
    }

    await prisma.$transaction(async (tx) => {
        if (sentRecipients.length > 0) {
            await tx.bulkCampaignRecipient.updateMany({
                where: {
                    id: {
                        in: sentRecipients.map((recipient) => recipient.id),
                    },
                },
                data: {
                    status: "replied",
                    repliedAt,
                    lastInboundAt: repliedAt,
                    conversationId: conversationId || undefined,
                },
            });
        }

        if (queuedRecipients.length > 0) {
            await tx.bulkCampaignRecipient.updateMany({
                where: {
                    id: {
                        in: queuedRecipients.map((recipient) => recipient.id),
                    },
                },
                data: {
                    status: "skipped",
                    lastError: intent === "stop"
                        ? "Seguimiento cancelado por solicitud STOP del lead"
                        : intent === "interest"
                            ? "Seguimiento cancelado porque el lead mostro interes"
                            : "Seguimiento cancelado porque el lead respondio",
                    lastInboundAt: repliedAt,
                },
            });
        }

        if (intent === "stop") {
            await tx.contact.update({
                where: { id: contactId },
                data: {
                    bulkCampaignOptOutAt: repliedAt,
                    bulkCampaignOptOutReason: rawText.trim().slice(0, 160) || "stop",
                },
            });
        }
    });

    if (intent === "stop") {
        await moveContactDealsToClosedLostStage(contactId);
    }

    const campaignIds = [...sentRecipients, ...queuedRecipients]
        .map((recipient) => recipient.campaignId)
        .filter((campaignId, index, array) => array.indexOf(campaignId) === index);

    for (const campaignId of campaignIds) {
        await refreshBulkCampaignStats(campaignId);
    }

    return {
        intent,
        stoppedCampaignIds: campaignIds,
        activatedBot: false,
        optedOut: intent === "stop",
    } satisfies BulkCampaignReplyHandlingResult;
}
