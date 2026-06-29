"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Check, DownloadCloud, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchCommand } from "@/components/header/search-command";

const PAGE_TITLES: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/dashboard/contacts": "Contactos",
    "/dashboard/pipeline": "Pipeline",
    "/dashboard/inbox": "Chats",
    "/dashboard/orders": "Pedidos",
    "/dashboard/templates": "Plantillas",
    "/dashboard/calendar": "Calendario",
    "/dashboard/brain": "Cerebro IA",
    "/dashboard/settings": "Configuracion",
};

function getPageTitle(pathname: string) {
    if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
    const match = Object.entries(PAGE_TITLES)
        .sort((a, b) => b[0].length - a[0].length)
        .find(([path]) => pathname.startsWith(`${path}/`));
    return match?.[1] || "Zen CRM";
}

export function Header() {
    const pathname = usePathname();
    const title = getPageTitle(pathname);

    return (
        <header className="sticky top-0 z-20 hidden border-b border-border bg-background/92 backdrop-blur-xl md:block">
            <div className="flex min-h-[72px] items-center gap-4 px-5 lg:px-6 xl:px-7">
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-xl font-semibold leading-7 text-foreground">{title}</h1>
                </div>

                <div className="hidden items-center gap-2 text-sm font-semibold text-muted-foreground xl:flex">
                    <Check className="h-4 w-4 text-foreground" />
                    Actualizado ahora
                </div>

                <div className="w-full max-w-[300px]">
                    <SearchCommand />
                </div>

                <Button variant="outline" size="icon" title="Notificaciones">
                    <Bell className="h-4 w-4" />
                </Button>
                <Button variant="outline" className="hidden gap-2 lg:inline-flex" asChild>
                    <Link href="/dashboard/templates">
                        <Share2 className="h-4 w-4" />
                        Compartir
                    </Link>
                </Button>
                <Button className="hidden gap-2 lg:inline-flex" asChild>
                    <Link href="/dashboard/contacts">
                        <DownloadCloud className="h-4 w-4" />
                        Exportar
                    </Link>
                </Button>
            </div>
        </header>
    );
}
