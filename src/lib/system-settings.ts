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
    agentName: "Asistente Zen",
    agentPrompt: `Eres un asistente de WhatsApp para un CRM. Responde siempre en espanol claro, breve y profesional.
Usa el contexto recuperado cuando sea relevante.
Si no encuentras una respuesta fiable en la base de conocimiento, dilo con honestidad y pide el dato faltante.
Cuando detectes intencion comercial o de seguimiento, guia la conversacion hacia el siguiente paso util.`,
    agentTemperature: 0.3,
    knowledgeTopK: 6,
    autoReplyDelayMs: 1200,
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
