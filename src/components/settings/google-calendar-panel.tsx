"use client";

import { useEffect, useState } from "react";
import { CalendarSync, CheckCircle2, Link2, Loader2, RefreshCw, Save, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

type Props = {
    googleClientId: string;
    googleClientSecret: string;
    googleCalendarId: string;
    onChange: (
        field: "googleClientId" | "googleClientSecret" | "googleCalendarId",
        value: string,
    ) => void;
    onSave: () => Promise<boolean>;
    isSaving: boolean;
};

type GoogleCalendarStatus = {
    configured: boolean;
    connected: boolean;
    connectedEmail?: string | null;
    calendarId?: string | null;
    lastSyncedAt?: string | null;
    redirectUri?: string;
    sync?: {
        synced: boolean;
        imported: number;
    };
};

export function GoogleCalendarPanel(props: Props) {
    const { toast } = useToast();
    const [status, setStatus] = useState<GoogleCalendarStatus>({
        configured: false,
        connected: false,
    });
    const [isWorking, setIsWorking] = useState(false);
    const [redirectUri, setRedirectUri] = useState("https://tu-dominio/api/google-calendar/callback");

    const loadStatus = async () => {
        try {
            const response = await fetch("/api/google-calendar/status", { cache: "no-store" });
            if (!response.ok) throw new Error("No se pudo consultar el estado.");
            const payload = (await response.json()) as GoogleCalendarStatus;
            setStatus(payload);
            if (payload.redirectUri) {
                setRedirectUri(payload.redirectUri);
            }
        } catch (error) {
            toast({
                title: "No se pudo cargar Google Calendar",
                description: error instanceof Error ? error.message : "Fallo al consultar el estado.",
                variant: "destructive",
            });
        }
    };

    useEffect(() => {
        loadStatus();
    }, []);

    const handleConnect = async () => {
        setIsWorking(true);
        try {
            const saved = await props.onSave();
            if (!saved) return;
            window.location.href = "/api/google-calendar/auth";
        } finally {
            setIsWorking(false);
        }
    };

    const handleSync = async () => {
        setIsWorking(true);
        try {
            const response = await fetch("/api/google-calendar/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "sync" }),
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || "No se pudo sincronizar.");
            }
            setStatus(payload);
            toast({
                title: "Sincronizacion completada",
                description: `Google Calendar importo ${payload.sync?.imported || 0} cambios.`,
            });
        } catch (error) {
            toast({
                title: "Error al sincronizar",
                description: error instanceof Error ? error.message : "Fallo la sincronizacion.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    const handleDisconnect = async () => {
        setIsWorking(true);
        try {
            const response = await fetch("/api/google-calendar/status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "disconnect" }),
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || "No se pudo desconectar.");
            }
            setStatus(payload);
            toast({
                title: "Google Calendar desconectado",
                description: "La cuenta quedo desvinculada del CRM.",
            });
        } catch (error) {
            toast({
                title: "Error al desconectar",
                description: error instanceof Error ? error.message : "No se pudo desconectar.",
                variant: "destructive",
            });
        } finally {
            setIsWorking(false);
        }
    };

    return (
        <div className="space-y-5">
            <div>
                <h3 className="font-semibold text-base text-foreground">Google Calendar</h3>
                <p className="text-sm text-muted-foreground">
                    Conecta una cuenta de Google para que las citas del CRM se reflejen en Google Calendar y los cambios de Google se importen al CRM.
                </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Google Client ID</Label>
                        <Input
                            value={props.googleClientId}
                            onChange={(event) => props.onChange("googleClientId", event.target.value)}
                            placeholder="Client ID del OAuth Web Application"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Google Client Secret</Label>
                        <Input
                            type="password"
                            value={props.googleClientSecret}
                            onChange={(event) => props.onChange("googleClientSecret", event.target.value)}
                            placeholder="Client Secret de Google"
                        />
                        <p className="text-xs text-muted-foreground">
                            En Google Cloud configura un OAuth Web Application y agrega como redirect URI:
                            <br />
                            <span className="font-mono break-all">{redirectUri}</span>
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label>Calendar ID</Label>
                        <Input
                            value={props.googleCalendarId}
                            onChange={(event) => props.onChange("googleCalendarId", event.target.value)}
                            placeholder="primary"
                        />
                        <p className="text-xs text-muted-foreground">
                            Usa `primary` o el ID exacto del calendario de Google que quieres sincronizar. No pongas el nombre visible del calendario.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Si solo quieres conectar rapido, deja este campo en <span className="font-mono">primary</span>.
                        </p>
                    </div>

                    <div className="rounded-xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                        Al conectar, Google ya debe mostrarte el selector de cuentas. Si aun bloquea el acceso, revisa que la cuenta elegida este autorizada en tu pantalla de consentimiento de Google y que la redirect URI coincida exactamente con la de arriba.
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button onClick={props.onSave} disabled={props.isSaving || isWorking} variant="outline">
                            {props.isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Guardar
                        </Button>
                        <Button onClick={handleConnect} disabled={props.isSaving || isWorking}>
                            {isWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                            Conectar Google
                        </Button>
                        <Button onClick={handleSync} disabled={props.isSaving || isWorking} variant="secondary">
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Sincronizar ahora
                        </Button>
                        <Button onClick={handleDisconnect} disabled={props.isSaving || isWorking} variant="ghost" className="text-destructive hover:text-destructive">
                            <Unlink className="mr-2 h-4 w-4" />
                            Desconectar
                        </Button>
                    </div>
                </div>

                <Card className="border-primary/20">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CalendarSync className="h-5 w-5 text-primary" />
                            Estado de la sincronizacion
                        </CardTitle>
                        <CardDescription>
                            Aqui veras la cuenta conectada y el ultimo jalado de eventos desde Google Calendar.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                            <div>
                                <p className="text-sm font-medium">Conexion</p>
                                <p className="text-xs text-muted-foreground">
                                    {status.connected ? "Activa" : status.configured ? "Lista para conectar" : "Faltan credenciales"}
                                </p>
                            </div>
                            {status.connected ? (
                                <div className="inline-flex items-center gap-2 text-emerald-600 text-sm font-medium">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Conectado
                                </div>
                            ) : null}
                        </div>

                        <div className="rounded-xl border bg-muted/30 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Cuenta enlazada</p>
                            <p className="text-sm font-medium break-all">{status.connectedEmail || "Todavia no hay una cuenta conectada."}</p>
                        </div>

                        <div className="rounded-xl border bg-muted/30 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Calendar ID activo</p>
                            <p className="text-sm font-medium break-all">{status.calendarId || "primary"}</p>
                        </div>

                        <div className="rounded-xl border bg-muted/30 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Ultima sincronizacion</p>
                            <p className="text-sm font-medium">
                                {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("es-MX") : "Aun no se ha sincronizado"}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
