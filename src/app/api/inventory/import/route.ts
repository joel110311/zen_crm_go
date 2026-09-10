import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseInventoryCsv } from "@/lib/inventory-csv";
import { importInventoryRows } from "@/lib/inventory";
import { inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

export async function POST(request: NextRequest) {
    const session = await auth();
    const user = inventorySessionUser(session);
    if (!user) return inventoryUnauthorizedResponse();
    try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!(file instanceof File)) throw new Error("Selecciona un archivo CSV.");
        if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
            throw new Error("Por seguridad la importación directa solo acepta CSV. Para XLSX usa la sincronización de Google Drive en n8n.");
        }
        const rows = parseInventoryCsv(await file.arrayBuffer());
        const result = await importInventoryRows(rows, user.id);
        return NextResponse.json({ result });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo importar el inventario." }, { status: 400 });
    }
}
