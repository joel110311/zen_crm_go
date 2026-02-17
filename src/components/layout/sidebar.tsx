"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    LayoutDashboard,
    Users,
    MessageSquare,
    KanbanSquare,
    Calendar,
    Settings,
    BrainCircuit,
    LogOut,
    Menu,
    FileText
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { ZenLogo } from "@/components/icons/zen-logo";

const sidebarNavItems = [
    {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
    },
    {
        title: "Contactos",
        href: "/dashboard/contacts",
        icon: Users,
    },
    {
        title: "Pipeline",
        href: "/dashboard/pipeline",
        icon: KanbanSquare,
    },
    {
        title: "Chats",
        href: "/dashboard/inbox",
        icon: MessageSquare,
    },
    {
        title: "Calendario",
        href: "/dashboard/calendar",
        icon: Calendar,
    },
    {
        title: "Cerebro IA",
        href: "/dashboard/brain",
        icon: BrainCircuit,
    },

    {
        title: "Configuración",
        href: "/dashboard/settings",
        icon: Settings,
    },
];

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    return (
        <>
            <div className="md:hidden p-4 flex items-center justify-between border-b bg-background">
                <span className="font-bold text-xl text-primary">Zen CRM</span>
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <Menu />
                        </Button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-[240px] p-0">
                        <MobileSidebarContent pathname={pathname} setOpen={setOpen} />
                    </SheetContent>
                </Sheet>
            </div>

            <div className={cn("hidden border-r bg-card md:block w-64 flex-col", className)}>
                <div className="flex h-16 items-center px-6 border-b">
                    <Link href="/dashboard" className="flex items-center gap-3 font-bold text-xl text-primary">
                        <ZenLogo className="h-12 w-12" />
                        <span>Zen CRM</span>
                    </Link>
                </div>
                <ScrollArea className="flex-1 py-4">
                    <nav className="grid gap-1 px-2">
                        {sidebarNavItems.map((item, index) => {
                            const Icon = item.icon;
                            return (
                                <Link
                                    key={index}
                                    href={item.href}
                                >
                                    <span
                                        className={cn(
                                            "group flex items-center rounded-md px-3 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors",
                                            pathname === item.href ? "bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground"
                                        )}
                                    >
                                        <Icon className="mr-3 h-5 w-5" />
                                        {item.title}
                                    </span>
                                </Link>
                            );
                        })}
                    </nav>
                </ScrollArea>
                <div className="p-4 border-t">
                    <Button variant="outline" className="w-full justify-start text-muted-foreground hover:text-destructive" onClick={() => console.log("Logout")}>
                        <LogOut className="mr-3 h-4 w-4" />
                        Log out
                    </Button>
                </div>
            </div>
        </>
    );
}

function MobileSidebarContent({ pathname, setOpen }: { pathname: string, setOpen: (open: boolean) => void }) {
    return (
        <div className="flex flex-col h-full">
            <div className="flex h-16 items-center px-6 border-b">
                <span className="font-bold text-xl text-primary flex items-center gap-3">
                    <ZenLogo className="h-12 w-12" />
                    Zen CRM
                </span>
            </div>
            <ScrollArea className="flex-1 py-4">
                <nav className="grid gap-1 px-2">
                    {sidebarNavItems.map((item, index) => {
                        const Icon = item.icon;
                        return (
                            <Link
                                key={index}
                                href={item.href}
                                onClick={() => setOpen(false)}
                            >
                                <span
                                    className={cn(
                                        "group flex items-center rounded-md px-3 py-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                                        pathname === item.href ? "bg-primary/10 text-primary" : "text-muted-foreground"
                                    )}
                                >
                                    <Icon className="mr-3 h-5 w-5" />
                                    {item.title}
                                </span>
                            </Link>
                        );
                    })}
                </nav>
            </ScrollArea>
            <div className="p-4 border-t">
                <Button variant="outline" className="w-full justify-start text-muted-foreground hover:text-destructive" onClick={() => console.log("Logout")}>
                    <LogOut className="mr-3 h-4 w-4" />
                    Log out
                </Button>
            </div>
        </div>
    )
}
