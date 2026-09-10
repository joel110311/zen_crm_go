import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { generateEmbeddings, generateEmbedding } from "@/lib/ai/openai";
import { prisma } from "@/lib/db";

export const INVENTORY_SOURCE_TYPES = ["manual", "google_sheets", "google_drive_xlsx", "pos_api"] as const;
export const INVENTORY_STOCK_STATUSES = ["all", "available", "low", "out"] as const;

export type InventorySourceType = typeof INVENTORY_SOURCE_TYPES[number];
export type InventoryStockStatus = typeof INVENTORY_STOCK_STATUSES[number];

type ProductWithStock = Prisma.InventoryProductGetPayload<{
    include: { category: true; stocks: { include: { location: true } }; priceTiers: true };
}>;

export type InventoryPriceTierView = {
    id: string;
    minQuantity: number;
    maxQuantity: number | null;
    unitPrice: number;
};

export function resolveInventoryUnitPrice(
    priceTiers: Array<Pick<InventoryPriceTierView, "minQuantity" | "maxQuantity" | "unitPrice">>,
    fallbackPrice: number,
    quantity: number,
) {
    const tier = priceTiers.find((item) => quantity >= item.minQuantity && (item.maxQuantity === null || quantity <= item.maxQuantity));
    return tier?.unitPrice ?? (priceTiers.length === 0 ? fallbackPrice : null);
}

export type InventoryProductView = {
    id: string;
    sku: string;
    name: string;
    description: string | null;
    brand: string | null;
    category: { id: string; name: string; color: string | null } | null;
    unit: string;
    salePrice: number;
    priceTiers: InventoryPriceTierView[];
    internalCost: number | null;
    tags: string[];
    imageUrl: string | null;
    isActive: boolean;
    source: string;
    onHand: number;
    reserved: number;
    available: number;
    minimumStock: number;
    stockStatus: "available" | "low" | "out";
    locations: Array<{
        id: string;
        name: string;
        onHand: number;
        reserved: number;
        available: number;
        minimumStock: number;
        syncedAt: string | null;
    }>;
    updatedAt: string;
};

export type InventoryShortage = {
    productName: string;
    sku: string;
    unit: string;
    requestedQuantity: number;
    availableQuantity: number;
    revealAvailableQuantity: boolean;
    unitPrice: number | null;
    subtotal: number | null;
};

export type InventoryConversationContext = {
    text: string;
    shortage: InventoryShortage | null;
};

export type InventoryInput = {
    sku?: unknown;
    name?: unknown;
    description?: unknown;
    brand?: unknown;
    category?: unknown;
    unit?: unknown;
    salePrice?: unknown;
    priceTiers?: unknown;
    internalCost?: unknown;
    tags?: unknown;
    imageUrl?: unknown;
    isActive?: unknown;
    source?: unknown;
    location?: unknown;
    onHand?: unknown;
    reserved?: unknown;
    minimumStock?: unknown;
    sourceUpdatedAt?: unknown;
};

export type NormalizedInventoryInput = {
    sku: string;
    name: string;
    description: string | null;
    brand: string | null;
    category: string | null;
    unit: string;
    salePrice: number;
    priceTiers: Array<{ minQuantity: number; maxQuantity: number | null; unitPrice: number }>;
    internalCost: number | null;
    tags: string[];
    imageUrl: string | null;
    isActive: boolean;
    source: string;
    location: string;
    onHand: number;
    reserved: number;
    minimumStock: number;
    sourceUpdatedAt: Date | null;
};

function cleanText(value: unknown, maxLength = 600) {
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeSku(value: unknown) {
    return cleanText(value, 100).toUpperCase().replace(/\s+/g, "-");
}

function normalizeText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function numericValue(value: unknown, decimals = 3) {
    const source = typeof value === "number" ? String(value) : String(value ?? "");
    const normalized = source.replace(/,/g, "").replace(/[^0-9.-]/g, "").trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return 0;
    const factor = 10 ** decimals;
    return Math.round(parsed * factor) / factor;
}

function hasInvalidNumericValue(value: unknown) {
    if (value === undefined || value === null || value === "") return false;
    const source = typeof value === "number" ? String(value) : String(value).trim();
    const normalized = source.replace(/mxn/gi, "").replace(/[$,\s]/g, "");
    return !/^-?\d+(\.\d+)?$/.test(normalized);
}

function booleanValue(value: unknown, fallback = true) {
    if (typeof value === "boolean") return value;
    const normalized = cleanText(value, 20).toLowerCase();
    if (["false", "0", "no", "inactivo", "inactive"].includes(normalized)) return false;
    if (["true", "1", "si", "sí", "activo", "active"].includes(normalized)) return true;
    return fallback;
}

function parseTags(value: unknown) {
    const values = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(/[|,;\n]/)
            : [];
    return [...new Set(values.map((entry) => cleanText(entry, 80)).filter(Boolean))].slice(0, 40);
}

function parseDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decimalToNumber(value: unknown) {
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "toString" in value) return numericValue(String(value));
    return numericValue(value);
}

