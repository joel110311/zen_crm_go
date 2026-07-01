"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import type { Session } from "next-auth";
import {
    Bot,
    Calendar,
    ChevronLeft,
    ChevronRight,
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
    { title: "Asistente IA", href: "/dashboard/brain", icon: Bot, superadminOnly: true },
    { title: "Configuracion", href: "/dashboard/settings", icon: Settings },
];

type SidebarProps = React.HTMLAttributes<HTMLDivElement> & {
    session?: Session | null;
};

function BrandMark({ compact = false }: { compact?: boolean }) {
    return (
        <Link
            href="/dashboard"
            className={cn(
                "flex min-w-0 items-center gap-3 text-sidebar-foreground",
                compact && "justify-center",
            )}
            title={compact ? "Zen CRM" : undefined}
        >
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

export function Sidebar({ className, session }: SidebarProps) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(true);
    const userRole = (session?.user as { role?: string } | undefined)?.role;
    const userName = session?.user?.name || "Usuario";
    const userEmail = session?.user?.email || "";

    useEffect(() => {
        document.body.style.overflow = open ? "hidden" : "";
        return () => {
            document.body.style.overflow = "";
        };
    }, [open]);

    const toggleCollapsed = () => setCollapsed((current) => !current);

    const filteredNavItems = sidebarNavItems.filter((item) => {
        if (item.superadminOnly && userRole !== "SUPERADMIN") return false;
        return true;
    });

    const renderNavItem = (
        item: typeof sidebarNavItems[number],
        key: string,
        onClickExtra?: () => void,
        isCompact = false,
    ) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;

        return (
            <Link key={key} href={item.href} onClick={onClickExtra} title={isCompact ? item.title : undefined}>
                <span
                    className={cn(
                        "group flex h-11 items-center rounded-xl border text-sm font-semibold transition",
                        isCompact ? "justify-center px-0" : "gap-3 px-3",
                        isActive
                            ? "border-primary bg-primary text-primary-foreground shadow-soft"
                            : "border-transparent text-sidebar-foreground/70 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    )}
                >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {!isCompact ? <span className="truncate">{item.title}</span> : null}
                </span>
            </Link>
        );
    };

    const renderUserInfo = (isCompact = false) => (
        <div
            className={cn(
                "rounded-xl border border-sidebar-border bg-sidebar-accent",
                isCompact ? "flex justify-center p-2" : "p-3",
            )}
            title={isCompact ? `${userName}${userEmail ? ` - ${userEmail}` : ""}` : undefined}
        >
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {userName.charAt(0).toUpperCase()}
                </div>
                {!isCompact ? (
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-sidebar-foreground">
                            {userName}
                        </div>
                        <div className="truncate text-xs text-sidebar-foreground/55">
                            {userEmail || "Sin correo"}
                        </div>
                    </div>
                ) : null}
            </div>
            {!isCompact ? (
                <Badge variant="outline" className="mt-3 border-sidebar-border bg-sidebar px-2 py-0 text-[10px] text-sidebar-foreground/70">
                    {userRole === "SUPERADMIN" ? (
                        <>
                            <ShieldCheck className="mr-1 h-3 w-3" /> Super Admin
                        </>
                    ) : (
                        <>
                            <Shield className="mr-1 h-3 w-3" /> Admin
                        </>
                    )}
                </Badge>
            ) : null}
        </div>
    );

    const sidebarContent = (mobile = false) => {
        const isCompact = !mobile && collapsed;
        const ToggleIcon = collapsed ? ChevronRight : ChevronLeft;

        return (
        <div className="flex h-full flex-col">
            <div className={cn("flex items-center", isCompact ? "justify-center" : "justify-between")}>
                <BrandMark compact={isCompact} />
                {mobile ? (
                    <button
                        onClick={() => setOpen(false)}
                        className="rounded-xl border border-sidebar-border bg-sidebar-accent p-2 text-sidebar-foreground transition hover:bg-sidebar"
                        aria-label="Cerrar menu"
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : (
                    <button
                        onClick={toggleCollapsed}
                        className={cn(
                            "rounded-xl border border-sidebar-border bg-sidebar-accent p-2 text-sidebar-foreground transition hover:bg-sidebar",
                            isCompact && "absolute left-[68px] z-10 rounded-full bg-sidebar shadow-soft",
                        )}
                        aria-label={collapsed ? "Desplegar menu" : "Plegar menu"}
                        title={collapsed ? "Desplegar menu" : "Plegar menu"}
                    >
                        <ToggleIcon className="h-4 w-4" />
                    </button>
                )}
            </div>

            <ScrollArea className={cn("flex-1", isCompact ? "mt-6" : "mt-5")}>
                <div className="space-y-5 pr-1">
                    <div>
                        {!isCompact ? (
                            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/42">
                                Operacion
                            </p>
                        ) : null}
                        <nav className={cn("grid gap-1.5", isCompact ? "mt-0" : "mt-3")}>
                            {filteredNavItems.map((item, index) =>
                                renderNavItem(
                                    item,
                                    `${mobile ? "mobile" : "desktop"}-${index}`,
                                    mobile ? () => setOpen(false) : undefined,
                                    isCompact,
                                ),
                            )}
                        </nav>
                    </div>
                </div>
            </ScrollArea>

            <div className="space-y-3 border-t border-sidebar-border pt-4">
                {renderUserInfo(isCompact)}
                <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className={cn(
                        "flex h-10 w-full items-center rounded-xl border border-transparent text-sm font-semibold text-sidebar-foreground/62 transition hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive",
                        isCompact ? "justify-center px-0" : "gap-3 px-3",
                    )}
                    title={isCompact ? "Cerrar sesion" : undefined}
                >
                    <LogOut className="h-[18px] w-[18px]" />
                    {!isCompact ? "Cerrar sesion" : null}
                </button>
            </div>
        </div>
        );
    };

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
                    {userName.charAt(0).toUpperCase()}
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

            <aside
                className={cn(
                    "relative hidden shrink-0 border-r border-sidebar-border bg-sidebar p-4 transition-[width] duration-300 ease-out md:flex md:flex-col",
                    className,
                    collapsed ? "w-[88px]" : "w-[260px]",
                )}
            >
                {sidebarContent(false)}
            </aside>
        </>
    );
}
