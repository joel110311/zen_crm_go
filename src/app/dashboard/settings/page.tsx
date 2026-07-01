"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    CalendarDays,
    Check,
    Bot,
    Loader2,
    MessageSquare,
    Palette,
    Pencil,
    Play,
    Plus,
    Save,
    Settings,
    Trash2,
    Users,
    Volume2,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/components/ui/use-toast";
import {
    getNotificationPrefs,
    NOTIFICATION_SOUNDS,
    playNotificationSound,
    saveNotificationPrefs,
    type NotificationPrefs,
} from "@/lib/notificationSounds";
import { createUser, deleteUser, getUsers, updateUser } from "@/app/actions/users";
import { MetaWhatsAppPanel } from "@/components/settings/meta-whatsapp-panel";
import { WhatsAppGatewayPanel } from "@/components/settings/whatsapp-gateway-panel";
import { GoogleCalendarPanel } from "@/components/settings/google-calendar-panel";
import { Slider } from "@/components/ui/slider";

type SectionId = "theme" | "users" | "ai" | "whatsapp" | "calendar" | "chats";

type UserRow = {
    id: string;
    name: string | null;
    email: string;
    role: string;
};

const SECTIONS: Array<{
    id: SectionId;
    label: string;
    description: string;
    icon: typeof Palette;
    superadminOnly?: boolean;
}> = [
    { id: "theme", label: "Apariencia", description: "Tema y estilo general del CRM", icon: Palette },
    { id: "users", label: "Usuarios", description: "Accesos, roles y permisos", icon: Users, superadminOnly: true },
    { id: "ai", label: "Asistente IA", description: "Claves y servicios de inteligencia", icon: Bot, superadminOnly: true },
    { id: "whatsapp", label: "Canal WhatsApp", description: "Conexion oficial Meta y canal por QR", icon: MessageSquare, superadminOnly: true },
    { id: "calendar", label: "Google Calendar", description: "Conexion y calendarios de agenda", icon: CalendarDays, superadminOnly: true },
    { id: "chats", label: "Notificaciones", description: "Sonidos y preferencias del inbox", icon: Volume2 },
];

