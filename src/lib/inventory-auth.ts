import crypto from "node:crypto";
import type { NextRequest } from "next/server";

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

function safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyInventorySyncRequest(request: NextRequest, rawBody: string) {
    const secret = (process.env.INVENTORY_SYNC_SECRET || "").trim();
    if (!secret) return { ok: false as const, error: "La sincronización de inventario no está configurada." };

    // Bearer is supported for standard n8n HTTP Request nodes. HMAC remains the
    // preferred option because it binds the payload and expires after five minutes.
    const authorization = request.headers.get("authorization")?.trim() || "";
    if (authorization.startsWith("Bearer ") && safeEqual(authorization.slice(7).trim(), secret)) {
        return { ok: true as const };
    }

    const timestamp = request.headers.get("x-inventory-timestamp")?.trim() || "";
    const signature = request.headers.get("x-inventory-signature")?.trim() || "";
    const timestampMs = Number(timestamp);
    if (!timestamp || !signature || !Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_SIGNATURE_AGE_MS) {
        return { ok: false as const, error: "Firma de sincronización inválida o expirada." };
    }

    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    return safeEqual(expected, signature)
        ? { ok: true as const }
        : { ok: false as const, error: "Firma de sincronización inválida o expirada." };
}

export function readInventorySyncJson<T>(rawBody: string) {
    try {
        return JSON.parse(rawBody) as T;
    } catch {
        throw new Error("JSON inválido.");
    }
}
