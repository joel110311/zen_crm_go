import type { AppSystemSettings } from "@/lib/system-settings";

export type MessageSourceType = "wuzapi" | "meta";

export const MESSAGE_SOURCE_WUZAPI: MessageSourceType = "wuzapi";
export const MESSAGE_SOURCE_META: MessageSourceType = "meta";
const LEGACY_OFFICIAL_SOURCE = "y" + "cloud";

export function normalizeMessageSourceType(value: string | null | undefined): MessageSourceType {
    if (value === LEGACY_OFFICIAL_SOURCE) return MESSAGE_SOURCE_META;
    if (value === MESSAGE_SOURCE_META) return MESSAGE_SOURCE_META;
    return MESSAGE_SOURCE_WUZAPI;
}

export function resolveMessageSourceId(
    sourceType: MessageSourceType,
    settings: Pick<AppSystemSettings, "whatsappInstanceName" | "whatsappPhoneNumberId">,
): string | null {
    const raw = sourceType === MESSAGE_SOURCE_META
            ? settings.whatsappPhoneNumberId
            : settings.whatsappInstanceName;
    const value = typeof raw === "string" ? raw.trim() : "";
    return value || null;
}
