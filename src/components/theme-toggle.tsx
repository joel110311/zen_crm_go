"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"

export function ThemeToggle() {
    const { setTheme, theme } = useTheme()
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return null
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div
                    className={cn(
                        "cursor-pointer rounded-xl border p-1 transition hover:border-foreground/40",
                        theme === "light" ? "border-foreground shadow-soft" : "border-border"
                    )}
                    onClick={() => setTheme("light")}
                >
                    <div className="space-y-2 rounded-lg bg-[#f4f4f4] p-3">
                        <div className="space-y-2 rounded-md bg-white p-3 shadow-sm">
                            <div className="h-2 w-24 rounded-lg bg-[#d8d8d8]" />
                            <div className="h-2 w-32 rounded-lg bg-[#ececec]" />
                        </div>
                        <div className="flex items-center gap-2 rounded-md bg-white p-3 shadow-sm">
                            <Sun className="h-4 w-4 text-[#111111]" />
                            <div className="h-2 w-28 rounded-lg bg-[#e5e5e5]" />
                        </div>
                    </div>
                    <div className="p-2 text-center text-sm font-semibold">Claro</div>
                </div>

                <div
                    className={cn(
                        "cursor-pointer rounded-xl border p-1 transition hover:border-foreground/40",
                        theme === "dark" ? "border-foreground shadow-soft" : "border-border"
                    )}
                    onClick={() => setTheme("dark")}
                >
                    <div className="space-y-2 rounded-lg bg-[#050505] p-3">
                        <div className="space-y-2 rounded-md bg-[#151515] p-3 shadow-sm">
                            <div className="h-2 w-24 rounded-lg bg-[#f5f5f5]" />
                            <div className="h-2 w-32 rounded-lg bg-[#505050]" />
                        </div>
                        <div className="flex items-center gap-2 rounded-md bg-[#151515] p-3 shadow-sm">
                            <Moon className="h-4 w-4 text-white" />
                            <div className="h-2 w-28 rounded-lg bg-[#626262]" />
                        </div>
                    </div>
                    <div className="p-2 text-center text-sm font-semibold">Oscuro</div>
                </div>
            </div>
        </div>
    )
}
