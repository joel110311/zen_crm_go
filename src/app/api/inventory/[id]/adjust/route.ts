import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adjustInventoryStock } from "@/lib/inventory";
import { inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    const user = inventorySessionUser(session);
    if (!user) return inventoryUnauthorizedResponse();
    try {
        const body = await request.json();
        const product = await adjustInventoryStock({ ...body, productId: (await params).id, actorId: user.id });
        return NextResponse.json({ product });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo ajustar la existencia." }, { status: 400 });
    }
}
