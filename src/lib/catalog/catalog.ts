import { prisma } from "@/lib/db";
import { generateEmbeddings, generateEmbedding } from "@/lib/ai/openai";

type CatalogImportRow = {
    externalId: string;
    development: string;
    location: string | null;
    question: string;
    answer: string;
    searchableText: string;
    isActive: boolean;
    assets: Array<{
        type: "image" | "pdf" | "link";
        url: string;
        label?: string | null;
        sortOrder: number;
    }>;
};

type CatalogSearchResult = {
    id: string;
    externalId: string;
    development: string;
    location: string | null;
    question: string;
    answer: string;
    searchableText: string;
    similarity: number;
};

export type CatalogAvailabilitySummary = {
    locationHint: string | null;
    developments: Array<{
        development: string;
        location: string | null;
    }>;
};

const MAX_IMPORT_IMAGES = 10;
const MAX_CATALOG_MATCHES = 3;
const MIN_VECTOR_SIMILARITY = 0.62;
const MAX_AVAILABILITY_SUMMARY_ITEMS = 8;
const CATALOG_QUERY_STOPWORDS = new Set([
    "a", "ahi", "alli", "algun", "alguna", "algunas", "algunos", "ando", "asi", "ayuda",
    "busca", "buscar", "como", "con", "cual", "cuales", "de", "del", "dime", "donde",
    "en", "esa", "esas", "ese", "eso", "esos", "estas", "este", "esto", "estos",
    "favor", "hay", "hola", "la", "las", "lo", "los", "manejas", "me", "muestrame",
    "ofreces", "oye", "para", "podrias", "por", "propiedad", "propiedades", "proyecto",
    "proyectos", "que", "quiero", "tendra", "tendras", "tendrás", "tener", "tienes",
    "un", "una", "unas", "unos", "ver",
]);
const CATALOG_GENERIC_AVAILABILITY_TERMS = [
    "propiedad", "propiedades", "desarrollo", "desarrollos", "proyecto", "proyectos",
    "casa", "casas", "departamento", "departamentos", "depa", "depas", "terreno",
    "terrenos", "lote", "lotes", "vivienda", "viviendas",
];

type DeduplicatedCatalogRowsResult = {
    rows: CatalogImportRow[];
    duplicateExternalIds: string[];
};

function normalizeHeader(value: string) {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function normalizeCell(value: string | undefined) {
    return (value || "").trim();
}

function normalizeSearchText(value: string | null | undefined) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenizeCatalogQuery(query: string) {
    return normalizeSearchText(query)
        .split(" ")
        .filter((token) => token.length >= 3 && !CATALOG_QUERY_STOPWORDS.has(token));
}

function buildCatalogHaystack(item: {
    development: string;
    location: string | null;
    question: string;
    answer: string;
    searchableText: string;
}) {
    return {
        development: normalizeSearchText(item.development),
        location: normalizeSearchText(item.location),
        question: normalizeSearchText(item.question),
        answer: normalizeSearchText(item.answer),
        searchableText: normalizeSearchText(item.searchableText),
    };
}

function scoreCatalogTextMatch(
    item: {
        development: string;
        location: string | null;
        question: string;
        answer: string;
        searchableText: string;
    },
    query: string,
) {
    const normalizedQuery = normalizeSearchText(query);
    const tokens = tokenizeCatalogQuery(query);

    if (tokens.length === 0) {
        return 0;
    }

    const haystack = buildCatalogHaystack(item);
    let score = 0;
    let matchedTokens = 0;

    for (const token of tokens) {
        let tokenMatched = false;

        if (haystack.development.includes(token)) {
            score += 24;
            tokenMatched = true;
        }
        if (haystack.location.includes(token)) {
            score += 30;
            tokenMatched = true;
        }
        if (haystack.question.includes(token)) {
            score += 16;
            tokenMatched = true;
        }
        if (haystack.answer.includes(token)) {
            score += 8;
            tokenMatched = true;
        }
        if (haystack.searchableText.includes(token)) {
            score += 3;
            tokenMatched = true;
        }

        if (tokenMatched) {
            matchedTokens += 1;
        }
    }

    if (haystack.location && normalizedQuery.includes(haystack.location)) {
        score += 90;
    }

    if (haystack.development && normalizedQuery.includes(haystack.development)) {
        score += 80;
    }

    if (haystack.question && normalizedQuery.includes(haystack.question)) {
        score += 55;
    }

    score += matchedTokens * 10;

    return matchedTokens === 0 ? 0 : score;
}

function isGenericAvailabilityQuery(query: string) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return false;

    const hasCatalogNoun = CATALOG_GENERIC_AVAILABILITY_TERMS.some((term) =>
        normalized.includes(term),
    );
    const hasAvailabilityIntent =
        /\b(donde|hay|tienes|manejas|ofreces|ubicad|zona|areas|lugares|disponibles)\b/.test(normalized);

    return hasCatalogNoun && hasAvailabilityIntent;
}

