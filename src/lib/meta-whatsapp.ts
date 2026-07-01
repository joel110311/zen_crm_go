import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

const DEFAULT_GRAPH_API_VERSION = "v23.0";

type MetaWhatsAppConfig = {
    accessToken: string;
    phoneNumberId: string;
    wabaId: string;
    displayPhoneNumber: string;
    graphApiVersion: string;
};

type MetaEmbeddedSignupConfig = {
    appId: string;
    appSecret: string;
    configId: string;
    solutionId: string;
    graphApiVersion: string;
    registrationPin: string;
    webhookVerifyToken: string;
    webhookBaseUrl: string;
};

type MetaApiErrorPayload = {
    error?: {
        code?: number;
        message?: string;
        error_user_msg?: string;
    };
};

type ProvisionMetaWhatsAppInput = {
    waba_id: string;
    phone_number_id: string;
    display_phone_number: string;
    access_token: string;
    business_id?: string;
    business_name?: string;
    client?: string;
};

type CompleteEmbeddedSignupInput = {
    code: string;
    wabaId: string;
    phoneNumberId: string;
    businessId?: string | null;
    client?: string | null;
};

type MetaMessageResult = {
    Id: string | null;
    raw: unknown;
};

type SendMetaMediaParams = {
    to: string;
    mediaType: "image" | "audio" | "video" | "document";
    link: string;
    caption?: string;
    fileName?: string;
};

type SendMetaTemplateParams = {
    to: string;
    templateName: string;
    languageCode?: string;
    components?: Array<Record<string, unknown>>;
};

type MetaTemplatePayload = {
    wabaId?: string;
    id?: string;
    name?: string;
    language?: string;
    category?: string;
    status?: string;
    components?: unknown[];
    createdAt?: string;
    updatedAt?: string;
};

function normalizeGraphApiVersion(value: string | null | undefined) {
    const normalized = (value || process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION).trim();
    return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

function graphBaseUrl(version?: string | null) {
    const normalizedVersion = normalizeGraphApiVersion(version);
    return `https://graph.facebook.com/${normalizedVersion.replace(/^\/+|\/+$/g, "")}`;
}

function normalizePhoneForMeta(raw: string) {
    const digits = (raw || "").replace(/\D/g, "");
    if (!digits) return "";
    return digits.length === 10 ? `52${digits}` : digits;
}

function extractMetaMessageId(payload: unknown) {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    const messages = Array.isArray(record.messages) ? record.messages : [];
    const firstMessage = messages[0];
    if (!firstMessage || typeof firstMessage !== "object") return null;
    const id = (firstMessage as Record<string, unknown>).id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
}

function normalizeTemplateSendComponents(components: Array<Record<string, unknown>> | undefined) {
    if (!components?.length) return undefined;

    return components.map((component) => {
        const type = typeof component.type === "string" ? component.type.toLowerCase() : component.type;
        return {
            ...component,
            type,
        };
    });
}

function extractMetaErrorMessage(payload: unknown, fallback: string) {
    const error = (payload as MetaApiErrorPayload | null)?.error;
    return error?.error_user_msg || error?.message || fallback;
}

export class MetaWhatsAppConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MetaWhatsAppConfigError";
    }
}

export class MetaWhatsAppApiError extends Error {
    constructor(public code: number | undefined, message: string) {
        super(message);
        this.name = "MetaWhatsAppApiError";
    }
}

export async function getMetaEmbeddedSignupConfig(): Promise<MetaEmbeddedSignupConfig> {
    const settings = await getSystemSettingsOrDefaults();
    const appId = (settings.whatsappMetaAppId || process.env.META_APP_ID || "").trim();
    const appSecret = (settings.whatsappMetaAppSecret || process.env.META_APP_SECRET || "").trim();
    const configId = (settings.whatsappEmbeddedSignupConfigId || process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "").trim();
    const solutionId = (settings.whatsappTechProviderSolutionId || process.env.META_TECH_PROVIDER_SOLUTION_ID || "").trim();
    const graphApiVersion = normalizeGraphApiVersion(settings.whatsappGraphApiVersion);
    const registrationPin = (settings.whatsappRegistrationPin || process.env.WHATSAPP_REGISTRATION_PIN || "").trim();
    const webhookVerifyToken = (settings.whatsappWebhookVerifyToken || process.env.WEBHOOK_VERIFY_TOKEN || "").trim();
    const webhookBaseUrl = (settings.whatsappWebhookBaseUrl || process.env.WHATSAPP_WEBHOOK_BASE_URL || "").trim().replace(/\/+$/, "");

    if (!appId) {
        throw new MetaWhatsAppConfigError("Falta Meta App ID para Embedded Signup.");
    }
    if (!appSecret) {
        throw new MetaWhatsAppConfigError("Falta Meta App Secret para intercambiar el codigo OAuth.");
    }
    if (!configId) {
        throw new MetaWhatsAppConfigError("Falta Configuration ID de Facebook Login for Business.");
    }

    return {
        appId,
        appSecret,
        configId,
        solutionId,
        graphApiVersion,
        registrationPin,
        webhookVerifyToken,
        webhookBaseUrl,
    };
}

