"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, Plus, RefreshCw, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";

type YCloudTemplate = {
    id?: string;
    name?: string;
    category?: string;
    language?: string;
    status?: string;
    wabaId?: string;
    updatedAt?: string;
    createdAt?: string;
};

type RequestFormState = {
    wabaId: string;
    name: string;
    category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
    language: string;
    headerText: string;
    bodyText: string;
    footerText: string;
};

const EMPTY_FORM: RequestFormState = {
    wabaId: "",
    name: "",
    category: "UTILITY",
    language: "es",
    headerText: "",
    bodyText: "",
    footerText: "",
};

function normalizeStatus(status?: string) {
    return (status || "").trim().toUpperCase();
}

function statusLabel(status?: string) {
    const normalized = normalizeStatus(status);
    if (normalized === "APPROVED") return "Aprobada";
    if (normalized === "PENDING" || normalized === "IN_REVIEW") return "Pendiente";
    if (normalized === "REJECTED") return "Rechazada";
    return normalized || "Sin estado";
}

function StatusBadge({ status }: { status?: string }) {
    const normalized = normalizeStatus(status);

    if (normalized === "APPROVED") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                Aprobada
            </span>
        );
    }

    if (normalized === "PENDING" || normalized === "IN_REVIEW") {
        return (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <Clock3 className="h-3 w-3" />
                Pendiente
            </span>
        );
    }

    return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700">
            <XCircle className="h-3 w-3" />
            {statusLabel(status)}
        </span>
    );
}

function buildTemplateComponents(form: RequestFormState) {
    const components: Array<Record<string, unknown>> = [];

    if (form.headerText.trim()) {
        components.push({
            type: "HEADER",
            format: "TEXT",
            text: form.headerText.trim(),
        });
    }

    const bodyText = form.bodyText.trim();
    const bodyComponent: Record<string, unknown> = {
        type: "BODY",
        text: bodyText,
    };

    const bodyVariableMatches = [...bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)];
    if (bodyVariableMatches.length > 0) {
        const orderedUniqueKeys = Array.from(new Set(bodyVariableMatches.map((match) => Number.parseInt(match[1] || "0", 10))))
            .filter((value) => Number.isFinite(value) && value > 0)
            .sort((left, right) => left - right);

        if (orderedUniqueKeys.length > 0) {
            bodyComponent.example = {
                body_text: [orderedUniqueKeys.map((index) => `ejemplo_${index}`)],
            };
        }
    }

    components.push(bodyComponent);

    if (form.footerText.trim()) {
        components.push({
            type: "FOOTER",
            text: form.footerText.trim(),
        });
    }

    return components;
}

export function YCloudTemplateRequestPanel() {
    const { toast } = useToast();
    const [templates, setTemplates] = useState<YCloudTemplate[]>([]);
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [form, setForm] = useState<RequestFormState>(EMPTY_FORM);

    const loadTemplates = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/templates/ycloud?limit=100", {
                cache: "no-store",
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "No se pudieron cargar las plantillas de YCloud");
            }

            const items = Array.isArray(result.items) ? result.items : [];
            setTemplates(items as YCloudTemplate[]);
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudieron cargar las plantillas de YCloud",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        void loadTemplates();
    }, [loadTemplates]);

    const filteredTemplates = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return templates;

        return templates.filter((template) =>
            [template.name || "", template.category || "", template.language || "", template.status || ""]
                .join(" ")
                .toLowerCase()
                .includes(query),
        );
    }, [search, templates]);

    const handleSubmit = async () => {
        if (!form.wabaId.trim() || !form.name.trim() || !form.bodyText.trim()) {
            toast({
                title: "Campos requeridos",
                description: "wabaId, nombre y cuerpo del mensaje son obligatorios.",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);
        try {
            const response = await fetch("/api/templates/ycloud", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    wabaId: form.wabaId.trim(),
                    name: form.name.trim(),
                    category: form.category,
                    language: form.language.trim() || "es",
                    components: buildTemplateComponents(form),
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "No se pudo solicitar la plantilla en YCloud");
            }

            toast({
                title: "Solicitud enviada",
                description: "La plantilla fue enviada a YCloud para revision/aprobacion.",
            });

            setForm((current) => ({ ...current, name: "", headerText: "", bodyText: "", footerText: "" }));
            await loadTemplates();
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo solicitar la plantilla en YCloud",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
            <div className="space-y-4 rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h2 className="font-semibold">Plantillas YCloud</h2>
                        <p className="text-sm text-muted-foreground">Lista de plantillas oficiales detectadas en tu cuenta.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void loadTemplates()} disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Actualizar
                    </Button>
                </div>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Buscar en YCloud..."
                        className="pl-9"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </div>

                <div className="space-y-2">
                    {isLoading ? (
                        <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Cargando plantillas YCloud...
                        </div>
                    ) : filteredTemplates.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                            No se encontraron plantillas en YCloud.
                        </div>
                    ) : (
                        filteredTemplates.map((template) => (
                            <div key={`${template.id || template.name}-${template.language || "es"}`} className="rounded-xl border p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">{template.name || "Sin nombre"}</p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {(template.category || "Sin categoria").toUpperCase()} � {(template.language || "es").toLowerCase()}
                                        </p>
                                    </div>
                                    <StatusBadge status={template.status} />
                                </div>
                                {(template.updatedAt || template.createdAt) ? (
                                    <p className="mt-2 text-[11px] text-muted-foreground">
                                        Actualizada: {new Date(template.updatedAt || template.createdAt || "").toLocaleString("es-MX")}
                                    </p>
                                ) : null}
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="space-y-4 rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="font-semibold">Solicitar nueva plantilla en YCloud</h2>
                        <p className="text-sm text-muted-foreground">Se envia la solicitud al API de YCloud para aprobacion de Meta.</p>
                    </div>
                    <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full sm:w-auto">
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                        Solicitar
                    </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label>WABA ID</Label>
                        <Input
                            value={form.wabaId}
                            onChange={(event) => setForm((current) => ({ ...current, wabaId: event.target.value }))}
                            placeholder="1332773164957103"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Nombre (snake_case)</Label>
                        <Input
                            value={form.name}
                            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") }))}
                            placeholder="recordatorio_pago"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Categoria</Label>
                        <select
                            value={form.category}
                            onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as RequestFormState["category"] }))}
                            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        >
                            <option value="UTILITY">UTILITY</option>
                            <option value="MARKETING">MARKETING</option>
                            <option value="AUTHENTICATION">AUTHENTICATION</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <Label>Idioma</Label>
                        <Input
                            value={form.language}
                            onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
                            placeholder="es"
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Header (opcional)</Label>
                    <Input
                        value={form.headerText}
                        onChange={(event) => setForm((current) => ({ ...current, headerText: event.target.value }))}
                        placeholder="Tu pedido esta listo"
                    />
                </div>

                <div className="space-y-2">
                    <Label>Cuerpo</Label>
                    <Textarea
                        className="min-h-[140px]"
                        value={form.bodyText}
                        onChange={(event) => setForm((current) => ({ ...current, bodyText: event.target.value }))}
                        placeholder="Hola {{1}}, tu pedido {{2}} ya esta en camino."
                    />
                    <p className="text-xs text-muted-foreground">Usa variables numericas como <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code> cuando aplique.</p>
                </div>

                <div className="space-y-2">
                    <Label>Footer (opcional)</Label>
                    <Input
                        value={form.footerText}
                        onChange={(event) => setForm((current) => ({ ...current, footerText: event.target.value }))}
                        placeholder="Gracias por tu compra"
                    />
                </div>
            </div>
        </div>
    );
}
