import type { AppSystemSettings } from "@/lib/system-settings";

export type MessageSourceType = "wuzapi" | "ycloud";

export const MESSAGE_SOURCE_WUZAPI: MessageSourceType = "wuzapi";
export const MESSAGE_SOURCE_YCLOUD: MessageSourceType = "ycloud";

export function normalizeMessageSourceType(value: string | null | undefined): MessageSourceType {
    return value === MESSAGE_SOURCE_YCLOUD ? MESSAGE_SOURCE_YCLOUD : MESSAGE_SOURCE_WUZAPI;
}

export function resolveMessageSourceId(
    sourceType: MessageSourceType,
    settings: Pick<AppSystemSettings, "whatsappInstanceName" | "ycloudPhoneId">,
): string | null {
    const raw = sourceType === MESSAGE_SOURCE_YCLOUD ? settings.ycloudPhoneId : settings.whatsappInstanceName;
    const value = typeof raw === "string" ? raw.trim() : "";
    return value || null;
}