function extractAvailabilityHintTokens(query: string) {
    return tokenizeCatalogQuery(query).filter(
        (token) => !CATALOG_GENERIC_AVAILABILITY_TERMS.includes(token),
    );
}

function resolveAvailabilityLocationHint(
    hintTokens: string[],
    developments: Array<{ development: string; location: string | null }>,
) {
    const locationScores = new Map<string, { label: string; score: number }>();

    for (const development of developments) {
        if (!development.location) continue;

        const normalizedLocation = normalizeSearchText(development.location);
        let score = 0;

        for (const token of hintTokens) {
            if (normalizedLocation.includes(token)) {
                score += Math.max(1, token.length);
            }
        }

        if (score <= 0) continue;

        const current = locationScores.get(normalizedLocation);
        if (!current || score > current.score) {
            locationScores.set(normalizedLocation, {
                label: development.location,
                score,
            });
        }
    }

    const bestLocation = [...locationScores.values()]
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.label.localeCompare(right.label, "es", { sensitivity: "base" });
        })[0];

    if (bestLocation) {
        return bestLocation.label;
    }

    const uniqueLocations = [...new Set(
        developments
            .map((development) => development.location?.trim())
            .filter((location): location is string => Boolean(location)),
    )];

    return uniqueLocations.length === 1 ? uniqueLocations[0] : null;
}

function countMatches(source: string, pattern: RegExp) {
    return (source.match(pattern) || []).length;
}

