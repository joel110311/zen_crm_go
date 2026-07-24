"use client";

import { ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";

type BrandIconProps = {
    className?: string;
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

const channels = [
    {
        id: "whatsapp",
        label: "WhatsApp por API",
        description: "Embedded Signup oficial y coexistencia con la app de WhatsApp Business.",
        status: "Disponible",
        icon: WhatsAppIcon,
        iconClassName: "bg-[#25D366] text-white",
        enabled: true,
    },
    {
        id: "messenger",
        label: "Facebook Messenger",
        description: "Webhook seguro preparado. Falta completar alta, token de Pagina y envio.",
        status: "En preparacion",
        icon: MessengerIcon,
        iconClassName: "bg-[#0866FF] text-white",
        enabled: false,
    },
    {
        id: "instagram",
        label: "Instagram Direct",
        description: "Pendiente de Embedded Signup, persistencia de cuenta y envio.",
        status: "En preparacion",
        icon: InstagramIcon,
        iconClassName: "bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#FCAF45] text-white",
        enabled: false,
    },
] as const;

export function MetaChannelConnectors() {
    return (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-5">
                <h2 className="text-xl font-semibold text-foreground">Canales oficiales de Meta</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Cada canal tiene su propio proceso de conexion. El canal por QR permanece independiente.
                </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                {channels.map((channel) => {
                    const Icon = channel.icon;

                    return (
                        <article
                            key={channel.id}
                            className="flex min-h-56 flex-col rounded-2xl border border-border bg-background p-4"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <span
                                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${channel.iconClassName}`}
                                >
                                    <Icon className="h-5 w-5" />
                                </span>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                    {channel.enabled ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                    ) : (
                                        <Clock3 className="h-3.5 w-3.5" />
                                    )}
                                    {channel.status}
                                </span>
                            </div>

                            <div className="mt-4 flex-1">
                                <h3 className="font-semibold text-foreground">{channel.label}</h3>
                                <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                                    {channel.description}
                                </p>
                            </div>

                            <Button
                                type="button"
                                variant={channel.enabled ? "default" : "outline"}
                                className="mt-4 w-full justify-between"
                                disabled={!channel.enabled}
                                onClick={channel.enabled ? openWhatsAppSignup : undefined}
                                aria-label={`Conectar ${channel.label}`}
                            >
                                Conectar {channel.label}
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
