import OpenAI, { toFile } from "openai";
import { prisma } from "@/lib/db";
import { SYSTEM_SETTINGS_DEFAULTS, withSettingsDefaults } from "@/lib/system-settings";
import { resolveChatModelSelection, resolveGeminiRestModelPath } from "@/lib/ai/models";
import { resolveAiProviderKey } from "@/lib/ai/provider-keys";
import {
    AI_ROUTER_FALLBACK_ID,
    AI_ROUTER_PRIMARY_ID,
    normalizeAiRouterOrder,
    normalizeCustomProviders,
} from "@/lib/ai/router-config";

const DEFAULT_IMAGE_OCR_PROMPT =
    "Extrae en espanol todo el texto legible de esta imagen. Conserva titulos, precios, ubicaciones, bullets y datos comerciales. Si una seccion no se alcanza a leer completa, transcribe lo visible y no inventes nada.";

const GEMINI_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const GEMINI_FALLBACK_MODEL_PATHS = [
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash",
];
const GEMINI_MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const AI_PROVIDER_FAILURE_COOLDOWN_MS = 30 * 1000;

type GeminiModelCacheEntry = {
    expiresAt: number;
    models: Set<string>;
};

const geminiModelCache = new Map<string, GeminiModelCacheEntry>();
const aiProviderCooldowns = new Map<string, number>();

type GeminiGenerateContentPayload = {
    contents: Array<{
        role?: string;
        parts: Array<{
            text?: string;
            inline_data?: {
                mime_type: string;
                data: string;
            };
        }>;
    }>;
    generationConfig?: Record<string, unknown>;
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGeminiModelCandidates(preferredModel?: string | null) {
    const normalizedPreferred = resolveGeminiRestModelPath(preferredModel);
    return [normalizedPreferred, ...GEMINI_FALLBACK_MODEL_PATHS].filter(
        (modelPath, index, all) => all.indexOf(modelPath) === index,
    );
}

function getCachedGeminiModels(apiKey: string) {
    const cached = geminiModelCache.get(apiKey);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
        geminiModelCache.delete(apiKey);
        return null;
    }
    return cached.models;
}

