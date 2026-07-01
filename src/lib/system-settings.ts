import { prisma } from "@/lib/db";
import type { SystemSettings } from "@prisma/client";
import { DEFAULT_CHAT_MODEL_ID } from "@/lib/ai/models";
import {
    DEFAULT_APPOINTMENT_DURATION_MINUTES,
    DEFAULT_BUSINESS_HOURS_END,
    DEFAULT_BUSINESS_HOURS_START,
    DEFAULT_BUSINESS_TIME_ZONE,
    buildUniformBusinessWeeklySchedule,
} from "@/lib/calendar/business-hours";

export const SYSTEM_SETTINGS_DEFAULTS = {
    openaiModel: DEFAULT_CHAT_MODEL_ID,
    whatsappBaseUrl: process.env.WHATSAPP_GATEWAY_URL || "",
    whatsappAdminToken: process.env.WUZAPI_ADMIN_TOKEN || "",
    whatsappUserToken: process.env.WUZAPI_USER_TOKEN || "",
    whatsappInstanceName: process.env.WHATSAPP_INSTANCE_NAME || "zen-crm",
    whatsappProxyEnabled: process.env.WHATSAPP_PROXY_ENABLED === "true",
    whatsappProxyUrl: process.env.WHATSAPP_PROXY_URL || "",
    whatsappWabaId: process.env.WHATSAPP_WABA_ID || "",
    whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    whatsappDisplayPhoneNumber: process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || "",
    whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    whatsappBusinessId: "",
    whatsappMetaAppId: process.env.META_APP_ID || "",
    whatsappMetaAppSecret: process.env.META_APP_SECRET || "",
    whatsappEmbeddedSignupConfigId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "",
    whatsappTechProviderSolutionId: process.env.META_TECH_PROVIDER_SOLUTION_ID || "",
    whatsappGraphApiVersion: process.env.META_GRAPH_API_VERSION || "v23.0",
    whatsappRegistrationPin: process.env.WHATSAPP_REGISTRATION_PIN || "",
    whatsappWebhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN || "",
    whatsappWebhookBaseUrl: process.env.WHATSAPP_WEBHOOK_BASE_URL || "",
    whatsappConnectedAt: null,
    agentName: "Asistente Zen",
    agentPrompt: `Eres un asistente de WhatsApp para un CRM. Responde siempre en espanol claro, breve y profesional.
Usa el contexto recuperado cuando sea relevante.
Si no encuentras una respuesta fiable en la base de conocimiento, dilo con honestidad y pide el dato faltante.
Cuando detectes intencion comercial o de seguimiento, guia la conversacion hacia el siguiente paso util.`,
    welcomeMessage: `👋 ¡Hola! Gracias por contactarnos.\n\n¿En qué te podemos ayudar hoy?`,
    welcomeRepeatHours: 24,
    agentTemperature: 0.3,
    knowledgeTopK: 6,
    autoReplyDelayMs: 4000,
    botReplyDelayMinMs: 4000,
    botReplyDelayMaxMs: 8000,
    isBotEnabled: false,
    businessHoursStart: DEFAULT_BUSINESS_HOURS_START,
    businessHoursEnd: DEFAULT_BUSINESS_HOURS_END,
    businessTimeZone: DEFAULT_BUSINESS_TIME_ZONE,
    businessWeeklySchedule: buildUniformBusinessWeeklySchedule(
        DEFAULT_BUSINESS_HOURS_START,
        DEFAULT_BUSINESS_HOURS_END,
        true,
    ),
    appointmentDurationMinutes: DEFAULT_APPOINTMENT_DURATION_MINUTES,
    googleCalendarId: "primary",
    leadScoringEnabled: true,
    captureLeadName: false,
    captureLeadEmail: false,
    leadInterestThreshold: 45,
    escalationEnabled: false,
    escalationPhone: "",
    catalogOfferImages: true,
    catalogOfferPdf: true,
    catalogAskBeforeSending: true,
    catalogMaxImagesToSend: 10,
    catalogIncludeLink: true,
} as const;

export type AppSystemSettings = SystemSettings & typeof SYSTEM_SETTINGS_DEFAULTS;

export function withSettingsDefaults(
    settings: SystemSettings | null | undefined,
): AppSystemSettings {
    const sanitizedSettings = settings
        ? Object.fromEntries(
              Object.entries(settings).filter(([, value]) => value !== null && value !== undefined),
          )
        : {};

    return {
        ...(settings ?? { id: "default", updatedAt: new Date() }),
        ...SYSTEM_SETTINGS_DEFAULTS,
        ...sanitizedSettings,
    } as AppSystemSettings;
}

export async function getSystemSettingsOrDefaults(): Promise<AppSystemSettings> {
    const settings = await prisma.systemSettings.findFirst();
    return withSettingsDefaults(settings);
}