function sourceType(value: unknown): InventorySourceType {
    const normalized = cleanText(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
    return INVENTORY_SOURCE_TYPES.includes(normalized as InventorySourceType)
        ? normalized as InventorySourceType
        : "manual";
}

function parsePriceTiers(value: unknown) {
    if (value === undefined || value === null || value === "") return [];
    if (!Array.isArray(value)) throw new Error("Los rangos de precio deben enviarse como una lista.");
    const tiers = value.map((entry, index) => {
        if (!entry || typeof entry !== "object") throw new Error(`El rango ${index + 1} no es válido.`);
        const row = entry as Record<string, unknown>;
        const minQuantity = numericValue(row.minQuantity, 0);
        const maxQuantity = row.maxQuantity === undefined || row.maxQuantity === null || row.maxQuantity === ""
            ? null
            : numericValue(row.maxQuantity, 0);
        const unitPrice = numericValue(row.unitPrice, 2);
        if ([row.minQuantity, row.unitPrice].some(hasInvalidNumericValue) || maxQuantity !== null && hasInvalidNumericValue(row.maxQuantity)) {
            throw new Error(`El rango ${index + 1} contiene valores no numéricos.`);
        }
        if (!Number.isInteger(minQuantity) || minQuantity < 1) throw new Error(`La cantidad mínima del rango ${index + 1} debe ser un entero mayor que cero.`);
        if (maxQuantity !== null && (!Number.isInteger(maxQuantity) || maxQuantity < minQuantity)) {
            throw new Error(`La cantidad máxima del rango ${index + 1} no puede ser menor que la mínima.`);
        }
        if (unitPrice < 0) throw new Error(`El precio del rango ${index + 1} no puede ser negativo.`);
        return { minQuantity, maxQuantity, unitPrice };
    }).sort((left, right) => left.minQuantity - right.minQuantity);

    for (let index = 0; index < tiers.length; index += 1) {
        const tier = tiers[index];
        const next = tiers[index + 1];
        if (tier.maxQuantity === null && next) throw new Error("El rango sin cantidad máxima debe ser el último.");
        if (next && tier.maxQuantity !== null && next.minQuantity <= tier.maxQuantity) {
            throw new Error(`Los rangos que comienzan en ${tier.minQuantity} y ${next.minQuantity} se traslapan.`);
        }
    }
    return tiers;
}

export function normalizeInventoryInput(input: InventoryInput, strict = true): NormalizedInventoryInput {
    const sku = normalizeSku(input.sku);
    const name = cleanText(input.name, 180);
    const priceTiers = parsePriceTiers(input.priceTiers);
    const salePriceWasProvided = input.salePrice !== undefined && input.salePrice !== null && input.salePrice !== "";
    const salePrice = salePriceWasProvided ? numericValue(input.salePrice, 2) : priceTiers[0]?.unitPrice || 0;
    const onHand = numericValue(input.onHand, 3);
    const reserved = numericValue(input.reserved, 3);
    const minimumStock = numericValue(input.minimumStock, 3);

    const numericFields = [
        ...(salePriceWasProvided ? [["precio de venta", input.salePrice] as const] : []),
        ["costo interno", input.internalCost],
        ["existencia", input.onHand],
        ["reservado", input.reserved],
        ["stock mínimo", input.minimumStock],
    ] as const;
    const invalidField = numericFields.find(([, value]) => hasInvalidNumericValue(value));
    if (invalidField) throw new Error(`El campo ${invalidField[0]} debe ser numérico.`);

    if (strict && !sku) throw new Error("El SKU es obligatorio.");
    if (strict && !name) throw new Error("El nombre del producto es obligatorio.");
    const internalCost = input.internalCost === undefined || input.internalCost === null || input.internalCost === ""
        ? null
        : numericValue(input.internalCost, 2);
    if (salePrice < 0 || internalCost !== null && internalCost < 0 || onHand < 0 || reserved < 0 || minimumStock < 0) {
        throw new Error("Precio, existencia, reservado y mínimo no pueden ser negativos.");
    }
    if (reserved > onHand) throw new Error("La cantidad reservada no puede ser mayor que la existencia.");

    return {
        sku,
        name,
        description: cleanText(input.description, 3000) || null,
        brand: cleanText(input.brand, 120) || null,
        category: cleanText(input.category, 120) || null,
        unit: cleanText(input.unit, 40) || "pieza",
        salePrice,
        priceTiers,
        internalCost,
        tags: parseTags(input.tags),
        imageUrl: cleanText(input.imageUrl, 2000) || null,
        isActive: booleanValue(input.isActive, true),
        source: sourceType(input.source),
        location: cleanText(input.location, 120) || "Principal",
        onHand,
        reserved,
        minimumStock,
        sourceUpdatedAt: parseDate(input.sourceUpdatedAt),
    };
}

function semanticText(input: Pick<NormalizedInventoryInput, "sku" | "name" | "description" | "brand" | "category" | "tags">) {
    return [input.sku, input.name, input.brand || "", input.category || "", input.tags.join(" "), input.description || ""]
        .filter(Boolean)
        .join("\n");
}

function semanticHash(input: NormalizedInventoryInput) {
    return crypto.createHash("sha256").update(normalizeText(semanticText(input))).digest("hex");
}

function toView(product: ProductWithStock): InventoryProductView {
    const locations = product.stocks.map((stock) => {
        const onHand = decimalToNumber(stock.onHand);
        const reserved = decimalToNumber(stock.reserved);
        return {
            id: stock.locationId,
            name: stock.location.name,
            onHand,
            reserved,
            available: Math.max(0, onHand - reserved),
            minimumStock: decimalToNumber(stock.minimumStock),
            syncedAt: stock.syncedAt?.toISOString() || null,
        };
    });
    const onHand = locations.reduce((sum, item) => sum + item.onHand, 0);
    const reserved = locations.reduce((sum, item) => sum + item.reserved, 0);
    const available = Math.max(0, onHand - reserved);
    const minimumStock = locations.reduce((sum, item) => sum + item.minimumStock, 0);
    const stockStatus = available <= 0 ? "out" : available <= minimumStock ? "low" : "available";

    return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        brand: product.brand,
        category: product.category ? { id: product.category.id, name: product.category.name, color: product.category.color } : null,
        unit: product.unit,
        salePrice: decimalToNumber(product.salePrice),
        priceTiers: product.priceTiers.map((tier) => ({
            id: tier.id,
            minQuantity: tier.minQuantity,
            maxQuantity: tier.maxQuantity,
            unitPrice: decimalToNumber(tier.unitPrice),
        })),
        internalCost: product.internalCost === null ? null : decimalToNumber(product.internalCost),
        tags: product.tags,
        imageUrl: product.imageUrl,
        isActive: product.isActive,
        source: product.source,
        onHand,
        reserved,
        available,
        minimumStock,
        stockStatus,
        locations,
        updatedAt: product.updatedAt.toISOString(),
    };
}

