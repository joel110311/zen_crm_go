"use client";

import { useState, useEffect, useTransition } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Volume2, Play, MessageSquare, Users, Plus, Trash2, X, ShieldCheck, Shield, Info, Pencil, Check } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import {
    getNotificationPrefs, saveNotificationPrefs,
    NOTIFICATION_SOUNDS, playNotificationSound,
    type NotificationPrefs, type NotificationSoundType
} from "@/lib/notificationSounds";
import { getUsers, createUser, updateUser, deleteUser } from "@/app/actions/users";

import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeCustomizer } from "@/components/theme-customizer";
import { Palette } from "lucide-react";

type UserRow = {
    id: string;
    name: string | null;
    email: string;
    role: string;
    createdAt: Date;
};

export default function SettingsPage() {
    const [openaiKey, setOpenaiKey] = useState("");
    const [geminiKey, setGeminiKey] = useState("");
    const [ycloudApiKey, setYcloudApiKey] = useState("");
    const [ycloudPhoneId, setYcloudPhoneId] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const userRole = (session?.user as any)?.role;
    const currentUserId = (session?.user as any)?.id;
    const isSuperadmin = status !== "loading" && userRole === "SUPERADMIN";

    // Chat notification preferences
    const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
        enabled: true, soundType: "gentle", volume: 0.5
    });

    // User management state
    const [users, setUsers] = useState<UserRow[]>([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [newRole, setNewRole] = useState<"ADMIN" | "SUPERADMIN">("ADMIN");
    const [isUserPending, startUserTransition] = useTransition();

    // Editing state
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editEmail, setEditEmail] = useState("");
    const [editRole, setEditRole] = useState<"ADMIN" | "SUPERADMIN">("ADMIN");
    const [editPassword, setEditPassword] = useState("");

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const response = await fetch("/api/settings");
                const settings = await response.json();
                if (settings) {
                    setOpenaiKey(settings.openaiApiKey || "");
                    setGeminiKey(settings.geminiApiKey || "");
                    setYcloudApiKey(settings.ycloudApiKey || "");
                    setYcloudPhoneId(settings.ycloudPhoneId || "");
                }
            } catch (error) {
                console.error("Failed to load settings:", error);
            }
        };
        loadSettings();
        setNotifPrefs(getNotificationPrefs());
    }, []);

    // Load users when superadmin
    useEffect(() => {
        if (isSuperadmin) {
            startUserTransition(async () => {
                try {
                    const data = await getUsers();
                    setUsers(data as UserRow[]);
                } catch { }
            });
        }
    }, [isSuperadmin]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const response = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ openaiApiKey: openaiKey, geminiApiKey: geminiKey, ycloudApiKey, ycloudPhoneId }),
            });
            if (!response.ok) throw new Error("Failed to save");
            toast({ title: "Configuración guardada", description: "Las claves de API han sido actualizadas." });
        } catch {
            toast({ title: "Error", description: "No se pudo guardar la configuración.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateUser = () => {
        if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) return;
        startUserTransition(async () => {
            const result = await createUser({ name: newName.trim(), email: newEmail.trim(), password: newPassword, role: newRole });
            if (result.success && result.user) {
                setUsers(prev => [...prev, result.user as UserRow]);
                setShowAddForm(false);
                setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("ADMIN");
                toast({ title: "Usuario creado", description: `${result.user.name} ha sido agregado.` });
            } else {
                toast({ title: "Error", description: result.error || "No se pudo crear el usuario.", variant: "destructive" });
            }
        });
    };

    const startEditUser = (user: UserRow) => {
        setEditingUserId(user.id);
        setEditName(user.name || "");
        setEditEmail(user.email);
        setEditRole(user.role as "ADMIN" | "SUPERADMIN");
        setEditPassword("");
    };

    const cancelEdit = () => {
        setEditingUserId(null);
        setEditPassword("");
    };

    const handleUpdateUser = (userId: string) => {
        startUserTransition(async () => {
            const result = await updateUser(userId, {
                name: editName.trim(),
                email: editEmail.trim(),
                role: editRole,
                password: editPassword || undefined,
            });
            if (result.success && result.user) {
                setUsers(prev => prev.map(u => u.id === userId ? result.user as UserRow : u));
                setEditingUserId(null);
                setEditPassword("");
                toast({ title: "Usuario actualizado" });
            } else {
                toast({ title: "Error", description: result.error || "No se pudo actualizar.", variant: "destructive" });
            }
        });
    };

    const handleDeleteUser = (userId: string, userName: string | null) => {
        if (!confirm(`¿Eliminar a ${userName || "este usuario"}? Esta acción no se puede deshacer.`)) return;
        startUserTransition(async () => {
            const result = await deleteUser(userId);
            if (result.success) {
                setUsers(prev => prev.filter(u => u.id !== userId));
                toast({ title: "Usuario eliminado" });
            } else {
                toast({ title: "Error", description: result.error || "No se pudo eliminar.", variant: "destructive" });
            }
        });
    };

    // ═══════ Shared tab trigger class ═══════
    const tabTriggerBase = `
        data-[state=active]:bg-card data-[state=active]:border-primary data-[state=active]:shadow-lg
        border border-border bg-card/60 hover:bg-card
        h-auto py-3 px-4 min-w-[100px]
        flex flex-col items-center gap-1.5 rounded-xl transition-all duration-200 group
        text-center whitespace-nowrap flex-shrink-0
    `;

    return (
        <div className="flex flex-col gap-6 max-w-5xl">
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Configuración</h1>
                <p className="text-muted-foreground">Administra tus claves de API, integraciones y apariencia.</p>
            </div>

            <Tabs defaultValue="visual" className="space-y-6">
                {/* ═══════ Tab Navigation ═══════ */}
                <TabsList className="bg-transparent h-auto p-0 w-full overflow-x-auto flex gap-2 pb-1 scrollbar-hide">
                    <TabsTrigger value="visual" className={tabTriggerBase}>
                        <Palette className="h-5 w-5 text-primary" />
                        <span className="text-xs font-semibold text-foreground">Diseño</span>
                    </TabsTrigger>

                    {isSuperadmin && (
                        <TabsTrigger value="users" className={tabTriggerBase}>
                            <Users className="h-5 w-5 text-sky-400" />
                            <span className="text-xs font-semibold text-foreground">Usuarios</span>
                        </TabsTrigger>
                    )}

                    {isSuperadmin && (
                        <TabsTrigger value="ai" className={tabTriggerBase}>
                            <Loader2 className="h-5 w-5 text-indigo-500" />
                            <span className="text-xs font-semibold text-foreground">IA</span>
                        </TabsTrigger>
                    )}

                    {isSuperadmin && (
                        <TabsTrigger value="whatsapp" className={tabTriggerBase}>
                            <MessageSquare className="h-5 w-5 text-sky-400" />
                            <span className="text-xs font-semibold text-foreground">WhatsApp</span>
                        </TabsTrigger>
                    )}

                    <TabsTrigger value="chats" className={tabTriggerBase}>
                        <Volume2 className="h-5 w-5 text-orange-500" />
                        <span className="text-xs font-semibold text-foreground">Chats</span>
                    </TabsTrigger>
                </TabsList>

                {/* ═══════ Visual Tab ═══════ */}
                <TabsContent value="visual" className="space-y-6">
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-primary">
                            <Palette className="h-4 w-4" />
                            <h3 className="font-semibold text-lg text-foreground">Modo de Visualización</h3>
                        </div>
                        <Card className="border-none shadow-sm bg-card">
                            <CardContent className="pt-6"><ThemeToggle /></CardContent>
                        </Card>
                    </div>
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-primary">
                            <Palette className="h-4 w-4" />
                            <h3 className="font-semibold text-lg text-foreground">Tema de Colores</h3>
                        </div>
                        <Card className="border-none shadow-sm bg-card">
                            <CardContent className="pt-6"><ThemeCustomizer /></CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* ═══════ Users Tab (SuperAdmin) ═══════ */}
                {isSuperadmin && (
                    <TabsContent value="users">
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle>Gestión de Usuarios</CardTitle>
                                        <CardDescription>{users.length} usuario{users.length !== 1 ? "s" : ""} registrado{users.length !== 1 ? "s" : ""}</CardDescription>
                                    </div>
                                    <Button size="sm" onClick={() => { setShowAddForm(!showAddForm); cancelEdit(); }} className="gap-1.5">
                                        {showAddForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                        {showAddForm ? "Cancelar" : "Agregar"}
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Info banner */}
                                <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                                    <Info className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        Los usuarios nuevos podrán iniciar sesión inmediatamente con su contraseña.
                                        Haz clic en el icono de editar para modificar cualquier usuario.
                                    </p>
                                </div>

                                {/* Add user form */}
                                {showAddForm && (
                                    <div className="rounded-xl border border-primary/30 p-4 space-y-3 bg-primary/5">
                                        <h4 className="font-semibold text-sm text-foreground">Nuevo Usuario</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <Input placeholder="Nombre completo" value={newName} onChange={(e) => setNewName(e.target.value)} />
                                            <Input placeholder="Email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                                            <Input placeholder="Contraseña (mín. 6 car.)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                                            <div className="flex gap-2">
                                                <select
                                                    value={newRole}
                                                    onChange={(e) => setNewRole(e.target.value as "ADMIN" | "SUPERADMIN")}
                                                    className="h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground flex-1"
                                                >
                                                    <option value="ADMIN">Operador</option>
                                                    <option value="SUPERADMIN">Super Admin</option>
                                                </select>
                                                <Button onClick={handleCreateUser} disabled={isUserPending || !newName.trim() || !newEmail.trim() || !newPassword.trim()} size="sm" className="gap-1 px-4">
                                                    {isUserPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="h-3.5 w-3.5" /> Crear</>}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* User list */}
                                <div className="space-y-2">
                                    {users.map((user) => {
                                        const isYou = user.id === currentUserId;
                                        const displayName = user.name || user.email;
                                        const initials = displayName.charAt(0).toUpperCase();
                                        const isEditing = editingUserId === user.id;

                                        if (isEditing) {
                                            return (
                                                <div key={user.id} className="rounded-xl border-2 border-primary/40 p-4 space-y-3 bg-primary/5">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="text-sm font-semibold text-foreground">Editando usuario</h4>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                                                            <X className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Nombre</Label>
                                                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Email</Label>
                                                            <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Nueva contraseña (dejar vacío para no cambiar)</Label>
                                                            <Input type="password" placeholder="••••••" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Rol</Label>
                                                            <div className="flex gap-2">
                                                                <select
                                                                    value={editRole}
                                                                    onChange={(e) => setEditRole(e.target.value as "ADMIN" | "SUPERADMIN")}
                                                                    className="h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground flex-1"
                                                                >
                                                                    <option value="ADMIN">Operador</option>
                                                                    <option value="SUPERADMIN">Super Admin</option>
                                                                </select>
                                                                <Button onClick={() => handleUpdateUser(user.id)} disabled={isUserPending} size="sm" className="gap-1 px-4">
                                                                    {isUserPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="h-3.5 w-3.5" /> Guardar</>}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={user.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-secondary/50">
                                                <div className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold text-primary-foreground flex-shrink-0"
                                                    style={{ background: "linear-gradient(135deg, hsl(221 83% 53%), hsl(221 83% 40%))" }}>
                                                    {initials}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-foreground truncate">
                                                        {displayName}
                                                        {isYou && <span className="text-xs font-normal text-muted-foreground ml-1.5">(Tú)</span>}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground truncate">✉ {user.email}</p>
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${user.role === "SUPERADMIN"
                                                        ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                                        : "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                                                        }`}>
                                                        {user.role === "SUPERADMIN" ? <><ShieldCheck className="h-2.5 w-2.5" /> Super Admin</> : <><Shield className="h-2.5 w-2.5" /> Operador</>}
                                                    </span>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => startEditUser(user)} title="Editar">
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                    {!isYou && (
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteUser(user.id, user.name)} disabled={isUserPending} title="Eliminar">
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* ═══════ AI Tab (SuperAdmin) ═══════ */}
                {isSuperadmin && (
                    <TabsContent value="ai">
                        <Card>
                            <CardHeader>
                                <CardTitle>Inteligencia Artificial</CardTitle>
                                <CardDescription>Configura los proveedores de LLM para "El Cerebro".</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="openai">OpenAI API Key</Label>
                                    <Input id="openai" type="password" placeholder="sk-..." value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="gemini">Gemini API Key</Label>
                                    <Input id="gemini" type="password" placeholder="AIza..." value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} />
                                </div>
                            </CardContent>
                            <CardFooter>
                                <Button onClick={handleSave} disabled={isSaving}>
                                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Guardar Cambios
                                </Button>
                            </CardFooter>
                        </Card>
                    </TabsContent>
                )}

                {/* ═══════ WhatsApp Tab (SuperAdmin) ═══════ */}
                {isSuperadmin && (
                    <TabsContent value="whatsapp">
                        <Card>
                            <CardHeader>
                                <CardTitle>WhatsApp via YCloud</CardTitle>
                                <CardDescription>Conecta tu cuenta de YCloud para enviar y recibir mensajes de WhatsApp.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="ycloudKey">YCloud API Key</Label>
                                    <Input id="ycloudKey" type="password" placeholder="Tu API Key de YCloud..." value={ycloudApiKey} onChange={(e) => setYcloudApiKey(e.target.value)} />
                                    <p className="text-xs text-muted-foreground">Obtén tu API Key en el dashboard de YCloud → Developer → API Keys</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="ycloudPhone">YCloud Phone Number ID</Label>
                                    <Input id="ycloudPhone" placeholder="El ID de tu número de WhatsApp..." value={ycloudPhoneId} onChange={(e) => setYcloudPhoneId(e.target.value)} />
                                    <p className="text-xs text-muted-foreground">Se encuentra en YCloud Dashboard → WhatsApp → Phone Numbers</p>
                                </div>
                            </CardContent>
                            <CardFooter className="flex flex-col items-start gap-4">
                                <Button onClick={handleSave} disabled={isSaving}>
                                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Guardar Cambios
                                </Button>
                                <p className="text-xs text-muted-foreground">
                                    Recuerda configurar el Webhook URL en YCloud apuntando a: <code className="bg-muted px-1 py-0.5 rounded">/api/webhook</code>
                                </p>
                            </CardFooter>
                        </Card>
                    </TabsContent>
                )}

                {/* ═══════ Chats Tab ═══════ */}
                <TabsContent value="chats">
                    <Card>
                        <CardHeader>
                            <CardTitle>Notificaciones de Chat</CardTitle>
                            <CardDescription>Configura los sonidos y notificaciones para los mensajes entrantes.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                    <Label htmlFor="notif-toggle" className="text-base font-medium">Activar Notificaciones</Label>
                                    <p className="text-sm text-muted-foreground">Reproduce un sonido cuando llega un nuevo mensaje.</p>
                                </div>
                                <Switch
                                    id="notif-toggle"
                                    checked={notifPrefs.enabled}
                                    onCheckedChange={(checked) => {
                                        const updated = { ...notifPrefs, enabled: checked };
                                        setNotifPrefs(updated);
                                        saveNotificationPrefs(updated);
                                        toast({ title: checked ? "Notificaciones activadas" : "Notificaciones desactivadas" });
                                    }}
                                />
                            </div>

                            {notifPrefs.enabled && (
                                <>
                                    <div className="space-y-3">
                                        <Label className="text-base font-medium">Tono de notificación</Label>
                                        <div className="grid gap-2">
                                            {NOTIFICATION_SOUNDS.map((sound) => (
                                                <div
                                                    key={sound.id}
                                                    onClick={() => {
                                                        const updated = { ...notifPrefs, soundType: sound.id };
                                                        setNotifPrefs(updated);
                                                        saveNotificationPrefs(updated);
                                                    }}
                                                    className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${notifPrefs.soundType === sound.id ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${notifPrefs.soundType === sound.id ? "border-primary" : "border-muted-foreground/30"}`}>
                                                            {notifPrefs.soundType === sound.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-medium">{sound.name}</p>
                                                            <p className="text-xs text-muted-foreground">{sound.description}</p>
                                                        </div>
                                                    </div>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); playNotificationSound(sound.id, notifPrefs.volume); }} title={`Escuchar ${sound.name}`}>
                                                        <Play className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Volume2 className="h-4 w-4 text-muted-foreground" />
                                            <Label className="text-base font-medium">Volumen</Label>
                                            <span className="text-sm text-muted-foreground ml-auto">{Math.round(notifPrefs.volume * 100)}%</span>
                                        </div>
                                        <input
                                            type="range" min={0} max={100}
                                            value={Math.round(notifPrefs.volume * 100)}
                                            onChange={(e) => {
                                                const vol = parseInt(e.target.value) / 100;
                                                const updated = { ...notifPrefs, volume: vol };
                                                setNotifPrefs(updated);
                                                saveNotificationPrefs(updated);
                                            }}
                                            onMouseUp={() => playNotificationSound(notifPrefs.soundType, notifPrefs.volume)}
                                            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary bg-muted"
                                        />
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
