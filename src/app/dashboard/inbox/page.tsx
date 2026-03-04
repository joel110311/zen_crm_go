"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    Search, MoreVertical, Phone, Video, Paperclip, Send, Mic, X,
    FileText, Download, Square, Star, BellOff, Bell, Archive, Trash2,
    Info, Users, MessageSquare, ChevronRight, ChevronDown, Mail, Tag, Clock,
    Eraser, Image as ImageIcon, Play, Pause, Bot, User as UserIcon, LayoutTemplate
} from "lucide-react";
import { TemplateSendModal } from "@/components/inbox/template-send-modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { maybePlayNotification } from "@/lib/notificationSounds";
import { ImageViewer } from "@/components/inbox/image-viewer";

// ──────────── Types ────────────
export type Message = {
    id: string;
    content: string;
    senderId: string | null;
    direction: string;
    createdAt: Date;
    type: string;
    senderType?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    mediaFileName?: string | null;
};

export type Conversation = {
    id: string;
    contact: {
        id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        status: string | null;
    } | null;
    messages: Message[];
    updatedAt: Date;
    status: string;
    isMuted: boolean;
    isFavorite: boolean;
    isGroup: boolean;
    botActive: boolean;
    lastMessageType: string;
    sessionExpiresAt?: string | null;
};

