"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type FacebookLoginResponse = {
    authResponse?: {
        code?: string;
    };
    status?: string;
};

type FacebookSdk = {
    init: (options: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
    }) => void;
    login: (
        callback: (response: FacebookLoginResponse) => void,
        options: Record<string, unknown>,
    ) => void;
};

type EmbeddedSignupSession = {
    event: string;
    wabaId: string;
    phoneNumberId: string;
    businessId: string;
};

type ConnectConfig = {
    appId: string;
    configId: string;
    solutionId: string;
    featureType: string;
    graphApiVersion: string;
    returnOrigin: string;
    client: string;
};

declare global {
    interface Window {
        FB?: FacebookSdk;
        fbAsyncInit?: () => void;
    }
}

let facebookSdkPromise: Promise<void> | null = null;
const DEFAULT_GRAPH_API_VERSION = "v25.0";

function normalizeGraphVersion(value: string) {
    const trimmed = (value || DEFAULT_GRAPH_API_VERSION).trim();
    return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function isFacebookOrigin(origin: string) {
    try {
        const host = new URL(origin).hostname;
        return host === "facebook.com" || host.endsWith(".facebook.com");
    } catch {
        return false;
    }
}

async function readSessionConfig(): Promise<{ config: ConnectConfig | null; error: string | null }> {
    const params = new URLSearchParams(window.location.search);
    const session = (params.get("session") || "").trim();
    if (!session) return { config: null, error: "Abre esta conexion desde el CRM para generar una sesion segura." };

    try {
        const response = await fetch(`/api/whatsapp/connect-session?session=${encodeURIComponent(session)}`, {
            cache: "no-store",
        });
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json")
            ? await response.json().catch(() => null) as (Partial<ConnectConfig> & { ok?: boolean; error?: string }) | null
            : null;
        if (response.redirected || !contentType.includes("application/json")) {
            return {
                config: null,
                error: "El servidor central no pudo validar la sesion. Abre nuevamente la conexion desde el CRM.",
            };
        }
        if (!response.ok || !payload?.ok) {
            return { config: null, error: payload?.error || "La sesion segura de Meta no es valida." };
        }

        const appId = (payload.appId || "").trim();
        const configId = (payload.configId || "").trim();
        const returnOrigin = (payload.returnOrigin || "").trim();
        if (!appId || !/^\d+$/.test(appId) || !configId || !returnOrigin) {
            return { config: null, error: "La sesion segura no contiene la configuracion completa de Meta." };
        }

        return {
            config: {
                appId,
                configId,
                solutionId: (payload.solutionId || "").trim(),
                featureType: (payload.featureType || "whatsapp_business_app_onboarding").trim(),
                graphApiVersion: normalizeGraphVersion(payload.graphApiVersion || "v23.0"),
                returnOrigin,
                client: (payload.client || "zen-crm").trim(),
            },
            error: null,
        };
    } catch (error) {
        return {
            config: null,
            error: error instanceof Error ? error.message : "No se pudo validar la sesion segura de Meta.",
        };
    }
}

function parseEmbeddedSignupMessage(data: unknown): EmbeddedSignupSession | null {
    const payload = typeof data === "string"
        ? (() => {
            try {
                return JSON.parse(data) as Record<string, unknown>;
            } catch {
                return null;
            }
        })()
        : data;
    if (!payload || typeof payload !== "object") return null;

    const record = payload as Record<string, unknown>;
    if (record.type !== "WA_EMBEDDED_SIGNUP") return null;

    const nestedData = record.data && typeof record.data === "object"
        ? record.data as Record<string, unknown>
        : {};
    const event = typeof record.event === "string" ? record.event : "";
    const wabaId = String(nestedData.waba_id || nestedData.wabaId || "");
    const phoneNumberId = String(nestedData.phone_number_id || nestedData.phoneNumberId || "");
    const businessId = String(nestedData.business_id || nestedData.businessId || "");

    return {
        event,
        wabaId,
        phoneNumberId,
        businessId,
    };
}

function loadFacebookSdk(appId: string, version: string) {
    if (window.FB) {
        window.FB.init({ appId, cookie: true, xfbml: false, version });
        return Promise.resolve();
    }

    if (!facebookSdkPromise) {
        facebookSdkPromise = new Promise((resolve, reject) => {
            window.fbAsyncInit = () => {
                window.FB?.init({ appId, cookie: true, xfbml: false, version });
                resolve();
            };

            const existing = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
            if (existing) {
                existing.addEventListener("load", () => resolve(), { once: true });
                existing.addEventListener("error", () => reject(new Error("No se pudo cargar Facebook SDK.")), { once: true });
                return;
            }

            const script = document.createElement("script");
            script.id = "facebook-jssdk";
            script.async = true;
            script.defer = true;
            script.crossOrigin = "anonymous";
            script.src = "https://connect.facebook.net/es_LA/sdk.js";
            script.onerror = () => reject(new Error("No se pudo cargar Facebook SDK."));
            document.body.appendChild(script);
        });
    }

    return facebookSdkPromise.then(() => {
        window.FB?.init({ appId, cookie: true, xfbml: false, version });
    });
}

export default function WhatsAppConnectPage() {
    const [config, setConfig] = useState<ConnectConfig | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isWorking, setIsWorking] = useState(false);
    const [code, setCode] = useState("");
    const [embeddedSession, setEmbeddedSession] = useState<EmbeddedSignupSession | null>(null);
    const [status, setStatus] = useState("Listo para abrir el alta oficial de Meta.");
    const [hasOpener, setHasOpener] = useState(false);
    const [posted, setPosted] = useState(false);
    const postedRef = useRef(false);

    useEffect(() => {
        setHasOpener(Boolean(window.opener));
        let active = true;
        void readSessionConfig().then((result) => {
            if (!active) return;
            setConfig(result.config);
            setError(result.error);
        });
        return () => {
            active = false;
        };
    }, []);

    const canNotifyParent = Boolean(config?.returnOrigin && hasOpener);

    const notifyParent = useCallback((payload: Record<string, unknown>) => {
        if (!config?.returnOrigin || !window.opener) return;
        window.opener.postMessage(payload, config.returnOrigin);
    }, [config?.returnOrigin]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!isFacebookOrigin(event.origin)) return;
            const parsed = parseEmbeddedSignupMessage(event.data);
            if (!parsed) return;

            if (parsed.event === "FINISH" || parsed.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
                if (!parsed.wabaId || !parsed.phoneNumberId) {
                    const message = "Meta no devolvio WABA ID o Phone Number ID.";
                    setError(message);
                    setIsWorking(false);
                    notifyParent({ type: "ZEN_META_EMBEDDED_SIGNUP_ERROR", error: message });
                    return;
                }
                setEmbeddedSession(parsed);
                setStatus("Meta confirmo el numero. Finalizando conexion con el CRM...");
                return;
            }

            if (parsed.event === "CANCEL" || parsed.event === "CANCELLED") {
                setIsWorking(false);
                setStatus("Alta cancelada. Puedes cerrar esta ventana.");
                notifyParent({ type: "ZEN_META_EMBEDDED_SIGNUP_CANCELLED" });
            }
        };

        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [notifyParent]);

    useEffect(() => {
        if (!config || !code || !embeddedSession || postedRef.current) return;
        postedRef.current = true;
        setPosted(true);
        notifyParent({
            type: "ZEN_META_EMBEDDED_SIGNUP_COMPLETE",
            code,
            session: {
                wabaId: embeddedSession.wabaId,
                phoneNumberId: embeddedSession.phoneNumberId,
                businessId: embeddedSession.businessId,
            },
        });
        setIsWorking(false);
        setStatus("Listo. El CRM esta guardando la conexion de WhatsApp.");
        window.setTimeout(() => window.close(), 1400);
    }, [code, config, embeddedSession, notifyParent]);

    const startEmbeddedSignup = async () => {
        if (!config) {
            setError("No hay configuracion suficiente para iniciar Meta.");
            return;
        }

        postedRef.current = false;
        setPosted(false);
        setCode("");
        setEmbeddedSession(null);
        setError(null);
        setIsWorking(true);
        setStatus("Abriendo Meta Embedded Signup...");

        try {
            await loadFacebookSdk(config.appId, config.graphApiVersion);
            if (!window.FB) {
                throw new Error("Facebook SDK no quedo disponible.");
            }

            window.FB.login((response) => {
                const responseCode = response.authResponse?.code || "";
                if (!responseCode) {
                    setIsWorking(false);
                    setStatus("Alta cancelada. Puedes intentar de nuevo.");
                    notifyParent({
                        type: "ZEN_META_EMBEDDED_SIGNUP_CANCELLED",
                    });
                    return;
                }
                setCode(responseCode);
                setStatus("Meta autorizo el alta. Esperando datos del numero...");
            }, {
                config_id: config.configId,
                response_type: "code",
                override_default_response_type: true,
                auth_type: "rerequest",
                extras: {
                    setup: config.solutionId
                        ? { solutionID: config.solutionId }
                        : {},
                    featureType: config.featureType,
                    sessionInfoVersion: "3",
                },
            });
        } catch (caughtError) {
            const message = caughtError instanceof Error ? caughtError.message : "No se pudo abrir Meta Embedded Signup.";
            setError(message);
            setStatus("No se pudo iniciar el alta.");
            setIsWorking(false);
            notifyParent({ type: "ZEN_META_EMBEDDED_SIGNUP_ERROR", error: message });
        }
    };

    return (
        <main className="min-h-screen bg-[#f7f7f7] px-5 py-10 text-[#111111]">
            <section className="mx-auto flex max-w-2xl flex-col items-center rounded-[2rem] border border-[#dedede] bg-white p-8 text-center shadow-sm">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f1f1f1]">
                    {error ? <XCircle className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
                </div>

                <div className="mt-6 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7a7a7a]">
                        Zen CRM Tech Provider
                    </p>
                    <h1 className="text-3xl font-semibold tracking-tight">Conexion de WhatsApp Business</h1>
                    <p className="mx-auto max-w-xl text-base text-[#666666]">
                        Selecciona o crea tu cuenta de WhatsApp Business en el popup oficial de Meta. Al terminar,
                        regresaremos la conexion al CRM que abrio esta ventana.
                    </p>
                </div>

                {error ? (
                    <div className="mt-7 w-full max-w-lg rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-700">
                        {error}
                    </div>
                ) : (
                    <div className="mt-7 flex w-full max-w-lg items-center gap-2 rounded-2xl border border-[#e5e5e5] bg-white px-4 py-3 text-left text-sm text-[#555555]">
                        <ShieldCheck className="h-4 w-4 shrink-0" />
                        {status}
                    </div>
                )}

                <Button
                    type="button"
                    className="mt-7 h-12 w-full max-w-lg rounded-2xl bg-[#111111] text-base font-semibold text-white hover:bg-[#2a2a2a]"
                    disabled={!config || isWorking}
                    onClick={startEmbeddedSignup}
                >
                    {isWorking ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                    Conectar mi WhatsApp
                </Button>

                {!canNotifyParent ? (
                    <p className="mt-4 max-w-lg text-xs text-[#777777]">
                        Esta ventana debe abrirse desde el CRM para poder devolver la conexion automaticamente.
                    </p>
                ) : null}

                {posted ? (
                    <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Conexion enviada al CRM
                    </div>
                ) : null}
            </section>
        </main>
    );
}
