"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { enrichContactFromMessage } from "@/lib/ai-enrichment";
import { resolveMediaToDataUrl } from "@/lib/media-data-url";
import {
    findBestCatalogItem,
    findBestCatalogItemInDevelopment,
    findCatalogAvailabilitySummary,
    getCatalogDevelopmentContext,
    parseCatalogAssetIntent,
    splitCatalogAssets,
} from "@/lib/catalog/catalog";
import { sendWuzapiMediaMessage, sendWuzapiTextMessage } from "@/lib/wuzapi";
import { generateConversationReply } from "@/lib/ai/chatbot";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import { buildInboundMediaContext, shouldSkipAutoReplyText } from "@/lib/ai/media-understanding";
import { maybeHandleAppointmentBooking } from "@/lib/ai/appointment-booking";
import { processLeadAutomationTurn } from "@/lib/ai/lead-intelligence";
import { buildPhoneMatchClauses, normalizePhoneDigits } from "@/lib/phone";
import { markBulkCampaignReplyForContact } from "@/lib/bulk-campaigns";
import { refreshWhatsAppAvatarForContact } from "@/lib/whatsapp-avatar";

const CATALOG_OFFER_EXPIRY_MS = 1000 * 60 * 90;
const KNOWLEDGE_IMAGE_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const KNOWLEDGE_IMAGE_MIN_SCORE = 3;
const KNOWLEDGE_IMAGE_TOKEN_STOPWORDS = new Set([
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "un",
    "una",
    "y",
    "o",
    "por",
    "para",
    "con",
    "sin",
    "que",
    "quiero",
    "necesito",
    "informacion",
    "info",
    "producto",
    "productos",
    "imagen",
    "imagenes",
    "foto",
    "fotos",
    "manda",
    "mandame",
    "enviar",
    "enviame",
    "tienes",
    "tengo",
    "puedes",
    "puedo",
]);

type CatalogItemMatch = NonNullable<Awaited<ReturnType<typeof findBestCatalogItem>>>;
type KnowledgeImageEntry = {
    label: string;
    imageUrl: string;
    searchableText: string;
    normalizedLabel: string;
};

function normalizeContactName(name?: string | null) {
    const normalized = name?.trim().replace(/\s+/g, " ") || "";
    if (!normalized) return null;
    if (/^(unknown|desconocido|sin nombre|null|undefined|n\/a|na)$/i.test(normalized)) {
        return null;
    }
    return normalized;
}

function appendSection(base: string, extra: string | null) {
    const trimmedBase = base.trim();
    const trimmedExtra = extra?.trim();
    if (!trimmedExtra) return trimmedBase;
    if (!trimmedBase) return trimmedExtra;
    return `${trimmedBase}\n\n${trimmedExtra}`;
}

function normalizeCatalogComparableText(value: string | null | undefined) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function sanitizeComparablePhone(value: string | null | undefined) {
    return (value || "").replace(/\D/g, "");
}

function queueAvatarRefreshForConversation(conversationId: string) {
    void prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { contactId: true },
    }).then((conversation) => {
        if (!conversation?.contactId) return;
        return refreshWhatsAppAvatarForContact(conversation.contactId);
    }).catch((error) => {
        console.warn("[Avatar] Failed to queue conversation avatar refresh", error);
    });
}

function buildCatalogLookupQuery(
    history: Array<{ content: string; direction: string }>,
    latestUserMessage: string,
) {
    const pieces: string[] = [];

    for (const candidate of [
        latestUserMessage,
        ...history
            .filter((message) => message.direction === "inbound" && message.content?.trim())
            .slice(0, 4)
            .map((message) => message.content.trim()),
    ]) {
        const normalized = candidate.trim();
        if (!normalized) continue;
        if (pieces[pieces.length - 1] === normalized) continue;
        pieces.push(normalized);
    }

    return pieces.join("\n");
}

function latestMessageMentionsDevelopment(
    latestUserMessage: string,
    development: string,
) {
    const normalizedMessage = normalizeCatalogComparableText(latestUserMessage);
    const normalizedDevelopment = normalizeCatalogComparableText(development);

    return Boolean(normalizedMessage && normalizedDevelopment && normalizedMessage.includes(normalizedDevelopment));
}

function isCatalogDetailFollowUp(latestUserMessage: string) {
    const normalized = normalizeCatalogComparableText(latestUserMessage);
    if (!normalized) return false;

    if (
        /\b(recamara|recamaras|habitacion|habitaciones|bano|banos|amenidad|amenidades|modelo|tipologia|tipologias|metros|m2|superficie|medidas|precio|financiamiento|detalle|detalles|informacion|ubicacion|caracteristicas)\b/.test(
            normalized,
        )
    ) {
        return true;
    }

    if (/\bde\s+\d+\s*(recamara|recamaras|habitacion|habitaciones|m2|metros)\b/.test(normalized)) {
        return true;
    }

    if (
        /\b(dame mas|dame info|quiero saber mas|quiero mas informacion|mas informacion|mas detalles)\b/.test(
            normalized,
        )
    ) {
        return true;
    }

    return false;
}

function hasRecentCatalogOffer(offeredAt: Date | null | undefined) {
    if (!offeredAt) return false;
    return Date.now() - offeredAt.getTime() <= CATALOG_OFFER_EXPIRY_MS;
}

function isCatalogAssistantEnabled(
    settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>,
) {
    return Boolean(
        settings.catalogOfferImages ||
            settings.catalogOfferPdf ||
            settings.catalogIncludeLink,
    );
}

function cleanKnowledgeImageDescription(value: string) {
    return normalizeCatalogComparableText(
        value
            .replace(/\b(producto|nombre|descripcion|desc|imagen|image|url)\b\s*:/gi, " ")
            .replace(/[|;,]+/g, " ")
            .trim(),
    );
}

function extractKnowledgeImageEntries(rawContent: string | null | undefined): KnowledgeImageEntry[] {
    if (!rawContent?.trim()) {
        return [];
    }

    const entries: KnowledgeImageEntry[] = [];
    let previousTextLine: string | null = null;

    for (const rawLine of rawContent.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }

        const urls = [...line.matchAll(KNOWLEDGE_IMAGE_URL_REGEX)]
            .map((match) => match[0]?.replace(/[),.;|]+$/, ""))
            .filter(Boolean) as string[];

        if (urls.length === 0) {
            const normalizedLine = cleanKnowledgeImageDescription(line);
            previousTextLine = normalizedLine || previousTextLine;
            continue;
        }

        let description = line;
        for (const url of urls) {
            description = description.replace(url, " ");
        }

        const rawLabelCandidate = description.split("|")[0] || description;
        const normalizedDescription = cleanKnowledgeImageDescription(description) || previousTextLine;
        previousTextLine = null;

        if (!normalizedDescription) {
            continue;
        }

        const normalizedLabel =
            normalizeCatalogComparableText(rawLabelCandidate) ||
            normalizeCatalogComparableText(normalizedDescription.split(" ").slice(0, 4).join(" "));

        if (!normalizedLabel) {
            continue;
        }

        entries.push({
            label: normalizedDescription,
            imageUrl: urls[0],
            searchableText: normalizedDescription,
            normalizedLabel,
        });
    }

    return entries;
}