function scoreDecodedCatalogText(source: string) {
    const replacementChars = countMatches(source, /\uFFFD/g);
    const mojibakeHints = countMatches(source, /Ã.|Â.|â€¦|â€œ|â€|â€"|â€™|â€“|â€”/g);
    const controlChars = countMatches(source, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
    const spanishChars = countMatches(source, /[áéíóúÁÉÍÓÚñÑ¿¡]/g);
    const printableChars = countMatches(source, /[A-Za-z0-9áéíóúÁÉÍÓÚñÑ¿¡.,;:()_\-\/"'@\s]/g);

    return (
        printableChars +
        spanishChars * 6 -
        replacementChars * 120 -
        mojibakeHints * 50 -
        controlChars * 120
    );
}

function decodeCatalogCsvBuffer(buffer: Buffer) {
    if (buffer.length === 0) {
        return "";
    }

    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return new TextDecoder("utf-8").decode(buffer);
    }

    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(buffer);
    }

    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(buffer);
    }

    const looksLikeUtf16 =
        buffer.subarray(0, Math.min(buffer.length, 512)).some((byte, index) =>
            index % 2 === 1 ? byte === 0 : false,
        );

    if (looksLikeUtf16) {
        const utf16le = new TextDecoder("utf-16le").decode(buffer);
        const utf16be = new TextDecoder("utf-16be").decode(buffer);
        return scoreDecodedCatalogText(utf16le) >= scoreDecodedCatalogText(utf16be)
            ? utf16le
            : utf16be;
    }

    const utf8 = new TextDecoder("utf-8").decode(buffer);
    const windows1252 = new TextDecoder("windows-1252").decode(buffer);

    return scoreDecodedCatalogText(utf8) >= scoreDecodedCatalogText(windows1252)
        ? utf8
        : windows1252;
}

function parseBooleanCell(value: string | undefined, fallback = true) {
    const normalized = normalizeCell(value).toLowerCase();
    if (!normalized) return fallback;

    if (["1", "true", "si", "sí", "yes", "activo", "activa"].includes(normalized)) {
        return true;
    }

    if (["0", "false", "no", "inactivo", "inactiva"].includes(normalized)) {
        return false;
    }

    return fallback;
}

function parseCsvLine(source: string) {
    const rows: string[][] = [];
    let currentCell = "";
    let currentRow: string[] = [];
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        const nextChar = source[index + 1];

        if (char === "\"") {
            if (inQuotes && nextChar === "\"") {
                currentCell += "\"";
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === "," && !inQuotes) {
            currentRow.push(currentCell);
            currentCell = "";
            continue;
        }

        if ((char === "\n" || char === "\r") && !inQuotes) {
            if (char === "\r" && nextChar === "\n") {
                index += 1;
            }
            currentRow.push(currentCell);
            if (currentRow.some((cell) => cell.trim().length > 0)) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = "";
            continue;
        }

        currentCell += char;
    }

    currentRow.push(currentCell);
    if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
    }

    return rows;
}

function getFirstValue(
    row: Record<string, string>,
    aliases: string[],
) {
    for (const alias of aliases) {
        const value = normalizeCell(row[alias]);
        if (value) return value;
    }
    return "";
}

function isImageColumn(header: string) {
    return /^(imagen|image)(?:_(?:url|\d+|img|\d+_url))?$/.test(header);
}

function isPdfColumn(header: string) {
    return /^(pdf|pdf_url|catalogo_pdf|catalogo_pdf_url|brochure_pdf|brochure_pdf_url)$/.test(header);
}

function isLinkColumn(header: string) {
    return /^(url|landing_url|link|enlace|pagina_url|sitio_url)$/.test(header);
}

function isAffirmative(text: string) {
    return /\b(si|sí|claro|va|ok|sale|manda|mandame|mandamelo|mandalas|mandamelas|envia|envialo|envialas|quiero|compartelo)\b/i.test(text);
}

function wantsOnlyImages(text: string) {
    return /\b(fotos|foto|imagenes|imágenes|imagen)\b/i.test(text);
}

function wantsOnlyPdf(text: string) {
    return /\b(pdf|catalogo|catalogo en pdf|brochure|ficha)\b/i.test(text);
}

function isNegative(text: string) {
    return /\b(no|ahorita no|luego no|despues no|después no|asi esta|así está|con eso)\b/i.test(text);
}

function buildSearchableText(row: {
    development: string;
    location: string | null;
    question: string;
    answer: string;
}) {
    return [
        row.development,
        row.location || "",
        row.question,
        row.answer,
    ]
        .filter(Boolean)
        .join("\n");
}

