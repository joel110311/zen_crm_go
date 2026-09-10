import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteInventorySource } from "@/lib/inventory";
import { inventoryAdminResponse, inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Context) {
    const session = await auth();
    const user = inventorySessionUser(session);
    if (!user) return inventoryUnauthorizedResponse();
    if (user.role !== "SUPERADMIN") return inventoryAdminResponse();
    try {
        const source = await deleteInventorySource((await params).id);
        return NextResponse.json({ success: true, source });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la fuente." }, { status: 400 });
    }
}
