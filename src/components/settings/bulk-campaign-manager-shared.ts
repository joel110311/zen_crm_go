import type { BulkCampaignAudienceMode, BulkCampaignManualEntry } from "@/lib/bulk-campaign-audience";

export type CampaignVariantRecord = {
    id: string;
    label: string;
    content: string;
    weight: number;
    sortOrder: number;
    isActive: boolean;
};

export type CampaignAudienceFilters = {
    mode?: BulkCampaignAudienceMode;
    statuses?: string[];
    tags?: string[];
    query?: string;
    limit?: number | null;
    sourceType?: "any" | "wuzapi" | "meta";
    sourceId?: string;
    onlyOpenMetaWindow?: boolean;
    onlyOpenOfficialWindow?: boolean;
    lastInboundFrom?: string;
    lastInboundTo?: string;
    selectedContactIds?: string[];
    manualEntries?: BulkCampaignManualEntry[];
};

export type CampaignMessageType = "text" | "image" | "document" | "template";

export type MetaCampaignTemplateComponent = {
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
};

export type CampaignRecord = {
    id: string;
    name: string;
    description: string | null;
    status: string;
    audienceFilters: CampaignAudienceFilters | null;
    sourceType?: "wuzapi" | "meta";
    sourceId?: string | null;
    type: CampaignMessageType;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFileName: string | null;
    metaTemplateName?: string | null;
    metaTemplateLanguage?: string | null;
    metaTemplateComponents?: MetaCampaignTemplateComponent[] | null;
    metaTemplateVariableValues?: Record<string, string> | null;
    batchSize: number;
    batchDelayMinutes: number;
    randomDelayMinSeconds: number;
    randomDelayMaxSeconds: number;
    scheduledStartAt: string | null;
    respectBusinessHours: boolean;
    stopOnReply: boolean;
    followUpCount: number;
    followUpDelayDays: number;
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    repliedCount: number;
    skippedCount: number;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    variants: CampaignVariantRecord[];
};

export type PreviewContactRecord = {
    id: string;
    name: string | null;
    lastName: string | null;
    company: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    tags: string[];
    updatedAt: string;
    createdAt: string;
};

export type AudiencePreviewRecipient = {
    key: string;
    contactId: string | null;
    name: string;
    company: string;
    phone: string;
    status: string | null;
    source: "crm" | "manual";
    matchedBy: "filters" | "selected" | "manual";
};

export type AudiencePreview = {
    candidates: PreviewContactRecord[];
    selectedContacts: PreviewContactRecord[];
    finalRecipients: AudiencePreviewRecipient[];
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
    metaWindow?: {
        enabled: boolean;
        eligibleContacts: number | null;
        onlyOpenWindow: boolean;
        lastInboundFrom: string | null;
        lastInboundTo: string | null;
    };
};

export type CampaignVariantFormState = {
    label: string;
    content: string;
    weight: number;
    isActive: boolean;
};

export type CampaignFormState = {
    id: string | null;
    name: string;
    description: string;
    status: string;
    type: CampaignMessageType;
    mediaUrl: string | null;
    mediaType: string | null;
    mediaFileName: string | null;
    metaTemplateName: string;
    metaTemplateLanguage: string;
    metaTemplateComponents: MetaCampaignTemplateComponent[];
    metaTemplateVariableValues: Record<string, string>;
    batchSize: number;
    batchDelayMinutes: number;
    randomDelayMinSeconds: number;
    randomDelayMaxSeconds: number;
    scheduledStartAt: string;
    respectBusinessHours: boolean;
    stopOnReply: boolean;
    followUpCount: number;
    followUpDelayDays: number;
    sourceType: "wuzapi" | "meta";
    sourceId: string;
    audienceMode: BulkCampaignAudienceMode;
    audienceStatuses: string[];
    audienceTags: string;
    audienceQuery: string;
    audienceLimit: string;
    audienceOnlyOpenMetaWindow: boolean;
    audienceLastInboundFrom: string;
    audienceLastInboundTo: string;
    audienceSelectedContactIds: string[];
    manualAudienceText: string;
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    repliedCount: number;
    skippedCount: number;
    variants: CampaignVariantFormState[];
};

export const DEFAULT_VARIANTS: CampaignVariantFormState[] = [
    { label: "A", content: "", weight: 1, isActive: true },
];