function mapCsvRows(source: string) {
    const rawRows = parseCsvLine(source);
    if (rawRows.length < 2) {
        throw new Error("El CSV no trae suficientes filas para importar.");
    }

    const rawHeaders = rawRows[0].map((header) => normalizeHeader(header));
    const dataRows = rawRows.slice(1);

    return dataRows
        .map((cells, rowIndex) => {
            const row = rawHeaders.reduce<Record<string, string>>((accumulator, header, cellIndex) => {
                accumulator[header] = cells[cellIndex] || "";
                return accumulator;
            }, {});

            const externalId =
                getFirstValue(row, ["id", "external_id", "externalid"]) ||
                `catalog_${rowIndex + 1}`;
            const development = getFirstValue(row, ["desarrollo", "desarrollo_nombre", "development", "proyecto"]);
            const location = getFirstValue(row, ["ubicacion", "ubicacion_texto", "location"]) || null;
            const question = getFirstValue(row, ["pregunta", "question"]);
            const answer = getFirstValue(row, ["contenido", "respuesta", "answer", "content"]);
            const isActive = parseBooleanCell(
                row.activo || row.active || row.is_active || row.estado,
                true,
            );

            if (!development || !question || !answer) {
                return null;
            }

            const assets: CatalogImportRow["assets"] = [];
            const seenUrls = new Set<string>();
            let imageSort = 0;

            for (const header of rawHeaders) {
                const url = normalizeCell(row[header]);
                if (!url || seenUrls.has(url)) continue;

                if (isImageColumn(header) && imageSort < MAX_IMPORT_IMAGES) {
                    assets.push({
                        type: "image",
                        url,
                        label: `Imagen ${imageSort + 1}`,
                        sortOrder: imageSort,
                    });
                    seenUrls.add(url);
                    imageSort += 1;
                    continue;
                }

                if (isPdfColumn(header)) {
                    assets.push({
                        type: "pdf",
                        url,
                        label: "Catalogo PDF",
                        sortOrder: 0,
                    });
                    seenUrls.add(url);
                    continue;
                }

                if (isLinkColumn(header)) {
                    assets.push({
                        type: "link",
                        url,
                        label: "Liga del desarrollo",
                        sortOrder: 0,
                    });
                    seenUrls.add(url);
                }
            }

            const record = {
                externalId,
                development,
                location,
                question,
                answer,
                searchableText: buildSearchableText({
                    development,
                    location,
                    question,
                    answer,
                }),
                isActive,
                assets,
            } satisfies CatalogImportRow;

            return record;
        })
        .filter((row): row is CatalogImportRow => Boolean(row));
}

function deduplicateImportRows(rows: CatalogImportRow[]): DeduplicatedCatalogRowsResult {
    const byExternalId = new Map<string, CatalogImportRow>();
    const duplicateExternalIds = new Set<string>();

    for (const row of rows) {
        if (byExternalId.has(row.externalId)) {
            duplicateExternalIds.add(row.externalId);
        }
        byExternalId.set(row.externalId, row);
    }

    return {
        rows: [...byExternalId.values()],
        duplicateExternalIds: [...duplicateExternalIds.values()],
    };
}

