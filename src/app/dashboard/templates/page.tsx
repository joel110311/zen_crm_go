"use client";

import { useSession } from "next-auth/react";
import { LayoutTemplate, Loader2, Megaphone, ShieldAlert, MessageSquare } from "lucide-react";
import { BulkCampaignManagerPanel } from "@/components/settings/bulk-campaign-manager-panel";
import { TemplateManagerPanel } from "@/components/settings/template-manager-panel";
import { YCloudTemplateRequestPanel } from "@/components/templates/ycloud-template-request-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function TemplatesPage() {
    const { data: session, status } = useSession();
    const sessionUser = session?.user as { role?: string } | undefined;
    const isSuperadmin = sessionUser?.role === "SUPERADMIN";

    if (status === "loading") {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <div className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando plantillas...
                </div>
            </div>
        );
    }

    if (!isSuperadmin) {
        return (
            <div className="mx-auto max-w-3xl space-y-5">
                <div className="rounded-xl border bg-card px-5 py-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)]">
                    <h1 className="flex items-center gap-2.5 text-3xl font-bold tracking-tight">
                        <LayoutTemplate className="h-6 w-6 text-primary" />
                        Plantillas
                    </h1>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                        Modulo de respuestas guardadas del CRM.
                    </p>
                </div>

                <div className="rounded-xl border bg-card p-7 text-center shadow-[0_12px_28px_-22px_rgba(15,23,42,0.22)]">
                    <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
                    <h2 className="mt-4 text-lg font-semibold">Acceso restringido</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Solo un superadministrador puede gestionar las plantillas internas.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-[1280px] space-y-4">
            <div className="rounded-xl border bg-card px-5 py-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)]">
                <h1 className="flex items-center gap-2.5 text-[1.85rem] font-semibold tracking-tight">
                    <LayoutTemplate className="h-6 w-6 text-primary" />
                    Plantillas
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Administra respuestas guardadas y campanas de envios masivos desde un mismo lugar.
                </p>
            </div>

            <Tabs defaultValue="templates" className="space-y-4">
                <TabsList className="grid h-auto w-full max-w-[48rem] grid-cols-3 gap-2 rounded-2xl border bg-card p-1.5 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.22)]">
                    <TabsTrigger value="templates" className="min-w-0 h-10 gap-1.5 rounded-xl border border-transparent bg-background px-3 text-[13px] font-semibold text-foreground/75 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_14px_28px_-18px_rgba(37,99,235,0.72)] sm:h-11 sm:px-4 sm:text-sm">
                        <LayoutTemplate className="hidden h-4 w-4 sm:block" />
                        <span className="truncate">Respuestas guardadas</span>
                    </TabsTrigger>
                    <TabsTrigger value="ycloud" className="min-w-0 h-10 gap-1.5 rounded-xl border border-transparent bg-background px-3 text-[13px] font-semibold text-foreground/75 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_14px_28px_-18px_rgba(37,99,235,0.72)] sm:h-11 sm:px-4 sm:text-sm">
                        <MessageSquare className="hidden h-4 w-4 sm:block" />
                        <span className="truncate">Plantillas YCloud</span>
                    </TabsTrigger>
                    <TabsTrigger value="campaigns" className="min-w-0 h-10 gap-1.5 rounded-xl border border-transparent bg-background px-3 text-[13px] font-semibold text-foreground/75 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_14px_28px_-18px_rgba(37,99,235,0.72)] sm:h-11 sm:px-4 sm:text-sm">
                        <Megaphone className="hidden h-4 w-4 sm:block" />
                        <span className="truncate">Envios masivos</span>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="templates" className="mt-0">
                    <TemplateManagerPanel />
                </TabsContent>

                <TabsContent value="ycloud" className="mt-0">
                    <YCloudTemplateRequestPanel />
                </TabsContent>

                <TabsContent value="campaigns" className="mt-0">
                    <BulkCampaignManagerPanel />
                </TabsContent>
            </Tabs>
        </div>
    );
}