function buildKnowledgeImageMatchTokens(text: string) {
    return [...new Set(normalizeCatalogComparableText(text)
        .split(" ")
        .filter((token) =>
            token.length >= 3 &&
            !KNOWLEDGE_IMAGE_TOKEN_STOPWORDS.has(token),
        ))];
}

function scoreKnowledgeImageEntry(
    entry: KnowledgeImageEntry,
    normalizedNeedle: string,
    tokens: string[],
) {
    let score = 0;

    if (entry.normalizedLabel.length >= 6 && normalizedNeedle.includes(entry.normalizedLabel)) {
        score += 8;
    }

    for (const token of tokens) {
        if (entry.searchableText.includes(token)) {
            score += token.length >= 6 ? 2 : 1;
        }
    }

    return score;
}

function buildCatalogInstruction(
    catalogItem: CatalogItemMatch,
    developmentContext: Awaited<ReturnType<typeof getCatalogDevelopmentContext>> | null,
) {
    const verifiedEntries = developmentContext?.entries?.length
        ? developmentContext.entries
        : [
            {
                question: catalogItem.question,
                answer: catalogItem.answer,
            },
        ];

    return [
        verifiedEntries.length > 1
            ? "Se encontraron varias fichas estructuradas verificadas del mismo desarrollo."
            : "Se encontro una ficha estructurada del catalogo.",
        `Desarrollo: ${developmentContext?.development || catalogItem.development}.`,
        (developmentContext?.location || catalogItem.location)
            ? `Ubicacion base: ${developmentContext?.location || catalogItem.location}.`
            : null,
        "Construye una respuesta integrada, comercial y clara usando solo la informacion verificada de estas fichas:",
        ...verifiedEntries.map((entry, index) =>
            `Ficha ${index + 1}: ${entry.question} -> ${entry.answer}`,
        ),
        "Usa esta ficha como fuente prioritaria si la consulta del cliente corresponde a este desarrollo.",
        "Si el cliente esta dando seguimiento a este desarrollo o a una tipologia/modelo de este desarrollo, mantente en este mismo desarrollo y no vuelvas a sugerir otros desarrollos o zonas.",
        "Si el cliente menciona una variante concreta, como numero de recamaras, metros, tipologia o modelo, enfocate primero en esa variante especifica.",
        "No inventes caracteristicas, precios, amenidades ni ubicaciones que no esten en estas fichas.",
        "No menciones ni ofrezcas imagenes, PDF o ligas dentro del cuerpo principal de la respuesta; el sistema los ofrece aparte cuando corresponde.",
        "Esta prohibido volver a ofrecer imagenes, catalogos, brochures o ligas dentro del cuerpo principal de la respuesta.",
        "No repitas textual las preguntas del catalogo. Sintetiza la informacion en una sola respuesta bien organizada.",
        "Da una respuesta resumida y facil de leer. A la mayoria de los clientes no les gusta leer demasiado.",
        "Si el usuario solo pide informacion general del desarrollo, responde en formato breve: una introduccion corta, maximo 3 o 4 puntos clave y una pregunta final para continuar la conversacion.",
        "No enumeres todas las amenidades ni todas las caracteristicas si no te las pidieron. Prioriza solo lo mas vendedor y util.",
        "Si hay cantidades importantes, mencionalas de forma resumida, por ejemplo modelos, rango de recamaras o amenidades destacadas, sin copiar bloques demasiado largos.",
        "Evita parrafos largos. Prefiere frases cortas y bullets cortos.",
        "No abras siempre con frases repetitivas como 'Si, claro que si', 'Claro que si' o 'Con gusto'. Entra directo al punto con un tono vendedor y natural.",
        "Cuando respondas con esta ficha, usa formato de WhatsApp bien estructurado: parrafos cortos, listas simples cuando haya caracteristicas y *negritas* solo en la informacion importante.",
        "Resalta en *negritas* lo mas relevante, por ejemplo: nombre del desarrollo, ubicacion, recamaras, banos, amenidades, precio o beneficio principal si aparece en la ficha.",
        "No cierres la conversacion. Termina con una pregunta abierta breve que ayude a seguir vendiendo.",
    ]
        .filter(Boolean)
        .join(" ");
}

function buildCatalogOfferText(params: {
    offerImages: boolean;
    imageCount: number;
    offerPdf: boolean;
}) {
    const lines: string[] = [];

    if (params.offerImages) {
        const imageLabel =
            params.imageCount === 1
                ? "una imagen"
                : params.imageCount <= 3
                    ? `${params.imageCount} imagenes`
                    : `hasta ${params.imageCount} imagenes`;
        lines.push(`Si quieres, tambien puedo enviarte ${imageLabel} del desarrollo.`);
    }

    if (params.offerPdf) {
        lines.push("Y si te sirve, tambien te comparto el catalogo en PDF.");
    }

    return lines.join("\n");
}

function shouldAppendCatalogOffer(
    reply: string,
    params: {
        offerImages: boolean;
        offerPdf: boolean;
    },
) {
    const normalized = normalizeCatalogComparableText(reply);
    if (!normalized) return true;

    if (params.offerImages && /\b(imagen(?:es)?|foto(?:s)?|galeria)\b/.test(normalized)) {
        return false;
    }

    if (params.offerPdf && (/\b(pdf|catalogo|brochure|ficha)\b/.test(normalized))) {
        return false;
    }

    return true;
}

function buildCatalogAssetIntro(params: {
    development: string;
    sendImages: boolean;
    sendPdf: boolean;
}) {
    if (params.sendImages && params.sendPdf) {
        return `Claro, te comparto las imagenes y tambien el catalogo en PDF de ${params.development}.`;
    }

    if (params.sendImages) {
        return `Claro, te comparto las imagenes de ${params.development}.`;
    }

    if (params.sendPdf) {
        return `Claro, te comparto el catalogo en PDF de ${params.development}.`;
    }

    return `Claro, te comparto la informacion de ${params.development}.`;
}

