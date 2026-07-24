import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ChannelSourceIconProps = {
    sourceType?: string | null;
    className?: string;
};

function BrandBadge({
    title,
    className,
    background,
    children,
}: {
    title: string;
    className?: string;
    background: string;
    children: ReactNode;
}) {
    return (
        <span
            aria-label={title}
            role="img"
            title={title}
            className={cn(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/80 text-white shadow-sm ring-2 ring-background",
                background,
                className,
            )}
        >
            {children}
        </span>
    );
}

function WhatsAppApiGlyph() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none">
            <path
                d="M12 4.25a7.25 7.25 0 0 0-6.24 10.94L5 19l3.91-.73A7.25 7.25 0 1 0 12 4.25Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
            />
            <path
                d="M9.05 8.25c.17-.37.35-.38.59-.39h.5c.16 0 .38.06.49.35l.66 1.6c.08.2.05.38-.09.55l-.53.64c-.13.15-.1.29-.03.42.43.77 1.04 1.42 1.78 1.9.14.09.29.08.42-.06l.74-.85c.16-.19.35-.21.55-.13l1.5.7c.23.11.38.19.4.37.03.18-.08 1.05-.5 1.48-.42.43-1.04.66-1.74.53-.7-.13-2.9-.94-4.56-3.1-1.33-1.73-1.4-2.92-1.25-3.46.13-.43.4-.8.57-1Z"
                fill="currentColor"
            />
        </svg>
    );
}

function MessengerGlyph() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5">
            <path
                d="M12 4.25c-4.35 0-7.75 3.16-7.75 7.2 0 2.3 1.1 4.35 2.86 5.68v2.62l2.55-1.4c.75.2 1.54.3 2.34.3 4.35 0 7.75-3.16 7.75-7.2S16.35 4.25 12 4.25Z"
                fill="currentColor"
            />
            <path
                d="m7.8 13.7 3.05-3.24 1.86 1.46 3.48-1.89-3.07 3.25-1.85-1.46L7.8 13.7Z"
                fill="#0866ff"
            />
        </svg>
    );
}

function InstagramGlyph() {
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none">
            <rect
                x="5.25"
                y="5.25"
                width="13.5"
                height="13.5"
                rx="4"
                stroke="currentColor"
                strokeWidth="2"
            />
            <circle cx="12" cy="12" r="3.15" stroke="currentColor" strokeWidth="2" />
            <circle cx="16.75" cy="7.65" r="1" fill="currentColor" />
        </svg>
    );
}

export function ChannelSourceIcon({ sourceType, className }: ChannelSourceIconProps) {
    const normalizedSource = sourceType?.trim().toLowerCase() ?? "";

    if (normalizedSource === "wuzapi") {
        return (
            <span
                aria-label="WhatsApp por QR"
                role="img"
                title="WhatsApp por QR"
                className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-foreground shadow-sm ring-2 ring-background",
                    className,
                )}
            >
                <MessageSquare className="h-3 w-3" aria-hidden="true" />
            </span>
        );
    }

    if (
        normalizedSource === "meta"
        || normalizedSource === "whatsapp_api"
        || normalizedSource === "whatsapp-business"
        || normalizedSource === "whatsapp_cloud"
    ) {
        return (
            <BrandBadge
                title="WhatsApp Business API oficial"
                background="bg-[#25D366]"
                className={className}
            >
                <WhatsAppApiGlyph />
            </BrandBadge>
        );
    }

    if (normalizedSource === "messenger" || normalizedSource === "facebook") {
        return (
            <BrandBadge
                title="Facebook Messenger"
                background="bg-[#0866FF]"
                className={className}
            >
                <MessengerGlyph />
            </BrandBadge>
        );
    }

    if (normalizedSource === "instagram" || normalizedSource === "instagram_direct") {
        return (
            <BrandBadge
                title="Instagram Direct"
                background="bg-[radial-gradient(circle_at_30%_110%,#ffd600_0%,#ff7a00_24%,#ff0169_52%,#d300c5_76%,#7638fa_100%)]"
                className={className}
            >
                <InstagramGlyph />
            </BrandBadge>
        );
    }

    return (
        <span
            aria-label="Canal de mensajeria"
            role="img"
            title="Canal de mensajeria"
            className={cn(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground shadow-sm ring-2 ring-background",
                className,
            )}
        >
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
        </span>
    );
}
