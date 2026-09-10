import { NextRequest, NextResponse } from "next/server";
import { startInventorySync } from "@/lib/inventory";
import { readInventorySyncJson, verifyInventorySyncRequest } from "@/lib/inventory-auth";

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const verified = verifyInventorySyncRequest(request, rawBody);
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });
    try {
        const body = readInventorySyncJson<{ sourceId?: string; mode?: string; idempotencyKey?: string }>(rawBody);
        const run = await startInventorySync(body);
        return NextResponse.json({ runId: run.id, status: run.status });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar la sincronización." }, { status: 400 });
    }
}