export async function importCatalogCsv(buffer: Buffer) {
    const source = decodeCatalogCsvBuffer(buffer);
    const mappedRows = mapCsvRows(source);
    const { rows, duplicateExternalIds } = deduplicateImportRows(mappedRows);

    if (rows.length === 0) {
        throw new Error("No encontre filas validas en el CSV del catalogo.");
    }

    let embeddings: number[][] = [];
    try {
        embeddings = await generateEmbeddings(rows.map((row) => row.searchableText.slice(0, 8000)));
    } catch (error) {
        console.warn("[Catalog] Import continuing without embeddings", error);
    }

    await prisma.$transaction(async (tx) => {
        await tx.catalogConversationState.deleteMany();

        const existingItems = await tx.catalogItem.findMany({
            select: {
                id: true,
                externalId: true,
            },
        });

        const existingByExternalId = new Map(
            existingItems.map((item) => [item.externalId, item]),
        );
        const incomingExternalIds = new Set(rows.map((row) => row.externalId));
        const staleItemIds = existingItems
            .filter((item) => !incomingExternalIds.has(item.externalId))
            .map((item) => item.id);

        if (staleItemIds.length > 0) {
            await tx.catalogAsset.deleteMany({
                where: {
                    itemId: {
                        in: staleItemIds,
                    },
                },
            });

            await tx.catalogItem.deleteMany({
                where: {
                    id: {
                        in: staleItemIds,
                    },
                },
            });
        }

        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            const existingItem = existingByExternalId.get(row.externalId);

            if (existingItem) {
                await tx.catalogAsset.deleteMany({
                    where: {
                        itemId: existingItem.id,
                    },
                });
            }

            const item = existingItem
                ? await tx.catalogItem.update({
                    where: { id: existingItem.id },
                    data: {
                        development: row.development,
                        location: row.location,
                        question: row.question,
                        answer: row.answer,
                        searchableText: row.searchableText,
                        isActive: row.isActive,
                        assets: {
                            create: row.assets.map((asset) => ({
                                type: asset.type,
                                url: asset.url,
                                label: asset.label || null,
                                sortOrder: asset.sortOrder,
                            })),
                        },
                    },
                })
                : await tx.catalogItem.create({
                    data: {
                        externalId: row.externalId,
                        development: row.development,
                        location: row.location,
                        question: row.question,
                        answer: row.answer,
                        searchableText: row.searchableText,
                        isActive: row.isActive,
                        assets: {
                            create: row.assets.map((asset) => ({
                                type: asset.type,
                                url: asset.url,
                                label: asset.label || null,
                                sortOrder: asset.sortOrder,
                            })),
                        },
                    },
                });

            if (embeddings[index]?.length) {
                const vectorLiteral = `[${embeddings[index].join(",")}]`;
                await tx.$executeRaw`
                    UPDATE "CatalogItem"
                    SET embedding = ${vectorLiteral}::vector
                    WHERE id = ${item.id}
                `;
            } else {
                await tx.$executeRaw`
                    UPDATE "CatalogItem"
                    SET embedding = NULL
                    WHERE id = ${item.id}
                `;
            }
        }
    });

    return {
        importedCount: rows.length,
        assetCount: rows.reduce((sum, row) => sum + row.assets.length, 0),
        duplicateCount: duplicateExternalIds.length,
    };
}

export async function getCatalogItems() {
    return prisma.catalogItem.findMany({
        orderBy: [
            { development: "asc" },
            { question: "asc" },
        ],
        include: {
            assets: {
                orderBy: [
                    { type: "asc" },
                    { sortOrder: "asc" },
                ],
            },
        },
        take: 250,
    });
}

export async function clearCatalogItems() {
    await prisma.$transaction(async (tx) => {
        await tx.catalogConversationState.deleteMany();
        await tx.catalogAsset.deleteMany();
        await tx.catalogItem.deleteMany();
    });
}

async function vectorSearchCatalog(query: string) {
    const embedding = await generateEmbedding(query);
    const vectorQuery = `[${embedding.join(",")}]`;

    return prisma.$queryRaw<CatalogSearchResult[]>`
        SELECT
            ci.id,
            ci."externalId",
            ci.development,
            ci.location,
            ci.question,
            ci.answer,
            ci."searchableText",
            1 - (ci.embedding <=> ${vectorQuery}::vector) AS similarity
        FROM "CatalogItem" ci
        WHERE ci."isActive" = true
          AND ci.embedding IS NOT NULL
        ORDER BY ci.embedding <=> ${vectorQuery}::vector
        LIMIT ${MAX_CATALOG_MATCHES}
    `;
}

async function lexicalCatalogSearch(query: string) {
    const rows = await prisma.catalogItem.findMany({
        where: { isActive: true },
        select: {
            id: true,
            development: true,
            location: true,
            question: true,
            answer: true,
            searchableText: true,
        },
        take: 400,
    });

    const ranked = rows
        .map((row) => ({
            id: row.id,
            score: scoreCatalogTextMatch(row, query),
        }))
        .filter((row) => row.score >= 28)
        .sort((left, right) => right.score - left.score);

    return ranked[0] || null;
}

