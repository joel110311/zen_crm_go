"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyColorTheme, DEFAULT_COLOR_THEME, persistColorTheme, readStoredColorTheme, type ColorTheme } from "@/lib/color-theme";

const OPTIONS: Array<{ id: ColorTheme; name: string; description: string; gradient: string }> = [
    { id: "clinic", name: "Azul clínica", description: "Azul clínico con sidebar oscura", gradient: "from-[#3A88A8] to-[#080b10]" },
    { id: "green", name: "Green", description: "Verdes naturales y superficies cálidas", gradient: "from-[#6f843d] to-[#263116]" },
    { id: "apple", name: "Apple", description: "Azul Apple, superficies luminosas y grises neutros", gradient: "from-[#0071e3] to-[#f5f5f7]" },
];

export function ThemeCustomizer() {
    const [mounted, setMounted] = React.useState(false);
    const [active, setActive] = React.useState<ColorTheme>(DEFAULT_COLOR_THEME);
    React.useEffect(() => {
        const stored = readStoredColorTheme();
        setActive(stored);
        applyColorTheme(stored);
        setMounted(true);
    }, []);
    if (!mounted) return null;

    return <div className="grid gap-3">{OPTIONS.map((option) => {
        const selected = active === option.id;
        return <button key={option.id} type="button" onClick={() => { setActive(option.id); applyColorTheme(option.id); persistColorTheme(option.id); }} className={cn("w-full rounded-xl border-2 p-1 text-left transition-all", selected ? "border-primary" : "border-border hover:border-primary/40")}>
            <div className="flex min-w-0 items-center gap-3 rounded-lg bg-secondary p-3">
                <div className={cn("h-10 w-10 shrink-0 rounded-full bg-gradient-to-br shadow-md", option.gradient)} />
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{option.name}</p><p className="text-xs text-muted-foreground">{option.description}</p></div>
                {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
            </div>
        </button>;
    })}</div>;
}
