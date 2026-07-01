"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    CheckCircle2,
    Copy,
    Loader2,
    RefreshCw,
    Save,
    ShieldCheck,
    Trash2,
    Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

type WhatsAppGatewayField =
    | "whatsappBaseUrl"
    | "whatsappAdminToken"
    | "whatsappUserToken"
    | "whatsappInstanceName"
    | "whatsappMetaAppId"
    | "whatsappMetaAppSecret"
    | "whatsappEmbeddedSignupConfigId"
    | "whatsappTechProviderSolutionId"
    | "whatsappGraphApiVersion"
    | "whatsappRegistrationPin"
    | "whatsappWebhookVerifyToken"
    | "whatsappWebhookBaseUrl"
    | "whatsappProxyUrl";

type Props = {
    whatsappBaseUrl: string;
    whatsappAdminToken: string;
    whatsappUserToken: string;
    whatsappInstanceName: string;
    whatsappMetaAppId: string;
    whatsappMetaAppSecret: string;
    whatsappEmbeddedSignupConfigId: string;
    whatsappTechProviderSolutionId: string;
    whatsappGraphApiVersion: string;
    whatsappRegistrationPin: string;
    whatsappWebhookVerifyToken: string;
    whatsappWebhookBaseUrl: string;
    whatsappProxyEnabled: boolean;
    whatsappProxyUrl: string;
    onChange: (field: WhatsAppGatewayField, value: string) => void;
    onProxyEnabledChange: (value: boolean) => void;
    onSave: () => Promise<boolean>;
    isSaving: boolean;
};

type SessionState = {
    configured: boolean;
    connected?: boolean;
    loggedIn?: boolean;
    metaConfigured?: boolean;
    embeddedSignupConfigured?: boolean;
    appId?: string | null;
    configId?: string | null;
    solutionId?: string | null;
    graphApiVersion?: string | null;
    phoneNumberId?: string | null;
    displayPhoneNumber?: string | null;
    wabaId?: string | null;
    businessId?: string | null;
    webhookVerifyToken?: string | null;
    webhookBaseUrl?: string | null;
    registrationPinConfigured?: boolean;
    appSecretConfigured?: boolean;
    error?: string;
};

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

type EmbeddedSignupConfigResponse = {
    ok?: boolean;
    appId?: string | null;
    configId?: string | null;
    solutionId?: string | null;
    graphApiVersion?: string | null;
    error?: string;
};

declare global {
    interface Window {
        FB?: FacebookSdk;
        fbAsyncInit?: () => void;
    }
}

let facebookSdkPromise: Promise<void> | null = null;

