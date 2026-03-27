import OpenAI, { toFile } from "openai";
import { prisma } from "@/lib/db";
import { SYSTEM_SETTINGS_DEFAULTS } from "@/lib/system-settings";
import { resolveChatModelSelection } from "@/lib/ai/models";
import { resolveAiProviderKey } from "@/lib/ai/provider-keys";

const DEFAULT_IMAGE_OCR_PROMPT =
    "Extrae en espanol todo el texto legible de esta imagen. Conserva titulos, precios, ubicaciones, bullets y datos comerciales. Si una seccion no se alcanza a leer completa, transcribe lo visible y no inventes nada.";

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
    const settings = await prisma.systemSettings.findFirst();
    const apiKey = await resolveAiProviderKey("gemini");

    if (!apiKey) {
        throw new Error(
            "Gemini API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
        );
    }

    const selectedModel = resolveChatModelSelection(settings?.openaiModel);
    const model =
        selectedModel.provider === "gemini"
            ? selectedModel.model
            : "gemini-2.5-flash";

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
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
            }),
        },
    );

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    return (
        data.candidates?.[0]?.content?.parts
            ?.map((part: { text?: string }) => part.text || "")
            .join("")
            .trim() || ""
    );
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
    try {
        const settings = await prisma.systemSettings.findFirst();
        const selectedModel = resolveChatModelSelection(
            settings?.openaiModel || SYSTEM_SETTINGS_DEFAULTS.openaiModel,
        );

        if (selectedModel.provider === "gemini") {
            const apiKey = await resolveAiProviderKey("gemini");
            if (!apiKey) {
                throw new Error(
                    "Gemini API Key not configured. Guardala en Configuracion > IA o habilita ALLOW_ENV_AI_FALLBACK.",
                );
            }

            const systemMessage = messages.find((message) => message.role === "system");
            const conversationMessages = messages.filter((message) => message.role !== "system");
            const prompt = [
                systemMessage?.content ? `INSTRUCCIONES DEL SISTEMA:\n${extractMessageText(systemMessage.content)}` : "",
                "CONVERSACION:",
                ...conversationMessages.map((message) => {
                    const role = message.role === "assistant" ? "Asistente" : "Usuario";
                    return `${role}: ${extractMessageText(message.content)}`;
                }),
            ]
                .filter(Boolean)
                .join("\n\n");

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel.model}:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [
                            {
                                role: "user",
                                parts: [{ text: prompt }],
                            },
                        ],
                        generationConfig: {
                            temperature,
                        },
                    }),
                },
            );

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
            }

            const data = await response.json();
            return (
                data.candidates?.[0]?.content?.parts
                    ?.map((part: { text?: string }) => part.text || "")
                    .join("")
                    .trim() || ""
            );
        }

        const openai = await getOpenAIClient();
        const completion = await openai.chat.completions.create({
            model: selectedModel.model,
            messages,
            temperature,
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error("Error generating completion:", error);
        throw error;
    }
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
