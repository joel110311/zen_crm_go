"use client";

import { cn } from "@/lib/utils";

interface ZenLogoProps {
    className?: string;
}

export function ZenLogo({ className }: ZenLogoProps) {
    return (
        <svg
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn("h-8 w-8", className)}
        >
            {/* Bottom stone (largest) */}
            <ellipse
                cx="50"
                cy="78"
                rx="32"
                ry="14"
                className="fill-primary"
            />
            {/* Middle stone */}
            <ellipse
                cx="50"
                cy="55"
                rx="24"
                ry="11"
                className="fill-primary/80"
            />
            {/* Top stone (smallest) */}
            <ellipse
                cx="50"
                cy="36"
                rx="16"
                ry="9"
                className="fill-primary/60"
            />

            {/* Network dots */}
            <circle cx="18" cy="40" r="3.5" className="fill-primary" />
            <circle cx="82" cy="40" r="3.5" className="fill-primary" />
            <circle cx="26" cy="22" r="3" className="fill-primary/80" />
            <circle cx="74" cy="22" r="3" className="fill-primary/80" />
            <circle cx="50" cy="14" r="3.5" className="fill-primary" />
            <circle cx="14" cy="62" r="3" className="fill-primary/70" />
            <circle cx="86" cy="62" r="3" className="fill-primary/70" />

            {/* Network lines connecting dots to stones */}
            <line x1="18" y1="40" x2="26" y2="47" className="stroke-primary/40" strokeWidth="1.2" />
            <line x1="82" y1="40" x2="74" y2="47" className="stroke-primary/40" strokeWidth="1.2" />
            <line x1="26" y1="22" x2="34" y2="30" className="stroke-primary/40" strokeWidth="1.2" />
            <line x1="74" y1="22" x2="66" y2="30" className="stroke-primary/40" strokeWidth="1.2" />
            <line x1="50" y1="14" x2="50" y2="27" className="stroke-primary/40" strokeWidth="1.2" />
            <line x1="26" y1="22" x2="50" y2="14" className="stroke-primary/30" strokeWidth="1" />
            <line x1="74" y1="22" x2="50" y2="14" className="stroke-primary/30" strokeWidth="1" />
            <line x1="18" y1="40" x2="26" y2="22" className="stroke-primary/30" strokeWidth="1" />
            <line x1="82" y1="40" x2="74" y2="22" className="stroke-primary/30" strokeWidth="1" />
            <line x1="14" y1="62" x2="18" y2="40" className="stroke-primary/30" strokeWidth="1" />
            <line x1="86" y1="62" x2="82" y2="40" className="stroke-primary/30" strokeWidth="1" />
            <line x1="14" y1="62" x2="22" y2="70" className="stroke-primary/30" strokeWidth="1" />
            <line x1="86" y1="62" x2="78" y2="70" className="stroke-primary/30" strokeWidth="1" />
        </svg>
    );
}