function buildCatalogLinkMessage(
    development: string,
    linkAsset: { url: string },
) {
    return `Tambien te dejo la liga de ${development}:\n${linkAsset.url}`;
}

function buildCatalogAvailabilityReply(summary: Awaited<ReturnType<typeof findCatalogAvailabilitySummary>>) {
    if (!summary) return null;

    if (summary.noDirectMatches && summary.requestedLocation) {
        return [
            `Por ahora no tengo propiedades cargadas exactamente en *${summary.requestedLocation}*.`,
            "Si quieres, puedo buscarte opciones cercanas o en otra zona de Merida.",
            "¿Prefieres que te muestre opciones del norte, poniente, oriente o sur?",
        ].join("\n\n");
    }

    const lines = summary.developments.map((item) =>
        item.location
            ? `- *${item.development}* (${item.location})`
            : `- *${item.development}*`,
    );

    if (summary.developments.length === 1) {
        const onlyDevelopment = summary.developments[0];
        const locationFragment = onlyDevelopment.location
            ? ` en *${onlyDevelopment.location}*`
            : "";

        return [
            `Tengo informacion disponible de *${onlyDevelopment.development}*${locationFragment}.`,
            "Si quieres, te platico mas sobre este desarrollo y te comparto lo mas importante.",
            "¿Que te gustaria conocer primero: ubicacion, caracteristicas, amenidades o imagenes?",
        ].join("\n\n");
    }

    const intro = summary.locationHint
        ? `Tenemos varias opciones disponibles en *${summary.locationHint}*.`
        : "Tenemos varias opciones disponibles en esta zona.";

    return [
        intro,
        "Algunos de ellos son:",
        lines.join("\n"),
        "Si quieres, te ayudo a encontrar la opcion que mejor se ajuste a lo que buscas.",
        "¿Te interesa conocer alguno en particular o prefieres que te recomiende una opcion segun ubicacion, recamaras o tipo de propiedad?",
    ].join("\n\n");
}

function shouldEscalateUnknownReply(reply: string) {
    const normalized = normalizeCatalogComparableText(reply);
    if (!normalized) return false;

    return [
        /\bno (tengo|cuento con|dispongo de|encuentro|logro encontrar)(?: [a-z0-9 ]{0,40})?(informacion|dato|respuesta|contexto)\b/,
        /\bno tengo informacion especifica\b/,
        /\bno tengo una respuesta fiable\b/,
        /\bno puedo confirmarlo\b/,
        /\bno tengo suficiente informacion\b/,
        /\bte voy a canalizar con un asesor\b/,
        /\btransferirte con un asesor\b/,
    ].some((pattern) => pattern.test(normalized));
}

function buildEscalationCustomerReply() {
    return "Para darte una respuesta precisa, te voy a canalizar con un asesor humano y en un momento te atenderemos por aqui.";
}

function buildEscalationAlertMessage(params: {
    brandName?: string | null;
    contact: {
        name?: string | null;
        phone?: string | null;
        company?: string | null;
    };
    latestUserMessage: string;
    conversationId: string;
}) {
    const brandName = params.brandName?.trim() || "el CRM";
    const contactName = normalizeContactName(params.contact.name) || "Sin nombre";
    const company = params.contact.company?.trim();

    return [
        `🔔 *Escalacion automatica desde ${brandName}*`,
        `Cliente: *${contactName}*`,
        `Telefono: *${params.contact.phone || "Sin telefono"}*`,
        company ? `Empresa: *${company}*` : null,
        `Motivo: La IA no encontro una respuesta confiable para continuar sola.`,
        `Ultimo mensaje del cliente:`,
        params.latestUserMessage.trim() ? params.latestUserMessage.trim() : "(sin texto)",
        `Conversacion: ${params.conversationId}`,
    ]
        .filter(Boolean)
        .join("\n");
}

async function triggerHumanEscalation(params: {
    conversationId: string;
    escalationPhone: string;
    contactPhone: string;
    brandName?: string | null;
    contact: {
        name?: string | null;
        phone?: string | null;
        company?: string | null;
    };
    latestUserMessage: string;
}) {
    const escalationPhone = sanitizeComparablePhone(params.escalationPhone);
    const contactPhone = sanitizeComparablePhone(params.contactPhone);

    await prisma.conversation.update({
        where: { id: params.conversationId },
        data: { botActive: false, updatedAt: new Date() },
    });

    if (!escalationPhone || escalationPhone === contactPhone) {
        return;
    }

    try {
        await sendWuzapiTextMessage(
            escalationPhone,
            buildEscalationAlertMessage({
                brandName: params.brandName,
                contact: params.contact,
                latestUserMessage: params.latestUserMessage,
                conversationId: params.conversationId,
            }),
        );
    } catch (error) {
        console.error("[Escalation] Failed to notify escalation phone:", error);
    }
}

async function touchAutomatedConversation(conversationId: string) {
    await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
    });

    revalidatePath("/dashboard/inbox");
    revalidatePath("/dashboard/pipeline");
}

async function getAutomatedWelcomeMessage(params: {
    welcomeMessage?: string | null;
}) {
    return params.welcomeMessage?.trim() || null;
}

function shouldSendAutomatedWelcome(
    currentInboundAt: Date,
    previousInboundAt: Date | null | undefined,
    repeatHours: number,
) {
    if (!previousInboundAt) {
        return true;
    }

    const repeatMs = Math.max(1, repeatHours || 24) * 60 * 60 * 1000;
    return currentInboundAt.getTime() - previousInboundAt.getTime() >= repeatMs;
}

async function persistCatalogState(params: {
    conversationId: string;
    catalogItemId: string | null;
    pendingImages: boolean;
    pendingPdf: boolean;
    pendingLink: boolean;
    offeredAt: Date | null;
    lastSentAt: Date | null;
}) {
    await prisma.catalogConversationState.upsert({
        where: { conversationId: params.conversationId },
        create: {
            conversationId: params.conversationId,
            catalogItemId: params.catalogItemId,
            pendingImages: params.pendingImages,
            pendingPdf: params.pendingPdf,
            pendingLink: params.pendingLink,
            offeredAt: params.offeredAt,
            lastSentAt: params.lastSentAt,
        },
        update: {
            catalogItemId: params.catalogItemId,
            pendingImages: params.pendingImages,
            pendingPdf: params.pendingPdf,
            pendingLink: params.pendingLink,
            offeredAt: params.offeredAt,
            lastSentAt: params.lastSentAt,
        },
    });
}