async function getCatalogItemWithAssets(id: string) {
    return prisma.catalogItem.findUnique({
        where: { id },
        include: {
            assets: {
                orderBy: [
                    { type: "asc" },
                    { sortOrder: "asc" },
                ],
            },
        },
    });
}

export async function findBestCatalogItem(query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return null;

    let candidates: CatalogSearchResult[] = [];

    try {
        candidates = await vectorSearchCatalog(normalizedQuery);
    } catch (error) {
        console.warn("[Catalog] Falling back to keyword search", error);
    }

    const lexicalMatch = await lexicalCatalogSearch(normalizedQuery);

    if (candidates.length === 0) {
        if (!lexicalMatch) {
            return null;
        }

        return getCatalogItemWithAssets(lexicalMatch.id);
    }

    const bestCandidate = candidates[0];
    const loweredQuery = normalizeSearchText(normalizedQuery);
    const developmentMentioned = loweredQuery.includes(
        normalizeSearchText(bestCandidate.development),
    );

    if (developmentMentioned || bestCandidate.similarity >= MIN_VECTOR_SIMILARITY) {
        return getCatalogItemWithAssets(bestCandidate.id);
    }

    if (lexicalMatch) {
        return getCatalogItemWithAssets(lexicalMatch.id);
    }

    return null;
}

export async function findCatalogAvailabilitySummary(query: string): Promise<CatalogAvailabilitySummary | null> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || !isGenericAvailabilityQuery(normalizedQuery)) {
        return null;
    }

    const hintTokens = extractAvailabilityHintTokens(normalizedQuery);
    const items = await prisma.catalogItem.findMany({
        where: { isActive: true },
        select: {
            development: true,
            location: true,
            searchableText: true,
        },
        take: 500,
    });

    const grouped = new Map<string, { development: string; location: string | null; score: number }>();

    for (const item of items) {
        const key = `${normalizeSearchText(item.development)}::${normalizeSearchText(item.location)}`;
        const haystack = normalizeSearchText(
            [item.development, item.location || "", item.searchableText].filter(Boolean).join(" "),
        );

        let score = 0;
        if (hintTokens.length > 0) {
            for (const token of hintTokens) {
                if (haystack.includes(token)) {
                    score += 20;
                }
                if (normalizeSearchText(item.location).includes(token)) {
                    score += 28;
                }
                if (normalizeSearchText(item.development).includes(token)) {
                    score += 20;
                }
            }
        } else {
            score = 10;
        }

        if (hintTokens.length > 0 && score === 0) {
            continue;
        }

        const current = grouped.get(key);
        if (!current || score > current.score) {
            grouped.set(key, {
                development: item.development,
                location: item.location,
                score,
            });
        }
    }

    const developments = [...grouped.values()]
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return left.development.localeCompare(right.development, "es", { sensitivity: "base" });
        })
        .slice(0, MAX_AVAILABILITY_SUMMARY_ITEMS)
        .map((item) => ({
            development: item.development,
            location: item.location,
        }));

    if (developments.length === 0) {
        return null;
    }

    return {
        locationHint: resolveAvailabilityLocationHint(hintTokens, developments),
        developments,
    };
}

export function splitCatalogAssets(
    assets: Array<{ type: string; url: string; label: string | null; sortOrder: number }>,
    maxImagesToSend: number,
) {
    const imageAssets = assets
        .filter((asset) => asset.type === "image")
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .slice(0, Math.max(0, Math.min(maxImagesToSend, 10)));
    const pdfAsset = assets.find((asset) => asset.type === "pdf") || null;
    const linkAsset = assets.find((asset) => asset.type === "link") || null;

    return { imageAssets, pdfAsset, linkAsset };
}

export function parseCatalogAssetIntent(text: string) {
    const normalized = text.trim();

    return {
        affirmative: isAffirmative(normalized),
        negative: isNegative(normalized),
        wantsImages: wantsOnlyImages(normalized),
        wantsPdf: wantsOnlyPdf(normalized),
    };
}
