"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    CalendarDays,
    Check,
    Loader2,
    MessageSquare,
    Palette,
    Pencil,
    Play,
    Plus,
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
import { ThemeCustomizer } from "@/components/theme-customizer";
import { useToast } from "@/components/ui/use-toast";
import {
    getNotificationPrefs,
    NOTIFICATION_SOUNDS,
    playNotificationSound,
    saveNotificationPrefs,
    type NotificationPrefs,
} from "@/lib/notificationSounds";
import { createUser, deleteUser, getUsers, updateUser } from "@/app/actions/users";
import { WhatsAppGatewayPanel } from "@/components/settings/whatsapp-gateway-panel";
import { GoogleCalendarPanel } from "@/components/settings/google-calendar-panel";

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
    { id: "theme", label: "Diseno", description: "Tema y colores", icon: Palette },
    { id: "users", label: "Usuarios", description: "Accesos y roles", icon: Users, superadminOnly: true },
    { id: "ai", label: "IA", description: "API keys", icon: Settings, superadminOnly: true },
    { id: "whatsapp", label: "WhatsApp", description: "QR con librerias Go", icon: MessageSquare, superadminOnly: true },
    { id: "calendar", label: "Calendario", description: "Google Calendar", icon: CalendarDays, superadminOnly: true },
    { id: "chats", label: "Notificaciones", description: "Sonidos", icon: Volume2 },
];

export default function SettingsPage() {
    const [activeSection, setActiveSection] = useState<SectionId>("theme");
    const [openaiKey, setOpenaiKey] = useState("");
    const [geminiKey, setGeminiKey] = useState("");
    const [whatsappBaseUrl, setWhatsappBaseUrl] = useState("");
    const [whatsappAdminToken, setWhatsappAdminToken] = useState("");
    const [whatsappUserToken, setWhatsappUserToken] = useState("");
    const [whatsappInstanceName, setWhatsappInstanceName] = useState("zen-crm");
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
                setGoogleClientId(settings.googleClientId || "");
                setGoogleClientSecret(settings.googleClientSecret || "");
            } catch (error) {
                console.error("Failed to load settings:", error);
            }
        };

        void load();
        setNotifPrefs(getNotificationPrefs());
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
        <div className="mx-auto max-w-5xl space-y-6">
            <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold">
                    <Settings className="h-6 w-6 text-primary" />
                    Configuracion
                </h1>
                <p className="text-sm text-muted-foreground">Panel del sistema, IA, usuarios y canal de WhatsApp QR.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {visibleSections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;
                    return (
                        <button
                            key={section.id}
                            onClick={() => setActiveSection(section.id)}
                            className={`rounded-xl border p-4 text-left transition ${
                                isActive ? "border-primary bg-primary/5" : "bg-card hover:border-primary/40"
                            }`}
                        >
                            <Icon className="mb-3 h-5 w-5 text-primary" />
                            <p className="font-medium">{section.label}</p>
                            <p className="text-xs text-muted-foreground">{section.description}</p>
                        </button>
                    );
                })}
            </div>

            <div className="rounded-2xl border bg-card p-6">
                {activeSection === "theme" && (
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Palette className="h-4 w-4 text-primary" />
                                <h2 className="font-semibold">Modo de visualizacion</h2>
                            </div>
                            <ThemeToggle />
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Palette className="h-4 w-4 text-primary" />
                                <h2 className="font-semibold">Tema de colores</h2>
                            </div>
                            <ThemeCustomizer />
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
                    <WhatsAppGatewayPanel
                        whatsappBaseUrl={whatsappBaseUrl}
                        whatsappAdminToken={whatsappAdminToken}
                        whatsappUserToken={whatsappUserToken}
                        whatsappInstanceName={whatsappInstanceName}
                        onChange={(field, value) => {
                            if (field === "whatsappBaseUrl") setWhatsappBaseUrl(value);
                            if (field === "whatsappAdminToken") setWhatsappAdminToken(value);
                            if (field === "whatsappUserToken") setWhatsappUserToken(value);
                            if (field === "whatsappInstanceName") setWhatsappInstanceName(value);
                        }}
                        onSave={handleSave}
                        isSaving={isSaving}
                    />
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
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="font-semibold">Usuarios</h2>
                                <p className="text-sm text-muted-foreground">{users.length} registrados</p>
                            </div>
                            <Button variant="outline" onClick={() => setShowAddForm((current) => !current)}>
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
                                    <Button onClick={handleCreateUser} disabled={isUserPending}>
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
                                                <div className="flex gap-2 md:col-span-2">
                                                    <Button onClick={() => handleUpdateUser(user.id)} disabled={isUserPending}>
                                                        {isUserPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                                        Guardar
                                                    </Button>
                                                    <Button variant="ghost" onClick={() => setEditingUserId(null)}>Cancelar</Button>
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
                                                <div className="flex gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => handleStartEdit(user)}>
                                                        <Pencil className="mr-2 h-4 w-4" />
                                                        Editar
                                                    </Button>
                                                    {user.id !== currentUserId ? (
                                                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteUser(user.id, user.name)}>
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
                    <div className="max-w-2xl space-y-5">
                        <div>
                            <h2 className="font-semibold">Notificaciones</h2>
                            <p className="text-sm text-muted-foreground">Sonidos para nuevos mensajes.</p>
                        </div>
                        <div className="flex items-center justify-between rounded-xl border p-4">
                            <div>
                                <Label htmlFor="notif-toggle" className="text-base">Activar notificaciones</Label>
                                <p className="text-sm text-muted-foreground">Reproduce un sonido al llegar mensajes.</p>
                            </div>
                            <Switch
                                id="notif-toggle"
                                checked={notifPrefs.enabled}
                                onCheckedChange={(checked) => {
                                    const updated = { ...notifPrefs, enabled: checked };
                                    setNotifPrefs(updated);
                                    saveNotificationPrefs(updated);
                                }}
                            />
                        </div>
                        {notifPrefs.enabled ? (
                            <>
                                <div className="space-y-2">
                                    {NOTIFICATION_SOUNDS.map((sound) => (
                                        <button
                                            key={sound.id}
                                            onClick={() => {
                                                const updated = { ...notifPrefs, soundType: sound.id };
                                                setNotifPrefs(updated);
                                                saveNotificationPrefs(updated);
                                            }}
                                            className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${
                                                notifPrefs.soundType === sound.id ? "border-primary bg-primary/5" : ""
                                            }`}
                                        >
                                            <div>
                                                <p className="font-medium">{sound.name}</p>
                                                <p className="text-xs text-muted-foreground">{sound.description}</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    playNotificationSound(sound.id, notifPrefs.volume);
                                                }}
                                            >
                                                <Play className="h-4 w-4" />
                                            </Button>
                                        </button>
                                    ))}
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Volumen</Label>
                                        <span className="text-sm text-muted-foreground">{Math.round(notifPrefs.volume * 100)}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={Math.round(notifPrefs.volume * 100)}
                                        onChange={(event) => {
                                            const updated = { ...notifPrefs, volume: Number(event.target.value) / 100 };
                                            setNotifPrefs(updated);
                                            saveNotificationPrefs(updated);
                                        }}
                                        onMouseUp={() => playNotificationSound(notifPrefs.soundType, notifPrefs.volume)}
                                        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                                    />
                                </div>
                            </>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