async function sendAutomatedBotText(params: {
    conversationId: string;
    phone: string;
    content: string;
}) {
    const content = params.content.trim();
    if (!content) return;

    try {
        const transportResult = await sendWuzapiTextMessage(params.phone, content);

        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content,
                direction: "outbound",
                status: "sent",
                type: "text",
                senderType: "bot",
                providerMessageId: transportResult?.Id || null,
            },
        });
        queueAvatarRefreshForConversation(params.conversationId);
    } catch (error) {
        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content,
                direction: "outbound",
                status: "failed",
                type: "text",
                senderType: "bot",
            },
        });
        throw error;
    }
}

async function sendAutomatedBotMedia(params: {
    conversationId: string;
    phone: string;
    mediaCategory: "image" | "document";
    mediaUrl: string;
    mediaLabel?: string | null;
    development: string;
}) {
    const placeholderContent = params.mediaCategory === "image" ? "[image]" : "[document]";

    try {
        const resolvedMedia = await resolveMediaToDataUrl(params.mediaUrl);
        const result = await sendWuzapiMediaMessage({
            phone: params.phone,
            mediaCategory: params.mediaCategory,
            dataUrl: resolvedMedia.dataUrl,
            fileName: resolvedMedia.fileName,
            mimeType: resolvedMedia.mimeType,
            caption: params.mediaCategory === "document" ? `Catalogo PDF de ${params.development}` : undefined,
        });

        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content: placeholderContent,
                direction: "outbound",
                status: "sent",
                type: params.mediaCategory,
                senderType: "bot",
                mediaUrl: params.mediaUrl,
                mediaType: resolvedMedia.mimeType,
                mediaFileName: resolvedMedia.fileName,
                providerMessageId: result?.Id || null,
            },
        });
        queueAvatarRefreshForConversation(params.conversationId);

        return true;
    } catch (error) {
        console.error("[Catalog] Failed to send automated media asset:", error);
        await prisma.message.create({
            data: {
                conversationId: params.conversationId,
                content: placeholderContent,
                direction: "outbound",
                status: "failed",
                type: params.mediaCategory,
                senderType: "bot",
                mediaUrl: params.mediaUrl,
                mediaFileName: params.mediaLabel || null,
            },
        });
        return false;
    }
}

async function sendCatalogAssets(params: {
    conversationId: string;
    phone: string;
    development: string;
    imageAssets: Array<{ url: string; label: string | null }>;
    pdfAsset: { url: string; label: string | null } | null;
    linkAsset: { url: string } | null;
    sendImages: boolean;
    sendPdf: boolean;
    sendLink: boolean;
}) {
    let sentSomething = false;

    if (params.sendImages) {
        for (const asset of params.imageAssets) {
            const sent = await sendAutomatedBotMedia({
                conversationId: params.conversationId,
                phone: params.phone,
                mediaCategory: "image",
                mediaUrl: asset.url,
                mediaLabel: asset.label,
                development: params.development,
            });
            sentSomething = sentSomething || sent;
        }
    }

    if (params.sendPdf && params.pdfAsset) {
        const sent = await sendAutomatedBotMedia({
            conversationId: params.conversationId,
            phone: params.phone,
            mediaCategory: "document",
            mediaUrl: params.pdfAsset.url,
            mediaLabel: params.pdfAsset.label,
            development: params.development,
        });
        sentSomething = sentSomething || sent;
    }

    if (params.sendLink && params.linkAsset) {
        await sendAutomatedBotText({
            conversationId: params.conversationId,
            phone: params.phone,
            content: buildCatalogLinkMessage(params.development, params.linkAsset),
        });
        sentSomething = true;
    }

    return sentSomething;
}

async function maybeSendKnowledgeImageFromTextSources(params: {
    conversationId: string;
    phone: string;
    latestUserMessage: string;
    assistantReply: string;
}) {
    try {
        const sources = await prisma.knowledgeSource.findMany({
            where: {
                type: "text",
                rawContent: {
                    not: null,
                },
            },
            select: {
                rawContent: true,
            },
            orderBy: {
                updatedAt: "desc",
            },
            take: 24,
        });

        if (sources.length === 0) {
            return false;
        }

        const entriesByUrl = new Map<string, KnowledgeImageEntry>();

        for (const source of sources) {
            for (const entry of extractKnowledgeImageEntries(source.rawContent)) {
                if (!entriesByUrl.has(entry.imageUrl)) {
                    entriesByUrl.set(entry.imageUrl, entry);
                }
            }
        }

        const entries = [...entriesByUrl.values()];
        if (entries.length === 0) {
            return false;
        }

        const combinedNeedle = `${params.latestUserMessage}\n${params.assistantReply}`;
        const normalizedNeedle = normalizeCatalogComparableText(combinedNeedle);
        const tokens = buildKnowledgeImageMatchTokens(combinedNeedle);

        if (!normalizedNeedle || tokens.length === 0) {
            return false;
        }

        let bestEntry: KnowledgeImageEntry | null = null;
        let bestScore = 0;

        for (const entry of entries) {
            const score = scoreKnowledgeImageEntry(entry, normalizedNeedle, tokens);
            if (score > bestScore) {
                bestScore = score;
                bestEntry = entry;
            }
        }

        if (!bestEntry || bestScore < KNOWLEDGE_IMAGE_MIN_SCORE) {
            return false;
        }

        const alreadySent = await prisma.message.findFirst({
            where: {
                conversationId: params.conversationId,
                direction: "outbound",
                senderType: "bot",
                type: "image",
                mediaUrl: bestEntry.imageUrl,
                status: {
                    not: "failed",
                },
            },
            select: { id: true },
        });

        if (alreadySent) {
            return false;
        }

        return sendAutomatedBotMedia({
            conversationId: params.conversationId,
            phone: params.phone,
            mediaCategory: "image",
            mediaUrl: bestEntry.imageUrl,
            mediaLabel: bestEntry.label,
            development: bestEntry.label,
        });
    } catch (error) {
        console.error("[KnowledgeImage] Failed to evaluate/send image from knowledge text sources:", error);
        return false;
    }
}

