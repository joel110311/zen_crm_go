import { NextRequest, NextResponse } from "next/server";
import { stageInventorySyncRows } from "@/lib/inventory";
import { readInventorySyncJson, verifyInventorySyncRequest } from "@/lib/inventory-auth";

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const verified = verifyInventorySyncRequest(request, rawBody);
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 401 });
    try {
        const body = readInventorySyncJson<{ runId?: string; rows?: unknown[] }>(rawBody);
        if (!body.runId) throw new Error("runId es obligatorio.");
        return NextResponse.json(await stageInventorySyncRows(body.runId, body.rows || []));
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo recibir el lote." }, { status: 400 });
    }
}