export default function SettingsPage() {
    const [activeSection, setActiveSection] = useState<SectionId>("theme");
    const [openaiKey, setOpenaiKey] = useState("");
    const [geminiKey, setGeminiKey] = useState("");
    const [whatsappBaseUrl, setWhatsappBaseUrl] = useState("");
    const [whatsappAdminToken, setWhatsappAdminToken] = useState("");
    const [whatsappUserToken, setWhatsappUserToken] = useState("");
    const [whatsappInstanceName, setWhatsappInstanceName] = useState("zen-crm");
    const [whatsappProxyEnabled, setWhatsappProxyEnabled] = useState(false);
    const [whatsappProxyUrl, setWhatsappProxyUrl] = useState("");
    const [whatsappMetaAppId, setWhatsappMetaAppId] = useState("");
    const [whatsappMetaAppSecret, setWhatsappMetaAppSecret] = useState("");
    const [whatsappEmbeddedSignupConfigId, setWhatsappEmbeddedSignupConfigId] = useState("");
    const [whatsappTechProviderSolutionId, setWhatsappTechProviderSolutionId] = useState("");
    const [whatsappGraphApiVersion, setWhatsappGraphApiVersion] = useState("v23.0");
    const [whatsappRegistrationPin, setWhatsappRegistrationPin] = useState("");
    const [whatsappWebhookVerifyToken, setWhatsappWebhookVerifyToken] = useState("");
    const [whatsappWebhookBaseUrl, setWhatsappWebhookBaseUrl] = useState("");
    const [googleClientId, setGoogleClientId] = useState("");
    const [googleClientSecret, setGoogleClientSecret] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [users, setUsers] = useState<UserRow[]>([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "ADMIN" as "ADMIN" | "SUPERADMIN" });
    const [editUser, setEditUser] = useState({ name: "", email: "", password: "", role: "ADMIN" as "ADMIN" | "SUPERADMIN" });
    const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
        enabled: true,
        soundType: "gentle",
        volume: 0.5,
    });
    const [savedNotifPrefs, setSavedNotifPrefs] = useState<NotificationPrefs>({
        enabled: true,
        soundType: "gentle",
        volume: 0.5,
    });
    const [isUserPending, startUserTransition] = useTransition();

    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { data: session, status } = useSession();
    const sessionUser = session?.user as { id?: string; role?: string } | undefined;
    const currentUserId = sessionUser?.id;
    const isSuperadmin = status !== "loading" && sessionUser?.role === "SUPERADMIN";

    useEffect(() => {
        const load = async () => {
            try {
                const response = await fetch("/api/settings", { cache: "no-store" });
                const settings = await response.json();
                if (!settings) return;
                setOpenaiKey(settings.openaiApiKey || "");
                setGeminiKey(settings.geminiApiKey || "");
                setWhatsappBaseUrl(settings.whatsappBaseUrl || "");
                setWhatsappAdminToken(settings.whatsappAdminToken || "");
                setWhatsappUserToken(settings.whatsappUserToken || "");
                setWhatsappInstanceName(settings.whatsappInstanceName || "zen-crm");
                setWhatsappProxyEnabled(Boolean(settings.whatsappProxyEnabled));
                setWhatsappProxyUrl(settings.whatsappProxyUrl || "");
                setWhatsappMetaAppId(settings.whatsappMetaAppId || "");
                setWhatsappMetaAppSecret(settings.whatsappMetaAppSecret || "");
                setWhatsappEmbeddedSignupConfigId(settings.whatsappEmbeddedSignupConfigId || "");
                setWhatsappTechProviderSolutionId(settings.whatsappTechProviderSolutionId || "");
                setWhatsappGraphApiVersion(settings.whatsappGraphApiVersion || "v23.0");
                setWhatsappRegistrationPin(settings.whatsappRegistrationPin || "");
                setWhatsappWebhookVerifyToken(settings.whatsappWebhookVerifyToken || "");
                setWhatsappWebhookBaseUrl(settings.whatsappWebhookBaseUrl || "");
                setGoogleClientId(settings.googleClientId || "");
                setGoogleClientSecret(settings.googleClientSecret || "");
            } catch (error) {
                console.error("Failed to load settings:", error);
            }
        };

        void load();
        const prefs = getNotificationPrefs();
        setNotifPrefs(prefs);
        setSavedNotifPrefs(prefs);
    }, []);

    useEffect(() => {
        const requestedSection = searchParams.get("section");
        if (requestedSection === "templates") {
            router.replace("/dashboard/templates");
            return;
        }

        if (requestedSection === "calendar") {
            setActiveSection("calendar");
        }

        const googleState = searchParams.get("google");
        if (googleState === "connected") {
            toast({
                title: "Google Calendar conectado",
                description: "La cuenta quedo enlazada y ya se hizo una primera sincronizacion.",
            });
        } else if (googleState === "error") {
            toast({
                title: "No se pudo conectar Google Calendar",
                description: searchParams.get("reason") || "La autorizacion fallo.",
                variant: "destructive",
            });
        }
    }, [router, searchParams, toast]);

    useEffect(() => {
        if (!isSuperadmin) return;

        startUserTransition(async () => {
            try {
                const data = await getUsers();
                setUsers(data as UserRow[]);
            } catch (error) {
                console.error("Failed to load users:", error);
            }
        });
    }, [isSuperadmin]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    openaiApiKey: openaiKey,
                    geminiApiKey: geminiKey,
                    whatsappBaseUrl,
                    whatsappAdminToken,
                    whatsappUserToken,
                    whatsappInstanceName,
                    whatsappProxyEnabled,
                    whatsappProxyUrl,
                    whatsappMetaAppId,
                    whatsappMetaAppSecret,
                    whatsappEmbeddedSignupConfigId,
                    whatsappTechProviderSolutionId,
                    whatsappGraphApiVersion,
                    whatsappRegistrationPin,
                    whatsappWebhookVerifyToken,
                    whatsappWebhookBaseUrl,
                    googleClientId,
                    googleClientSecret,
                }),
            });
            if (!response.ok) throw new Error("No se pudo guardar la configuracion");
            toast({ title: "Configuracion guardada" });
            return true;
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "Fallo al guardar",
                variant: "destructive",
            });
            return false;
        } finally {
            setIsSaving(false);
        }
    };

    const refreshUsers = () => {
        startUserTransition(async () => {
            const data = await getUsers();
            setUsers(data as UserRow[]);
        });
    };

    const hasNotifChanges =
        notifPrefs.enabled !== savedNotifPrefs.enabled ||
        notifPrefs.soundType !== savedNotifPrefs.soundType ||
        Math.abs(notifPrefs.volume - savedNotifPrefs.volume) > 0.001;

    const handleNotifSave = () => {
        saveNotificationPrefs(notifPrefs);
        setSavedNotifPrefs(notifPrefs);
        toast({
            title: "Preferencias guardadas",
            description: "Las notificaciones del inbox ya quedaron actualizadas.",
        });
    };

    const handleNotifReset = () => {
        setNotifPrefs(savedNotifPrefs);
    };

    const handleCreateUser = () => {
        if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password.trim()) return;
        startUserTransition(async () => {
            const result = await createUser({
                name: newUser.name.trim(),
                email: newUser.email.trim(),
                password: newUser.password,
                role: newUser.role,
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error, variant: "destructive" });
                return;
            }
            setNewUser({ name: "", email: "", password: "", role: "ADMIN" });
            setShowAddForm(false);
            refreshUsers();
            toast({ title: "Usuario creado" });
        });
    };

    const handleStartEdit = (user: UserRow) => {
        setEditingUserId(user.id);
        setEditUser({
            name: user.name || "",
            email: user.email,
            password: "",
            role: user.role as "ADMIN" | "SUPERADMIN",
        });
    };

    const handleUpdateUser = (userId: string) => {
        startUserTransition(async () => {
            const result = await updateUser(userId, {
                name: editUser.name.trim(),
                email: editUser.email.trim(),
                role: editUser.role,
                password: editUser.password || undefined,
            });
            if (!result.success) {
                toast({ title: "Error", description: result.error, variant: "destructive" });
                return;
            }
            setEditingUserId(null);
            setEditUser({ name: "", email: "", password: "", role: "ADMIN" });
            refreshUsers();
            toast({ title: "Usuario actualizado" });
        });
    };

    const handleDeleteUser = (userId: string, name: string | null) => {
        if (!confirm(`Eliminar a ${name || "este usuario"}?`)) return;
        startUserTransition(async () => {
            const result = await deleteUser(userId);
            if (!result.success) {
                toast({ title: "Error", description: result.error, variant: "destructive" });
                return;
            }
            refreshUsers();
            toast({ title: "Usuario eliminado" });
        });
    };

    const visibleSections = SECTIONS.filter((section) => !section.superadminOnly || isSuperadmin);

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold">
                    <Settings className="h-6 w-6 text-primary" />
                    Configuracion
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Ajusta la apariencia, los canales y las integraciones del CRM sin tocar la operacion diaria del equipo.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleSections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;
                    return (
                        <button
                            key={section.id}
                            onClick={() => setActiveSection(section.id)}
                            className={`min-w-0 rounded-2xl border px-4 py-4 text-left transition ${
                                isActive
                                    ? "border-primary bg-primary/5 shadow-sm"
                                    : "bg-card hover:border-primary/35 hover:bg-muted/20"
                            }`}
                        >
                            <div className="flex min-h-[112px] flex-col justify-between gap-4">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-medium">{section.label}</p>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                        {section.description}
                                    </p>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-2xl border bg-card p-4 sm:p-5 md:p-7">
                {activeSection === "theme" && (
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Palette className="h-4 w-4 text-primary" />
                                <h2 className="font-semibold">Modo de visualizacion</h2>
                            </div>
                            <ThemeToggle />
                        </div>
                    </div>
                )}

                {activeSection === "ai" && isSuperadmin && (
                    <div className="max-w-xl space-y-4">
                        <div>
                            <h2 className="font-semibold">Inteligencia artificial</h2>
                            <p className="text-sm text-muted-foreground">Credenciales para el cerebro del CRM.</p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="openai">OpenAI API key</Label>
                            <Input id="openai" type="password" value={openaiKey} onChange={(event) => setOpenaiKey(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="gemini">Gemini API key</Label>
                            <Input id="gemini" type="password" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} />
                        </div>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Guardar cambios
                        </Button>
                    </div>
                )}

                {activeSection === "whatsapp" && isSuperadmin && (
                    <div className="space-y-6">
                        <MetaWhatsAppPanel
                            whatsappBaseUrl={whatsappBaseUrl}
                            whatsappAdminToken={whatsappAdminToken}
                            whatsappUserToken={whatsappUserToken}
                            whatsappInstanceName={whatsappInstanceName}
                            whatsappMetaAppId={whatsappMetaAppId}
                            whatsappMetaAppSecret={whatsappMetaAppSecret}
                            whatsappEmbeddedSignupConfigId={whatsappEmbeddedSignupConfigId}
                            whatsappTechProviderSolutionId={whatsappTechProviderSolutionId}
                            whatsappGraphApiVersion={whatsappGraphApiVersion}
                            whatsappRegistrationPin={whatsappRegistrationPin}
                            whatsappWebhookVerifyToken={whatsappWebhookVerifyToken}
                            whatsappWebhookBaseUrl={whatsappWebhookBaseUrl}
                            whatsappProxyEnabled={whatsappProxyEnabled}
                            whatsappProxyUrl={whatsappProxyUrl}
                            onChange={(field, value) => {
                                if (field === "whatsappBaseUrl") setWhatsappBaseUrl(value);
                                if (field === "whatsappAdminToken") setWhatsappAdminToken(value);
                                if (field === "whatsappUserToken") setWhatsappUserToken(value);
                                if (field === "whatsappInstanceName") setWhatsappInstanceName(value);
                                if (field === "whatsappMetaAppId") setWhatsappMetaAppId(value);
                                if (field === "whatsappMetaAppSecret") setWhatsappMetaAppSecret(value);
                                if (field === "whatsappEmbeddedSignupConfigId") setWhatsappEmbeddedSignupConfigId(value);
                                if (field === "whatsappTechProviderSolutionId") setWhatsappTechProviderSolutionId(value);
                                if (field === "whatsappGraphApiVersion") setWhatsappGraphApiVersion(value);
                                if (field === "whatsappRegistrationPin") setWhatsappRegistrationPin(value);
                                if (field === "whatsappWebhookVerifyToken") setWhatsappWebhookVerifyToken(value);
                                if (field === "whatsappWebhookBaseUrl") setWhatsappWebhookBaseUrl(value);
                                if (field === "whatsappProxyUrl") setWhatsappProxyUrl(value);
                            }}
                            onProxyEnabledChange={setWhatsappProxyEnabled}
                            onSave={handleSave}
                            isSaving={isSaving}
                        />

                        <WhatsAppGatewayPanel
                            whatsappBaseUrl={whatsappBaseUrl}
                            whatsappAdminToken={whatsappAdminToken}
                            whatsappUserToken={whatsappUserToken}
                            whatsappInstanceName={whatsappInstanceName}
                            whatsappProxyEnabled={whatsappProxyEnabled}
                            whatsappProxyUrl={whatsappProxyUrl}
                            onChange={(field, value) => {
                                if (field === "whatsappBaseUrl") setWhatsappBaseUrl(value);
                                if (field === "whatsappAdminToken") setWhatsappAdminToken(value);
                                if (field === "whatsappUserToken") setWhatsappUserToken(value);
                                if (field === "whatsappInstanceName") setWhatsappInstanceName(value);
                                if (field === "whatsappProxyUrl") setWhatsappProxyUrl(value);
                            }}
                            onProxyEnabledChange={setWhatsappProxyEnabled}
                            onSave={handleSave}
                            isSaving={isSaving}
                        />
                    </div>
                )}

                {activeSection === "calendar" && isSuperadmin && (
                    <GoogleCalendarPanel
                        googleClientId={googleClientId}
                        googleClientSecret={googleClientSecret}
                        onChange={(field, value) => {
                            if (field === "googleClientId") setGoogleClientId(value);
                            if (field === "googleClientSecret") setGoogleClientSecret(value);
                        }}
                        onSave={handleSave}
                        isSaving={isSaving}
                    />
                )}

                {activeSection === "users" && isSuperadmin && (
                    <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="font-semibold">Usuarios</h2>
                                <p className="text-sm text-muted-foreground">{users.length} registrados</p>
                            </div>
                            <Button variant="outline" onClick={() => setShowAddForm((current) => !current)} className="w-full sm:w-auto">
                                {showAddForm ? <X className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                                {showAddForm ? "Cancelar" : "Agregar"}
                            </Button>
                        </div>

                        {showAddForm && (
                            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 md:grid-cols-2">
                                <Input placeholder="Nombre" value={newUser.name} onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))} />
                                <Input placeholder="Email" type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} />
                                <Input placeholder="Contrasena" type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} />
                                <select
                                    value={newUser.role}
                                    onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as "ADMIN" | "SUPERADMIN" }))}
                                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    <option value="ADMIN">Operador</option>
                                    <option value="SUPERADMIN">Super Admin</option>
                                </select>
                                <div className="md:col-span-2">
                                    <Button onClick={handleCreateUser} disabled={isUserPending} className="w-full sm:w-auto">
                                        {isUserPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                        Crear usuario
                                    </Button>
                                </div>
                            </div>
                        )}

                        <div className="space-y-3">
                            {users.map((user) => {
                                const isEditing = editingUserId === user.id;
                                return (
                                    <div key={user.id} className="rounded-xl border p-4">
                                        {isEditing ? (
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <Input value={editUser.name} onChange={(event) => setEditUser((current) => ({ ...current, name: event.target.value }))} />
                                                <Input type="email" value={editUser.email} onChange={(event) => setEditUser((current) => ({ ...current, email: event.target.value }))} />
                                                <Input type="password" placeholder="Nueva contrasena" value={editUser.password} onChange={(event) => setEditUser((current) => ({ ...current, password: event.target.value }))} />
                                                <select
                                                    value={editUser.role}
                                                    onChange={(event) => setEditUser((current) => ({ ...current, role: event.target.value as "ADMIN" | "SUPERADMIN" }))}
                                                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                                >
                                                    <option value="ADMIN">Operador</option>
                                                    <option value="SUPERADMIN">Super Admin</option>
                                                </select>
                                                <div className="flex flex-col gap-2 md:col-span-2 sm:flex-row">
                                                    <Button onClick={() => handleUpdateUser(user.id)} disabled={isUserPending} className="w-full sm:w-auto">
                                                        {isUserPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                                        Guardar
                                                    </Button>
                                                    <Button variant="ghost" onClick={() => setEditingUserId(null)} className="w-full sm:w-auto">Cancelar</Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                <div>
                                                    <p className="font-medium">
                                                        {user.name || user.email}
                                                        {user.id === currentUserId ? <span className="ml-2 text-xs text-muted-foreground">(Tu)</span> : null}
                                                    </p>
                                                    <p className="text-sm text-muted-foreground">{user.email}</p>
                                                    <p className="text-xs text-muted-foreground">{user.role}</p>
                                                </div>
                                                <div className="flex flex-col gap-2 sm:flex-row">
                                                    <Button variant="outline" size="sm" onClick={() => handleStartEdit(user)} className="w-full sm:w-auto">
                                                        <Pencil className="mr-2 h-4 w-4" />
                                                        Editar
                                                    </Button>
                                                    {user.id !== currentUserId ? (
                                                        <Button variant="ghost" size="sm" className="w-full text-destructive sm:w-auto" onClick={() => handleDeleteUser(user.id, user.name)}>
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Eliminar
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeSection === "chats" && (
                    <div className="max-w-3xl space-y-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 className="font-semibold">Notificaciones</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Define el sonido del inbox y aplica los cambios cuando estes conforme.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    onClick={handleNotifReset}
                                    disabled={!hasNotifChanges}
                                >
                                    Cancelar cambios
                                </Button>
                                <Button
                                    onClick={handleNotifSave}
                                    disabled={!hasNotifChanges}
                                >
                                    <Save className="mr-2 h-4 w-4" />
                                    Guardar preferencias
                                </Button>
                            </div>
                        </div>

                        <div className="rounded-2xl border bg-muted/15 p-5">
                            <div className="flex flex-col gap-4">
                                <div className="flex flex-col gap-3 rounded-xl border bg-background/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="pr-4">
                                        <Label htmlFor="notif-toggle" className="text-base">Activar notificaciones</Label>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Reproduce un sonido cuando entra un mensaje nuevo en el inbox.
                                        </p>
                                    </div>
                                    <Switch
                                        id="notif-toggle"
                                        checked={notifPrefs.enabled}
                                        onCheckedChange={(checked) =>
                                            setNotifPrefs((current) => ({ ...current, enabled: checked }))
                                        }
                                    />
                                </div>

                                {notifPrefs.enabled ? (
                                    <>
                                        <div className="space-y-2">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <p className="font-medium">Sonido</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        Elige el tono que mejor encaje con tu forma de trabajo.
                                                    </p>
                                                </div>
                                                <span className="text-xs text-muted-foreground">
                                                    Vista previa disponible
                                                </span>
                                            </div>

                                            {NOTIFICATION_SOUNDS.map((sound) => (
                                                <button
                                                    key={sound.id}
                                                    onClick={() =>
                                                        setNotifPrefs((current) => ({ ...current, soundType: sound.id }))
                                                    }
                                                    className={`flex w-full items-center justify-between gap-4 rounded-xl border px-4 py-4 text-left transition ${
                                                        notifPrefs.soundType === sound.id
                                                            ? "border-primary bg-primary/5"
                                                            : "bg-background/80 hover:border-primary/30"
                                                    }`}
                                                >
                                                    <div className="min-w-0 pr-4">
                                                        <p className="font-medium">{sound.name}</p>
                                                        <p className="mt-1 text-sm text-muted-foreground">
                                                            {sound.description}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            playNotificationSound(sound.id, notifPrefs.volume);
                                                        }}
                                                        title={`Probar sonido ${sound.name}`}
                                                    >
                                                        <Play className="h-4 w-4" />
                                                    </Button>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="space-y-3 rounded-xl border bg-background/80 px-4 py-4">
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <Label>Volumen</Label>
                                                    <p className="mt-1 text-sm text-muted-foreground">
                                                        Ajusta la intensidad antes de guardar.
                                                    </p>
                                                </div>
                                                <span className="text-sm font-medium text-muted-foreground">
                                                    {Math.round(notifPrefs.volume * 100)}%
                                                </span>
                                            </div>
                                            <Slider
                                                min={0}
                                                max={100}
                                                step={1}
                                                value={[Math.round(notifPrefs.volume * 100)]}
                                                onValueChange={([value]) =>
                                                    setNotifPrefs((current) => ({ ...current, volume: value / 100 }))
                                                }
                                            />
                                            <div className="flex justify-end">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => playNotificationSound(notifPrefs.soundType, notifPrefs.volume)}
                                                >
                                                    <Play className="mr-2 h-4 w-4" />
                                                    Probar volumen
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="rounded-xl border border-dashed bg-background/70 px-4 py-5 text-sm text-muted-foreground">
                                        Las notificaciones estan desactivadas. Si las vuelves a activar, podras elegir tono y volumen antes de guardar.
                                    </div>
                                )}

                                <p className="text-xs text-muted-foreground">
                                    Los cambios de esta seccion no se aplican hasta pulsar <span className="font-medium text-foreground">Guardar preferencias</span>.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