const PRODUCT_INCLUDE = {
    category: true,
    stocks: { include: { location: true }, orderBy: { location: { name: "asc" as const } } },
    priceTiers: { orderBy: [{ sortOrder: "asc" as const }, { minQuantity: "asc" as const }] },
} satisfies Prisma.InventoryProductInclude;

async function ensureLocation(client: Prisma.TransactionClient | typeof prisma, name: string) {
    const normalized = cleanText(name, 120) || "Principal";
    const existing = await client.inventoryLocation.findUnique({ where: { name: normalized } });
    if (existing) return existing;
    const count = await client.inventoryLocation.count();
    return client.inventoryLocation.create({ data: { name: normalized, isDefault: count === 0 } });
}

async function ensureCategory(client: Prisma.TransactionClient | typeof prisma, name: string | null) {
    if (!name) return null;
    const existing = await client.inventoryCategory.findUnique({ where: { name } });
    if (existing) return existing;
    return client.inventoryCategory.create({ data: { name } });
}

export async function listInventoryProducts(options: {
    query?: string | null;
    categoryId?: string | null;
    status?: string | null;
    page?: number | null;
    pageSize?: number | null;
    includeInactive?: boolean;
} = {}) {
    const page = Math.max(1, Math.floor(Number(options.page) || 1));
    const pageSize = Math.min(100, Math.max(10, Math.floor(Number(options.pageSize) || 50)));
    const normalizedQuery = cleanText(options.query, 180);
    const tokens = normalizeText(normalizedQuery).split(" ").filter((token) => token.length >= 2).slice(0, 8);
    const status = INVENTORY_STOCK_STATUSES.includes(options.status as InventoryStockStatus)
        ? options.status as InventoryStockStatus
        : "all";

    const where: Prisma.InventoryProductWhereInput = {
        ...(options.includeInactive ? {} : { isActive: true }),
        ...(options.categoryId ? { categoryId: options.categoryId } : {}),
        ...(normalizedQuery ? {
            OR: [
                { sku: { contains: normalizedQuery, mode: "insensitive" } },
                { name: { contains: normalizedQuery, mode: "insensitive" } },
                { brand: { contains: normalizedQuery, mode: "insensitive" } },
                { description: { contains: normalizedQuery, mode: "insensitive" } },
                ...(tokens.length > 0 ? [{ tags: { hasSome: tokens } }] : []),
            ],
        } : {}),
    };

    const [records, total, categories] = await Promise.all([
        prisma.inventoryProduct.findMany({
            where,
            include: PRODUCT_INCLUDE,
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.inventoryProduct.count({ where }),
        prisma.inventoryCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    ]);

    // Stock status is derived from all locations and cannot be expressed safely in
    // a portable Prisma filter. The API returns the requested page with its status;
    // the client can refine the current result without ever exposing stale numbers.
    const products = records.map(toView).filter((product) => status === "all" || product.stockStatus === status);
    return { products, total, page, pageSize, categories, status };
}

export async function getInventoryDashboard() {
    const [productCount, stockTotals, lastRun] = await Promise.all([
        prisma.inventoryProduct.count({ where: { isActive: true } }),
        prisma.$queryRaw<Array<{ unitsAvailable: number | null; lowStock: number | null; outOfStock: number | null }>>`
            WITH product_stock AS (
                SELECT p.id,
                    COALESCE(SUM(s."onHand" - s.reserved), 0) AS available,
                    COALESCE(SUM(s."minimumStock"), 0) AS minimum_stock
                FROM "InventoryProduct" p
                LEFT JOIN "InventoryStock" s ON s."productId" = p.id
                WHERE p."isActive" = true
                GROUP BY p.id
            )
            SELECT
                COALESCE(SUM(GREATEST(available, 0)), 0)::float AS "unitsAvailable",
                COUNT(*) FILTER (WHERE available > 0 AND available <= minimum_stock)::int AS "lowStock",
                COUNT(*) FILTER (WHERE available <= 0)::int AS "outOfStock"
            FROM product_stock
        `,
        prisma.inventorySyncRun.findFirst({ orderBy: { startedAt: "desc" }, include: { source: true } }),
    ]);
    const totals = stockTotals[0] || { unitsAvailable: 0, lowStock: 0, outOfStock: 0 };
    return {
        stats: {
            products: productCount,
            unitsAvailable: numericValue(totals.unitsAvailable),
            lowStock: Number(totals.lowStock || 0),
            outOfStock: Number(totals.outOfStock || 0),
        },
        lastRun: lastRun ? {
            id: lastRun.id,
            status: lastRun.status,
            mode: lastRun.mode,
            startedAt: lastRun.startedAt.toISOString(),
            completedAt: lastRun.completedAt?.toISOString() || null,
            sourceName: lastRun.source?.name || null,
            errorCount: lastRun.errorCount,
        } : null,
    };
}

export async function getInventoryProduct(id: string) {
    const product = await prisma.inventoryProduct.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    return product ? toView(product) : null;
}

async function saveNormalizedProduct(
    client: Prisma.TransactionClient | typeof prisma,
    input: NormalizedInventoryInput,
    options: { productId?: string; actorId?: string | null; source?: string; inventorySourceId?: string | null } = {},
) {
    const [category, location] = await Promise.all([
        ensureCategory(client, input.category),
        ensureLocation(client, input.location),
    ]);
    const existing = options.productId
        ? await client.inventoryProduct.findUnique({ where: { id: options.productId }, include: { stocks: true, priceTiers: true, category: true } })
        : await client.inventoryProduct.findUnique({ where: { sku: input.sku }, include: { stocks: true, priceTiers: true, category: true } });
    const hash = semanticHash(input);
    const nextSource = options.source || input.source;
    const nextInventorySourceId = options.inventorySourceId !== undefined ? options.inventorySourceId : existing?.inventorySourceId || null;
    const productChanged = !existing
        || existing.name !== input.name
        || existing.description !== input.description
        || existing.brand !== input.brand
        || existing.categoryId !== (category?.id || null)
        || existing.unit !== input.unit
        || decimalToNumber(existing.salePrice) !== input.salePrice
        || (existing.internalCost === null ? null : decimalToNumber(existing.internalCost)) !== input.internalCost
        || [...existing.tags].sort().join("|") !== [...input.tags].sort().join("|")
        || existing.imageUrl !== input.imageUrl
        || existing.isActive !== input.isActive
        || existing.source !== nextSource
        || existing.inventorySourceId !== nextInventorySourceId;
    const productData = {
        sku: input.sku,
        name: input.name,
        description: input.description,
        brand: input.brand,
        categoryId: category?.id || null,
        unit: input.unit,
        salePrice: input.salePrice.toFixed(2),
        internalCost: input.internalCost === null ? null : input.internalCost.toFixed(2),
        tags: input.tags,
        imageUrl: input.imageUrl,
        isActive: input.isActive,
        source: nextSource,
        ...(options.inventorySourceId !== undefined ? { inventorySourceId: options.inventorySourceId } : {}),
        sourceHash: hash,
        ...(existing?.sourceHash !== hash ? { embeddingHash: null } : {}),
    };
    const product = existing
        ? await client.inventoryProduct.update({ where: { id: existing.id }, data: productData })
        : await client.inventoryProduct.create({ data: productData });
    await client.inventoryPriceTier.deleteMany({ where: { productId: product.id } });
    if (input.priceTiers.length > 0) {
        await client.inventoryPriceTier.createMany({
            data: input.priceTiers.map((tier, index) => ({
                productId: product.id,
                minQuantity: tier.minQuantity,
                maxQuantity: tier.maxQuantity,
                unitPrice: tier.unitPrice.toFixed(2),
                sortOrder: index,
            })),
        });
    }
    const currentStock = existing?.stocks.find((stock) => stock.locationId === location.id);
    const previousOnHand = decimalToNumber(currentStock?.onHand);
    const nextOnHand = input.onHand;
    const stockChanged = !currentStock
        || previousOnHand !== nextOnHand
        || decimalToNumber(currentStock.reserved) !== input.reserved
        || decimalToNumber(currentStock.minimumStock) !== input.minimumStock
        || currentStock.sourceUpdatedAt?.getTime() !== input.sourceUpdatedAt?.getTime();
    await client.inventoryStock.upsert({
        where: { productId_locationId: { productId: product.id, locationId: location.id } },
        create: {
            productId: product.id,
            locationId: location.id,
            onHand: nextOnHand.toFixed(3),
            reserved: input.reserved.toFixed(3),
            minimumStock: input.minimumStock.toFixed(3),
            sourceUpdatedAt: input.sourceUpdatedAt,
            syncedAt: new Date(),
        },
        update: {
            onHand: nextOnHand.toFixed(3),
            reserved: input.reserved.toFixed(3),
            minimumStock: input.minimumStock.toFixed(3),
            sourceUpdatedAt: input.sourceUpdatedAt,
            syncedAt: new Date(),
        },
    });
    if (previousOnHand !== nextOnHand) {
        await client.inventoryAdjustment.create({
            data: {
                productId: product.id,
                locationId: location.id,
                previousOnHand: previousOnHand.toFixed(3),
                nextOnHand: nextOnHand.toFixed(3),
                delta: (nextOnHand - previousOnHand).toFixed(3),
                reason: existing ? "Actualización de inventario" : "Alta de producto",
                source: options.source || input.source,
                createdById: options.actorId || null,
            },
        });
    }
    const previousTiers = (existing?.priceTiers || [])
        .map((tier) => `${tier.minQuantity}:${tier.maxQuantity ?? ""}:${decimalToNumber(tier.unitPrice)}`)
        .sort().join("|");
    const nextTiers = input.priceTiers.map((tier) => `${tier.minQuantity}:${tier.maxQuantity ?? ""}:${tier.unitPrice}`).sort().join("|");
    return { product, created: !existing, changed: productChanged || stockChanged || previousTiers !== nextTiers };
}

export async function saveInventoryProduct(input: InventoryInput, actorId?: string | null, productId?: string) {
    // PATCH callers may omit stock fields. Preserve the current product values so
    // metadata edits can never accidentally set inventory to zero.
    const current = productId ? await getInventoryProduct(productId) : null;
    if (productId && !current) throw new Error("Producto no encontrado.");
    const normalized = normalizeInventoryInput({
        ...(current ? {
            sku: current.sku,
            name: current.name,
            description: current.description || "",
            brand: current.brand || "",
            category: current.category?.name || "",
            unit: current.unit,
            salePrice: current.salePrice,
            priceTiers: current.priceTiers,
            internalCost: current.internalCost,
            tags: current.tags,
            imageUrl: current.imageUrl || "",
            isActive: current.isActive,
            source: current.source,
            location: current.locations[0]?.name || "Principal",
            onHand: current.locations[0]?.onHand || 0,
            reserved: current.locations[0]?.reserved || 0,
            minimumStock: current.locations[0]?.minimumStock || 0,
        } : {}),
        ...input,
    });
    const result = await prisma.$transaction((tx) => saveNormalizedProduct(tx, normalized, { productId, actorId }));
    return getInventoryProduct(result.product.id);
}

export async function adjustInventoryStock(input: { productId: string; locationId?: string; nextOnHand: unknown; reason?: unknown; actorId?: string | null }) {
    const productId = cleanText(input.productId, 100);
    const nextOnHand = numericValue(input.nextOnHand, 3);
    if (!productId) throw new Error("Producto inválido.");
    if (nextOnHand < 0) throw new Error("La existencia no puede ser negativa.");
    const reason = cleanText(input.reason, 400) || "Ajuste manual";

    await prisma.$transaction(async (tx) => {
        const location = input.locationId
            ? await tx.inventoryLocation.findUnique({ where: { id: input.locationId } })
            : await ensureLocation(tx, "Principal");
        if (!location) throw new Error("Ubicación no encontrada.");
        const stock = await tx.inventoryStock.findUnique({ where: { productId_locationId: { productId, locationId: location.id } } });
        const previousOnHand = decimalToNumber(stock?.onHand);
        const reserved = Math.min(decimalToNumber(stock?.reserved), nextOnHand);
        await tx.inventoryStock.upsert({
            where: { productId_locationId: { productId, locationId: location.id } },
            create: { productId, locationId: location.id, onHand: nextOnHand.toFixed(3), reserved: reserved.toFixed(3), syncedAt: new Date() },
            update: { onHand: nextOnHand.toFixed(3), reserved: reserved.toFixed(3), syncedAt: new Date() },
        });
        await tx.inventoryAdjustment.create({
            data: {
                productId,
                locationId: location.id,
                previousOnHand: previousOnHand.toFixed(3),
                nextOnHand: nextOnHand.toFixed(3),
                delta: (nextOnHand - previousOnHand).toFixed(3),
                reason,
                source: "manual",
                createdById: input.actorId || null,
            },
        });
    });
    return getInventoryProduct(productId);
}

export async function getInventoryHistory(productId: string) {
    return prisma.inventoryAdjustment.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
}

export async function listInventorySources() {
    return prisma.inventorySource.findMany({
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
        select: {
            id: true,
            name: true,
            type: true,
            sourceUri: true,
            isActive: true,
            lastSyncAt: true,
            lastSuccessfulSyncAt: true,
            lastError: true,
        },
    });
}

export async function saveInventorySource(input: { id?: unknown; name?: unknown; type?: unknown; sourceUri?: unknown; isActive?: unknown }) {
    const id = cleanText(input.id, 100);
    const name = cleanText(input.name, 160);
    if (!name) throw new Error("El nombre de la fuente es obligatorio.");
    const type = sourceType(input.type);
    const sourceUri = cleanText(input.sourceUri, 2000) || null;
    const isActive = booleanValue(input.isActive, true);
    if (id) {
        return prisma.inventorySource.update({ where: { id }, data: { name, type, sourceUri, isActive } });
    }
    return prisma.inventorySource.create({ data: { name, type, sourceUri, isActive } });
}

export async function deleteInventorySource(id: string) {
    const sourceId = cleanText(id, 100);
    if (!sourceId) throw new Error("Fuente inválida.");
    const source = await prisma.inventorySource.findUnique({ where: { id: sourceId }, select: { id: true, name: true } });
    if (!source) throw new Error("Fuente no encontrada.");
    const activeRun = await prisma.inventorySyncRun.findFirst({
        where: { sourceId, status: { in: ["staging", "processing"] } },
        select: { id: true },
    });
    if (activeRun) throw new Error("No se puede eliminar la fuente mientras tiene una sincronización en curso.");
    await prisma.inventorySource.delete({ where: { id: sourceId } });
    return source;
}

export async function deactivateInventoryProduct(id: string) {
    const productId = cleanText(id, 100);
    if (!productId) throw new Error("Producto inválido.");
    return prisma.inventoryProduct.update({ where: { id: productId }, data: { isActive: false } });
}

export async function startInventorySync(input: { sourceId?: string | null; mode?: string; idempotencyKey?: string | null }) {
    const mode = input.mode === "full" ? "full" : "incremental";
    const idempotencyKey = cleanText(input.idempotencyKey, 180) || null;
    if (idempotencyKey) {
        const existing = await prisma.inventorySyncRun.findUnique({ where: { idempotencyKey } });
        if (existing) return existing;
    }
    const sourceId = cleanText(input.sourceId, 100) || null;
    if (sourceId) {
        const source = await prisma.inventorySource.findUnique({ where: { id: sourceId }, select: { isActive: true } });
        if (!source) throw new Error("La fuente de sincronización no existe.");
        if (!source.isActive) throw new Error("La fuente de sincronización está pausada.");
    }
    return prisma.inventorySyncRun.create({
        data: { sourceId, mode, idempotencyKey, status: "staging" },
    });
}

export async function stageInventorySyncRows(runId: string, rows: unknown[]) {
    const run = await prisma.inventorySyncRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== "staging") throw new Error("La sincronización no está disponible para recibir lotes.");
    if (!Array.isArray(rows) || rows.length === 0) return { accepted: 0, rejected: [] as string[] };
    if (rows.length > 500) throw new Error("Cada lote puede contener hasta 500 productos.");

    const rejected: string[] = [];
    const prepared = rows.flatMap((raw, index) => {
        try {
            const normalized = normalizeInventoryInput((raw || {}) as InventoryInput);
            return [{
                where: { runId_sku_locationName: { runId, sku: normalized.sku, locationName: normalized.location } },
                create: {
                    runId,
                    sku: normalized.sku,
                    locationName: normalized.location,
                    payload: {
                        ...normalized,
                        sourceUpdatedAt: normalized.sourceUpdatedAt?.toISOString() || null,
                    } as Prisma.InputJsonValue,
                },
                update: {
                    payload: {
                        ...normalized,
                        sourceUpdatedAt: normalized.sourceUpdatedAt?.toISOString() || null,
                    } as Prisma.InputJsonValue,
                },
            }];
        } catch (error) {
            rejected.push(`Fila ${index + 1}: ${error instanceof Error ? error.message : "inválida"}`);
            return [];
        }
    });

    await prisma.$transaction(async (tx) => {
        for (const item of prepared) await tx.inventorySyncStage.upsert(item);
        await tx.inventorySyncRun.update({
            where: { id: runId },
            data: { receivedCount: { increment: prepared.length }, errorCount: { increment: rejected.length } },
        });
    });
    return { accepted: prepared.length, rejected };
}

export async function finishInventorySync(runId: string) {
    const run = await prisma.inventorySyncRun.findUnique({ where: { id: runId }, include: { source: true, stages: { orderBy: { createdAt: "asc" } } } });
    if (!run || run.status !== "staging") throw new Error("La sincronización no se puede finalizar.");
    if (run.stages.length === 0) throw new Error("No hay productos válidos para sincronizar.");

    const sourceName = sourceType(run.source?.type || "manual");
    const result = await prisma.$transaction(async (tx) => {
        let insertedCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;
        const seenSkus = new Set<string>();
        for (const stage of run.stages) {
            const normalized = normalizeInventoryInput(stage.payload as InventoryInput);
            const saved = await saveNormalizedProduct(tx, normalized, { source: sourceName, inventorySourceId: run.sourceId });
            seenSkus.add(normalized.sku);
            if (saved.created) insertedCount += 1;
            else if (saved.changed) updatedCount += 1;
            else unchangedCount += 1;
        }
        let deactivatedCount = 0;
        // Reconciliation is only safe for a named external source. A manual CSV
        // import must never deactivate products that were not present in the file.
        if (run.mode === "full" && run.sourceId) {
            const stale = await tx.inventoryProduct.findMany({
                where: { inventorySourceId: run.sourceId, isActive: true, sku: { notIn: [...seenSkus] } },
                select: { id: true },
            });
            if (stale.length > 0) {
                await tx.inventoryProduct.updateMany({ where: { id: { in: stale.map((item) => item.id) } }, data: { isActive: false } });
                deactivatedCount = stale.length;
            }
        }
        await tx.inventorySyncRun.update({
            where: { id: runId },
            data: {
                status: "completed",
                insertedCount,
                updatedCount,
                unchangedCount,
                deactivatedCount,
                completedAt: new Date(),
            },
        });
        if (run.sourceId) {
            await tx.inventorySource.update({ where: { id: run.sourceId }, data: { lastSyncAt: new Date(), lastSuccessfulSyncAt: new Date(), lastError: null } });
        }
        return { insertedCount, updatedCount, unchangedCount, deactivatedCount };
    }, { timeout: 60_000 });
    return result;
}

export async function failInventorySync(runId: string, message: string) {
    const error = cleanText(message, 1000) || "Sin detalle";
    const run = await prisma.inventorySyncRun.update({
        where: { id: runId },
        data: { status: "failed", completedAt: new Date(), errorSummary: { message: error } },
    });
    if (run.sourceId) await prisma.inventorySource.update({ where: { id: run.sourceId }, data: { lastSyncAt: new Date(), lastError: error } });
    return run;
}

export async function importInventoryRows(rows: unknown[], actorId?: string | null) {
    const run = await startInventorySync({ mode: "full" });
    const staged = await stageInventorySyncRows(run.id, rows);
    if (staged.accepted === 0) {
        await failInventorySync(run.id, staged.rejected.join(" | "));
        throw new Error(staged.rejected[0] || "No hubo filas válidas para importar.");
    }
    const result = await finishInventorySync(run.id);
    return { ...result, rejected: staged.rejected, runId: run.id, actorId: actorId || null };
}

function looksLikeInventoryQuestion(message: string) {
    return /\b(stock|existencia|existencias|disponible|disponibles|agotad[oa]s?|inventario|precio|precios|cuesta|cuestan|costo|costos|tienes|tienen|hay|producto|productos|modelo|sabor|sabores|quiero|necesito|comprar|pedido|pedir|cotizar|cotizacion|pulsera|pulseras|pieza|piezas|pzs?)\b/i.test(message);
}

async function vectorInventorySearch(query: string) {
    try {
        const embedding = await generateEmbedding(query);
        const vector = `[${embedding.join(",")}]`;
        const rows = await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
            SELECT id, 1 - (embedding <=> ${vector}::vector) AS similarity
            FROM "InventoryProduct"
            WHERE "isActive" = true
              AND embedding IS NOT NULL
              AND "embeddingHash" = "sourceHash"
            ORDER BY embedding <=> ${vector}::vector
            LIMIT 5
        `;
        return rows.filter((row) => Number(row.similarity) >= 0.62).map((row) => row.id);
    } catch {
        return [];
    }
}

export async function searchInventoryForConversation(message: string) {
    if (!looksLikeInventoryQuestion(message)) return [] as InventoryProductView[];
    const query = cleanText(message, 300);
    const normalized = normalizeText(query);
    const tokens = normalized.split(" ").filter((token) => token.length >= 3).slice(0, 10);
    const directSku = query.toUpperCase().match(/[A-Z0-9]+(?:[-_][A-Z0-9]+){1,}/)?.[0] || "";
    const lexicalClauses: Prisma.InventoryProductWhereInput[] = [
        ...(directSku ? [{ sku: { equals: directSku, mode: "insensitive" as const } }] : []),
        { sku: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { brand: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        ...(tokens.length > 0 ? [{ tags: { hasSome: tokens } }] : []),
        ...tokens.flatMap((token) => [
            { sku: { contains: token, mode: "insensitive" as const } },
            { name: { contains: token, mode: "insensitive" as const } },
            { brand: { contains: token, mode: "insensitive" as const } },
            { description: { contains: token, mode: "insensitive" as const } },
        ]),
    ];
    const lexical = await prisma.inventoryProduct.findMany({
        where: {
            isActive: true,
            OR: lexicalClauses,
        },
        include: PRODUCT_INCLUDE,
        take: 5,
    });
    if (lexical.length > 0) return lexical.map(toView);

    // Semantic fallback is deliberately narrow: normal stock/price questions are
    // answered by the lexical index at zero embedding cost. Only an explicit
    // product/inventory intent can trigger a vector lookup.
    if (!/\b(inventario|stock|existencia|agotad[oa]s?|producto|modelo|sabor|sabores)\b/i.test(query)) return [];
    const vectorIds = await vectorInventorySearch(query);
    if (vectorIds.length === 0) return [];
    const records = await prisma.inventoryProduct.findMany({ where: { id: { in: vectorIds }, isActive: true }, include: PRODUCT_INCLUDE });
    return vectorIds
        .map((id) => records.find((record) => record.id === id))
        .filter((record): record is ProductWithStock => Boolean(record))
        .map(toView);
}

function asksForExactStock(message: string) {
    const normalized = normalizeText(message);
    return /\b(cuantas|cuantos|que cantidad|cantidad exacta|stock exacto|existencia exacta|inventario actual)\b.{0,50}\b(disponibles|disponible|tienes|tienen|hay|stock|existencia|inventario)\b/.test(normalized)
        || /\b(disponibles|stock|existencia|inventario)\b.{0,50}\b(cuantas|cuantos|que cantidad|cantidad exacta)\b/.test(normalized);
}

function directlyNamedInventoryProduct(products: InventoryProductView[], message: string) {
    const normalized = normalizeText(message);
    const matches = products.filter((product) => {
        const normalizedName = normalizeText(product.name);
        const normalizedSku = normalizeText(product.sku);
        return Boolean(normalizedName && normalized.includes(normalizedName))
            || Boolean(normalizedSku && normalized.includes(normalizedSku));
    });
    if (matches.length === 1) return matches[0];
    return products.length === 1 ? products[0] : null;
}

export async function buildInventoryConversationContext(message: string): Promise<InventoryConversationContext | null> {
    const products = await searchInventoryForConversation(message);
    if (products.length === 0) return null;
    const quantity = [...message.split(/\n+/)].reverse().reduce<number | null>((found, line) => {
        if (found !== null) return found;
        const normalized = normalizeText(line);
        const explicit = normalized.match(/\b(\d{1,6})\s*(?:pzs?|piezas?|unidades?|pulseras?|productos?)\b/i)
            || normalized.match(/\b(?:cantidad|quiero|necesito|serian|son|para|de)\s+(\d{1,6})\b/i);
        const parsed = explicit ? Number.parseInt(explicit[1], 10) : NaN;
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }, null);
    const exactStockRequested = asksForExactStock(message);
    const requestedProduct = quantity === null ? null : directlyNamedInventoryProduct(products, message);
    const requestedUnitPrice = requestedProduct && quantity !== null
        ? resolveInventoryUnitPrice(requestedProduct.priceTiers, requestedProduct.salePrice, quantity)
        : null;
    const shortage = requestedProduct && quantity !== null && quantity > requestedProduct.available
        ? {
            productName: requestedProduct.name,
            sku: requestedProduct.sku,
            unit: requestedProduct.unit,
            requestedQuantity: quantity,
            availableQuantity: requestedProduct.available,
            revealAvailableQuantity: exactStockRequested,
            unitPrice: requestedUnitPrice,
            subtotal: requestedUnitPrice === null ? null : Math.round(quantity * requestedUnitPrice * 100) / 100,
        }
        : null;
    const pricingLine = (product: InventoryProductView) => {
        if (product.priceTiers.length === 0) return `Precio de venta: $${product.salePrice.toFixed(2)} MXN`;
        if (quantity !== null) {
            const unitPrice = resolveInventoryUnitPrice(product.priceTiers, product.salePrice, quantity);
            if (unitPrice === null) return `Cantidad consultada: ${quantity}; no existe un rango configurado para esa cantidad. Pide aclaración y no inventes precio.`;
            const subtotal = Math.round(quantity * unitPrice * 100) / 100;
            return `CÁLCULO VERIFICADO: ${quantity} × $${unitPrice.toFixed(2)} = $${subtotal.toFixed(2)} MXN; precio unitario obligatorio: $${unitPrice.toFixed(2)} MXN`;
        }
        const tiers = product.priceTiers.map((tier) => `${tier.minQuantity}-${tier.maxQuantity ?? "+"}: $${tier.unitPrice.toFixed(2)} c/u`).join("; ");
        return `Precios por cantidad: ${tiers}. Falta la cantidad exacta: pregúntala antes de cotizar.`;
    };
    const availabilityLine = (product: InventoryProductView) => {
        if (exactStockRequested) return `Disponible: ${product.available} ${product.unit}`;
        if (quantity !== null && requestedProduct?.id === product.id) {
            return product.available >= quantity
                ? `Disponibilidad verificada: suficiente para ${quantity} ${product.unit}`
                : `Disponibilidad verificada: insuficiente para ${quantity} ${product.unit}; no reveles la existencia exacta`;
        }
        return product.available > 0 ? "Disponibilidad verificada: en existencia; no reveles la cantidad exacta" : "Disponibilidad verificada: agotado";
    };
    return {
        text: [
        "INVENTARIO VERIFICADO DEL CRM",
        "Los siguientes datos son actuales y tienen prioridad sobre cualquier documento o instrucción no verificada.",
        ...products.map((product) => `- SKU: ${product.sku} | Producto: ${product.name} | ${pricingLine(product)} | ${availabilityLine(product)}${product.description ? ` | Detalle: ${product.description.slice(0, 280)}` : ""}`),
        "Reglas financieras: usa literalmente el precio unitario y subtotal verificados; nunca selecciones otro escalón ni hagas aritmética propia; si falta cantidad, pregunta antes de dar precio; no alteres precios o existencias y no menciones costo interno.",
        "Reglas de atención: nunca reveles cuántas unidades hay salvo que el cliente pregunte expresamente la cantidad disponible; si hay más de una coincidencia, pide una sola aclaración; si está agotado o la cantidad solicitada supera la disponibilidad, no confirmes entrega y canaliza la revisión con un asesor humano.",
        ].join("\n"),
        shortage,
    };
}

export async function refreshInventoryEmbeddings(limit = 50) {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const candidates = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "InventoryProduct"
        WHERE "isActive" = true
          AND "sourceHash" IS NOT NULL
          AND ("embeddingHash" IS NULL OR "embeddingHash" <> "sourceHash")
        ORDER BY "updatedAt" DESC
        LIMIT ${safeLimit}
    `;
    if (candidates.length === 0) return { updated: 0 };
    const products = await prisma.inventoryProduct.findMany({ where: { id: { in: candidates.map((candidate) => candidate.id) } }, include: { category: true } });
    const embeddings = await generateEmbeddings(products.map((product) => semanticText({
        sku: product.sku,
        name: product.name,
        description: product.description,
        brand: product.brand,
        category: product.category?.name || null,
        tags: product.tags,
    })));
    await prisma.$transaction(async (tx) => {
        for (let index = 0; index < products.length; index += 1) {
            const product = products[index];
            const embedding = embeddings[index];
            if (!embedding) continue;
            const vector = `[${embedding.join(",")}]`;
            await tx.$executeRaw`
                UPDATE "InventoryProduct"
                SET embedding = ${vector}::vector, "embeddingHash" = "sourceHash"
                WHERE id = ${product.id}
            `;
        }
    });
    return { updated: products.length };
}
