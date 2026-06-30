"use client";

import { usePathname } from "next/navigation";
import { SearchCommand } from "@/components/header/search-command";

const PAGE_TITLES: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/dashboard/contacts": "Contactos",
    "/dashboard/pipeline": "Pipeline",
    "/dashboard/inbox": "Chats",
    "/dashboard/orders": "Pedidos",
    "/dashboard/templates": "Plantillas",
    "/dashboard/calendar": "Calendario",
    "/dashboard/brain": "Asistente IA",
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

                <div className="w-full max-w-[300px]">
                    <SearchCommand />
                </div>
            </div>
        </header>
    );
}
