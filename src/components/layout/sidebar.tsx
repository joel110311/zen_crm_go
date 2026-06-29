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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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

function BrandMark({ compact = false }: { compact?: boolean }) {
    return (
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3 text-sidebar-foreground">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent text-sidebar-foreground shadow-soft">
                <ZenLogo className="h-7 w-7" />
            </span>
            {!compact ? (
                <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold leading-5">Zen CRM</span>
                    <span className="block truncate text-xs text-sidebar-foreground/58">CRM Management</span>
                </span>
            ) : null}
        </Link>
    );
}

export function Sidebar({ className }: React.HTMLAttributes<HTMLDivElement>) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const { data: session, status } = useSession();
    const sessionLoading = status === "loading";
    const userRole = (session?.user as { role?: string } | undefined)?.role;
    const userName = session?.user?.name || (sessionLoading ? "..." : "Usuario");
    const userEmail = session?.user?.email || "";

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
                        "group flex h-11 items-center gap-3 rounded-xl border px-3 text-sm font-semibold transition",
                        isActive
                            ? "border-primary bg-primary text-primary-foreground shadow-soft"
                            : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{item.title}</span>
                </span>
            </Link>
        );
    };

    const renderUserInfo = () => (
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent p-3">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {!sessionLoading && userName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-sidebar-foreground">
                        {sessionLoading ? <div className="h-3 w-20 animate-pulse rounded bg-sidebar-foreground/10" /> : userName}
                    </div>
                    <div className="truncate text-xs text-sidebar-foreground/55">
                        {sessionLoading ? "Cargando..." : userEmail || "Workspace Zen"}
                    </div>
                </div>
            </div>
            <Badge variant="outline" className="mt-3 border-sidebar-border bg-sidebar px-2 py-0 text-[10px] text-sidebar-foreground/70">
                {sessionLoading ? (
                    <div className="my-1 h-2 w-12 animate-pulse rounded bg-sidebar-foreground/10" />
                ) : userRole === "SUPERADMIN" ? (
                    <>
                        <ShieldCheck className="mr-1 h-3 w-3" /> Super Admin
                    </>
                ) : (
                    <>
                        <Shield className="mr-1 h-3 w-3" /> Admin
                    </>
                )}
            </Badge>
        </div>
    );

    const sidebarContent = (mobile = false) => (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between">
                <BrandMark />
                {mobile ? (
                    <button
                        onClick={() => setOpen(false)}
                        className="rounded-xl border border-sidebar-border bg-sidebar-accent p-2 text-sidebar-foreground transition hover:bg-sidebar"
                        aria-label="Cerrar menu"
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : null}
            </div>

            <div className="mt-5 rounded-xl border border-sidebar-border bg-sidebar-accent px-3 py-2 text-sm font-semibold text-sidebar-foreground shadow-soft">
                Workspace Zen
            </div>

            <ScrollArea className="mt-5 flex-1">
                <div className="space-y-5 pr-1">
                    <div>
                        <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/42">
                            Operacion
                        </p>
                        <nav className="mt-3 grid gap-1.5">
                            {filteredNavItems.map((item, index) => renderNavItem(item, `${mobile ? "mobile" : "desktop"}-${index}`, mobile ? () => setOpen(false) : undefined))}
                        </nav>
                    </div>
                </div>
            </ScrollArea>

            <div className="space-y-3 border-t border-sidebar-border pt-4">
                {renderUserInfo()}
                <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="flex h-10 w-full items-center gap-3 rounded-xl border border-transparent px-3 text-sm font-semibold text-sidebar-foreground/62 transition hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                >
                    <LogOut className="h-[18px] w-[18px]" />
                    Cerrar sesion
                </button>
            </div>
        </div>
    );

    return (
        <>
            <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-sidebar-border bg-sidebar px-4 md:hidden">
                <button
                    onClick={() => setOpen(true)}
                    className="rounded-xl border border-sidebar-border bg-sidebar-accent p-2 text-sidebar-foreground transition hover:bg-sidebar"
                    aria-label="Abrir menu"
                >
                    <Menu className="h-5 w-5" />
                </button>
                <BrandMark compact />
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {!sessionLoading && userName.charAt(0).toUpperCase()}
                </div>
            </header>

            {open ? (
                <div
                    className="fixed inset-0 z-40 bg-background/65 backdrop-blur-sm md:hidden"
                    onClick={() => setOpen(false)}
                />
            ) : null}

            <aside
                className={cn(
                    "fixed inset-y-0 left-0 z-50 w-[280px] border-r border-sidebar-border bg-sidebar p-4 transition-transform duration-300 ease-out md:hidden",
                    open ? "translate-x-0" : "-translate-x-full",
                )}
            >
                {sidebarContent(true)}
            </aside>

            <aside className={cn("hidden w-[260px] shrink-0 border-r border-sidebar-border bg-sidebar p-4 md:flex md:flex-col", className)}>
                {sidebarContent(false)}
            </aside>
        </>
    );
}
