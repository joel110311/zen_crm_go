import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refreshInventoryEmbeddings } from "@/lib/inventory";
import { inventoryAdminResponse, inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

export async function POST(request: NextRequest) {
    const session = await auth();
    const user = inventorySessionUser(session);
    if (!user) return inventoryUnauthorizedResponse();
    if (user.role !== "SUPERADMIN") return inventoryAdminResponse();
    try {
        const body = await request.json().catch(() => ({}));
        return NextResponse.json(await refreshInventoryEmbeddings(Number(body.limit) || 50));
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron preparar las búsquedas semánticas." }, { status: 400 });
    }
}
