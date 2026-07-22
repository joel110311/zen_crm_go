import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    createMetaConnectSession,
    isAllowedMetaConnectOrigin,
    verifyMetaConnectSession,
} from "@/lib/meta-connect-session";
import { getMetaEmbeddedSignupConfig } from "@/lib/meta-whatsapp";

const COEXISTENCE_FEATURE_TYPE = "whatsapp_business_app_onboarding";
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function getSessionUserId(session: unknown) {
    return (session as { user?: { id?: string } } | null)?.user?.id || null;
}

function normalizeOrigin(value: string) {
    try {
        return new URL(value.trim()).origin;
    } catch {
        return "";
    }
}

function resolveCrmOrigin(request: NextRequest) {
    const configured = process.env.APP_BASE_URL || process.env.AUTH_URL || "";
    const configuredOrigin = normalizeOrigin(configured);
    if (configuredOrigin && isAllowedMetaConnectOrigin(configuredOrigin)) return configuredOrigin;

    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestOrigin = forwardedHost && forwardedProto
        ? normalizeOrigin(`${forwardedProto}://${forwardedHost}`)
        : request.nextUrl.origin;

    if (!isAllowedMetaConnectOrigin(requestOrigin)) {
        throw new Error("No se pudo resolver un dominio autorizado para devolver la conexion al CRM.");
    }
    return requestOrigin;
}

function clientFromOrigin(origin: string) {
    const hostname = new URL(origin).hostname.toLowerCase();
    const client = hostname
        .replace(/\.synapselogik\.com$/, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return client || "zen-crm";
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!getSessionUserId(session)) {
        return NextResponse.json(
            { ok: false, error: "No autorizado." },
            { status: 401, headers: NO_STORE_HEADERS },
        );
    }

    try {
        const config = await getMetaEmbeddedSignupConfig();
        const origin = resolveCrmOrigin(request);
        const signed = createMetaConnectSession({
            origin,
            client: clientFromOrigin(origin),
            appId: config.appId,
            configId: config.configId,
            solutionId: config.solutionId || "",
            graphApiVersion: config.graphApiVersion,
            featureType: COEXISTENCE_FEATURE_TYPE,
        });
        const signupBaseUrl = config.signupBaseUrl || origin;
        const signupUrl = new URL("/connect/whatsapp", signupBaseUrl);
        signupUrl.searchParams.set("session", signed.token);

        return NextResponse.json(
            {
                ok: true,
                signupUrl: signupUrl.toString(),
                signupOrigin: signupUrl.origin,
                expiresAt: signed.expiresAt,
            },
            { headers: NO_STORE_HEADERS },
        );
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : "No se pudo crear la sesion segura de Meta.",
            },
            { status: 400, headers: NO_STORE_HEADERS },
        );
    }
}

export async function GET(request: NextRequest) {
    try {
        const token = request.nextUrl.searchParams.get("session") || "";
        if (!token) {
            return NextResponse.json(
                { ok: false, error: "Falta la sesion segura de conexion Meta." },
                { status: 400, headers: NO_STORE_HEADERS },
            );
        }

        const payload = verifyMetaConnectSession(token);
        return NextResponse.json(
            {
                ok: true,
                appId: payload.appId,
                configId: payload.configId,
                solutionId: payload.solutionId || null,
                graphApiVersion: payload.graphApiVersion,
                featureType: payload.featureType,
                returnOrigin: payload.origin,
                client: payload.client,
                expiresAt: new Date(payload.exp * 1000).toISOString(),
            },
            { headers: NO_STORE_HEADERS },
        );
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : "La sesion segura de Meta no es valida.",
            },
            { status: 400, headers: NO_STORE_HEADERS },
        );
    }
}