export async function getMetaWhatsAppConfig(): Promise<MetaWhatsAppConfig> {
    const settings = await getSystemSettingsOrDefaults();
    const accessToken = (settings.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
    const phoneNumberId = (settings.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
    const wabaId = (settings.whatsappWabaId || process.env.WHATSAPP_WABA_ID || "").trim();
    const displayPhoneNumber = (settings.whatsappDisplayPhoneNumber || process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || "").trim();
    const graphApiVersion = normalizeGraphApiVersion(settings.whatsappGraphApiVersion);

    if (!accessToken) {
        throw new MetaWhatsAppConfigError("Falta el access token de WhatsApp Cloud API.");
    }
    if (!phoneNumberId) {
        throw new MetaWhatsAppConfigError("Falta el Phone Number ID de WhatsApp Cloud API.");
    }

    return {
        accessToken,
        phoneNumberId,
        wabaId,
        displayPhoneNumber,
        graphApiVersion,
    };
}

export async function getMetaWhatsAppSessionSnapshot() {
    const settings = await getSystemSettingsOrDefaults();
    const accessToken = (settings.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
    const phoneNumberId = (settings.whatsappPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
    const wabaId = (settings.whatsappWabaId || process.env.WHATSAPP_WABA_ID || "").trim();
    const displayPhoneNumber = (settings.whatsappDisplayPhoneNumber || process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || "").trim();
    const appId = (settings.whatsappMetaAppId || process.env.META_APP_ID || "").trim();
    const configId = (settings.whatsappEmbeddedSignupConfigId || process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "").trim();
    const solutionId = (settings.whatsappTechProviderSolutionId || process.env.META_TECH_PROVIDER_SOLUTION_ID || "").trim();
    const graphApiVersion = normalizeGraphApiVersion(settings.whatsappGraphApiVersion);
    const webhookVerifyToken = (settings.whatsappWebhookVerifyToken || process.env.WEBHOOK_VERIFY_TOKEN || "").trim();
    const webhookBaseUrl = (settings.whatsappWebhookBaseUrl || process.env.WHATSAPP_WEBHOOK_BASE_URL || "").trim().replace(/\/+$/, "");
    const registrationPin = (settings.whatsappRegistrationPin || process.env.WHATSAPP_REGISTRATION_PIN || "").trim();
    const configured = Boolean(accessToken && phoneNumberId);

    return {
        configured,
        connected: configured,
        loggedIn: configured,
        metaConfigured: configured,
        phoneNumberId: phoneNumberId || null,
        wabaId: wabaId || null,
        businessId: settings.whatsappBusinessId || null,
        displayPhoneNumber: displayPhoneNumber || null,
        jid: displayPhoneNumber || phoneNumberId || undefined,
        embeddedSignupConfigured: Boolean(appId && configId),
        appId: appId || null,
        configId: configId || null,
        solutionId: solutionId || null,
        graphApiVersion,
        webhookVerifyToken: webhookVerifyToken || null,
        webhookBaseUrl: webhookBaseUrl || null,
        registrationPinConfigured: Boolean(registrationPin),
        appSecretConfigured: Boolean(settings.whatsappMetaAppSecret || process.env.META_APP_SECRET),
    };
}

async function requestMeta(pathname: string, init?: RequestInit) {
    const config = await getMetaWhatsAppConfig();
    const response = await fetch(`${graphBaseUrl(config.graphApiVersion)}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
        cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new MetaWhatsAppApiError(
            (payload as MetaApiErrorPayload)?.error?.code,
            extractMetaErrorMessage(payload, `Meta Graph API devolvio ${response.status}`),
        );
    }

    return payload;
}

async function requestMetaWithToken(
    pathname: string,
    accessToken: string,
    graphApiVersion: string,
    init?: RequestInit,
) {
    const response = await fetch(`${graphBaseUrl(graphApiVersion)}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(init?.headers || {}),
        },
        cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new MetaWhatsAppApiError(
            (payload as MetaApiErrorPayload)?.error?.code,
            extractMetaErrorMessage(payload, `Meta Graph API devolvio ${response.status}`),
        );
    }

    return payload;
}

async function exchangeEmbeddedSignupCode(code: string, config: MetaEmbeddedSignupConfig) {
    const url = new URL(`${graphBaseUrl(config.graphApiVersion)}/oauth/access_token`);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("client_secret", config.appSecret);
    url.searchParams.set("code", code);

    const response = await fetch(url.toString(), { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new MetaWhatsAppApiError(
            (payload as MetaApiErrorPayload)?.error?.code,
            extractMetaErrorMessage(payload, "No se pudo intercambiar el codigo de Meta por access token."),
        );
    }

    const accessToken = typeof (payload as Record<string, unknown>).access_token === "string"
        ? String((payload as Record<string, unknown>).access_token)
        : "";
    if (!accessToken) {
        throw new MetaWhatsAppConfigError("Meta no devolvio access_token al finalizar Embedded Signup.");
    }

    return accessToken;
}

async function fetchPhoneNumberSnapshot(phoneNumberId: string, accessToken: string, graphApiVersion: string) {
    const payload = await requestMetaWithToken(
        `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`,
        accessToken,
        graphApiVersion,
        { method: "GET" },
    );

    const record = payload as Record<string, unknown>;
    return {
        displayPhoneNumber: typeof record.display_phone_number === "string" ? record.display_phone_number : "",
        verifiedName: typeof record.verified_name === "string" ? record.verified_name : "",
        raw: payload,
    };
}

async function registerPhoneNumberIfNeeded(phoneNumberId: string, accessToken: string, config: MetaEmbeddedSignupConfig) {
    if (!config.registrationPin) {
        return { skipped: true, reason: "registration_pin_missing" };
    }

    return requestMetaWithToken(
        `/${encodeURIComponent(phoneNumberId)}/register`,
        accessToken,
        config.graphApiVersion,
        {
            method: "POST",
            body: JSON.stringify({
                messaging_product: "whatsapp",
                pin: config.registrationPin,
            }),
        },
    );
}

async function subscribeWabaToApp(wabaId: string, accessToken: string, config: MetaEmbeddedSignupConfig) {
    await requestMetaWithToken(
        `/${encodeURIComponent(wabaId)}/subscribed_apps`,
        accessToken,
        config.graphApiVersion,
        { method: "POST", body: JSON.stringify({ subscribed_fields: "messages" }) },
    );

    if (!config.webhookBaseUrl || !config.webhookVerifyToken) {
        return { subscribed: true, overrideConfigured: false };
    }

    const callbackUrl = `${config.webhookBaseUrl}/api/webhooks/whatsapp`;
    await requestMetaWithToken(
        `/${encodeURIComponent(wabaId)}/subscribed_apps`,
        accessToken,
        config.graphApiVersion,
        {
            method: "POST",
            body: JSON.stringify({
                subscribed_fields: "messages",
                override_callback_uri: callbackUrl,
                verify_token: config.webhookVerifyToken,
            }),
        },
    );

    return { subscribed: true, overrideConfigured: true, callbackUrl };
}

export async function getMetaWebhookVerifyToken() {
    const settings = await getSystemSettingsOrDefaults();
    return (settings.whatsappWebhookVerifyToken || process.env.WEBHOOK_VERIFY_TOKEN || "").trim();
}

export async function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null) {
    const settings = await getSystemSettingsOrDefaults();
    const appSecret = (settings.whatsappMetaAppSecret || process.env.META_APP_SECRET || "").trim();
    if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

    const expected = crypto
        .createHmac("sha256", appSecret)
        .update(rawBody, "utf8")
        .digest("hex");
    const received = signatureHeader.slice("sha256=".length);

    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

export async function provisionMetaWhatsAppNumber(input: ProvisionMetaWhatsAppInput) {
    const now = new Date();
    const first = await prisma.systemSettings.findFirst();
    const data = {
        whatsappWabaId: input.waba_id.trim(),
        whatsappPhoneNumberId: input.phone_number_id.trim(),
        whatsappDisplayPhoneNumber: input.display_phone_number.trim(),
        whatsappAccessToken: input.access_token.trim(),
        whatsappBusinessId: input.business_id?.trim() || first?.whatsappBusinessId || null,
        whatsappInstanceName: input.client?.trim() || input.business_name?.trim() || first?.whatsappInstanceName || "zen-crm",
        whatsappConnectedAt: now,
    };

    if (first) {
        return prisma.systemSettings.update({
            where: { id: first.id },
            data,
        });
    }

    return prisma.systemSettings.create({
        data,
    });
}

export async function completeMetaEmbeddedSignup(input: CompleteEmbeddedSignupInput) {
    const code = input.code.trim();
    const wabaId = input.wabaId.trim();
    const phoneNumberId = input.phoneNumberId.trim();
    if (!code || !wabaId || !phoneNumberId) {
        throw new MetaWhatsAppConfigError("code, wabaId y phoneNumberId son obligatorios.");
    }

    const config = await getMetaEmbeddedSignupConfig();
    const accessToken = await exchangeEmbeddedSignupCode(code, config);
    const phoneSnapshot = await fetchPhoneNumberSnapshot(phoneNumberId, accessToken, config.graphApiVersion)
        .catch((error) => {
            console.warn("[Meta Embedded Signup] No se pudo leer el numero despues del onboarding:", error);
            return { displayPhoneNumber: "", verifiedName: "", raw: null };
        });
    const registration = await registerPhoneNumberIfNeeded(phoneNumberId, accessToken, config);
    const subscription = await subscribeWabaToApp(wabaId, accessToken, config);
    const settings = await provisionMetaWhatsAppNumber({
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        display_phone_number: phoneSnapshot.displayPhoneNumber || phoneSnapshot.verifiedName || phoneNumberId,
        access_token: accessToken,
        business_id: input.businessId || undefined,
        client: input.client || undefined,
    });

    return {
        ok: true,
        settings,
        phoneSnapshot,
        registration,
        subscription,
    };
}

export async function deleteMetaWhatsAppConnection() {
    const first = await prisma.systemSettings.findFirst();
    if (!first) return { deleted: true };

    await prisma.systemSettings.update({
        where: { id: first.id },
        data: {
            whatsappWabaId: null,
            whatsappPhoneNumberId: null,
            whatsappDisplayPhoneNumber: null,
            whatsappAccessToken: null,
            whatsappBusinessId: null,
            whatsappConnectedAt: null,
        },
    });

    return { deleted: true };
}

export async function sendMetaTextMessage(to: string, body: string): Promise<MetaMessageResult> {
    const config = await getMetaWhatsAppConfig();
    const payload = await requestMeta(`/${config.phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: normalizePhoneForMeta(to),
            type: "text",
            text: {
                preview_url: true,
                body,
            },
        }),
    });

    return {
        Id: extractMetaMessageId(payload),
        raw: payload,
    };
}

export async function sendMetaMediaMessage(params: SendMetaMediaParams): Promise<MetaMessageResult> {
    const config = await getMetaWhatsAppConfig();
    const mediaPayload: Record<string, unknown> = {
        link: params.link,
    };

    if (params.caption && params.mediaType !== "audio") {
        mediaPayload.caption = params.caption;
    }
    if (params.mediaType === "document" && params.fileName) {
        mediaPayload.filename = params.fileName;
    }

    const payload = await requestMeta(`/${config.phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: normalizePhoneForMeta(params.to),
            type: params.mediaType,
            [params.mediaType]: mediaPayload,
        }),
    });

    return {
        Id: extractMetaMessageId(payload),
        raw: payload,
    };
}

export async function sendMetaTemplateMessage(params: SendMetaTemplateParams): Promise<MetaMessageResult> {
    const config = await getMetaWhatsAppConfig();
    const components = normalizeTemplateSendComponents(params.components);
    const payload = await requestMeta(`/${config.phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: normalizePhoneForMeta(params.to),
            type: "template",
            template: {
                name: params.templateName,
                language: { code: params.languageCode || "es" },
                ...(components && components.length > 0 ? { components } : {}),
            },
        }),
    });

    return {
        Id: extractMetaMessageId(payload),
        raw: payload,
    };
}

export async function sendMetaReactionMessage(params: {
    to: string;
    providerMessageId: string;
    reaction: string | null;
}): Promise<MetaMessageResult> {
    const config = await getMetaWhatsAppConfig();
    const payload = await requestMeta(`/${config.phoneNumberId}/messages`, {
        method: "POST",
        body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: normalizePhoneForMeta(params.to),
            type: "reaction",
            reaction: {
                message_id: params.providerMessageId,
                emoji: params.reaction || "",
            },
        }),
    });

    return {
        Id: extractMetaMessageId(payload),
        raw: payload,
    };
}

export async function listMetaTemplates(params?: { limit?: number; page?: number; wabaId?: string }) {
    const config = await getMetaWhatsAppConfig();
    const wabaId = (params?.wabaId || config.wabaId || "").trim();
    if (!wabaId) {
        throw new MetaWhatsAppConfigError("Falta el WABA ID para consultar plantillas Meta.");
    }

    const limit = Math.min(Math.max(Math.trunc(params?.limit || 100), 1), 100);
    const payload = await requestMeta(
        `/${encodeURIComponent(wabaId)}/message_templates?fields=id,name,status,language,category,components&limit=${limit}`,
        { method: "GET" },
    );
    const data = Array.isArray((payload as Record<string, unknown>).data)
        ? (payload as Record<string, unknown>).data as MetaTemplatePayload[]
        : [];

    return {
        items: data.map((template) => ({
            ...template,
            wabaId,
            createdAt: template.createdAt || template.updatedAt || null,
            updatedAt: template.updatedAt || template.createdAt || null,
        })),
        raw: payload,
    };
}

export async function createMetaTemplate(payload: {
    wabaId?: string;
    name: string;
    category: string;
    language: string;
    components: unknown[];
    allowCategoryChange?: boolean;
}) {
    const config = await getMetaWhatsAppConfig();
    const wabaId = (payload.wabaId || config.wabaId || "").trim();
    if (!wabaId) {
        throw new MetaWhatsAppConfigError("Falta el WABA ID para crear plantillas Meta.");
    }

    return requestMeta(`/${encodeURIComponent(wabaId)}/message_templates`, {
        method: "POST",
        body: JSON.stringify({
            name: payload.name,
            category: payload.category,
            language: payload.language,
            components: payload.components,
            ...(payload.allowCategoryChange ? { allow_category_change: true } : {}),
        }),
    });
}

export async function deleteMetaTemplate(params: { wabaId?: string; name: string }) {
    const config = await getMetaWhatsAppConfig();
    const wabaId = (params.wabaId || config.wabaId || "").trim();
    const name = params.name.trim();
    if (!wabaId || !name) {
        throw new MetaWhatsAppConfigError("wabaId y name son obligatorios para eliminar la plantilla Meta.");
    }

    return requestMeta(
        `/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}`,
        { method: "DELETE" },
    );
}

export async function fetchMetaMedia(mediaId: string) {
    const config = await getMetaWhatsAppConfig();
    const metaResponse = await fetch(`${graphBaseUrl(config.graphApiVersion)}/${encodeURIComponent(mediaId)}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        cache: "no-store",
    });
    const metaPayload = await metaResponse.json().catch(() => ({}));
    if (!metaResponse.ok) {
        throw new MetaWhatsAppApiError(
            (metaPayload as MetaApiErrorPayload)?.error?.code,
            extractMetaErrorMessage(metaPayload, "No se pudo resolver el medio de Meta."),
        );
    }

    const url = typeof (metaPayload as Record<string, unknown>).url === "string"
        ? String((metaPayload as Record<string, unknown>).url)
        : "";
    if (!url) {
        throw new Error("Meta no devolvio una URL de descarga para el medio.");
    }

    const mediaResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        cache: "no-store",
    });
    if (!mediaResponse.ok) {
        throw new MetaWhatsAppApiError(mediaResponse.status, "No se pudo descargar el medio de Meta.");
    }

    return {
        buffer: Buffer.from(await mediaResponse.arrayBuffer()),
        mimeType: String((metaPayload as Record<string, unknown>).mime_type || mediaResponse.headers.get("content-type") || "application/octet-stream"),
    };
}
