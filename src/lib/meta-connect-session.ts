import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_VERSION = 1;
const SESSION_TTL_SECONDS = 10 * 60;
const MANAGED_RETURN_DOMAIN = "synapselogik.com";

export type MetaConnectSessionPayload = {
    v: number;
    origin: string;
    client: string;
    appId: string;
    configId: string;
    solutionId: string;
    graphApiVersion: string;
    featureType: string;
    iat: number;
    exp: number;
    nonce: string;
};

type CreateMetaConnectSessionInput = Omit<
    MetaConnectSessionPayload,
    "v" | "iat" | "exp" | "nonce"
>;

function signingSecret() {
    const secret = (process.env.META_CONNECT_SIGNING_SECRET || process.env.AUTH_SECRET || "").trim();
    if (!secret) {
        throw new Error("Falta META_CONNECT_SIGNING_SECRET para proteger el alta central de Meta.");
    }
    return secret;
}

function normalizeOrigin(value: string) {
    const url = new URL(value.trim());
    if (url.origin !== value.trim().replace(/\/+$/, "") || url.username || url.password) {
        throw new Error("El origen del CRM debe contener solamente protocolo y dominio.");
    }
    return url.origin;
}

function configuredOrigins() {
    return (process.env.META_CONNECT_ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
            try {
                return normalizeOrigin(value);
            } catch {
                return "";
            }
        })
        .filter(Boolean);
}

export function isAllowedMetaConnectOrigin(value: string) {
    try {
        const origin = normalizeOrigin(value);
        const url = new URL(origin);
        const hostname = url.hostname.toLowerCase();
        const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";

        if (local) return process.env.NODE_ENV !== "production" && url.protocol === "http:";
        if (url.protocol !== "https:") return false;
        if (configuredOrigins().includes(origin)) return true;

        return hostname === MANAGED_RETURN_DOMAIN || hostname.endsWith(`.${MANAGED_RETURN_DOMAIN}`);
    } catch {
        return false;
    }
}

function encode(value: string | Buffer) {
    return Buffer.from(value).toString("base64url");
}

function signatureFor(encodedPayload: string) {
    return createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");
}

function readRequiredString(payload: Record<string, unknown>, key: keyof MetaConnectSessionPayload) {
    const value = payload[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`La sesion de Meta no contiene ${String(key)}.`);
    }
    return value.trim();
}

export function createMetaConnectSession(input: CreateMetaConnectSessionInput) {
    if (!isAllowedMetaConnectOrigin(input.origin)) {
        throw new Error("El dominio de retorno no esta autorizado para Embedded Signup.");
    }

    const now = Math.floor(Date.now() / 1000);
    const payload: MetaConnectSessionPayload = {
        ...input,
        v: SESSION_VERSION,
        origin: normalizeOrigin(input.origin),
        client: input.client.trim() || "zen-crm",
        iat: now,
        exp: now + SESSION_TTL_SECONDS,
        nonce: randomBytes(18).toString("base64url"),
    };
    const encodedPayload = encode(JSON.stringify(payload));
    return {
        token: `${encodedPayload}.${signatureFor(encodedPayload)}`,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
}

export function verifyMetaConnectSession(token: string): MetaConnectSessionPayload {
    const [encodedPayload, encodedSignature, extra] = token.trim().split(".");
    if (!encodedPayload || !encodedSignature || extra) {
        throw new Error("La sesion de conexion Meta no tiene un formato valido.");
    }

    const expected = Buffer.from(signatureFor(encodedPayload), "utf8");
    const received = Buffer.from(encodedSignature, "utf8");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw new Error("La firma de la sesion de conexion Meta no es valida.");
    }

    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
    } catch {
        throw new Error("No se pudo leer la sesion de conexion Meta.");
    }

    const now = Math.floor(Date.now() / 1000);
    const version = Number(raw.v);
    const issuedAt = Number(raw.iat);
    const expiresAt = Number(raw.exp);
    if (version !== SESSION_VERSION || !Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) {
        throw new Error("La version de la sesion de conexion Meta no es valida.");
    }
    if (issuedAt > now + 60 || expiresAt <= now || expiresAt - issuedAt > SESSION_TTL_SECONDS) {
        throw new Error("La sesion de conexion Meta vencio. Abre nuevamente el alta desde el CRM.");
    }

    const origin = readRequiredString(raw, "origin");
    if (!isAllowedMetaConnectOrigin(origin)) {
        throw new Error("El dominio de retorno de la sesion Meta no esta autorizado.");
    }

    const payload: MetaConnectSessionPayload = {
        v: version,
        origin: normalizeOrigin(origin),
        client: readRequiredString(raw, "client"),
        appId: readRequiredString(raw, "appId"),
        configId: readRequiredString(raw, "configId"),
        solutionId: typeof raw.solutionId === "string" ? raw.solutionId.trim() : "",
        graphApiVersion: readRequiredString(raw, "graphApiVersion"),
        featureType: readRequiredString(raw, "featureType"),
        iat: issuedAt,
        exp: expiresAt,
        nonce: readRequiredString(raw, "nonce"),
    };

    if (!/^\d+$/.test(payload.appId)) {
        throw new Error("El Meta App ID de la sesion no es valido.");
    }

    return payload;
}

