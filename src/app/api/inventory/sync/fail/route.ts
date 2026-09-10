import { NextRequest, NextResponse } from "next/server";
import { failInventorySync } from "@/lib/inventory";
import { readInventorySyncJson, verifyInventorySyncRequest } from "@/lib/inventory-auth";

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const verified = verifyInventorySyncRequest(request, rawBody);
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });
    try {
        const body = readInventorySyncJson<{ runId?: string; error?: string }>(rawBody);
        if (!body.runId) throw new Error("runId es obligatorio.");
        await failInventorySync(body.runId, body.error || "Error reportado por la fuente externa.");
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo marcar la sincronización." }, { status: 400 });
    }
}