async function maybeHandleCatalogAssetReply(params: {
    conversationId: string;
    phone: string;
    latestUserMessage: string;
    settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>;
    catalogState:
        | {
              catalogItemId: string | null;
              pendingImages: boolean;
              pendingPdf: boolean;
              pendingLink: boolean;
              offeredAt: Date | null;
              lastSentAt: Date | null;
              catalogItem: CatalogItemMatch | null;
          }
        | null
        | undefined;
}) {
    if (!isCatalogAssistantEnabled(params.settings)) {
        return false;
    }

    const state = params.catalogState;
    if (!state?.catalogItem) {
        return false;
    }

    const intent = parseCatalogAssetIntent(params.latestUserMessage);
    const isOfferActive =
        hasRecentCatalogOffer(state.offeredAt) &&
        ((state.pendingImages && state.catalogItem.assets.some((asset) => asset.type === "image")) ||
            (state.pendingPdf && state.catalogItem.assets.some((asset) => asset.type === "pdf")));
    const { imageAssets, pdfAsset, linkAsset } = splitCatalogAssets(
        state.catalogItem.assets,
        params.settings.catalogMaxImagesToSend,
    );

    if (intent.negative && isOfferActive) {
        await sendAutomatedBotText({
            conversationId: params.conversationId,
            phone: params.phone,
            content: "Sin problema, seguimos por aqui.",
        });

        await persistCatalogState({
            conversationId: params.conversationId,
            catalogItemId: state.catalogItem.id,
            pendingImages: false,
            pendingPdf: false,
            pendingLink: false,
            offeredAt: null,
            lastSentAt: state.lastSentAt,
        });
        await touchAutomatedConversation(params.conversationId);
        return true;
    }

    const specificRequest = intent.wantsImages || intent.wantsPdf;
    const genericAcceptance = intent.affirmative && !specificRequest && isOfferActive;

    if (!specificRequest && !genericAcceptance) {
        return false;
    }

    const sendImages = intent.wantsImages ? imageAssets.length > 0 : Boolean(genericAcceptance && state.pendingImages);
    const sendPdf = intent.wantsPdf ? Boolean(pdfAsset) : Boolean(genericAcceptance && state.pendingPdf);

    if (!sendImages && !sendPdf) {
        const unavailableReply = intent.wantsImages
            ? "En esta ficha no tengo imagenes cargadas por ahora."
            : intent.wantsPdf
                ? "En esta ficha no tengo un catalogo en PDF cargado por ahora."
                : "Por ahora no tengo archivos adicionales de esta ficha.";

        await sendAutomatedBotText({
            conversationId: params.conversationId,
            phone: params.phone,
            content: unavailableReply,
        });
        await touchAutomatedConversation(params.conversationId);
        return true;
    }

    await sendAutomatedBotText({
        conversationId: params.conversationId,
        phone: params.phone,
        content: buildCatalogAssetIntro({
            development: state.catalogItem.development,
            sendImages,
            sendPdf,
        }),
    });

    await sendCatalogAssets({
        conversationId: params.conversationId,
        phone: params.phone,
        development: state.catalogItem.development,
        imageAssets,
        pdfAsset,
        linkAsset,
        sendImages,
        sendPdf,
        sendLink: params.settings.catalogIncludeLink && Boolean(linkAsset) && (sendImages || sendPdf || state.pendingLink),
    });

    await persistCatalogState({
        conversationId: params.conversationId,
        catalogItemId: state.catalogItem.id,
        pendingImages: Boolean(state.pendingImages && !sendImages),
        pendingPdf: Boolean(state.pendingPdf && !sendPdf),
        pendingLink: false,
        offeredAt:
            state.pendingImages && !sendImages
                ? state.offeredAt
                : state.pendingPdf && !sendPdf
                    ? state.offeredAt
                    : null,
        lastSentAt: new Date(),
    });
    await touchAutomatedConversation(params.conversationId);
    return true;
}

