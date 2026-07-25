"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ArrowRight,
    CheckCircle2,
    Clock3,
    Copy,
    Loader2,
    PlugZap,
    RefreshCw,
    Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

type BrandIconProps = {
    className?: string;
};

type MessengerStatus = {
    configured: boolean;
    connected: boolean;
    appId: string | null;
    appSecretConfigured: boolean;
    graphApiVersion: string;
    webhookBaseUrl: string | null;
    webhookVerifyTokenConfigured: boolean;
    callbackUrl: string | null;
    pageId: string | null;
    pageName: string | null;
    webhookSubscribed: boolean;
    connectedAt: string | null;
};

type MessengerPage = {
    id: string;
    name: string;
    pictureUrl: string | null;
    tasks: string[];
};

type FacebookLoginResponse = {
    authResponse?: { accessToken?: string };
    status?: string;
};

type FacebookSdk = {
    init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
    login(
        callback: (response: FacebookLoginResponse) => void,
        options: { scope: string; return_scopes: boolean },
    ): void;
};

let messengerSdkPromise: Promise<void> | null = null;

type MessengerFacebookWindow = {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
};

function WhatsAppIcon({ className }: BrandIconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M12.04 2a9.84 9.84 0 0 0-8.4 14.96L2 22l5.2-1.62A9.95 9.95 0 1 0 12.04 2Zm0 17.94a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.08.96 1-3-.2-.31A8.02 8.02 0 1 1 12.04 19.94Zm4.45-6.06c-.24-.12-1.43-.7-1.65-.79-.22-.08-.38-.12-.54.12-.16.24-.62.79-.76.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2a7.27 7.27 0 0 1-1.34-1.67c-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.43-.59 1.63-1.15.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"
            />
        </svg>
    );
}

function MessengerIcon({ className }: BrandIconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M12 2C6.37 2 2 6.13 2 11.7c0 2.91 1.19 5.43 3.13 7.17V22l2.86-1.57c1.24.34 2.59.52 4.01.52 5.63 0 10-4.13 10-9.25S17.63 2 12 2Zm1 13.05-2.55-2.72-4.98 2.72 5.48-5.82 2.61 2.72 4.92-2.72L13 15.05Z"
            />
        </svg>
    );
}

function InstagramIcon({ className }: BrandIconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm-.2 2A3.6 3.6 0 0 0 4 7.6v8.8A3.6 3.6 0 0 0 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6A3.6 3.6 0 0 0 16.4 4H7.6Zm9.65 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
            />
        </svg>
    );
}

function openWhatsAppSignup() {
    const button = document.getElementById("meta-whatsapp-embedded-signup-button");
    button?.scrollIntoView({ behavior: "smooth", block: "center" });
    button?.click();
}

