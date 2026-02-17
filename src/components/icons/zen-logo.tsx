"use client";

import { cn } from "@/lib/utils";

interface ZenLogoProps {
    className?: string;
}

export function ZenLogo({ className }: ZenLogoProps) {
    // Selected Logo: "Candlestick Zen" (Wall Street + Zen)
    return (
        <svg
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn("h-auto w-auto", className)}
        >
            {/* Background Grid Hint */}
            <path d="M20 20 L20 80 L80 80" className="stroke-primary/10" strokeWidth="2" strokeLinecap="round" />

            {/* Candle 1 (Low) */}
            <line x1="35" y1="65" x2="35" y2="85" className="stroke-primary/40" strokeWidth="1" />
            <rect x="30" y="65" width="10" height="15" rx="1" className="fill-primary/40" />
            <line x1="35" y1="65" x2="35" y2="60" className="stroke-primary/40" strokeWidth="1" />

            {/* Candle 2 (Mid) */}
            <line x1="55" y1="45" x2="55" y2="70" className="stroke-primary/60" strokeWidth="1" />
            <rect x="50" y="45" width="10" height="20" rx="1" className="fill-primary/60" />
            <line x1="55" y1="45" x2="55" y2="35" className="stroke-primary/60" strokeWidth="1" />

            {/* Candle 3 (High) */}
            <line x1="75" y1="20" x2="75" y2="50" className="stroke-primary" strokeWidth="1" />
            <rect x="70" y="20" width="10" height="25" rx="1" className="fill-primary" />
            <line x1="75" y1="20" x2="75" y2="10" className="stroke-primary" strokeWidth="1" />
        </svg>
    );
}