async function maybeSendAutomatedReply(
    conversationId: string,
    inboundMessageId: string,
    latestUserMessage: string,
) {
    try {
        const settings = await getSystemSettingsOrDefaults();
        const catalogAssistantEnabled = isCatalogAssistantEnabled(settings);
        if (!settings.isBotEnabled) return;
        if (shouldSkipAutoReplyText(latestUserMessage)) return;

        const initialConversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true },
        });

        if (!initialConversation?.botActive || !initialConversation.contact?.phone) {
            return;
        }

        if (settings.autoReplyDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, settings.autoReplyDelayMs));
        }

        const [latestConversation, latestMessage, previousInboundMessage] = await Promise.all([
            prisma.conversation.findUnique({
                where: { id: conversationId },
                include: {
                    contact: true,
                    catalogState: {
                        include: {
                            catalogItem: {
                                include: {
                                    assets: {
                                        orderBy: [
                                            { type: "asc" },
                                            { sortOrder: "asc" },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                    messages: {
                        where: {
                            type: { not: "system" },
                        },
                        orderBy: { createdAt: "desc" },
                        take: 8,
                        select: {
                            content: true,
                            direction: true,
                            senderType: true,
                        },
                    },
                },
            }),
            prisma.message.findFirst({
                where: { conversationId },
                orderBy: { createdAt: "desc" },
            }),
            prisma.message.findFirst({
                where: {
                    conversationId,
                    direction: "inbound",
                    id: { not: inboundMessageId },
                },
                orderBy: { createdAt: "desc" },
                select: { createdAt: true },
            }),
        ]);

        if (!latestConversation?.botActive || !latestConversation.contact?.phone) return;
        if (!latestMessage || latestMessage.id !== inboundMessageId || latestMessage.direction !== "inbound") {
            return;
        }

        if (
            shouldSendAutomatedWelcome(
                latestMessage.createdAt,
                previousInboundMessage?.createdAt,
                settings.welcomeRepeatHours || 24,
            )
        ) {
            const welcomeMessage = await getAutomatedWelcomeMessage({
                welcomeMessage: settings.welcomeMessage,
            });

            if (welcomeMessage) {
                await sendAutomatedBotText({
                    conversationId,
                    phone: latestConversation.contact.phone,
                    content: welcomeMessage,
                });
                await touchAutomatedConversation(conversationId);
                return;
            }
        }

        const handledCatalogReply = catalogAssistantEnabled
            ? await maybeHandleCatalogAssetReply({
                conversationId,
                phone: latestConversation.contact.phone,
                latestUserMessage,
                settings,
                catalogState: latestConversation.catalogState,
            })
            : false;

        if (handledCatalogReply) {
            return;
        }

        const leadAutomation = await processLeadAutomationTurn({
            conversationId,
            latestUserMessage,
            settings,
        });
        const appointmentResult = await maybeHandleAppointmentBooking(
            conversationId,
            latestUserMessage,
            {
                mode: leadAutomation.pendingCaptureField ? "validate" : "create",
            },
        );

        let reply: string | null = null;
        let catalogItem: CatalogItemMatch | null = null;
        let pendingCatalogImages = false;
        let pendingCatalogPdf = false;
        let pendingCatalogLink = false;
        let sendCatalogImagesNow = false;
        let sendCatalogPdfNow = false;
        let sendCatalogLinkNow = false;
        let sendOnlyFirstCatalogImageNow = false;
        let usedCatalogAvailabilitySummary = false;
        let catalogDevelopmentContext: Awaited<ReturnType<typeof getCatalogDevelopmentContext>> | null = null;
        let replyFromModel = false;

        if (
            appointmentResult.kind === "missing" ||
            appointmentResult.kind === "unavailable" ||
            appointmentResult.kind === "created"
        ) {
            reply = appointmentResult.reply;
        } else {
            const appointmentInstruction =
                appointmentResult.kind === "validated" && leadAutomation.pendingCaptureField
                    ? [
                        `Ya verificaste operativamente que el horario ${appointmentResult.availableSlot.label} sigue disponible.`,
                        "Todavia no confirmes que la cita quedo agendada.",
                        `Antes de reservarla, pide unicamente el dato pendiente del cliente (${leadAutomation.pendingCaptureField === "name" ? "nombre completo" : "correo electronico"}).`,
                        "Manten el mismo horario como referencia y no inventes asesoras, ejecutivos ni datos de contacto humanos.",
                    ].join(" ")
                    : null;

            if (catalogAssistantEnabled) {
                const activeCatalogItem = latestConversation.catalogState?.catalogItem || null;
                const shouldStickToCurrentDevelopment = activeCatalogItem
                    ? (
                        latestMessageMentionsDevelopment(latestUserMessage, activeCatalogItem.development) ||
                        isCatalogDetailFollowUp(latestUserMessage)
                    )
                    : false;
                const catalogLookupQuery = shouldStickToCurrentDevelopment
                    ? latestUserMessage
                    : buildCatalogLookupQuery(
                        latestConversation.messages.map((message) => ({
                            content: message.content,
                            direction: message.direction,
                        })),
                        latestUserMessage,
                    );
                const developmentScopedCatalogItem =
                    shouldStickToCurrentDevelopment && activeCatalogItem
                        ? await findBestCatalogItemInDevelopment(
                            activeCatalogItem.development,
                            latestUserMessage,
                        )
                        : null;
                const latestCatalogAvailabilitySummary = shouldStickToCurrentDevelopment
                    ? null
                    : await findCatalogAvailabilitySummary(latestUserMessage);
                const latestRequestedLocation = latestCatalogAvailabilitySummary?.requestedLocation || null;
                const catalogAvailabilitySummary = latestCatalogAvailabilitySummary ||
                    (
                        !shouldStickToCurrentDevelopment &&
                        catalogLookupQuery !== latestUserMessage &&
                        !latestRequestedLocation
                            ? await findCatalogAvailabilitySummary(catalogLookupQuery)
                            : null
                    );
                const shouldSuppressCatalogItemLookup = Boolean(catalogAvailabilitySummary?.noDirectMatches);
                catalogItem =
                    shouldSuppressCatalogItemLookup
                        ? null
                        : developmentScopedCatalogItem ||
                    await findBestCatalogItem(latestUserMessage) ||
                    (
                        !shouldStickToCurrentDevelopment &&
                        !shouldSuppressCatalogItemLookup &&
                        catalogLookupQuery !== latestUserMessage
                            ? await findBestCatalogItem(catalogLookupQuery)
                            : null
                    ) ||
                    (
                        shouldStickToCurrentDevelopment
                            ? activeCatalogItem
                            : null
                    );
                const catalogIntent = parseCatalogAssetIntent(latestUserMessage);
                const shouldPreferCatalogSummary =
                    Boolean(catalogAvailabilitySummary) &&
                    !shouldStickToCurrentDevelopment &&
                    (!catalogItem || !latestMessageMentionsDevelopment(latestUserMessage, catalogItem.development));

                if (shouldPreferCatalogSummary) {
                    reply = buildCatalogAvailabilityReply(catalogAvailabilitySummary);
                    catalogItem = null;
                    usedCatalogAvailabilitySummary = true;
                } else if (catalogItem) {
                    catalogDevelopmentContext = await getCatalogDevelopmentContext(
                        catalogItem.id,
                        6,
                        latestUserMessage,
                    );
                    const { imageAssets, pdfAsset, linkAsset } = splitCatalogAssets(
                        catalogItem.assets,
                        settings.catalogMaxImagesToSend,
                    );

                    const requestedImages = Boolean(catalogIntent.wantsImages && imageAssets.length > 0);
                    const requestedPdf = Boolean(catalogIntent.wantsPdf && pdfAsset);
                    const alreadySentCurrentItemAssets = Boolean(
                        latestConversation.catalogState?.catalogItemId === catalogItem.id &&
                        latestConversation.catalogState?.lastSentAt,
                    );
                    const shouldAutoSendFirstImage =
                        settings.catalogAskBeforeSending &&
                        settings.catalogOfferImages &&
                        imageAssets.length > 0 &&
                        !requestedImages &&
                        !alreadySentCurrentItemAssets;
                    const remainingImagesAfterAutoSend = Math.max(
                        0,
                        imageAssets.length - (shouldAutoSendFirstImage ? 1 : 0),
                    );

                    sendOnlyFirstCatalogImageNow = shouldAutoSendFirstImage;
                    sendCatalogImagesNow =
                        requestedImages ||
                        shouldAutoSendFirstImage ||
                        (!settings.catalogAskBeforeSending &&
                            settings.catalogOfferImages &&
                            imageAssets.length > 0);
                    sendCatalogPdfNow =
                        requestedPdf ||
                        (!settings.catalogAskBeforeSending &&
                            settings.catalogOfferPdf &&
                            Boolean(pdfAsset));

                    pendingCatalogImages =
                        settings.catalogAskBeforeSending &&
                        settings.catalogOfferImages &&
                        remainingImagesAfterAutoSend > 0 &&
                        !requestedImages;
                    pendingCatalogPdf =
                        settings.catalogAskBeforeSending &&
                        settings.catalogOfferPdf &&
                        Boolean(pdfAsset) &&
                        !requestedPdf;

                    sendCatalogLinkNow =
                        settings.catalogIncludeLink &&
                        Boolean(linkAsset) &&
                        (
                            sendCatalogImagesNow ||
                            sendCatalogPdfNow ||
                            (!pendingCatalogImages && !pendingCatalogPdf)
                        );
                    pendingCatalogLink =
                        settings.catalogIncludeLink &&
                        Boolean(linkAsset) &&
                        !sendCatalogLinkNow &&
                        (pendingCatalogImages || pendingCatalogPdf);
                }
            }

            if (!reply) {
                const catalogInstruction = catalogItem
                    ? buildCatalogInstruction(catalogItem, catalogDevelopmentContext)
                    : null;
                const automationInstruction = [leadAutomation.instruction, appointmentInstruction]
                    .concat(catalogInstruction ? [catalogInstruction] : [])
                    .filter(Boolean)
                    .join(" ")
                    .trim() || null;

                reply = await generateConversationReply(
                    conversationId,
                    latestUserMessage,
                    automationInstruction,
                );
                replyFromModel = true;
            }
        }

        if (!reply) return;

        const shouldEscalate =
            replyFromModel &&
            settings.escalationEnabled &&
            Boolean(settings.escalationPhone?.trim()) &&
            shouldEscalateUnknownReply(reply);

        if (shouldEscalate) {
            reply = buildEscalationCustomerReply();
            catalogItem = null;
            pendingCatalogImages = false;
            pendingCatalogPdf = false;
            pendingCatalogLink = false;
            sendCatalogImagesNow = false;
            sendCatalogPdfNow = false;
            sendCatalogLinkNow = false;
            sendOnlyFirstCatalogImageNow = false;
        }

        if (catalogItem && settings.catalogAskBeforeSending) {
            const imageCountForOffer = Math.max(
                0,
                splitCatalogAssets(
                    catalogItem.assets,
                    settings.catalogMaxImagesToSend,
                ).imageAssets.length - (sendOnlyFirstCatalogImageNow ? 1 : 0),
            );
            const offerText = buildCatalogOfferText({
                offerImages: pendingCatalogImages,
                imageCount: imageCountForOffer,
                offerPdf: pendingCatalogPdf,
            });
            if (shouldAppendCatalogOffer(reply, {
                offerImages: pendingCatalogImages,
                offerPdf: pendingCatalogPdf,
            })) {
                reply = appendSection(reply, offerText);
            }
        }

        await sendAutomatedBotText({
            conversationId,
            phone: latestConversation.contact.phone,
            content: reply,
        });

        if (!shouldEscalate && !catalogItem) {
            await maybeSendKnowledgeImageFromTextSources({
                conversationId,
                phone: latestConversation.contact.phone,
                latestUserMessage,
                assistantReply: reply,
            });
        }

        if (shouldEscalate) {
            await triggerHumanEscalation({
                conversationId,
                escalationPhone: settings.escalationPhone || "",
                contactPhone: latestConversation.contact.phone,
                brandName: settings.agentName,
                contact: latestConversation.contact,
                latestUserMessage,
            });
        }

        if (catalogItem) {
            const { imageAssets, pdfAsset, linkAsset } = splitCatalogAssets(
                catalogItem.assets,
                settings.catalogMaxImagesToSend,
            );
            const imageAssetsToSend = sendOnlyFirstCatalogImageNow
                ? imageAssets.slice(0, 1)
                : imageAssets;

            if (sendCatalogImagesNow || sendCatalogPdfNow || sendCatalogLinkNow) {
                await sendCatalogAssets({
                    conversationId,
                    phone: latestConversation.contact.phone,
                    development: catalogItem.development,
                    imageAssets: imageAssetsToSend,
                    pdfAsset,
                    linkAsset,
                    sendImages: sendCatalogImagesNow,
                    sendPdf: sendCatalogPdfNow,
                    sendLink: sendCatalogLinkNow,
                });
            }

            await persistCatalogState({
                conversationId,
                catalogItemId: catalogItem.id,
                pendingImages: pendingCatalogImages,
                pendingPdf: pendingCatalogPdf,
                pendingLink: pendingCatalogLink,
                offeredAt:
                    pendingCatalogImages || pendingCatalogPdf
                        ? new Date()
                        : null,
                lastSentAt:
                    sendCatalogImagesNow || sendCatalogPdfNow || sendCatalogLinkNow
                        ? new Date()
                        : latestConversation.catalogState?.lastSentAt || null,
            });
        } else if (usedCatalogAvailabilitySummary) {
            await persistCatalogState({
                conversationId,
                catalogItemId: null,
                pendingImages: false,
                pendingPdf: false,
                pendingLink: false,
                offeredAt: null,
                lastSentAt: latestConversation.catalogState?.lastSentAt || null,
            });
        }

        await touchAutomatedConversation(conversationId);
    } catch (error) {
        console.error("[Bot] Failed to send automated reply:", error);
    }
}

export async function getConversations() {
    try {
        const conversations = await prisma.conversation.findMany({
            include: {
                contact: true,
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
            orderBy: { updatedAt: "desc" },
        });
        return conversations;
    } catch (error) {
        console.error("Failed to fetch conversations:", error);
        return [];
    }
}

export async function getMessages(conversationId: string) {
    try {
        const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: "asc" },
        });
        return messages;
    } catch (error) {
        console.error("Failed to fetch messages:", error);
        return [];
    }
}

export async function sendMessage(conversationId: string, content: string, direction: "inbound" | "outbound" = "outbound") {
    console.log("!!! [SendMessage] FUNCTION CALLED !!!", { conversationId, content, direction });
    try {
        // Get conversation with contact to get phone number
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true },
        });

        if (!conversation) {
            throw new Error("Conversation not found");
        }

        const isHumanOutbound = direction === "outbound";

        // Create message in database first
        const message = await prisma.message.create({
            data: {
                conversationId,
                content,
                direction,
                status: "sending",
                type: "text",
                senderType: isHumanOutbound ? "human" : null,
            },
        });

        console.log("[SendMessage] Created message:", message.id);
        console.log("[SendMessage] Direction:", direction);
        console.log("[SendMessage] Contact phone:", conversation.contact?.phone);

        // If outbound, send via WhatsApp QR gateway
        if (direction === "outbound" && conversation.contact?.phone) {
            console.log("[SendMessage] Attempting to send via WuzAPI...");
            try {
                const result = await sendWuzapiTextMessage(conversation.contact.phone, content);
                console.log("[SendMessage] WuzAPI result:", result);

                // Update message status to sent
                await prisma.message.update({
                    where: { id: message.id },
                    data: {
                        status: result?.Id ? "sent" : "failed",
                        providerMessageId: result?.Id || null,
                    },
                });
            } catch (whatsappError) {
                console.error("[SendMessage] WhatsApp send error:", whatsappError);
                // Update message status to failed
                await prisma.message.update({
                    where: { id: message.id },
                    data: { status: "failed" },
                });
            }
        } else {
            console.log("[SendMessage] Skipping WhatsApp transport - direction:", direction, "phone:", conversation.contact?.phone);
            // For inbound or no phone, just mark as sent
            await prisma.message.update({
                where: { id: message.id },
                data: { status: "sent" },
            });
        }

        if (direction === "outbound" && conversation.contact?.id) {
            void refreshWhatsAppAvatarForContact(conversation.contact.id).catch((avatarError) => {
                console.warn("[SendMessage] Failed to refresh WhatsApp avatar", avatarError);
            });
        }

        await prisma.conversation.update({
            where: { id: conversationId },
            data: {
                updatedAt: new Date(),
                botActive: isHumanOutbound ? false : conversation.botActive,
            },
        });

        revalidatePath(`/dashboard/inbox`);
        return message;
    } catch (error) {
        console.error("Failed to send message:", error);
        throw new Error("Failed to send message");
    }
}

