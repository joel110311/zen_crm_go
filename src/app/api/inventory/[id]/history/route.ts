import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInventoryHistory } from "@/lib/inventory";
import { inventorySessionUser, inventoryUnauthorizedResponse } from "@/lib/inventory-route-auth";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!inventorySessionUser(session)) return inventoryUnauthorizedResponse();
    const history = await getInventoryHistory((await params).id);
    return NextResponse.json({ history: history.map((item) => ({
        ...item,
        previousOnHand: Number(item.previousOnHand),
        nextOnHand: Number(item.nextOnHand),
        delta: Number(item.delta),
    })) });
}