async function fetchAvailableGeminiModels(apiKey: string, timeoutMs?: number) {
    const cached = getCachedGeminiModels(apiKey);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`,
            { cache: "no-store", signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined },
        );

        if (!response.ok) {
            return null;
        }

        const data = (await response.json()) as {
            models?: Array<{ name?: string }>;
        };
        const models = new Set(
            (data.models || [])
                .map((model) => model.name?.trim())
                .filter((name): name is string => Boolean(name && name.startsWith("models/"))),
        );

        if (models.size > 0) {
            geminiModelCache.set(apiKey, {
                expiresAt: Date.now() + GEMINI_MODEL_CACHE_TTL_MS,
                models,
            });
        }

        return models.size > 0 ? models : null;
    } catch {
        return null;
    }
}

function rememberUnavailableGeminiModel(apiKey: string, modelPath: string) {
    const cached = getCachedGeminiModels(apiKey);
    if (!cached) return;
    cached.delete(modelPath);
}

function pickAvailableFallbackModel(availableModels: Set<string>) {
    const preferredOrder = [
        "models/gemini-2.5-flash",
        "models/gemini-2.0-flash",
        "models/gemini-1.5-flash",
        "models/gemini-1.5-pro",
    ];

    for (const preferred of preferredOrder) {
        if (availableModels.has(preferred)) {
            return preferred;
        }
    }

    return null;
}

function extractGeminiText(data: unknown) {
    const responseData = data as {
        candidates?: Array<{
            content?: {
                parts?: Array<{ text?: string }>;
            };
        }>;
    };

    return (
        responseData?.candidates?.[0]?.content?.parts
            ?.map((part: { text?: string }) => part.text || "")
            .join("")
            .trim() || ""
    );
}

function isGeminiModelNotFound(status: number, errorBody: string) {
    const normalized = errorBody.toLowerCase();
    if (status === 404) {
        return true;
    }

    return normalized.includes("model") && normalized.includes("not found");
}

export async function callGeminiGenerateContent(options: {
    apiKey: string;
    preferredModel?: string | null;
    payload: GeminiGenerateContentPayload;
    maxRetriesPerModel?: number;
    timeoutMs?: number;
}) {
    const { apiKey, preferredModel, payload, maxRetriesPerModel = 1, timeoutMs } = options;
    const discoveredModels = await fetchAvailableGeminiModels(apiKey, timeoutMs);
    const baseCandidates = buildGeminiModelCandidates(preferredModel);
    const availableCandidates = discoveredModels
        ? baseCandidates.filter((modelPath) => discoveredModels.has(modelPath))
        : baseCandidates;
    const modelCandidates =
        availableCandidates.length > 0
            ? availableCandidates
            : discoveredModels
                ? [pickAvailableFallbackModel(discoveredModels)].filter(
                    (modelPath): modelPath is string => Boolean(modelPath),
                )
                : baseCandidates;
    let lastError: Error | null = null;

    for (const modelPath of modelCandidates) {
        for (let attempt = 0; attempt <= maxRetriesPerModel; attempt += 1) {
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
                },
            );

            if (response.ok) {
                const data = await response.json();
                return extractGeminiText(data);
            }

            const errorBody = await response.text();
            const status = response.status;
            const modelNotFound = isGeminiModelNotFound(status, errorBody);
            const retryable = GEMINI_RETRYABLE_STATUSES.has(status);

            const error = new Error(
                `Gemini API error (${status}) on ${modelPath}: ${errorBody}`,
            );
            lastError = error;

            if (modelNotFound) {
                rememberUnavailableGeminiModel(apiKey, modelPath);
                console.warn(`[Gemini] Model unavailable (${modelPath}), trying fallback model.`);
                break;
            }

            if (retryable && attempt < maxRetriesPerModel) {
                const backoffMs = 450 * (attempt + 1);
                await sleep(backoffMs);
                continue;
            }

            throw error;
        }
    }

    throw (
        lastError ||
        new Error("Gemini API error: no se pudo completar la solicitud con ningun modelo disponible.")
    );
}

export async function getOpenAIClient() {
    const apiKey = await resolveAiProviderKey("openai");

    if (!apiKey) {
        throw new Error(
            "OpenAI API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
        );
    }

    return new OpenAI({ apiKey });
}

export async function generateEmbedding(text: string) {
    try {
        const openai = await getOpenAIClient();
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text.replace(/\n/g, " "),
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw error;
    }
}

export async function generateEmbeddings(texts: string[]) {
    if (texts.length === 0) return [];

    try {
        const openai = await getOpenAIClient();
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: texts.map((text) => text.replace(/\n/g, " ")),
        });

        return response.data.map((item) => item.embedding);
    } catch (error) {
        console.error("Error generating embeddings:", error);
        throw error;
    }
}

export async function transcribeAudioBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
) {
    try {
        const openai = await getOpenAIClient();
        const file = await toFile(buffer, fileName, { type: mimeType });
        const response = await openai.audio.transcriptions.create({
            file,
            model: "gpt-4o-mini-transcribe",
        });

        return response.text;
    } catch (error) {
        console.error("Error transcribing audio:", error);
        throw error;
    }
}

async function runGeminiInlineMediaPrompt(
    prompt: string,
    buffer: Buffer,
    mimeType: string,
) {
    const apiKey = await resolveAiProviderKey("gemini");

    if (!apiKey) {
        throw new Error(
            "Gemini API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
        );
    }

    let settings: { openaiModel: string | null } | null = null;
    try {
        settings = await prisma.systemSettings.findFirst({
            select: {
                openaiModel: true,
            },
        });
    } catch (error) {
        console.warn("[AI OCR] Could not read stored model selection, using Gemini fallback model:", error);
    }

    const selectedModel = resolveChatModelSelection(settings?.openaiModel);
    const model =
        selectedModel.provider === "gemini"
            ? selectedModel.model
            : "gemini-2.5-flash";
    return callGeminiGenerateContent({
        apiKey,
        preferredModel: model,
        payload: {
            contents: [
                {
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: buffer.toString("base64"),
                            },
                        },
                    ],
                },
            ],
            generationConfig: {
                temperature: 0.1,
            },
        },
    });
}

export async function extractTextFromImageBuffer(
    buffer: Buffer,
    mimeType: string,
    prompt: string = DEFAULT_IMAGE_OCR_PROMPT,
) {
    const openai = await getOpenAIClient();
    const dataUrl = `data:${mimeType || "image/png"};base64,${buffer.toString("base64")}`;
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.1,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: prompt,
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: dataUrl,
                        },
                    },
                ],
            },
        ],
    });

    return response.choices[0]?.message?.content?.trim() || "";
}

export async function extractTextFromImageBufferWithFallback(
    buffer: Buffer,
    mimeType: string,
    prompt: string = DEFAULT_IMAGE_OCR_PROMPT,
) {
    try {
        return await extractTextFromImageBuffer(buffer, mimeType, prompt);
    } catch (error) {
        console.warn("[AI OCR] OpenAI image OCR failed, trying Gemini fallback:", error);
        return runGeminiInlineMediaPrompt(prompt, buffer, mimeType || "image/png");
    }
}

export async function generateCompletion(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: number = SYSTEM_SETTINGS_DEFAULTS.agentTemperature,
) {
    const storedSettings = await prisma.systemSettings.findFirst();
    const settings = withSettingsDefaults(storedSettings);
    const selectedModel = resolveChatModelSelection(settings.openaiModel);

    if (!settings.aiRouterEnabled) {
        return callSelectedChatProvider(selectedModel, messages, temperature);
    }

    const timeoutMs = Math.max(1500, Math.min(10000, Number(settings.aiRouterTimeoutMs) || 4000));
    const customProviders = normalizeCustomProviders(settings.aiRouterCustomProviders, {
        enabled: settings.customLlmEnabled,
        name: settings.customLlmName,
        baseUrl: settings.customLlmBaseUrl,
        model: settings.customLlmModel,
        apiKey: settings.customLlmApiKey,
    });
    const fallbackModel = selectedModel.provider === "gemini"
        ? resolveChatModelSelection("openai:gpt-4o-mini")
        : resolveChatModelSelection("gemini:gemini-2.5-flash");
    const candidatesById = new Map<string, { id: string; run: () => Promise<string | null> }>();

    for (const provider of customProviders) {
        if (!provider.enabled || !provider.baseUrl || !provider.model || !provider.apiKey) continue;
        candidatesById.set(provider.id, {
            id: `custom:${provider.id}:${provider.model}`,
            run: () => callOpenAiCompatibleProvider({
                baseUrl: provider.baseUrl,
                apiKey: provider.apiKey,
                model: provider.model,
                messages,
                temperature,
                timeoutMs,
            }),
        });
    }
    if (settings.aiRouterPrimaryEnabled) {
        candidatesById.set(AI_ROUTER_PRIMARY_ID, {
            id: selectedModel.id,
            run: () => callSelectedChatProvider(selectedModel, messages, temperature, timeoutMs),
        });
    }
    if (settings.aiRouterFallbackEnabled) {
        candidatesById.set(AI_ROUTER_FALLBACK_ID, {
            id: fallbackModel.id,
            run: () => callSelectedChatProvider(fallbackModel, messages, temperature, timeoutMs),
        });
    }

    const candidates = normalizeAiRouterOrder(settings.aiRouterOrder, customProviders)
        .map((id) => candidatesById.get(id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    if (candidates.length === 0) {
        throw new Error("El router de IA no tiene proveedores activos y configurados.");
    }

    const errors: string[] = [];
    for (const candidate of candidates.filter((candidate, index, all) => all.findIndex((item) => item.id === candidate.id) === index)) {
        const blockedUntil = aiProviderCooldowns.get(candidate.id) || 0;
        if (blockedUntil > Date.now()) {
            errors.push(`${candidate.id}: en enfriamiento temporal`);
            continue;
        }
        try {
            const result = (await runWithTimeout(candidate.run(), timeoutMs, candidate.id))?.trim();
            if (result) {
                aiProviderCooldowns.delete(candidate.id);
                return result;
            }
            throw new Error("respuesta vacia");
        } catch (error) {
            const reason = error instanceof Error ? error.message : "error desconocido";
            errors.push(`${candidate.id}: ${reason}`);
            aiProviderCooldowns.set(candidate.id, Date.now() + AI_PROVIDER_FAILURE_COOLDOWN_MS);
            console.warn(`[AI Router] ${candidate.id} failed; trying next provider:`, reason);
        }
    }

    throw new Error(`Ningun proveedor de IA pudo responder. ${errors.join(" | ")}`);
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, providerId: string) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error(`timeout de ${timeoutMs} ms en ${providerId}`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function buildGeminiConversationPrompt(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
    const systemMessage = messages.find((message) => message.role === "system");
    const conversationMessages = messages.filter((message) => message.role !== "system");
    return [
        systemMessage?.content ? `INSTRUCCIONES DEL SISTEMA:\n${extractMessageText(systemMessage.content)}` : "",
        "CONVERSACION:",
        ...conversationMessages.map((message) => {
            const role = message.role === "assistant" ? "Asistente" : "Usuario";
            return `${role}: ${extractMessageText(message.content)}`;
        }),
    ].filter(Boolean).join("\n\n");
}

async function callSelectedChatProvider(
    selectedModel: ReturnType<typeof resolveChatModelSelection>,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: number,
    timeoutMs?: number,
) {
    if (selectedModel.provider === "gemini") {
        const apiKey = await resolveAiProviderKey("gemini");
        if (!apiKey) throw new Error("Gemini no tiene API Key configurada.");
        return callGeminiGenerateContent({
            apiKey,
            preferredModel: selectedModel.model,
            maxRetriesPerModel: timeoutMs ? 0 : 1,
            timeoutMs,
            payload: {
                contents: [{ role: "user", parts: [{ text: buildGeminiConversationPrompt(messages) }] }],
                generationConfig: { temperature },
            },
        });
    }

    const openai = await getOpenAIClient();
    const completion = await openai.chat.completions.create(
        { model: selectedModel.model, messages, temperature },
        timeoutMs ? { timeout: timeoutMs, maxRetries: 0 } : undefined,
    );
    return completion.choices[0]?.message?.content || "";
}

function resolveOpenAiCompatibleEndpoint(baseUrl: string) {
    const parsed = new URL(baseUrl.trim());
    if (parsed.protocol !== "https:") throw new Error("El proveedor compatible debe usar HTTPS.");
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    if (!parsed.pathname.endsWith("/chat/completions")) {
        parsed.pathname = `${parsed.pathname || ""}${parsed.pathname.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
    }
    return parsed.toString();
}

async function callOpenAiCompatibleProvider(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    temperature: number;
    timeoutMs: number;
}) {
    const response = await fetch(resolveOpenAiCompatibleEndpoint(options.baseUrl), {
        method: "POST",
        headers: {
            "authorization": `Bearer ${options.apiKey.trim()}`,
            "content-type": "application/json",
            "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({
            model: options.model.trim(),
            messages: options.messages,
            temperature: options.temperature,
            stream: false,
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
        cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("respuesta sin texto util");
    return content.trim();
}

function extractMessageText(
    content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"],
) {
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => ("text" in item && typeof item.text === "string" ? item.text : ""))
            .filter(Boolean)
            .join("\n");
    }

    return "";
}
