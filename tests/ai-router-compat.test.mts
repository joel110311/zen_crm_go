import assert from "node:assert/strict";
import test from "node:test";

import {
    AiProviderHttpError,
    ensureOpenAiCompatibleUserMessage,
    shouldCooldownAiProvider,
} from "../src/lib/ai/openai-compatible.ts";

test("a valid customer conversation is preserved", () => {
    const messages = [
        { role: "system" as const, content: "Responde en español" },
        { role: "user" as const, content: "Hola" },
    ];

    assert.equal(ensureOpenAiCompatibleUserMessage(messages), messages);
});

test("a system-only task receives a user turn for compatible providers", () => {
    const messages = [{ role: "system" as const, content: "Devuelve JSON" }];
    const normalized = ensureOpenAiCompatibleUserMessage(messages);

    assert.equal(normalized.length, 2);
    assert.equal(normalized[0], messages[0]);
    assert.equal(normalized[1]?.role, "user");
    assert.match(String(normalized[1]?.content), /Ejecuta la tarea/);
});

test("request-specific 400 errors do not poison the next provider call", () => {
    assert.equal(shouldCooldownAiProvider(new AiProviderHttpError(400, "bad request")), false);
    assert.equal(shouldCooldownAiProvider(new AiProviderHttpError(422)), false);
    assert.equal(shouldCooldownAiProvider(new AiProviderHttpError(429)), true);
    assert.equal(shouldCooldownAiProvider(new AiProviderHttpError(503)), true);
    assert.equal(shouldCooldownAiProvider(new Error("timeout de 4000 ms")), true);
});
