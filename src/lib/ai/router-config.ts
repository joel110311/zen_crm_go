export type AiRouterCustomProvider = {
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    apiKey: string;
    enabled: boolean;
};

export const AI_ROUTER_PRIMARY_ID = "primary";
export const AI_ROUTER_FALLBACK_ID = "fallback";
export const LEGACY_CUSTOM_PROVIDER_ID = "custom";

type LegacyCustomProvider = {
    enabled?: boolean | null;
    name?: string | null;
    baseUrl?: string | null;
    model?: string | null;
    apiKey?: string | null;
};

function cleanText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export function normalizeCustomProviders(
    value: unknown,
    legacy?: LegacyCustomProvider,
): AiRouterCustomProvider[] {
    if (Array.isArray(value)) {
        const seen = new Set<string>();
        return value.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const row = entry as Record<string, unknown>;
            const id = cleanText(row.id);
            if (!id || id === AI_ROUTER_PRIMARY_ID || id === AI_ROUTER_FALLBACK_ID || seen.has(id)) return [];
            seen.add(id);
            return [{
                id,
                name: cleanText(row.name) || "Proveedor OpenAI-compatible",
                baseUrl: cleanText(row.baseUrl),
                model: cleanText(row.model),
                apiKey: typeof row.apiKey === "string" ? row.apiKey : "",
                enabled: row.enabled !== false,
            }];
        });
    }

    if (!legacy) return [];
    return [{
        id: LEGACY_CUSTOM_PROVIDER_ID,
        name: cleanText(legacy.name) || "Proveedor OpenAI-compatible",
        baseUrl: cleanText(legacy.baseUrl),
        model: cleanText(legacy.model),
        apiKey: typeof legacy.apiKey === "string" ? legacy.apiKey : "",
        enabled: legacy.enabled === true,
    }];
}

export function normalizeAiRouterOrder(value: unknown, customProviders: AiRouterCustomProvider[]) {
    const validIds = new Set([
        ...customProviders.map((provider) => provider.id),
        AI_ROUTER_PRIMARY_ID,
        AI_ROUTER_FALLBACK_ID,
    ]);
    const requested = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    const ordered = requested.filter((id, index) => validIds.has(id) && requested.indexOf(id) === index);

    for (const provider of customProviders) {
        if (!ordered.includes(provider.id)) ordered.push(provider.id);
    }
    if (!ordered.includes(AI_ROUTER_PRIMARY_ID)) ordered.push(AI_ROUTER_PRIMARY_ID);
    if (!ordered.includes(AI_ROUTER_FALLBACK_ID)) ordered.push(AI_ROUTER_FALLBACK_ID);
    return ordered;
}
