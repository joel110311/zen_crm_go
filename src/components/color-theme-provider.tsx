"use client";

import * as React from "react";
import { applyColorTheme, COLOR_THEME_STORAGE_KEY, isColorTheme, readStoredColorTheme } from "@/lib/color-theme";

export function ColorThemeProvider({ children }: { children: React.ReactNode }) {
    React.useEffect(() => {
        applyColorTheme(readStoredColorTheme());
        const onStorage = (event: StorageEvent) => {
            if (event.key === COLOR_THEME_STORAGE_KEY && isColorTheme(event.newValue)) applyColorTheme(event.newValue);
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    return <>{children}</>;
}