// ──────────── Helpers ────────────
function formatPhone(phone: string | null | undefined): string {
    if (!phone) return "";
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 12 && cleaned.startsWith("52")) {
        return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
    }
    if (cleaned.length === 10) {
        return `+52 ${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
    }
    return `+${cleaned}`;
}

// Deterministic color for avatar based on name
const AVATAR_COLORS = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
    "bg-rose-500", "bg-cyan-500", "bg-pink-500", "bg-teal-500",
    "bg-indigo-500", "bg-orange-500", "bg-lime-600", "bg-fuchsia-500",
];
function getAvatarColor(name: string | null | undefined): string {
    if (!name) return "bg-muted-foreground";
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getLastMessagePreview(conv: Conversation): string {
    const msg = conv.messages[0];
    if (!msg) return "Sin mensajes";
    if (conv.lastMessageType === "image") return "📷 Imagen";
    if (conv.lastMessageType === "audio") return "🎙️ Audio";
    if (conv.lastMessageType === "video") return "🎥 Video";
    if (conv.lastMessageType === "document") return "📄 Documento";
    return msg.content || "Sin mensajes";
}

// ──────────── Media Renderer ────────────
function getCleanMediaUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined;

    let cleanUrl = url;

    // Strip full domain prefix to get a relative path
    if (typeof window !== "undefined") {
        const origin = window.location.origin;
        if (cleanUrl.startsWith(origin)) {
            cleanUrl = cleanUrl.replace(origin, "");
        }
    }
    // Also handle legacy localhost URLs
    if (cleanUrl.includes("localhost:3000")) {
        cleanUrl = cleanUrl.replace(/https?:\/\/localhost:3000/, "");
    }
    // Strip any other full domain that contains /uploads/
    if (cleanUrl.includes("/uploads/") && cleanUrl.startsWith("http")) {
        cleanUrl = cleanUrl.substring(cleanUrl.indexOf("/uploads/"));
    }

    // Route /uploads/ through /api/media/ for reliable serving in Docker standalone
    if (cleanUrl.startsWith("/uploads/")) {
        const filename = cleanUrl.substring("/uploads/".length);
        return `/api/media/${filename}`;
    }

    return cleanUrl;
}

// ──────────── WhatsApp-style Audio Player ────────────
function AudioPlayer({ src, isOutbound }: { src: string; isOutbound: boolean }) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const onDurationChange = () => {
            const d = audio.duration;
            if (d && isFinite(d) && d > 0) setDuration(d);
        };
        const onTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
            // For files without duration metadata, grow our known duration
            const d = audio.duration;
            if (d && isFinite(d) && d > 0) {
                setDuration(d);
            } else {
                // Fallback: expand duration as we discover more of the file
                setDuration(prev => Math.max(prev, audio.currentTime + 0.5));
            }
        };
        const onEnded = () => {
            // We now know the exact duration
            setDuration(prev => Math.max(prev, audio.currentTime));
            setIsPlaying(false);
            setCurrentTime(0);
        };

        audio.addEventListener("loadedmetadata", onDurationChange);
        audio.addEventListener("durationchange", onDurationChange);
        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("ended", onEnded);
        return () => {
            audio.removeEventListener("loadedmetadata", onDurationChange);
            audio.removeEventListener("durationchange", onDurationChange);
            audio.removeEventListener("timeupdate", onTimeUpdate);
            audio.removeEventListener("ended", onEnded);
        };
    }, [src]);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) { audio.pause(); } else { audio.play(); }
        setIsPlaying(!isPlaying);
    };

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "0:00";
        return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
    };

    const progress = duration > 0 && isFinite(duration) ? (currentTime / duration) * 100 : 0;

    // Generate pseudo-random waveform bar heights (deterministic per src)
    const bars = 28;
    const barHeights = Array.from({ length: bars }, (_, i) => {
        const seed = (i * 7 + src.charCodeAt(i % src.length)) % 100;
        return 20 + (seed / 100) * 80; // 20% to 100% height
    });

    return (
        <div className="flex items-center gap-2 min-w-[200px] max-w-[280px]">
            <audio ref={audioRef} src={src} preload="auto" />
            <button
                onClick={togglePlay}
                className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors",
                    isOutbound
                        ? "bg-white/20 hover:bg-white/30 text-white"
                        : "bg-primary/10 hover:bg-primary/20 text-primary"
                )}
            >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <div className="flex-1 flex flex-col gap-1">
                <div className="relative flex items-end gap-[2px] h-6 cursor-pointer"
                    onClick={(e) => {
                        if (!audioRef.current || !duration) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = (e.clientX - rect.left) / rect.width;
                        audioRef.current.currentTime = pct * duration;
                    }}
                >
                    {barHeights.map((h, i) => {
                        const barPct = ((i + 1) / bars) * 100;
                        const active = barPct <= progress;
                        return (
                            <div
                                key={i}
                                className="w-[3px] rounded-full"
                                style={{
                                    height: `${h}%`,
                                    backgroundColor: active
                                        ? (isOutbound ? "rgba(255,255,255,1)" : "rgba(37,99,235,1)")
                                        : (isOutbound ? "rgba(255,255,255,0.2)" : "rgba(100,116,139,0.25)")
                                }}
                            />
                        );
                    })}
                    {/* Position indicator dot */}
                    {duration > 0 && (
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full shadow-sm"
                            style={{
                                left: `${Math.min(progress, 100)}%`,
                                backgroundColor: isOutbound ? "#fff" : "#2563EB",
                                transform: `translateX(-50%) translateY(-50%)`,
                            }}
                        />
                    )}
                </div>
                <span className={cn("text-[10px] tabular-nums", isOutbound ? "text-white/70" : "text-muted-foreground")}>
                    {isPlaying ? formatTime(currentTime) : formatTime(duration)}
                </span>
            </div>
        </div>
    );
}

function MediaContent({ msg, onImageClick }: { msg: Message, onImageClick?: (msgId: string) => void }) {
    const isOutbound = msg.direction === "outbound";
    const cleanUrl = getCleanMediaUrl(msg.mediaUrl);

    if (msg.type === "image" && cleanUrl) {
        return (
            <div className="space-y-1">
                <img
                    src={cleanUrl}
                    alt={msg.content || "Image"}
                    className="max-w-[280px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => onImageClick ? onImageClick(msg.id) : window.open(cleanUrl, "_blank")}
                    loading="lazy"
                />
                {msg.content && !["[Imagen]", "[Sticker]", "[image]"].includes(msg.content) && (
                    <p className="text-sm">{msg.content}</p>
                )}
            </div>
        );
    }

    if (msg.type === "audio" && cleanUrl) {
        return <AudioPlayer src={cleanUrl} isOutbound={isOutbound} />;
    }

    if (msg.type === "video" && cleanUrl) {
        return (
            <div className="space-y-1">
                <video controls className="max-w-[280px] rounded-lg" preload="metadata">
                    <source src={cleanUrl} type={msg.mediaType || "video/mp4"} />
                </video>
                {msg.content && msg.content !== "[Video]" && <p className="text-sm">{msg.content}</p>}
            </div>
        );
    }

    if (msg.type === "document" && cleanUrl) {
        return (
            <a
                href={cleanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
                    isOutbound ? "bg-white/10 hover:bg-white/20" : "bg-muted/50 hover:bg-muted"
                )}
            >
                <FileText className="h-8 w-8 shrink-0 opacity-70" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{msg.mediaFileName || "Documento"}</p>
                    <p className={cn("text-xs", isOutbound ? "text-primary-foreground/60" : "text-muted-foreground")}>
                        {msg.mediaType || "Descargar"}
                    </p>
                </div>
                <Download className="h-4 w-4 shrink-0 opacity-50" />
            </a>
        );
    }

    return <p>{msg.content}</p>;
}

// ──────────── Mic Permission Banner ────────────
function MicPermissionBanner({ onAllow, onDeny }: { onAllow: () => void; onDeny: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border rounded-2xl shadow-2xl p-8 max-w-md mx-4 animate-in zoom-in-95 duration-300">
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                        <Mic className="h-10 w-10 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold">Acceso al Micrófono</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                        Para enviar notas de voz necesitamos acceso a tu micrófono.
                        <br /><strong>Acepta el permiso</strong> en el aviso del navegador.
                    </p>
                    <div className="flex gap-3 w-full mt-2">
                        <Button variant="outline" className="flex-1" onClick={onDeny}>Cancelar</Button>
                        <Button className="flex-1" onClick={onAllow}>
                            <Mic className="h-4 w-4 mr-2" /> Permitir
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ──────────── Contact Info Panel ────────────
function ContactInfoPanel({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
    const contact = conversation.contact;
    return (
        <div className="w-80 border-l flex flex-col bg-card animate-in slide-in-from-right duration-200">
            <div className="h-16 border-b flex items-center justify-between px-4">
                <h3 className="font-semibold">Info. del contacto</h3>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>
            <ScrollArea className="flex-1">
                <div className="p-6 flex flex-col items-center gap-4">
                    {/* Avatar */}
                    <Avatar className="h-24 w-24">
                        <AvatarFallback className="text-3xl bg-primary/10 text-primary">
                            {contact?.name?.charAt(0) || "?"}
                        </AvatarFallback>
                    </Avatar>
                    <div className="text-center">
                        <h4 className="text-lg font-semibold">{contact?.name || "Desconocido"}</h4>
                        <p className="text-sm text-muted-foreground">{formatPhone(contact?.phone)}</p>
                    </div>

                    {/* Status badge */}
                    {contact?.status && (
                        <Badge variant="outline" className="capitalize">
                            {contact.status === "lead" ? "Lead" : contact.status === "qualified" ? "Calificado" : contact.status === "customer" ? "Cliente" : contact.status}
                        </Badge>
                    )}

                    <Separator />

                    {/* Details */}
                    <div className="w-full space-y-4">
                        <div className="flex items-center gap-3">
                            <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Teléfono</p>
                                <p className="text-sm font-medium">{formatPhone(contact?.phone) || "—"}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Email</p>
                                <p className="text-sm font-medium">{contact?.email || "—"}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Estado</p>
                                <p className="text-sm font-medium capitalize">{contact?.status || "—"}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                                <p className="text-xs text-muted-foreground">Última actividad</p>
                                <p className="text-sm font-medium">
                                    {new Date(conversation.updatedAt).toLocaleString("es-MX", {
                                        day: "numeric", month: "short", year: "numeric",
                                        hour: "2-digit", minute: "2-digit"
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Conversation info */}
                    <div className="w-full space-y-2">
                        <p className="text-xs text-muted-foreground font-medium uppercase">Conversación</p>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Estado</span>
                            <Badge variant={conversation.status === "active" ? "default" : "secondary"} className="capitalize">
                                {conversation.status === "active" ? "Activa" : conversation.status === "closed" ? "Cerrada" : conversation.status}
                            </Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Favorito</span>
                            <span>{conversation.isFavorite ? "⭐ Sí" : "No"}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Silenciado</span>
                            <span>{conversation.isMuted ? "🔇 Sí" : "No"}</span>
                        </div>
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
}

// ──────────── Confirmation Modal ────────────
function ConfirmModal({ title, description, onConfirm, onCancel, variant = "default" }: {
    title: string;
    description: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: "default" | "destructive";
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border rounded-2xl shadow-2xl p-6 max-w-sm mx-4 animate-in zoom-in-95 duration-200">
                <h3 className="text-lg font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground mb-6">{description}</p>
                <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={onCancel}>Cancelar</Button>
                    <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={onConfirm}>
                        Confirmar
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ──────────── Window Timer Component ────────────
function WindowTimer({ expiresAt, onWindowChange }: { expiresAt: string | null | undefined; onWindowChange?: (isOpen: boolean) => void }) {
    const [timeLeft, setTimeLeft] = useState<string>("");
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (!expiresAt) {
            setIsOpen(false);
            onWindowChange?.(false);
            return;
        }

        const updateTimer = () => {
            const now = new Date();
            const expiry = new Date(expiresAt);
            const diff = expiry.getTime() - now.getTime();

            if (diff > 0) {
                setIsOpen(true);
                onWindowChange?.(true);
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                setTimeLeft(`${hours}h ${minutes}m`);
            } else {
                setIsOpen(false);
                onWindowChange?.(false);
                setTimeLeft("");
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 60000);
        return () => clearInterval(interval);
    }, [expiresAt, onWindowChange]);

    if (!expiresAt) return null;

    return (
        <div className={cn(
            "mx-4 mb-2 px-3 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-2 transition-colors",
            isOpen ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
        )}>
            {isOpen ? (
                <>
                    <Clock className="h-3 w-3" />
                    <span>Ventana abierta ({timeLeft})</span>
                </>
            ) : (
                <>
                    <BellOff className="h-3 w-3" />
                    <span>Ventana de 24h cerrada (Responderá con Plantilla)</span>
                </>
            )}
        </div>
    );
}

// ──────────── Main Inbox Page ────────────
export default function InboxPage() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedChat, setSelectedChat] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [pendingFile, setPendingFile] = useState<{
        url: string; fileName: string; mimeType: string; mediaCategory: string; previewUrl?: string;
    } | null>(null);
    const [showContactInfo, setShowContactInfo] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [confirmAction, setConfirmAction] = useState<{ type: string; title: string; desc: string } | null>(null);
    const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
    const [isWindowOpen, setIsWindowOpen] = useState(true);
    const [templateModalOpen, setTemplateModalOpen] = useState(false);

    const handleWindowChange = useCallback((open: boolean) => {
        setIsWindowOpen(open);
    }, []);

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [showMicPermission, setShowMicPermission] = useState(false);
    const [micPermissionGranted, setMicPermissionGranted] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    // Scroll tracking state
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [newMessageCount, setNewMessageCount] = useState(0);
    const prevMessagesLenRef = useRef(0);
    const isFirstLoadRef = useRef(true);

    // Unread message count tracking (per conversation)
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const isFirstFetchRef = useRef(true);
    const prevConvTimestampsRef = useRef<Record<string, string>>({});

    // Ref to keep the selected chat ID accessible inside polling closures
    const selectedChatIdRef = useRef<string | null>(null);
    useEffect(() => {
        selectedChatIdRef.current = selectedChat?.id ?? null;
    }, [selectedChat?.id]);

    // ──── Fetch conversations ────
    useEffect(() => {
        const fetchConversations = async () => {
            try {
                const response = await fetch("/api/chat");
                const data = await response.json();
                if (!Array.isArray(data)) return;

                const transformed: Conversation[] = data.map((conv: any) => ({
                    id: conv.id,
                    contact: {
                        id: conv.id,
                        name: conv.contactName,
                        phone: conv.contactPhone || null,
                        email: conv.contactEmail || null,
                        status: conv.contactStatus || null,
                    },
                    messages: conv.lastMessage ? [{
                        id: "preview-" + conv.id,
                        content: conv.lastMessage,
                        createdAt: conv.lastMessageTime,
                        senderId: null,
                        direction: "inbound",
                        type: conv.lastMessageType || "text"
                    }] : [],
                    updatedAt: conv.lastMessageTime || new Date(),
                    status: conv.status || "active",
                    isMuted: conv.isMuted || false,
                    isFavorite: conv.isFavorite || false,
                    isGroup: conv.isGroup || false,
                    botActive: conv.botActive ?? true,
                    lastMessageType: conv.lastMessageType || "text",
                    sessionExpiresAt: conv.sessionExpiresAt,
                }));
                setConversations(transformed);

                const currentId = selectedChatIdRef.current;

                // Track unread counts: compare updatedAt timestamps
                if (!isFirstFetchRef.current) {
                    const prevTimestamps = prevConvTimestampsRef.current;
                    setUnreadCounts(prev => {
                        const next = { ...prev };
                        for (const conv of transformed) {
                            // Skip the currently selected chat (user is viewing it)
                            if (conv.id === currentId) continue;
                            const prevTime = prevTimestamps[conv.id];
                            const newTime = new Date(conv.updatedAt).toISOString();
                            if (prevTime && newTime !== prevTime) {
                                // Conversation has new activity
                                next[conv.id] = (next[conv.id] || 0) + 1;
                            }
                        }
                        return next;
                    });
                }

                // Save current timestamps for next comparison
                const timestamps: Record<string, string> = {};
                for (const conv of transformed) {
                    timestamps[conv.id] = new Date(conv.updatedAt).toISOString();
                }
                prevConvTimestampsRef.current = timestamps;

                // Only auto-select a chat on the VERY FIRST load
                if (isFirstFetchRef.current) {
                    isFirstFetchRef.current = false;
                    if (!currentId && transformed.length > 0) {
                        setSelectedChat(transformed[0]);
                    }
                }

                // Update selected chat data (keep same chat, just refresh its data)
                if (currentId) {
                    const updated = transformed.find(c => c.id === currentId);
                    if (updated) setSelectedChat(updated);
                }
            } catch (error) {
                console.error("Failed to fetch conversations:", error);
            }
        };

        fetchConversations();
        const interval = setInterval(fetchConversations, 3000);
        return () => clearInterval(interval);
    }, []);

    // ──── Fetch messages ────
    useEffect(() => {
        if (!selectedChat) return;
        const fetchMessages = async () => {
            try {
                const response = await fetch(`/api/chat?conversationId=${selectedChat.id}`);
                const data = await response.json();
                setMessages(data);
            } catch (error) {
                console.error("Failed to fetch messages:", error);
            }
        };
        fetchMessages();
        const interval = setInterval(fetchMessages, 2000);
        return () => clearInterval(interval);
    }, [selectedChat?.id]);

    // ──── Smart scroll logic ────
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        // Use scrollIntoView on the sentinel div — much more reliable on mobile
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
        } else if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
        setNewMessageCount(0);
    }, []);

    // Check if user is near the bottom of the messages
    const handleMessagesScroll = useCallback(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const threshold = 100; // px from bottom
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
        setIsAtBottom(atBottom);
        if (atBottom) setNewMessageCount(0);
    }, []);

    // Auto-scroll only when at bottom or on first load / chat switch
    useEffect(() => {
        if (messages.length === 0) return;

        if (isFirstLoadRef.current) {
            // First load of this chat: scroll to bottom instantly
            isFirstLoadRef.current = false;
            // Use multiple attempts because mobile layout can be slow to settle
            setTimeout(() => scrollToBottom("instant"), 50);
            setTimeout(() => scrollToBottom("instant"), 200);
            setTimeout(() => scrollToBottom("instant"), 500);
            prevMessagesLenRef.current = messages.length;
            return;
        }

        const newCount = messages.length - prevMessagesLenRef.current;
        if (newCount > 0) {
            // Check if any new message is inbound → play notification
            const newMessages = messages.slice(-newCount);
            const hasInbound = newMessages.some(m => m.direction === "inbound");
            if (hasInbound && selectedChat) {
                maybePlayNotification(selectedChat.isMuted);
            }

            if (isAtBottom) {
                // User is at bottom → auto-scroll to new messages
                scrollToBottom();
            } else {
                // User is scrolled up → show badge with count
                setNewMessageCount(prev => prev + newCount);
            }
        }
        prevMessagesLenRef.current = messages.length;
    }, [messages, isAtBottom, scrollToBottom, selectedChat]);

    // Reset scroll state when switching chats
    useEffect(() => {
        setIsAtBottom(true);
        setNewMessageCount(0);
        isFirstLoadRef.current = true;
        prevMessagesLenRef.current = 0;
    }, [selectedChat?.id]);

    // Cleanup
    useEffect(() => {
        return () => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current); };
    }, []);

    // ──── Conversation Actions ────
    const performAction = async (action: string) => {
        if (!selectedChat) return;
        try {
            const res = await fetch("/api/conversation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedChat.id, action }),
            });
            const result = await res.json();
            console.log("[Action]", action, result);

            if (action === "delete") {
                setSelectedChat(null);
                setMessages([]);
            }
            if (action === "clear") {
                setMessages([]);
            }

            // Refresh conversations
            const convRes = await fetch("/api/chat");
            const convData = await convRes.json();
            if (Array.isArray(convData)) {
                const transformed: Conversation[] = convData.map((conv: any) => ({
                    id: conv.id,
                    contact: {
                        id: conv.id, name: conv.contactName, phone: conv.contactPhone || null,
                        email: conv.contactEmail || null, status: conv.contactStatus || null,
                    },
                    messages: conv.lastMessage ? [{
                        id: "preview-" + conv.id,
                        content: conv.lastMessage,
                        createdAt: conv.lastMessageTime,
                        senderId: null,
                        direction: "inbound",
                        type: conv.lastMessageType || "text"
                    }] : [],
                    updatedAt: conv.lastMessageTime || new Date(),
                    status: conv.status || "active",
                    isMuted: conv.isMuted || false,
                    isFavorite: conv.isFavorite || false,
                    isGroup: conv.isGroup || false,
                    botActive: conv.botActive ?? true,
                    lastMessageType: conv.lastMessageType || "text",
                }));
                setConversations(transformed);
                if (selectedChat && action !== "delete") {
                    const updated = transformed.find(c => c.id === selectedChat.id);
                    if (updated) setSelectedChat(updated);
                }
            }
        } catch (error) {
            console.error("[Action] error:", error);
        }
    };

    const handleConfirmAction = () => {
        if (confirmAction) {
            performAction(confirmAction.type);
            setConfirmAction(null);
        }
    };

    // ──── Filter conversations by search ────
    const filteredConversations = conversations.filter(conv => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        const name = (conv.contact?.name || "").toLowerCase();
        const phone = (conv.contact?.phone || "").toLowerCase();
        const lastMsg = (conv.messages[0]?.content || "").toLowerCase();
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
    });

    // ──── Voice Recording ────
    const requestMicPermission = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            setMicPermissionGranted(true);
            setShowMicPermission(false);
            startRecording();
        } catch {
            setShowMicPermission(false);
        }
    };

    const handleMicClick = () => {
        if (isRecording) { stopRecording(); return; }
        if (!micPermissionGranted) {
            navigator.permissions?.query({ name: "microphone" as PermissionName })
                .then(result => {
                    if (result.state === "granted") { setMicPermissionGranted(true); startRecording(); }
                    else setShowMicPermission(true);
                })
                .catch(() => setShowMicPermission(true));
        } else {
            startRecording();
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true }
            });

            // Priority: OGG Opus (WhatsApp's native voice format, well-supported by browsers)
            // Chromium browsers falsely claim audio/mp4 support but output WebM containers
            const mimeTypes = [
                "audio/ogg;codecs=opus", // WhatsApp native voice note format
                "audio/webm;codecs=opus", // Will be converted to send as ogg
                "audio/ogg",
                "audio/webm",
            ];

            let mimeType = "";
            for (const type of mimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }

            if (!mimeType) {
                console.warn("No suitable audio MIME type found, defaulting to default");
                mimeType = ""; // Let browser decide
            }

            console.log("Recording with MIME type:", mimeType);

            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            audioChunksRef.current = [];
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunksRef.current.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());

                const actualMimeType = mediaRecorder.mimeType;
                // Always use OGG for WhatsApp compatibility
                // Even if browser records as webm, WhatsApp can often handle it when sent as audio type
                let ext = "ogg";
                let blobType = "audio/ogg; codecs=opus";

                if (actualMimeType.includes("ogg")) {
                    ext = "ogg";
                    blobType = "audio/ogg; codecs=opus";
                } else if (actualMimeType.includes("webm")) {
                    // WebM/Opus is very similar to OGG/Opus internally
                    // Send as .ogg anyway - WhatsApp handles this better
                    ext = "ogg";
                    blobType = "audio/ogg; codecs=opus";
                }

                console.log(`Recording finished. Mime: ${actualMimeType}, Sending as: ${blobType}, Ext: ${ext}`);

                const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
                if (audioBlob.size > 0) await uploadAndSendAudio(audioBlob, ext, blobType);
            };

            mediaRecorder.start(250);
            setIsRecording(true);
            setRecordingTime(0);
            recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
        } catch (err) {
            console.error("Failed to start recording:", err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
        setIsRecording(false);
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current?.state !== "inactive") {
            mediaRecorderRef.current!.ondataavailable = null;
            mediaRecorderRef.current!.onstop = null;
            mediaRecorderRef.current!.stop();
            mediaRecorderRef.current!.stream.getTracks().forEach(track => track.stop());
        }
        audioChunksRef.current = [];
        setIsRecording(false);
        if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    };

    const uploadAndSendAudio = async (audioBlob: Blob, ext: string, mimeType: string) => {
        if (!selectedChat) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", audioBlob, `nota-de-voz-${Date.now()}.${ext}`);
            const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
            const uploadResult = await uploadRes.json();
            if (uploadResult.success) {
                await sendMediaMessage(uploadResult.url, "audio", uploadResult.fileName, mimeType);
            }
        } catch (error) {
            console.error("Upload audio error:", error);
        } finally {
            setIsUploading(false);
        }
    };

    const formatRecordingTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

    // ──── File Upload ────
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/upload", { method: "POST", body: formData });
            const result = await response.json();
            if (result.success) {
                if (result.mediaCategory === "image") setPendingFile({ ...result, previewUrl: URL.createObjectURL(file) });
                else await sendMediaMessage(result.url, result.mediaCategory, result.fileName, result.mimeType);
            }
        } catch (error) {
            console.error("Upload error:", error);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    // ──── Send Media ────
    const sendMediaMessage = async (mediaUrl: string, mediaCategory: string, fileName?: string, mimeType?: string, caption?: string) => {
        if (!selectedChat) return;

        // Optimistic update
        const optimisticId = "temp-" + Date.now();
        const optimistic: Message = {
            id: optimisticId, content: caption || `[${mediaCategory}]`,
            senderId: "me", direction: "outbound", createdAt: new Date(),
            type: mediaCategory, mediaUrl, mediaType: mimeType, mediaFileName: fileName,
        };
        setMessages(prev => [...prev, optimistic]);
        setPendingFile(null);

        try {
            const fullMediaUrl = mediaUrl.startsWith("http") ? mediaUrl : `${window.location.origin}${mediaUrl}`;

            const res = await fetch("/api/send-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId: selectedChat.id, content: caption || `[${mediaCategory}]`,
                    direction: "outbound", type: mediaCategory,
                    mediaUrl: fullMediaUrl, mediaType: mimeType, mediaFileName: fileName,
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to send message");
            }

            const msgRes = await fetch(`/api/chat?conversationId=${selectedChat.id}`);
            const updatedMessages = await msgRes.json();

            // simple diff to avoid full re-render flickering if possible, but for now just replace
            setMessages(updatedMessages);

        } catch (error: any) {
            console.error("sendMediaMessage error:", error);
            // Mark optimistic message as failed visually (in a real app) or remove it
            // For now, let's alert the user if it's a critical error like ngrok missing
            if (error.message.includes("ngrok") || error.message.includes("public media URL")) {
                alert("⚠️ Error: No se pudo enviar el archivo multimedia.\n\nEl servidor YCloud necesita una URL pública para descargar el archivo. Asegúrate de tener 'ngrok' corriendo.");
            } else {
                alert(`Error al enviar mensaje multimedia: ${error.message}`);
            }

            // Remove optimistic message on failure
            setMessages(prev => prev.filter(m => m.id !== optimisticId));
        }
    };

    // ──── Send Text ────
    const handleSendMessage = async () => {
        if (pendingFile) {
            await sendMediaMessage(pendingFile.url, pendingFile.mediaCategory, pendingFile.fileName, pendingFile.mimeType, inputText.trim() || undefined);
            setInputText("");
            return;
        }
        if (!inputText.trim() || !selectedChat) return;
        const optimistic: Message = {
            id: "temp-" + Date.now(), content: inputText,
            senderId: "me", direction: "outbound", createdAt: new Date(), type: "text",
        };
        setMessages(prev => [...prev, optimistic]);
        setInputText("");
        // Always scroll to bottom when user sends a message
        setTimeout(() => scrollToBottom("smooth"), 100);
        try {
            const res = await fetch("/api/send-message", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedChat.id, content: optimistic.content, direction: "outbound" }),
            });
            if (!res.ok) throw new Error("Failed");
            const msgRes = await fetch(`/api/chat?conversationId=${selectedChat.id}`);
            setMessages(await msgRes.json());
        } catch (error) {
            console.error("sendMessage error:", error);
        }
    };

    return (
        <>
            {showMicPermission && <MicPermissionBanner onAllow={requestMicPermission} onDeny={() => setShowMicPermission(false)} />}
            {confirmAction && (
                <ConfirmModal
                    title={confirmAction.title}
                    description={confirmAction.desc}
                    variant="destructive"
                    onConfirm={handleConfirmAction}
                    onCancel={() => setConfirmAction(null)}
                />
            )}

            <div className="flex h-[calc(100dvh-3.5rem-2rem)] md:h-full bg-card border rounded-lg overflow-hidden shadow-sm"
                style={{ contain: "layout size" }}>
                {/* ──── Sidebar ──── */}
                <div className={cn("w-full md:w-72 2xl:w-80 border-r flex flex-col bg-muted/10", selectedChat ? "hidden md:flex" : "flex")}>
                    <div className="p-4 border-b space-y-3">
                        <h2 className="font-semibold text-lg">Chats</h2>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar chats..."
                                className="pl-8 bg-background"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>

                    <ScrollArea className="flex-1">
                        <div className="flex flex-col">
                            {filteredConversations.length === 0 && (
                                <div className="p-8 text-center text-muted-foreground text-sm">
                                    {searchQuery ? "No se encontraron chats" : "Sin conversaciones"}
                                </div>
                            )}
                            {filteredConversations.map((chat) => (
                                <button
                                    key={chat.id}
                                    onClick={() => {
                                        setSelectedChat(chat);
                                        setShowContactInfo(false);
                                        // Clear unread count for this chat
                                        setUnreadCounts(prev => {
                                            const next = { ...prev };
                                            delete next[chat.id];
                                            return next;
                                        });
                                    }}
                                    className={cn(
                                        "flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors",
                                        selectedChat?.id === chat.id && "bg-accent"
                                    )}
                                >
                                    <div className="relative flex-shrink-0">
                                        <Avatar className="h-9 w-9">
                                            <AvatarFallback className={cn(getAvatarColor(chat.contact?.name), "text-white font-semibold text-sm")}>
                                                {chat.isGroup ? <Users className="h-4 w-4" /> : (chat.contact?.name?.charAt(0)?.toUpperCase() || "?")}
                                            </AvatarFallback>
                                        </Avatar>
                                        {chat.isFavorite && (
                                            <Star className="absolute -top-0.5 -right-0.5 h-3 w-3 text-yellow-500 fill-yellow-500" />
                                        )}
                                    </div>
                                    <div className="flex-1 overflow-hidden min-w-0">
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium text-sm truncate flex items-center gap-1">
                                                {chat.contact?.name || "Desconocido"}
                                                {chat.isMuted && <BellOff className="h-3 w-3 text-muted-foreground" />}
                                            </span>
                                            <div className="flex flex-col items-end gap-0.5 ml-2 flex-shrink-0">
                                                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                                    {new Date(chat.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {unreadCounts[chat.id] > 0 && (
                                                    <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
                                                        {unreadCounts[chat.id]}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {chat.contact?.phone && (
                                            <p className="text-[11px] text-muted-foreground/80 truncate">{formatPhone(chat.contact.phone)}</p>
                                        )}
                                        <p className="text-xs text-muted-foreground truncate">
                                            {getLastMessagePreview(chat)}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </ScrollArea>
                </div>

                {/* ──── Main Chat ──── */}
                <div className={cn("flex-1 flex flex-col bg-background", selectedChat ? "flex" : "hidden md:flex")}>
                    {selectedChat ? (
                        <>
                            {/* Header */}
                            <div className="h-16 border-b flex items-center justify-between px-3 md:px-6 bg-card">
                                <div className="flex items-center gap-1 overflow-hidden">
                                    {/* Back button on mobile */}
                                    <button className="md:hidden p-1.5 rounded-md hover:bg-muted flex-shrink-0" onClick={() => setSelectedChat(null)}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                                    </button>
                                    <button className="flex items-center gap-3 hover:opacity-80 transition text-left overflow-hidden ml-1 md:ml-0" onClick={() => setShowContactInfo(true)}>
                                        <Avatar className="h-9 w-9 flex-shrink-0">
                                            <AvatarFallback>{selectedChat.contact?.name?.charAt(0) || "?"}</AvatarFallback>
                                        </Avatar>
                                        <div className="overflow-hidden">
                                            <div className="font-medium flex items-center gap-1.5 truncate">
                                                <span className="truncate">{selectedChat.contact?.name || "Desconocido"}</span>
                                                {selectedChat.status === "closed" && (
                                                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 shrink-0">Cerrada</Badge>
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">{formatPhone(selectedChat.contact?.phone)}</div>
                                        </div>
                                    </button>
                                </div>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                    <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={() => setShowContactInfo(!showContactInfo)} title="Info del contacto">
                                        <Info className="h-4 w-4" />
                                    </Button>
                                    <Separator orientation="vertical" className="h-6 mx-1 hidden sm:block" />
                                    {/* Dropdown Menu */}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon">
                                                <MoreVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-52">
                                            <DropdownMenuItem onClick={() => setShowContactInfo(true)}>
                                                <Info className="h-4 w-4 mr-2" /> Info. del contacto
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => performAction("mute")}>
                                                {selectedChat.isMuted
                                                    ? <><Bell className="h-4 w-4 mr-2" /> Activar notificaciones</>
                                                    : <><BellOff className="h-4 w-4 mr-2" /> Silenciar notificaciones</>
                                                }
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => performAction("favorite")}>
                                                <Star className={cn("h-4 w-4 mr-2", selectedChat.isFavorite && "fill-yellow-500 text-yellow-500")} />
                                                {selectedChat.isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => performAction(selectedChat.status === "active" ? "close" : "reopen")}>
                                                <Archive className="h-4 w-4 mr-2" />
                                                {selectedChat.status === "active" ? "Cerrar chat" : "Reabrir chat"}
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onClick={() => setConfirmAction({ type: "clear", title: "Vaciar chat", desc: "¿Estás seguro de que quieres eliminar todos los mensajes de esta conversación? Esta acción no se puede deshacer." })}
                                            >
                                                <Eraser className="h-4 w-4 mr-2" /> Vaciar chat
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onClick={() => setConfirmAction({ type: "delete", title: "Eliminar chat", desc: "¿Estás seguro de que quieres eliminar esta conversación por completo? Esta acción no se puede deshacer." })}
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" /> Eliminar chat
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 min-h-0 overflow-hidden relative">
                                <div
                                    ref={messagesContainerRef}
                                    onScroll={handleMessagesScroll}
                                    className="h-full overflow-y-auto p-4 sm:px-8 bg-whatsapp-pattern"
                                    style={{ scrollBehavior: "auto" }}
                                >
                                    {/* Extra padding at bottom to account for the floating input area on desktop */}
                                    <div className="flex flex-col gap-4 max-w-3xl mx-auto pb-32 sm:pb-40">
                                        {messages.map((msg, idx) => {
                                            // Dynamic date separators
                                            const msgDate = new Date(msg.createdAt);
                                            const prevDate = idx > 0 ? new Date(messages[idx - 1].createdAt) : null;
                                            const showDateSep = idx === 0 || (prevDate && msgDate.toDateString() !== prevDate.toDateString());

                                            let dateLabel = "";
                                            if (showDateSep) {
                                                const today = new Date();
                                                const yesterday = new Date();
                                                yesterday.setDate(today.getDate() - 1);
                                                if (msgDate.toDateString() === today.toDateString()) {
                                                    dateLabel = "Hoy";
                                                } else if (msgDate.toDateString() === yesterday.toDateString()) {
                                                    dateLabel = "Ayer";
                                                } else {
                                                    dateLabel = msgDate.toLocaleDateString("es-MX", { day: "numeric", month: "numeric", year: "numeric" });
                                                }
                                            }

                                            return (
                                                <React.Fragment key={msg.id}>
                                                    {showDateSep && (
                                                        <div className="flex justify-center my-4">
                                                            <Badge variant="outline" className="text-xs font-normal text-foreground/80 bg-background/80 backdrop-blur-md border border-white/10 shadow-sm px-3 py-1 rounded-full">
                                                                {dateLabel}
                                                            </Badge>
                                                        </div>
                                                    )}
                                                    <div
                                                        className={cn(
                                                            "flex flex-col gap-0.5 max-w-[85%] sm:max-w-[80%] 2xl:max-w-[70%]",
                                                            msg.direction === "outbound" ? "self-end items-end" : "self-start items-start"
                                                        )}
                                                    >

                                                        <div
                                                            className={cn(
                                                                "rounded-2xl px-4 py-2 shadow-premium text-sm relative",
                                                                msg.direction === "outbound"
                                                                    ? "bg-primary text-primary-foreground"
                                                                    : "bg-card border-white/5",
                                                                // Apply tails and specific rounding only to the very first message of a contiguous group
                                                                (idx === 0 || messages[idx - 1].direction !== msg.direction)
                                                                    ? msg.direction === "outbound"
                                                                        ? "rounded-tr-sm chat-bubble-tail-right" // Tail right
                                                                        : "rounded-tl-sm chat-bubble-tail-left"  // Tail left
                                                                    : "" // Middle messages stay fully rounded
                                                            )}
                                                        >
                                                            <MediaContent msg={msg} onImageClick={setViewerMessageId} />
                                                            <p className={cn(
                                                                "text-[10px] mt-1 text-right font-medium",
                                                                msg.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"
                                                            )}>
                                                                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </React.Fragment>
                                            );
                                        })}
                                        <div ref={messagesEndRef} />
                                    </div>
                                </div>

                                {/* Floating scroll-to-bottom button */}
                                {!isAtBottom && (
                                    <button
                                        onClick={() => scrollToBottom()}
                                        className="absolute bottom-28 sm:bottom-32 right-6 z-10 h-10 w-10 rounded-full bg-card border shadow-lg flex items-center justify-center hover:bg-accent transition-all duration-200 hover:scale-105"
                                        title="Ir al último mensaje"
                                    >
                                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                        {newMessageCount > 0 && (
                                            <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
                                                {newMessageCount}
                                            </span>
                                        )}
                                    </button>
                                )}
                            </div>

                            {/* Pending file preview */}
                            {pendingFile && (
                                <div className="px-4 pt-3 border-t bg-card">
                                    <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 max-w-3xl mx-auto">
                                        {pendingFile.mediaCategory === "image" ? (
                                            <img src={pendingFile.previewUrl || pendingFile.url} alt="Preview" className="h-16 w-16 object-cover rounded-md" />
                                        ) : (
                                            <div className="h-16 w-16 flex items-center justify-center bg-primary/10 rounded-md">
                                                <FileText className="h-8 w-8 text-primary" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{pendingFile.fileName}</p>
                                            <p className="text-xs text-muted-foreground">{pendingFile.mimeType}</p>
                                        </div>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPendingFile(null)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Window Timer */}
                            <WindowTimer expiresAt={selectedChat.sessionExpiresAt} onWindowChange={handleWindowChange} />

                            {/* Input Area — Locked when 24h window is closed */}
                            {selectedChat.sessionExpiresAt && !isWindowOpen ? (
                                /* ═══ LOCKED: 24h window expired ═══ */
                                <div className="shrink-0 space-y-0">
                                    <p className="text-xs text-center text-muted-foreground px-6 py-3">
                                        Solo puedes responder a esta conversación utilizando un mensaje plantilla debido a la{" "}
                                        <span className="text-primary underline cursor-help" title="WhatsApp requiere que las empresas respondan dentro de las 24 horas posteriores al último mensaje del cliente.">
                                            restricción de la ventana de mensajes de 24 horas
                                        </span>
                                    </p>
                                    <div className="flex justify-center pb-4">
                                        <Button
                                            variant="outline"
                                            className="rounded-full px-6 gap-2 border-border hover:bg-primary/5 hover:border-primary/30"
                                            onClick={() => setTemplateModalOpen(true)}
                                        >
                                            <LayoutTemplate className="h-4 w-4" />
                                            Mensaje de plantilla
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                /* ═══ UNLOCKED: Normal input area ═══ */
                                <div className="p-4 sm:p-6 sm:pb-8 sm:absolute sm:bottom-0 sm:left-0 sm:right-0 shrink-0 pointer-events-none">
                                    {isRecording ? (
                                        <div className="flex items-center gap-3 max-w-3xl mx-auto glass-input p-2 rounded-full pointer-events-auto">
                                            <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0" onClick={cancelRecording} title="Cancelar">
                                                <X className="h-6 w-6" />
                                            </Button>
                                            <div className="flex-1 flex items-center justify-center gap-3 px-4 h-12 bg-destructive/5 rounded-full">
                                                <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
                                                <span className="text-sm font-medium text-destructive">Grabando audio...</span>
                                                <span className="text-sm font-mono text-muted-foreground hidden sm:inline">{formatRecordingTime(recordingTime)}</span>
                                            </div>
                                            <Button size="icon" className="h-12 w-12 rounded-full shrink-0" onClick={stopRecording} title="Enviar">
                                                <Send className="h-5 w-5 ml-1" />
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex items-end gap-2 max-w-3xl mx-auto glass-input p-2 rounded-3xl pointer-events-auto">
                                            <input ref={fileInputRef} type="file" className="hidden"
                                                accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
                                                onChange={handleFileSelect}
                                            />
                                            <input ref={imageInputRef} type="file" className="hidden"
                                                accept="image/*"
                                                onChange={handleFileSelect}
                                            />
                                            <div className="flex gap-1 pb-1 pl-1">
                                                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                    onClick={() => fileInputRef.current?.click()} disabled={isUploading} title="Adjuntar archivo">
                                                    {isUploading
                                                        ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                                        : <Paperclip className="h-5 w-5" />}
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                    onClick={() => imageInputRef.current?.click()} disabled={isUploading} title="Enviar imagen">
                                                    <ImageIcon className="h-5 w-5" />
                                                </Button>
                                            </div>
                                            <div className="flex-1 bg-muted/20 rounded-2xl border-0 focus-within:bg-muted/30 focus-within:ring-1 ring-primary/50 p-1 mb-1 transition-all">
                                                <Input
                                                    placeholder={pendingFile ? "Agregar descripción..." : "Escribe un mensaje..."}
                                                    className="border-0 bg-transparent focus-visible:ring-0 px-3 py-3 h-auto max-h-32 min-h-[44px] text-base"
                                                    value={inputText}
                                                    onChange={(e) => setInputText(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                                                />
                                            </div>
                                            <div className="pb-1 pr-1 shrink-0">
                                                {(inputText.trim() || pendingFile) ? (
                                                    <Button size="icon" className="h-12 w-12 rounded-full animate-in zoom-in-50 duration-200 shadow-premium" onClick={handleSendMessage}>
                                                        <Send className="h-5 w-5 ml-0.5" />
                                                    </Button>
                                                ) : (
                                                    <Button size="icon" className="h-12 w-12 rounded-full shrink-0 shadow-premium bg-green-500 hover:bg-green-600 text-white" onClick={handleMicClick} title="Nota de voz">
                                                        <Mic className="h-5 w-5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground">
                            Selecciona una conversación para comenzar
                        </div>
                    )}
                </div>

                {/* ──── Contact Info Panel ──── */}
                {showContactInfo && selectedChat && (
                    <ContactInfoPanel conversation={selectedChat} onClose={() => setShowContactInfo(false)} />
                )}
            </div >

            {/* Image Viewer Lightbox */}
            {
                viewerMessageId && selectedChat && (
                    <ImageViewer
                        conversation={selectedChat}
                        messages={messages}
                        initialMessageId={viewerMessageId}
                        onClose={() => setViewerMessageId(null)}
                    />
                )
            }

            {/* Template Send Modal */}
            {selectedChat && (
                <TemplateSendModal
                    open={templateModalOpen}
                    onOpenChange={setTemplateModalOpen}
                    contactPhone={selectedChat.contact?.phone || ""}
                    contactName={selectedChat.contact?.name || ""}
                    onSent={() => {
                        // Refresh messages after sending a template
                        if (selectedChat) {
                            fetch(`/api/chat?conversationId=${selectedChat.id}`)
                                .then(r => r.json())
                                .then(data => {
                                    if (data.messages) setMessages(data.messages);
                                });
                        }
                    }}
                />
            )}
        </>
    );
}

