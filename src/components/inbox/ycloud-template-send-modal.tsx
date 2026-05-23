"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquareText, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

type YCloudTemplateComponent = {
    type?: string;
    text?: string;
};

type YCloudTemplateItem = {
    id?: string;
    name?: string;
    language?: string;
    status?: string;
    category?: string;
    components?: YCloudTemplateComponent[];
};

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conversationId: string;
    contactName?: string | null;
    contactPhone?: string | null;
    onSent?: (message: unknown) => void;
};

function normalizeStatus(value: string | undefined) {
    return (value || "").trim().toUpperCase();
}

function extractBodyText(template: YCloudTemplateItem) {
    const body = (template.components || []).find((component) => (component.type || "").toUpperCase() === "BODY");
    return (body?.text || "").trim();
}

function extractBodyVariables(bodyText: string) {
    const matches = [...bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)];
    return Array.from(new Set(matches.map((match) => match[1]))).sort((left, right) => Number(left) - Number(right));
}

function applyBodyVariables(bodyText: string, values: Record<string, string>) {
    return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, key: string) => values[key] || `{{${key}}}`);
}

export function YCloudTemplateSendModal({
    open,
    onOpenChange,
    conversationId,
    contactName,
    contactPhone,
    onSent,
}: Props) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [query, setQuery] = useState("");
    const [templates, setTemplates] = useState<YCloudTemplateItem[]>([]);
    const [selectedKey, setSelectedKey] = useState("");
    const [variableValues, setVariableValues] = useState<Record<string, string>>({});

    const loadTemplates = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/templates/ycloud?limit=200", { cache: "no-store" });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "No se pudieron cargar las plantillas.");
            }

            const items = Array.isArray(result.items) ? (result.items as YCloudTemplateItem[]) : [];
            setTemplates(items);
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudieron cargar las plantillas de YCloud.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (!open) return;
        void loadTemplates();
    }, [open, loadTemplates]);

    const approvedTemplates = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return templates
            .filter((template) => normalizeStatus(template.status) === "APPROVED")
            .filter((template) => {
                if (!normalizedQuery) return true;
                return `${template.name || ""} ${template.language || ""} ${template.category || ""}`
                    .toLowerCase()
                    .includes(normalizedQuery);
            });
    }, [templates, query]);

    const selectedTemplate = useMemo(
        () => approvedTemplates.find((template) => `${template.name || ""}::${template.language || "es"}` === selectedKey) || null,
        [approvedTemplates, selectedKey],
    );

    const bodyText = selectedTemplate ? extractBodyText(selectedTemplate) : "";
    const bodyVariables = useMemo(() => extractBodyVariables(bodyText), [bodyText]);
    const renderedPreview = useMemo(() => applyBodyVariables(bodyText, variableValues), [bodyText, variableValues]);

    useEffect(() => {
        setVariableValues({});
    }, [selectedKey]);

    const handleSend = async () => {
        if (!selectedTemplate?.name) {
            toast({
                title: "Plantilla requerida",
                description: "Selecciona una plantilla aprobada para continuar.",
                variant: "destructive",
            });
            return;
        }

        const missingVar = bodyVariables.find((key) => !variableValues[key]?.trim());
        if (missingVar) {
            toast({
                title: "Faltan variables",
                description: `Completa la variable {{${missingVar}}} antes de enviar.`,
                variant: "destructive",
            });
            return;
        }

        setSending(true);
        try {
            const bodyParameters = bodyVariables.map((key) => ({
                type: "text" as const,
                text: variableValues[key].trim(),
            }));

            const components = bodyParameters.length > 0
                ? [{ type: "BODY", parameters: bodyParameters }]
                : undefined;

            const response = await fetch("/api/templates/ycloud/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId,
                    templateName: selectedTemplate.name,
                    languageCode: selectedTemplate.language || "es",
                    components,
                    resolvedContent: renderedPreview || `[Plantilla: ${selectedTemplate.name}]`,
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "No se pudo enviar la plantilla.");
            }

            toast({
                title: "Plantilla enviada",
                description: "El mensaje plantilla se envio correctamente por YCloud.",
            });
            onSent?.(result.message);
            onOpenChange(false);
        } catch (error) {
            toast({
                title: "Error al enviar",
                description: error instanceof Error ? error.message : "No se pudo enviar la plantilla.",
                variant: "destructive",
            });
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MessageSquareText className="h-4 w-4" />
                        Enviar plantilla YCloud
                    </DialogTitle>
                    <DialogDescription>
                        {contactName || "Contacto"} {contactPhone ? `(${contactPhone})` : ""}. Solo se muestran plantillas aprobadas.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Input
                            placeholder="Buscar plantilla..."
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => void loadTemplates()}
                            disabled={loading}
                            title="Actualizar plantillas"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <Label>Plantilla aprobada</Label>
                        <select
                            value={selectedKey}
                            onChange={(event) => setSelectedKey(event.target.value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            <option value="">Selecciona una plantilla...</option>
                            {approvedTemplates.map((template) => {
                                const key = `${template.name || ""}::${template.language || "es"}`;
                                return (
                                    <option key={key} value={key}>
                                        {template.name || "Sin nombre"} - {(template.language || "es").toLowerCase()}
                                    </option>
                                );
                            })}
                        </select>
                    </div>

                    {selectedTemplate && (
                        <div className="space-y-3 rounded-lg border bg-muted/25 p-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vista previa</p>
                                <p className="mt-1 whitespace-pre-wrap text-sm">
                                    {renderedPreview || `[Plantilla: ${selectedTemplate.name}]`}
                                </p>
                            </div>

                            {bodyVariables.length > 0 && (
                                <div className="grid gap-2 md:grid-cols-2">
                                    {bodyVariables.map((key) => (
                                        <div key={key} className="space-y-1.5">
                                            <Label htmlFor={`tpl-var-${key}`}>Variable {`{{${key}}}`}</Label>
                                            <Input
                                                id={`tpl-var-${key}`}
                                                value={variableValues[key] || ""}
                                                onChange={(event) =>
                                                    setVariableValues((prev) => ({
                                                        ...prev,
                                                        [key]: event.target.value,
                                                    }))
                                                }
                                                placeholder={`Valor para {{${key}}}`}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSend} disabled={sending || !selectedTemplate || !conversationId}>
                        {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Enviar plantilla
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
