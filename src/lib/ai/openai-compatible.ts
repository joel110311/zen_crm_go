import type OpenAI from "openai";

const SYNTHETIC_USER_INSTRUCTION =
    "Ejecuta la tarea indicada en las instrucciones anteriores y devuelve únicamente el resultado solicitado.";

/**
 * OpenAI-compatible chat endpoints require at least one user turn. Some
 * internal CRM tasks are expressed entirely as a system instruction, so add
 * a neutral user turn without changing the task itself.
 */
export function ensureOpenAiCompatibleUserMessage(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
) {
    if (messages.some((message) => message.role === "user")) {
        return messages;
    }

    return [
        ...messages,
        { role: "user" as const, content: SYNTHETIC_USER_INSTRUCTION },
    ];
}

export class AiProviderHttpError extends Error {
    readonly status: number;

    constructor(status: number, detail = "") {
        super(`HTTP ${status}${detail ? ` (${detail})` : ""}`);
        this.name = "AiProviderHttpError";
        this.status = status;
    }
}

/**
 * A malformed request is specific to that payload and must not suppress the
 * provider for a later, valid customer message. Quota, authentication,
 * connectivity and server failures still use the short provider cooldown.
 */
export function shouldCooldownAiProvider(error: unknown) {
    const status = error instanceof AiProviderHttpError
        ? error.status
        : error instanceof Error
            ? Number(error.message.match(/\bHTTP\s+(\d{3})\b/i)?.[1] || 0)
            : 0;

    return status !== 400 && status !== 422;
}
