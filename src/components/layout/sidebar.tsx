"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import {
    BrainCircuit,
    Calendar,
    KanbanSquare,
    LayoutDashboard,
    LayoutTemplate,
    LogOut,
    Menu,
    MessageSquare,
    ReceiptText,
    Settings,
    Shield,
    ShieldCheck,
    Users,
    X,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ZenLogo } from "@/components/icons/zen-logo";
import { cn } from "@/lib/utils";

const sidebarNavItems = [
    { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { title: "Contactos", href: "/dashboard/contacts", icon: Users },
    { title: "Pipeline", href: "/dashboard/pipeline", icon: KanbanSquare },
    { title: "Chats", href: "/dashboard/inbox", icon: MessageSquare },
    { title: "Pedidos", href: "/dashboard/orders", icon: ReceiptText },
    { title: "Plantillas", href: "/dashboard/templates", icon: LayoutTemplate, superadminOnly: true },
    { title: "Calendario", href: "/dashboard/calendar", icon: Calendar },
    { title: "Cerebro IA", href: "/dashboard/brain", icon: BrainCircuit, superadminOnly: true },
    { title: "Configuracion", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar({ className }: React.HTMLAttributes<HTMLDivElement>) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const { data: session, status } = useSession();
    const sessionLoading = status === "loading";
    const userRole = (session?.user as { role?: string } | undefined)?.role;
    const userName = session?.user?.name || (sessionLoading ? "..." : "Usuario");

    useEffect(() => {
        document.body.style.overflow = open ? "hidden" : "";
        return () => {
            document.body.style.overflow = "";
        };
    }, [open]);

    const filteredNavItems = sidebarNavItems.filter((item) => {
        if (sessionLoading) return !item.superadminOnly;
        if (item.superadminOnly && userRole !== "SUPERADMIN") return false;
        return true;
    });

    const renderNavItem = (item: typeof sidebarNavItems[number], key: string, onClickExtra?: () => void) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;

        return (
            <Link key={key} href={item.href} onClick={onClickExtra}>
                <span
                    className={cn(
                        "group flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition-all duration-200",
                        isActive
                            ? "border-primary/35 bg-primary/18 text-white shadow-[0_12px_28px_-20px_rgba(8,31,17,0.85)]"
                            : "border-transparent text-sidebar-foreground/78 hover:border-white/10 hover:bg-white/7 hover:text-white",
                    )}
                >
                    <span
                        className={cn(
                            "flex h-[1.875rem] w-[1.875rem] items-center justify-center rounded-lg border transition-colors",
                            isActive
                                ? "border-primary/40 bg-primary/28 text-white"
                                : "border-white/10 bg-white/5 text-sidebar-foreground/62 group-hover:text-white",
                        )}
                    >
                        <Icon className="h-[17px] w-[17px]" />
                    </span>
                    <span className="truncate">{item.title}</span>
                </span>
            </Link>
        );
    };

    const renderUserInfo = (compact?: boolean) => (
        <div
            className={cn(
                "flex items-center gap-2.5 rounded-xl border border-white/6 bg-white/5",
                compact ? "px-3 py-2.5" : "px-3 py-3",
            )}
        >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-[0_12px_22px_-16px_rgba(10,64,35,0.95)]">
                {!sessionLoading && userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">
                    {sessionLoading ? <div className="h-3 w-20 animate-pulse rounded bg-white/10" /> : userName}
                </div>
                <Badge variant="outline" className="mt-1 border-white/10 bg-white/5 px-2 py-0 text-[10px] text-sidebar-foreground/70">
                    {sessionLoading ? (
                        <div className="my-1 h-2 w-12 animate-pulse rounded bg-white/10" />
                    ) : userRole === "SUPERADMIN" ? (
                        <>
                            <ShieldCheck className="mr-0.5 h-2.5 w-2.5" /> Super Admin
                        </>
                    ) : (
                        <>
                            <Shield className="mr-0.5 h-2.5 w-2.5" /> Admin
                        </>
                    )}
                </Badge>
            </div>
        </div>
    );

    return (
        <>
            <header className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between border-b border-sidebar-border/85 bg-sidebar/95 px-4 py-2.5 backdrop-blur-xl md:hidden">
                <button
                    onClick={() => setOpen(true)}
                    className="rounded-xl border border-white/10 bg-white/8 p-2 text-sidebar-foreground transition-colors hover:bg-white/12"
                    aria-label="Abrir menu"
                >
                    <Menu className="h-5 w-5" />
                </button>

                <Link href="/dashboard" className="flex items-center gap-2.5 text-sidebar-foreground">
                    <ZenLogo className="h-7 w-7 text-white" />
                    <span className="text-base font-semibold tracking-tight text-white">Zen CRM</span>
                </Link>

                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-[0_12px_22px_-16px_rgba(10,64,35,0.95)]">
                    {!sessionLoading && userName.charAt(0).toUpperCase()}
                </div>
            </header>

            {open ? (
                <div
                    className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm md:hidden"
                    onClick={() => setOpen(false)}
                />
            ) : null}

            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-50 w-[264px] border-r border-sidebar-border bg-sidebar px-3.5 py-3.5 transition-transform duration-300 ease-out md:hidden",
                    open ? "translate-x-0" : "-translate-x-full",
                )}
            >
                <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between rounded-[1.1rem] border border-white/8 bg-white/6 px-3.5 py-3 shadow-[0_20px_40px_-30px_rgba(0,0,0,0.95)]">
                        <Link href="/dashboard" className="flex items-center gap-2.5 text-sidebar-foreground" onClick={() => setOpen(false)}>
                            <ZenLogo className="h-8 w-8 text-white" />
                            <span className="text-lg font-semibold tracking-tight text-white">Zen CRM</span>
                        </Link>
                        <button
                            onClick={() => setOpen(false)}
                            className="rounded-xl border border-white/8 bg-white/6 p-2 text-sidebar-foreground/70 transition-colors hover:bg-white/12 hover:text-white"
                            aria-label="Cerrar menu"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <ScrollArea className="mt-4 flex-1">
                        <div className="space-y-5 px-1 py-1">
                            <div>
                                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/38">
                                    Operacion
                                </p>
                                <nav className="mt-3 grid gap-1.5">
                                    {filteredNavItems.map((item, index) => renderNavItem(item, `mobile-${index}`, () => setOpen(false)))}
                                </nav>
                            </div>
                        </div>
                    </ScrollArea>

                    <div className="space-y-2.5 border-t border-white/8 pt-3.5">
                        {renderUserInfo(true)}
                        <button
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            className="flex h-10 w-full items-center gap-3 rounded-xl border border-transparent px-3.5 text-sm font-medium text-sidebar-foreground/68 transition-all hover:border-destructive/20 hover:bg-destructive/12 hover:text-destructive"
                        >
                            <LogOut className="h-[18px] w-[18px]" />
                            Cerrar sesion
                        </button>
                    </div>
                </div>
            </aside>

            <aside className={cn("hidden w-[244px] shrink-0 border-r border-sidebar-border/85 bg-sidebar px-3 py-3 md:flex md:flex-col", className)}>
                <div className="rounded-[1.1rem] border border-white/8 bg-white/6 px-4 py-4 shadow-[0_20px_40px_-30px_rgba(0,0,0,0.9)]">
                    <Link href="/dashboard" className="flex items-center gap-3 text-sidebar-foreground">
                        <ZenLogo className="h-8 w-8 text-white" />
                        <div className="space-y-0.5">
                            <span className="block text-base font-semibold tracking-tight text-white">Zen CRM</span>
                            <span className="block text-xs text-sidebar-foreground/48">Workspace comercial</span>
                        </div>
                    </Link>
                </div>

                <ScrollArea className="mt-5 flex-1">
                    <div className="space-y-5 px-1 py-1">
                        <div>
                            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/38">
                                Operacion
                            </p>
                            <nav className="mt-3 grid gap-1.5">
                                {filteredNavItems.map((item, index) => renderNavItem(item, `desktop-${index}`))}
                            </nav>
                        </div>
                    </div>
                </ScrollArea>

                <div className="space-y-2.5 border-t border-white/8 pt-3.5">
                    {renderUserInfo()}
                    <button
                        onClick={() => signOut({ callbackUrl: "/login" })}
                        className="flex h-10 w-full items-center gap-3 rounded-xl border border-transparent px-3.5 text-sm font-medium text-sidebar-foreground/68 transition-all hover:border-destructive/20 hover:bg-destructive/12 hover:text-destructive"
                    >
                        <LogOut className="h-[18px] w-[18px]" />
                        Cerrar sesion
                    </button>
                </div>
            </aside>
        </>
    );
}