function normalizeGraphVersion(value: string) {
    const trimmed = (value || "v23.0").trim();
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

function isLocalOrigin(origin: string) {
    try {
        const host = new URL(origin).hostname;
        return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    } catch {
        return false;
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

function generateToken() {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isNumericMetaAppId(value: string) {
    return /^\d+$/.test(value.trim());
}

function formatSignupIssues(issues: string[]) {
    return issues.join(" | ");
}

export function MetaWhatsAppPanel(props: Props) {
    const { toast } = useToast();
    const [session, setSession] = useState<SessionState>({ configured: false });
    const [isWorking, setIsWorking] = useState(false);
    const [embeddedCode, setEmbeddedCode] = useState("");
    const [embeddedSession, setEmbeddedSession] = useState<EmbeddedSignupSession | null>(null);
    const [clearChatsOnDelete, setClearChatsOnDelete] = useState(false);
    const [browserBaseUrl, setBrowserBaseUrl] = useState("");
    const [showTechnicalSettings, setShowTechnicalSettings] = useState(false);
    const finalizeInFlightRef = useRef(false);

    const effectiveMetaAppId = (session.appId || props.whatsappMetaAppId || "").trim();
    const effectiveConfigId = (session.configId || props.whatsappEmbeddedSignupConfigId || "").trim();
    const effectiveSolutionId = (session.solutionId || props.whatsappTechProviderSolutionId || "").trim();
    const graphApiVersion = normalizeGraphVersion(session.graphApiVersion || props.whatsappGraphApiVersion);
    const providerConfigReady = Boolean(effectiveMetaAppId && effectiveConfigId && session.appSecretConfigured);
    const effectiveWebhookBaseUrl = useMemo(() => (
        props.whatsappWebhookBaseUrl.trim() || session.webhookBaseUrl || browserBaseUrl
    ).replace(/\/+$/, ""), [browserBaseUrl, props.whatsappWebhookBaseUrl, session.webhookBaseUrl]);
    const webhookEndpoint = `${effectiveWebhookBaseUrl}/api/webhooks/whatsapp`;
    const isConnected = Boolean(session.connected || session.metaConfigured);
    const signupIssues = useMemo(() => {
        const issues: string[] = [];
        const appId = effectiveMetaAppId;
        const hasAppSecret = Boolean(props.whatsappMetaAppSecret.trim() || session.appSecretConfigured);

        if (!appId) {
            issues.push("Meta App ID");
        } else if (!isNumericMetaAppId(appId)) {
            issues.push("Meta App ID debe ser numerico, no correo");
        }

        if (!hasAppSecret) issues.push("App Secret");
        if (!effectiveConfigId) issues.push("Configuration ID");

        return issues;
    }, [
        effectiveConfigId,
        effectiveMetaAppId,
        props.whatsappMetaAppSecret,
        session.appSecretConfigured,
    ]);
    const canStartSignup = signupIssues.length === 0;
    const usesPublicHttps = effectiveWebhookBaseUrl.startsWith("https://");
    const canOpenEmbeddedSignup = usesPublicHttps || isLocalOrigin(effectiveWebhookBaseUrl);

    const loadSession = async () => {
        try {
            const response = await fetch("/api/whatsapp/session", { cache: "no-store" });
            const payload = await response.json();
            setSession(payload);
        } catch (error) {
            setSession({
                configured: false,
                error: error instanceof Error ? error.message : "No se pudo consultar el canal de WhatsApp.",
            });
        }
    };

    useEffect(() => {
        setBrowserBaseUrl(window.location.origin);
        void loadSession();
        const interval = setInterval(() => {
            void loadSession();
        }, 6000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!isFacebookOrigin(event.origin)) return;
            const parsed = parseEmbeddedSignupMessage(event.data);
            if (!parsed) return;

            if (parsed.event === "FINISH" || parsed.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
                if (!parsed.wabaId || !parsed.phoneNumberId) {
                    toast({
                        title: "Meta no devolvio todos los datos",
                        description: "Faltan WABA ID o Phone Number ID en la respuesta del onboarding.",
                        variant: "destructive",
                    });
                    return;
                }
                setEmbeddedSession(parsed);
                return;
            }

            if (parsed.event === "CANCEL" || parsed.event === "CANCELLED") {
                toast({
                    title: "Onboarding cancelado",
                    description: "No se guardaron cambios en el canal de WhatsApp.",
                });
            }
        };

        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [toast]);

    useEffect(() => {
        if (!embeddedCode || !embeddedSession || finalizeInFlightRef.current) return;

        const finalize = async () => {
            finalizeInFlightRef.current = true;
            setIsWorking(true);
            try {
                const response = await fetch("/api/whatsapp/embedded-signup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        code: embeddedCode,
                        wabaId: embeddedSession.wabaId,
                        phoneNumberId: embeddedSession.phoneNumberId,
                        businessId: embeddedSession.businessId,
                        client: props.whatsappInstanceName,
                    }),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.ok) {
                    throw new Error(payload?.error || "Meta no pudo completar la conexion.");
                }

                toast({
                    title: "WhatsApp conectado",
                    description: "El WABA, numero y token quedaron guardados en el CRM.",
                });
                setEmbeddedCode("");
                setEmbeddedSession(null);
                await loadSession();
            } catch (error) {
                toast({
                    title: "No se pudo finalizar Meta",
                    description: error instanceof Error ? error.message : "Fallo al completar Embedded Signup.",
                    variant: "destructive",
                });
            } finally {
                finalizeInFlightRef.current = false;
                setIsWorking(false);
            }
        };

        void finalize();
    }, [embeddedCode, embeddedSession, props.whatsappInstanceName, toast]);

    const executeDelete = async (extra: Record<string, unknown> = {}) => {
        setIsWorking(true);
        try {
            const response = await fetch("/api/whatsapp/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "deleteMeta", ...extra }),
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || "No se pudo eliminar la conexion.");
            }

            toast({
                title: "Canal eliminado",
                description: extra.clearChats
                    ? "Se limpio la conexion y tambien la seccion Chats del CRM."
                    : "Se limpio la conexion Meta guardada.",
            });
            await loadSession();
        } catch (error) {
            toast({
                title: "Accion fallida",
                description: error instanceof Error ? error.message : "Fallo al ejecutar la accion del canal.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    const handleEmbeddedSignup = async () => {
        if (!canStartSignup) {
            toast({
                title: "Falta configuracion Meta",
                description: `Configura estos datos de proveedor antes de abrir Meta: ${formatSignupIssues(signupIssues)}.`,
                variant: "destructive",
            });
            return;
        }

        if (!canOpenEmbeddedSignup) {
            toast({
                title: "Meta necesita una URL publica HTTPS",
                description: "Usa un dominio HTTPS publico, por ejemplo tu dominio final. En local solo se permite localhost.",
                variant: "destructive",
            });
            return;
        }

        setIsWorking(true);
        try {
            if (!providerConfigReady || showTechnicalSettings) {
                const saved = await props.onSave();
                if (!saved) return;
            }

            const configResponse = await fetch("/api/whatsapp/embedded-signup", { cache: "no-store" });
            const configPayload = await configResponse.json().catch(() => null) as EmbeddedSignupConfigResponse | null;
            if (!configResponse.ok || !configPayload?.ok) {
                throw new Error(configPayload?.error || "Falta configuracion de proveedor para Embedded Signup.");
            }

            const signupAppId = (configPayload.appId || effectiveMetaAppId).trim();
            const signupConfigId = (configPayload.configId || effectiveConfigId).trim();
            const signupSolutionId = (configPayload.solutionId || effectiveSolutionId || "").trim();
            const signupGraphApiVersion = normalizeGraphVersion(configPayload.graphApiVersion || graphApiVersion);

            if (!signupAppId || !isNumericMetaAppId(signupAppId)) {
                throw new Error("Meta App ID debe ser el identificador numerico de la app de proveedor.");
            }
            if (!signupConfigId) {
                throw new Error("Falta Configuration ID de Facebook Login for Business.");
            }

            setEmbeddedCode("");
            setEmbeddedSession(null);
            finalizeInFlightRef.current = false;

            await loadFacebookSdk(signupAppId, signupGraphApiVersion);
            if (!window.FB) {
                throw new Error("Facebook SDK no quedo disponible.");
            }

            window.FB.login((response) => {
                const code = response.authResponse?.code || "";
                if (!code) {
                    setIsWorking(false);
                    toast({
                        title: "Meta no devolvio codigo",
                        description: response.status === "connected"
                            ? "El popup cerro sin authorization code."
                            : "El usuario cancelo o Meta no autorizo el flujo.",
                        variant: "destructive",
                    });
                    return;
                }
                setEmbeddedCode(code);
            }, {
                config_id: signupConfigId,
                response_type: "code",
                override_default_response_type: true,
                auth_type: "rerequest",
                extras: {
                    setup: signupSolutionId
                        ? { solutionID: signupSolutionId }
                        : {},
                    featureType: "",
                    sessionInfoVersion: 3,
                },
            });
        } catch (error) {
            toast({
                title: "No se pudo abrir Meta",
                description: error instanceof Error ? error.message : "Fallo al iniciar Embedded Signup.",
                variant: "destructive",
            });
            setIsWorking(false);
        }
    };

    const handleDelete = () => {
        const description = clearChatsOnDelete
            ? "Esto eliminara la conexion Meta guardada y limpiara Chats del CRM. Esta accion no se puede deshacer."
            : "Esto eliminara la conexion Meta guardada. Podras conectar de nuevo con Embedded Signup.";
        if (!window.confirm(description)) return;
        void executeDelete({ clearChats: clearChatsOnDelete });
    };

    const copyToClipboard = async (value: string, label: string) => {
        await navigator.clipboard.writeText(value);
        toast({ title: "Copiado", description: `${label} listo en el portapapeles.` });
    };

    const generateVerifyToken = () => {
        props.onChange("whatsappWebhookVerifyToken", generateToken());
    };

    return (
        <div className="space-y-5">
            <div>
                <h3 className="font-semibold text-base text-foreground">Conexion de WhatsApp Business</h3>
                <p className="text-sm text-muted-foreground">
                    Conecta el WABA y el numero oficial por Embedded Signup de Meta.
                </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-4">
                    <div className="rounded-2xl border bg-background p-5">
                        <div className="mx-auto max-w-2xl space-y-4 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-foreground">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-semibold">Conexion de WhatsApp Business</h2>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Tu cliente abre el popup oficial de Meta para seleccionar o crear su cuenta de WhatsApp Business bajo tu proveedor.
                                </p>
                            </div>
                            <Button
                                onClick={handleEmbeddedSignup}
                                disabled={props.isSaving || isWorking}
                                className="h-11 w-full max-w-md text-base font-semibold"
                            >
                                {isWorking ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                                Conectar mi WhatsApp
                            </Button>
                            {!canStartSignup ? (
                                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                                    El boton queda disponible; si falta configuracion te dire que dato completar antes de abrir Meta.
                                </p>
                            ) : null}
                            <p className="text-xs text-muted-foreground">
                                Cliente: <span className="font-medium">{props.whatsappInstanceName || "zen-crm"}</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4">
                        <div>
                            <p className="text-sm font-medium">
                                {providerConfigReady ? "Configuracion de proveedor lista" : "Configuracion de proveedor pendiente"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {providerConfigReady
                                    ? "El cliente no necesita capturar credenciales: el boton usa tu App ID, Configuration ID y Secret del servidor."
                                    : "Completa los ajustes tecnicos o configura las variables de entorno del proveedor antes de conectar clientes."}
                            </p>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowTechnicalSettings((value) => !value)}
                        >
                            {showTechnicalSettings ? "Ocultar ajustes tecnicos" : "Ver ajustes tecnicos"}
                        </Button>
                    </div>

                    {showTechnicalSettings ? (
                    <div className="grid gap-4 rounded-2xl border bg-muted/20 p-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Nombre interno del canal</Label>
                            <Input
                                value={props.whatsappInstanceName}
                                onChange={(event) => props.onChange("whatsappInstanceName", event.target.value)}
                                placeholder="zen-crm-oficial"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Graph API version</Label>
                            <Input
                                value={props.whatsappGraphApiVersion}
                                onChange={(event) => props.onChange("whatsappGraphApiVersion", event.target.value)}
                                placeholder="v23.0"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Meta App ID</Label>
                            <Input
                                value={props.whatsappMetaAppId}
                                onChange={(event) => props.onChange("whatsappMetaAppId", event.target.value)}
                                placeholder="123456789012345"
                            />
                            {props.whatsappMetaAppId.trim() && !isNumericMetaAppId(props.whatsappMetaAppId) ? (
                                <p className="text-xs text-destructive">
                                    Usa el identificador numerico de la app de Meta, no el correo.
                                </p>
                            ) : null}
                        </div>
                        <div className="space-y-2">
                            <Label>App Secret</Label>
                            <Input
                                type="password"
                                value={props.whatsappMetaAppSecret}
                                onChange={(event) => props.onChange("whatsappMetaAppSecret", event.target.value)}
                                placeholder={session.appSecretConfigured ? "Guardado, deja vacio para conservar" : "Meta App Secret"}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Configuration ID</Label>
                            <Input
                                value={props.whatsappEmbeddedSignupConfigId}
                                onChange={(event) => props.onChange("whatsappEmbeddedSignupConfigId", event.target.value)}
                                placeholder="Facebook Login for Business configuration id"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Solution ID del Tech Provider</Label>
                            <Input
                                value={props.whatsappTechProviderSolutionId}
                                onChange={(event) => props.onChange("whatsappTechProviderSolutionId", event.target.value)}
                                placeholder="Opcional si Meta no lo requiere"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>PIN de registro del numero</Label>
                            <Input
                                type="password"
                                value={props.whatsappRegistrationPin}
                                onChange={(event) => props.onChange("whatsappRegistrationPin", event.target.value)}
                                placeholder={session.registrationPinConfigured ? "Guardado, deja vacio para conservar" : "6 digitos"}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <Label>Webhook verify token</Label>
                                <Button type="button" size="sm" variant="ghost" onClick={generateVerifyToken}>
                                    Generar
                                </Button>
                            </div>
                            <Input
                                type="password"
                                value={props.whatsappWebhookVerifyToken}
                                onChange={(event) => props.onChange("whatsappWebhookVerifyToken", event.target.value)}
                                placeholder={session.webhookVerifyToken ? "Guardado, deja vacio para conservar" : "Token compartido con Meta"}
                            />
                        </div>
                        <div className="space-y-2 lg:col-span-2">
                            <Label>URL publica HTTPS del CRM</Label>
                            <Input
                                value={props.whatsappWebhookBaseUrl}
                                onChange={(event) => props.onChange("whatsappWebhookBaseUrl", event.target.value)}
                                placeholder="https://crm.tudominio.com"
                            />
                            {!usesPublicHttps ? (
                                <p className={cn("text-xs", isLocalOrigin(effectiveWebhookBaseUrl) ? "text-muted-foreground" : "text-destructive")}>
                                    {isLocalOrigin(effectiveWebhookBaseUrl)
                                        ? "En local puedes abrir el popup, pero los webhooks reales de Meta requieren HTTPS publico."
                                        : "Para completar Meta necesitas HTTPS publico. Localhost sirve para ver la UI, no para webhooks reales de Meta."}
                                </p>
                            ) : null}
                        </div>
                    </div>
                    ) : null}

                    <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
                        <div>
                            <p className="font-medium">Valores para Meta Developers</p>
                            <p className="text-sm text-muted-foreground">
                                Usalos en WhatsApp Configuration y Facebook Login for Business.
                            </p>
                        </div>
                        <EndpointRow
                            label="Callback URL"
                            value={webhookEndpoint}
                            onCopy={() => copyToClipboard(webhookEndpoint, "Callback URL")}
                        />
                        <EndpointRow
                            label="Valid OAuth Redirect URI / Allowed Domain"
                            value={effectiveWebhookBaseUrl}
                            onCopy={() => copyToClipboard(effectiveWebhookBaseUrl, "Dominio publico")}
                        />
                    </div>

                    <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                        <Checkbox
                            id="clear-chats-on-delete"
                            checked={clearChatsOnDelete}
                            onCheckedChange={(checked) => setClearChatsOnDelete(Boolean(checked))}
                        />
                        <div className="space-y-1">
                            <Label htmlFor="clear-chats-on-delete" className="text-sm font-medium">
                                Al eliminar el canal, limpiar tambien Chats del CRM
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Solo vacia conversaciones y mensajes del inbox. No elimina contactos.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button onClick={props.onSave} disabled={props.isSaving || isWorking} variant="outline">
                            {props.isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Guardar configuracion
                        </Button>
                        <Button
                            onClick={handleDelete}
                            disabled={props.isSaving || isWorking}
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Eliminar conexion
                        </Button>
                    </div>
                </div>

                <Card className="border-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Webhook className="h-5 w-5 text-primary" />
                            Estado Meta
                        </CardTitle>
                        <CardDescription>
                            Estado guardado despues de completar Embedded Signup.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                            <div>
                                <p className="text-sm font-medium">Canal</p>
                                <p className="text-xs text-muted-foreground">
                                    {isConnected ? "Conectado por WhatsApp Business" : "Esperando Embedded Signup"}
                                </p>
                            </div>
                            {isConnected ? (
                                <div className="inline-flex items-center gap-2 text-foreground text-sm font-medium">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Activo
                                </div>
                            ) : (
                                <Button variant="ghost" size="sm" onClick={() => loadSession()} disabled={isWorking}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Refrescar
                                </Button>
                            )}
                        </div>

                        <StatusValue label="Numero" value={session.displayPhoneNumber} />
                        <StatusValue label="Phone Number ID" value={session.phoneNumberId} />
                        <StatusValue label="WABA ID" value={session.wabaId} />
                        <StatusValue label="Business ID" value={session.businessId} />
                        <StatusValue label="App ID" value={session.appId || props.whatsappMetaAppId} />
                        <StatusValue label="Configuration ID" value={session.configId || props.whatsappEmbeddedSignupConfigId} />

                        {session.error ? (
                            <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                                {session.error}
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function EndpointRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex gap-2">
                <Input value={value} readOnly />
                <Button type="button" variant="outline" size="icon" onClick={onCopy} title={`Copiar ${label}`}>
                    <Copy className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

function StatusValue({ label, value }: { label: string; value?: string | null }) {
    return (
        <div className="rounded-xl border bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-medium break-all">{value || "Todavia no disponible"}</p>
        </div>
    );
}
