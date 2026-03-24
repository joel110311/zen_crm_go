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

const MAX_IMPORT_IMAGES = 10;
const MAX_CATALOG_MATCHES = 3;
const MIN_VECTOR_SIMILARITY = 0.62;

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

export async function findBestCatalogItem(query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return null;

    let candidates: CatalogSearchResult[] = [];

    try {
        candidates = await vectorSearchCatalog(normalizedQuery);
    } catch (error) {
        console.warn("[Catalog] Falling back to keyword search", error);
    }

    if (candidates.length === 0) {
        const fallback = await prisma.catalogItem.findMany({
            where: {
                isActive: true,
                OR: [
                    { development: { contains: normalizedQuery, mode: "insensitive" } },
                    { location: { contains: normalizedQuery, mode: "insensitive" } },
                    { question: { contains: normalizedQuery, mode: "insensitive" } },
                    { answer: { contains: normalizedQuery, mode: "insensitive" } },
                ],
            },
            include: {
                assets: {
                    orderBy: [
                        { type: "asc" },
                        { sortOrder: "asc" },
                    ],
                },
            },
            take: 1,
        });

        return fallback[0] || null;
    }

    const bestCandidate = candidates[0];
    const loweredQuery = normalizedQuery.toLowerCase();
    const developmentMentioned = loweredQuery.includes(bestCandidate.development.toLowerCase());

    if (!developmentMentioned && bestCandidate.similarity < MIN_VECTOR_SIMILARITY) {
        return null;
    }

    return prisma.catalogItem.findUnique({
        where: { id: bestCandidate.id },
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
