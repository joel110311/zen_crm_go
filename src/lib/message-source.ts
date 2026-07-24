import type { AppSystemSettings } from "@/lib/system-settings";

export type MessageSourceType = "wuzapi" | "meta" | "messenger" | "instagram";

export const MESSAGE_SOURCE_WUZAPI: MessageSourceType = "wuzapi";
export const MESSAGE_SOURCE_META: MessageSourceType = "meta";
export const MESSAGE_SOURCE_MESSENGER: MessageSourceType = "messenger";
export const MESSAGE_SOURCE_INSTAGRAM: MessageSourceType = "instagram";
const LEGACY_OFFICIAL_SOURCE = "y" + "cloud";

export function normalizeMessageSourceType(value: string | null | undefined): MessageSourceType {
    const normalized = value?.trim().toLowerCase().replace(/-/g, "_");

    if (
        normalized === LEGACY_OFFICIAL_SOURCE
        || normalized === MESSAGE_SOURCE_META
        || normalized === "whatsapp_api"
        || normalized === "whatsapp_business"
        || normalized === "whatsapp_cloud"
    ) {
        return MESSAGE_SOURCE_META;
    }

    if (normalized === MESSAGE_SOURCE_MESSENGER || normalized === "facebook") {
        return MESSAGE_SOURCE_MESSENGER;
    }

    if (normalized === MESSAGE_SOURCE_INSTAGRAM || normalized === "instagram_direct") {
        return MESSAGE_SOURCE_INSTAGRAM;
    }

    return MESSAGE_SOURCE_WUZAPI;
}

export function resolveMessageSourceId(
    sourceType: MessageSourceType,
    settings: Pick<AppSystemSettings, "whatsappInstanceName" | "whatsappPhoneNumberId">,
): string | null {
    const raw = sourceType === MESSAGE_SOURCE_META
        ? settings.whatsappPhoneNumberId
        : sourceType === MESSAGE_SOURCE_WUZAPI
            ? settings.whatsappInstanceName
            : null;
    const value = typeof raw === "string" ? raw.trim() : "";
    return value || null;
}
