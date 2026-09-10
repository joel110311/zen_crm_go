import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listInventoryProducts, saveInventoryProduct } from "@/lib/inventory";
import { inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!inventorySessionUser(session)) return inventoryUnauthorizedResponse();
    try {
        const params = request.nextUrl.searchParams;
        const result = await listInventoryProducts({
            query: params.get("q"),
            categoryId: params.get("categoryId"),
            status: params.get("status"),
            page: Number(params.get("page") || 1),
            pageSize: Number(params.get("pageSize") || 50),
            includeInactive: params.get("includeInactive") === "true",
        });
        return NextResponse.json(result);
    } catch (error) {
        console.error("[Inventory] GET failed:", error);
        return NextResponse.json({ error: "No se pudo cargar el inventario." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const user = inventorySessionUser(session);
    if (!user) return inventoryUnauthorizedResponse();
    try {
        const product = await saveInventoryProduct(await request.json(), user.id);
        return NextResponse.json({ product }, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar el producto." }, { status: 400 });
    }
}