export const EMPTY_FORM: CampaignFormState = {
    id: null,
    name: "",
    description: "",
    status: "draft",
    type: "text",
    mediaUrl: null,
    mediaType: null,
    mediaFileName: null,
    metaTemplateName: "",
    metaTemplateLanguage: "",
    metaTemplateComponents: [],
    metaTemplateVariableValues: {},
    batchSize: 3,
    batchDelayMinutes: 5,
    randomDelayMinSeconds: 25,
    randomDelayMaxSeconds: 75,
    scheduledStartAt: "",
    respectBusinessHours: true,
    stopOnReply: true,
    followUpCount: 0,
    followUpDelayDays: 2,
    sourceType: "wuzapi",
    sourceId: "",
    audienceMode: "selected",
    audienceStatuses: ["lead"],
    audienceTags: "",
    audienceQuery: "",
    audienceLimit: "",
    audienceOnlyOpenMetaWindow: true,
    audienceLastInboundFrom: "",
    audienceLastInboundTo: "",
    audienceSelectedContactIds: [],
    manualAudienceText: "",
    totalRecipients: 0,
    sentCount: 0,
    failedCount: 0,
    repliedCount: 0,
    skippedCount: 0,
    variants: DEFAULT_VARIANTS,
};

export const CONTACT_STATUSES = [
    { value: "lead", label: "Lead" },
    { value: "qualified", label: "Calificado" },
    { value: "customer", label: "Cliente" },
];

export const AUDIENCE_MODE_OPTIONS: Array<{
    value: BulkCampaignAudienceMode;
    label: string;
    hint: string;
}> = [
    {
        value: "filters",
        label: "Todo lo filtrado",
        hint: "Usa todos los contactos del CRM que coincidan con la búsqueda y filtros.",
    },
    {
        value: "selected",
        label: "Solo selección manual",
        hint: "Solo envía a los contactos que marques en la tabla, más los números manuales.",
    },
    {
        value: "mixed",
        label: "Filtros + selección",
        hint: "Combina lo filtrado con una lista fija marcada por ti.",
    },
];

export function buildVariantLabel(index: number) {
    const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return code[index] || `V${index + 1}`;
}

export function splitCommaSeparatedValues(value: string) {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export function appendCommaSeparatedValue(source: string, value: string) {
    const normalizedValue = value.trim();
    if (!normalizedValue) return source;

    const existing = splitCommaSeparatedValues(source);
    if (existing.includes(normalizedValue)) {
        return existing.join(", ");
    }

    return [...existing, normalizedValue].join(", ");
}

export function formatPhone(phone: string | null | undefined) {
    if (!phone) return "Sin teléfono";
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 12 && cleaned.startsWith("52")) {
        return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
    }
    if (cleaned.length === 10) {
        return `+52 ${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
    }
    return `+${cleaned}`;
}

export function toLocalDateTimeValue(value: string | null | undefined) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
}

export function formatDateTime(value: string | null | undefined) {
    if (!value) return "Inmediato";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Inmediato";
    return date.toLocaleString("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

export function formatFollowUpCadenceLabel(days: number) {
    const normalizedDays = Math.max(1, Math.round(days || 1));
    return normalizedDays === 1 ? "cada dia" : `cada ${normalizedDays} dias`;
}

export function formatFollowUpSpanLabel(days: number) {
    const normalizedDays = Math.max(0, Math.round(days || 0));
    if (normalizedDays <= 0) return "sin espera adicional";
    return normalizedDays === 1 ? "1 dia" : `${normalizedDays} dias`;
}

export function getStatusBadgeVariant(status: string) {
    if (status === "running") return "default";
    if (status === "paused") return "secondary";
    if (status === "completed") return "outline";
    if (status === "cancelled" || status === "failed") return "destructive";
    return "secondary";
}

export function getAudienceModeLabel(value: BulkCampaignAudienceMode) {
    return AUDIENCE_MODE_OPTIONS.find((option) => option.value === value)?.label || "Solo seleccion manual";
}

export function getPreviewMatchLabel(value: AudiencePreviewRecipient["matchedBy"]) {
    if (value === "selected") return "Lista";
    if (value === "manual") return "Manual";
    return "Filtro";
}