function loadFacebookSdk(appId: string, version: string) {
    const facebookWindow = window as unknown as MessengerFacebookWindow;
    if (facebookWindow.FB) {
        facebookWindow.FB.init({ appId, cookie: true, xfbml: false, version });
        return Promise.resolve();
    }

    if (!messengerSdkPromise) {
        messengerSdkPromise = new Promise((resolve, reject) => {
            const previousInit = facebookWindow.fbAsyncInit;
            facebookWindow.fbAsyncInit = () => {
                previousInit?.();
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

    return messengerSdkPromise.then(() => {
        if (!facebookWindow.FB) throw new Error("Facebook SDK no quedo disponible.");
        facebookWindow.FB.init({ appId, cookie: true, xfbml: false, version });
    });
}

function facebookLogin() {
    return new Promise<string>((resolve, reject) => {
        const facebookWindow = window as unknown as MessengerFacebookWindow;
        if (!facebookWindow.FB) {
            reject(new Error("Facebook SDK no esta disponible."));
            return;
        }
        facebookWindow.FB.login((response) => {
            const token = response.authResponse?.accessToken;
            if (!token) {
                reject(new Error("Facebook no autorizo el acceso a las Paginas."));
                return;
            }
            resolve(token);
        }, {
            scope: "pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement",
            return_scopes: true,
        });
    });
}

export function MetaChannelConnectors() {
    const { toast } = useToast();
    const [status, setStatus] = useState<MessengerStatus | null>(null);
    const [appId, setAppId] = useState("");
    const [appSecret, setAppSecret] = useState("");
    const [graphApiVersion, setGraphApiVersion] = useState("v23.0");
    const [webhookBaseUrl, setWebhookBaseUrl] = useState("");
    const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
    const [pages, setPages] = useState<MessengerPage[]>([]);
    const [selectedPageId, setSelectedPageId] = useState("");
    const [userAccessToken, setUserAccessToken] = useState("");
    const [busy, setBusy] = useState<"save" | "login" | "connect" | "disconnect" | null>(null);

    const applyStatus = useCallback((next: MessengerStatus) => {
        setStatus(next);
        setAppId(next.appId || "");
        setGraphApiVersion(next.graphApiVersion || "v23.0");
        setWebhookBaseUrl(next.webhookBaseUrl || "");
    }, []);

    const refreshStatus = useCallback(async () => {
        const response = await fetch("/api/messenger", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "No se pudo consultar Messenger.");
        applyStatus(payload);
    }, [applyStatus]);

    useEffect(() => {
        void refreshStatus().catch((error) => {
            toast({
                title: "No se pudo consultar Messenger",
                description: error instanceof Error ? error.message : "Error inesperado.",
                variant: "destructive",
            });
        });
    }, [refreshStatus, toast]);

    const saveConfiguration = async (manageBusy = true) => {
        if (manageBusy) setBusy("save");
        try {
            const response = await fetch("/api/messenger", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    appId,
                    appSecret,
                    graphApiVersion,
                    webhookBaseUrl,
                    webhookVerifyToken,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No se pudo guardar la configuracion.");
            applyStatus(payload);
            setAppSecret("");
            setWebhookVerifyToken("");
            toast({ title: "Configuracion de Messenger guardada" });
            return payload as MessengerStatus;
        } finally {
            if (manageBusy) setBusy(null);
        }
    };

    const authorizeFacebook = async () => {
        setBusy("login");
        try {
            const saved = await saveConfiguration(false);
            const effectiveAppId = saved.appId || appId.trim();
            if (!effectiveAppId || !saved.appSecretConfigured) {
                throw new Error("Guarda App ID y App Secret antes de continuar.");
            }
            await loadFacebookSdk(effectiveAppId, saved.graphApiVersion);
            const token = await facebookLogin();
            const response = await fetch("/api/messenger/pages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userAccessToken: token }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las Paginas.");
            setUserAccessToken(token);
            setPages(payload.pages || []);
            setSelectedPageId(payload.pages?.[0]?.id || "");
            if (!payload.pages?.length) {
                throw new Error("La cuenta autorizada no devolvio Paginas administrables.");
            }
        } catch (error) {
            toast({
                title: "No se pudo autorizar Facebook",
                description: error instanceof Error ? error.message : "Error inesperado.",
                variant: "destructive",
            });
        } finally {
            setBusy(null);
        }
    };

    const connectPage = async () => {
        if (!userAccessToken || !selectedPageId) return;
        setBusy("connect");
        try {
            const response = await fetch("/api/messenger/pages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userAccessToken, pageId: selectedPageId }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No se pudo conectar la Pagina.");
            applyStatus(payload);
            setPages([]);
            setSelectedPageId("");
            setUserAccessToken("");
            toast({
                title: "Facebook Messenger conectado",
                description: `${payload.pageName || "La Pagina"} quedo suscrita al webhook.`,
            });
        } catch (error) {
            toast({
                title: "No se pudo conectar la Pagina",
                description: error instanceof Error ? error.message : "Error inesperado.",
                variant: "destructive",
            });
        } finally {
            setBusy(null);
        }
    };

    const disconnectPage = async () => {
        if (!window.confirm("Se cancelara la suscripcion al webhook y se eliminara el token de la Pagina. El historial del CRM se conserva.")) {
            return;
        }
        setBusy("disconnect");
        try {
            const response = await fetch("/api/messenger", { method: "DELETE" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "No se pudo desconectar Messenger.");
            applyStatus(payload);
            toast({ title: "Facebook Messenger desconectado" });
        } catch (error) {
            toast({
                title: "No se pudo desconectar Messenger",
                description: error instanceof Error ? error.message : "Error inesperado.",
                variant: "destructive",
            });
        } finally {
            setBusy(null);
        }
    };

    const copyCallback = async () => {
        if (!status?.callbackUrl) return;
        await navigator.clipboard.writeText(status.callbackUrl);
        toast({ title: "URL del webhook copiada" });
    };

    return (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-5">
                <h2 className="text-xl font-semibold text-foreground">Canales oficiales de Meta</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Cada canal tiene su propia conexion. El canal por QR permanece independiente.
                </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <article className="flex min-h-56 flex-col rounded-2xl border border-border bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#25D366] text-white">
                            <WhatsAppIcon className="h-5 w-5" />
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            Disponible
                        </span>
                    </div>
                    <div className="mt-4 flex-1">
                        <h3 className="font-semibold">WhatsApp por API</h3>
                        <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                            Embedded Signup oficial y coexistencia con la app de WhatsApp Business.
                        </p>
                    </div>
                    <Button type="button" className="mt-4 w-full justify-between" onClick={openWhatsAppSignup}>
                        Conectar WhatsApp por API
                        <ArrowRight className="h-4 w-4" />
                    </Button>
                </article>

                <article className="flex min-h-56 flex-col rounded-2xl border border-[#0866FF]/30 bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0866FF] text-white">
                            <MessengerIcon className="h-5 w-5" />
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            {status?.connected && status.webhookSubscribed ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                                <Clock3 className="h-3.5 w-3.5" />
                            )}
                            {status?.connected ? "Conectado" : "Disponible"}
                        </span>
                    </div>
                    <div className="mt-4 flex-1">
                        <h3 className="font-semibold">Facebook Messenger</h3>
                        <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                            {status?.connected
                                ? `${status.pageName || "Pagina"} recibe y responde mensajes desde el inbox.`
                                : "Autoriza Facebook, elige una Pagina y suscribela al webhook."}
                        </p>
                    </div>
                    {status?.connected ? (
                        <Button type="button" variant="outline" className="mt-4 w-full justify-between" onClick={disconnectPage} disabled={busy !== null}>
                            {busy === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                            Desconectar Pagina
                        </Button>
                    ) : (
                        <Button type="button" className="mt-4 w-full justify-between bg-[#0866FF] hover:bg-[#0758d9]" onClick={authorizeFacebook} disabled={busy !== null}>
                            {busy === "login" || busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                            Autorizar Facebook
                        </Button>
                    )}
                </article>

                <article className="flex min-h-56 flex-col rounded-2xl border border-border bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#FCAF45] text-white">
                            <InstagramIcon className="h-5 w-5" />
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            <Clock3 className="h-3.5 w-3.5" />
                            En preparacion
                        </span>
                    </div>
                    <div className="mt-4 flex-1">
                        <h3 className="font-semibold">Instagram Direct</h3>
                        <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                            Pendiente de alta, persistencia de cuenta y envio.
                        </p>
                    </div>
                    <Button type="button" variant="outline" className="mt-4 w-full justify-between" disabled>
                        Conectar Instagram Direct
                        <ArrowRight className="h-4 w-4" />
                    </Button>
                </article>
            </div>

            <div className="mt-5 rounded-2xl border border-[#0866FF]/20 bg-[#0866FF]/[0.03] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h3 className="font-semibold">Configuracion de Facebook Messenger</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Usa una app de Meta con Messenger y Facebook Login for Business habilitados.
                        </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void refreshStatus()} disabled={busy !== null}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Actualizar
                    </Button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="messenger-app-id">Meta App ID</Label>
                        <Input id="messenger-app-id" value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="Identificador numerico" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="messenger-app-secret">Meta App Secret</Label>
                        <Input
                            id="messenger-app-secret"
                            type="password"
                            value={appSecret}
                            onChange={(event) => setAppSecret(event.target.value)}
                            placeholder={status?.appSecretConfigured ? "Guardado; deja vacio para conservar" : "App Secret"}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="messenger-version">Graph API</Label>
                        <Input id="messenger-version" value={graphApiVersion} onChange={(event) => setGraphApiVersion(event.target.value)} placeholder="v23.0" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="messenger-base-url">URL publica del CRM</Label>
                        <Input
                            id="messenger-base-url"
                            value={webhookBaseUrl}
                            onChange={(event) => setWebhookBaseUrl(event.target.value)}
                            placeholder="https://crm.ejemplo.com"
                        />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="messenger-verify-token">Token de verificacion del webhook</Label>
                        <Input
                            id="messenger-verify-token"
                            type="password"
                            value={webhookVerifyToken}
                            onChange={(event) => setWebhookVerifyToken(event.target.value)}
                            placeholder={status?.webhookVerifyTokenConfigured ? "Guardado; deja vacio para conservar" : "Token secreto compartido con Meta"}
                        />
                    </div>
                </div>

                {status?.callbackUrl ? (
                    <div className="mt-4 flex flex-col gap-2 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Callback URL</p>
                            <p className="truncate text-sm">{status.callbackUrl}</p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={copyCallback}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copiar
                        </Button>
                    </div>
                ) : null}

                {pages.length > 0 ? (
                    <div className="mt-4 rounded-xl border bg-background p-4">
                        <Label htmlFor="messenger-page">Selecciona la Pagina</Label>
                        <select
                            id="messenger-page"
                            value={selectedPageId}
                            onChange={(event) => setSelectedPageId(event.target.value)}
                            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {pages.map((page) => (
                                <option key={page.id} value={page.id}>{page.name} ({page.id})</option>
                            ))}
                        </select>
                        <Button type="button" className="mt-3 w-full sm:w-auto" onClick={connectPage} disabled={!selectedPageId || busy !== null}>
                            {busy === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                            Conectar y suscribir
                        </Button>
                    </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button type="button" variant="outline" onClick={() => void saveConfiguration().catch((error) => {
                        toast({
                            title: "No se pudo guardar",
                            description: error instanceof Error ? error.message : "Error inesperado.",
                            variant: "destructive",
                        });
                    })} disabled={busy !== null}>
                        {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Guardar configuracion
                    </Button>
                </div>
            </div>
        </section>
    );
}