export async function createConversation(contactId: string) {
    try {
        let conversation = await prisma.conversation.findFirst({
            where: { contactId, status: 'active' }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    contactId,
                    status: 'active'
                }
            });
        }

        revalidatePath('/dashboard/inbox');
        return conversation;
    } catch (error) {
        console.error("Error creating conversation:", error);
        throw new Error("Failed to create conversation");
    }
}

// Process incoming webhook message and store in database
export async function processInboundMessage(
    from: string,
    text: string,
    customerName?: string,
    media?: {
        type?: string;
        mediaUrl?: string;
        mediaType?: string;
        mediaFileName?: string;
    },
    providerMessageId?: string,
) {
    try {
        const normalizedFrom = normalizePhoneDigits(from);
        if (!normalizedFrom) {
            return;
        }

        const normalizedCustomerName = normalizeContactName(customerName);
        const phoneClauses = buildPhoneMatchClauses([normalizedFrom]);

        // Find or create contact by phone number
        let contact = phoneClauses.length > 0 ? await prisma.contact.findFirst({
            where: { OR: phoneClauses },
        }) : null;

        if (!contact) {
            contact = await prisma.contact.create({
                data: {
                    phone: normalizedFrom,
                    name: normalizedCustomerName,
                    status: "lead",
                },
            });
        } else if (normalizedCustomerName && !normalizeContactName(contact.name)) {
            // Update contact name if we got it from webhook and it's not set
            contact = await prisma.contact.update({
                where: { id: contact.id },
                data: { name: normalizedCustomerName },
            });
        }

        void refreshWhatsAppAvatarForContact(contact.id).catch((avatarError) => {
            console.warn("[Inbound] Failed to refresh WhatsApp avatar", avatarError);
        });

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
            where: { contactId: contact.id, status: "active" },
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    contactId: contact.id,
                    status: "active",
                },
            });
        }

        // Create inbound message with optional media
        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: text,
                direction: "inbound",
                status: "delivered",
                type: media?.type || "text",
                mediaUrl: media?.mediaUrl || null,
                mediaType: media?.mediaType || null,
                mediaFileName: media?.mediaFileName || null,
                providerMessageId: providerMessageId || null,
            },
        });

        // Update conversation activity timestamp
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                updatedAt: new Date(),
            },
        });

        // â”€â”€ Ensure the contact already exists in the pipeline before evaluating stop rules â”€â”€
        try {
            const existingDeal = await prisma.deal.findFirst({
                where: { contactId: contact.id },
            });

            if (!existingDeal) {
                const incomingStage = await prisma.pipelineStage.findFirst({
                    where: { isIncoming: true },
                });

                if (incomingStage) {
                    const displayName = normalizeContactName(contact.name) || normalizedCustomerName;
                    const dealTitle = displayName
                        ? `Lead - ${displayName}`
                        : `Lead WhatsApp - ${from}`;

                    await prisma.deal.create({
                        data: {
                            title: dealTitle,
                            value: 0,
                            stageId: incomingStage.id,
                            contactId: contact.id,
                            source: "whatsapp",
                            priority: "medium",
                        },
                    });
                    revalidatePath("/dashboard/pipeline");
                }
            }
        } catch (dealError) {
            console.error("[Pipeline] Failed to auto-create deal:", dealError);
        }

        const botInputText = await buildInboundMediaContext({
            text,
            type: media?.type,
            mediaUrl: media?.mediaUrl,
            mediaType: media?.mediaType,
            mediaFileName: media?.mediaFileName,
        });

        const bulkReplyResult = await markBulkCampaignReplyForContact(
            contact.id,
            conversation.id,
            botInputText || text,
            message.createdAt,
        );
        const conversationWasBotActive = conversation.botActive ?? true;
        let shouldScheduleAutomatedReply = conversationWasBotActive;

        if (bulkReplyResult.intent === "stop") {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    botActive: false,
                    updatedAt: new Date(),
                },
            });
            shouldScheduleAutomatedReply = false;
            revalidatePath("/dashboard/pipeline");
        } else if (bulkReplyResult.activatedBot && conversationWasBotActive) {
            await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    botActive: true,
                    updatedAt: new Date(),
                },
            });
            shouldScheduleAutomatedReply = true;
        } else if (bulkReplyResult.activatedBot && !conversationWasBotActive) {
            console.log("[Chatbot] Interest detected but the conversation stays in human mode:", conversation.id);
        }

        // ── Auto-create Deal for contacts without a deal ──
        // Every contact should be mapped in the pipeline
        try {
            const existingDeal = await prisma.deal.findFirst({
                where: { contactId: contact.id },
            });

            if (!existingDeal) {
                const incomingStage = await prisma.pipelineStage.findFirst({
                    where: { isIncoming: true },
                });

                if (incomingStage) {
                    const displayName = normalizeContactName(contact.name) || normalizedCustomerName;
                    const dealTitle = displayName
                        ? `Lead - ${displayName}`
                        : `Lead WhatsApp - ${from}`;

                    await prisma.deal.create({
                        data: {
                            title: dealTitle,
                            value: 0,
                            stageId: incomingStage.id,
                            contactId: contact.id,
                            source: "whatsapp",
                            priority: "medium",
                        },
                    });
                    console.log(`[Pipeline] Auto-created deal for contact without deal: ${dealTitle}`);
                    revalidatePath("/dashboard/pipeline");
                }
            }
        } catch (dealError) {
            console.error("[Pipeline] Failed to auto-create deal:", dealError);
            // Don't fail the whole message processing
        }

        // ── CHATBOT / N8N FORWARDING ──
        try {
            if (bulkReplyResult.intent !== "stop" && shouldScheduleAutomatedReply) {
                void maybeSendAutomatedReply(conversation.id, message.id, botInputText);
            }
        } catch (botError) {
            console.error("[Chatbot] Error scheduling automated reply:", botError);
        }

        // ── AI Contact Enrichment (fire-and-forget) ──
        enrichContactFromMessage(contact.id, botInputText || text).catch((err) => {
            console.error("[AI Enrichment] Background enrichment failed:", err);
        });

        revalidatePath("/dashboard/inbox");
        return { contact, conversation, message };
    } catch (error) {
        console.error("Failed to process inbound message:", error);
        throw error;
    }
}
