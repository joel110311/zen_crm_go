import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deactivateInventoryProduct, getInventoryProduct, saveInventoryProduct } from "@/lib/inventory";
import { inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Context) {
    const session = await auth();
    if (!inventorySessionUser(session)) return inventoryUnauthorizedResponse();
    const product = await getInventoryProduct((await params).id);
    return product ? NextResponse.json({ product }) : NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: Context) {
    const session = await auth();
    const user = inventorySessionUser(session);
    if (!user) return inventoryUnauthorizedResponse();
    try {
        const product = await saveInventoryProduct(await request.json(), user.id, (await params).id);
        return NextResponse.json({ product });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el producto." }, { status: 400 });
    }
}

export async function DELETE(_: NextRequest, { params }: Context) {
    const session = await auth();
    if (!inventorySessionUser(session)) return inventoryUnauthorizedResponse();
    try {
        await deactivateInventoryProduct((await params).id);
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "No se pudo desactivar el producto." }, { status: 400 });
    }
}
