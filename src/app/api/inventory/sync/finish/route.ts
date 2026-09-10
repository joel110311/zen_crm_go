import { NextRequest, NextResponse } from "next/server";
import { finishInventorySync } from "@/lib/inventory";
import { readInventorySyncJson, verifyInventorySyncRequest } from "@/lib/inventory-auth";

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const verified = verifyInventorySyncRequest(request, rawBody);
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });
    try {
        const body = readInventorySyncJson<{ runId?: string }>(rawBody);
        if (!body.runId) throw new Error("runId es obligatorio.");
        return NextResponse.json(await finishInventorySync(body.runId));
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo finalizar la sincronización." }, { status: 400 });
    }
}
