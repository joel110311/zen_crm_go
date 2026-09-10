import type { InventoryInput } from "@/lib/inventory";

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;

function normalizeHeader(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function parseCsv(text: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted && character === '"' && text[index + 1] === '"') {
            value += '"';
            index += 1;
        } else if (character === '"') {
            quoted = !quoted;
        } else if (!quoted && character === ",") {
            row.push(value.trim());
            value = "";
        } else if (!quoted && (character === "\n" || character === "\r")) {
            if (character === "\r" && text[index + 1] === "\n") index += 1;
            row.push(value.trim());
            if (row.some(Boolean)) rows.push(row);
            row = [];
            value = "";
            if (rows.length > MAX_ROWS + 1) throw new Error("El archivo supera el límite de 20,000 filas.");
        } else {
            value += character;
        }
    }
    if (quoted) throw new Error("El CSV contiene una comilla sin cerrar.");
    row.push(value.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
}

const headerAliases: Record<string, keyof InventoryInput> = {
    sku: "sku",
    codigo: "sku",
    codigo_producto: "sku",
    id_producto: "sku",
    nombre: "name",
    producto: "name",
    nombre_producto: "name",
    descripcion: "description",
    description: "description",
    marca: "brand",
    brand: "brand",
    categoria: "category",
    category: "category",
    unidad: "unit",
    unit: "unit",
    precio: "salePrice",
    precio_venta: "salePrice",
    sale_price: "salePrice",
    costo: "internalCost",
    costo_interno: "internalCost",
    internal_cost: "internalCost",
    etiquetas: "tags",
    tags: "tags",
    imagen: "imageUrl",
    image_url: "imageUrl",
    activo: "isActive",
    active: "isActive",
    ubicacion: "location",
    location: "location",
    existencia: "onHand",
    stock: "onHand",
    inventario: "onHand",
    on_hand: "onHand",
    reservado: "reserved",
    reserved: "reserved",
    minimo: "minimumStock",
    stock_minimo: "minimumStock",
    minimum_stock: "minimumStock",
    actualizado_en: "sourceUpdatedAt",
    source_updated_at: "sourceUpdatedAt",
};

export function parseInventoryCsv(buffer: ArrayBuffer): InventoryInput[] {
    if (buffer.byteLength === 0) throw new Error("El archivo está vacío.");
    if (buffer.byteLength > MAX_CSV_BYTES) throw new Error("El CSV excede el límite de 5 MB.");
    const rows = parseCsv(new TextDecoder("utf-8", { fatal: false }).decode(buffer).replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw new Error("El CSV debe incluir encabezados y al menos un producto.");
    const headers = rows[0].map((header) => headerAliases[normalizeHeader(header)] || null);
    if (!headers.includes("sku") || !headers.includes("name")) {
        throw new Error("El CSV debe incluir las columnas SKU y Nombre.");
    }

    return rows.slice(1).map((row) => {
        const item: InventoryInput = {};
        headers.forEach((header, index) => {
            if (header && row[index] !== undefined) item[header] = row[index];
        });
        return item;
    }).filter((item) => Object.values(item).some((value) => String(value || "").trim()));
}
