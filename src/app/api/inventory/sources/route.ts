import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listInventorySources, saveInventorySource } from "@/lib/inventory";
import { inventoryAdminResponse, inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

export async function GET() {
    const session = await auth();
    if (!inventorySessionUser(session)) return inventoryUnauthorizedResponse();
    return NextResponse.json({ sources: await listInventorySources() });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    const user = inventorySessionUser(session);
    if (!user) return inventoryUnauthorizedResponse();
    if (user.role !== "SUPERADMIN") return inventoryAdminResponse();
    try {
        return NextResponse.json({ source: await saveInventorySource(await request.json()) });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar la fuente." }, { status: 400 });
    }
}
