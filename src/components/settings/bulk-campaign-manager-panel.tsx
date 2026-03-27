"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, CheckCircle2, Clock3, Loader2, Megaphone, Pause, Play, Square, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import {
    appendCommaSeparatedValue,
    type AudiencePreview,
    type CampaignFormState,
    type CampaignRecord,
    type CampaignVariantFormState,
    DEFAULT_VARIANTS,
    EMPTY_FORM,
    formatDateTime,
    getStatusBadgeVariant,
    splitCommaSeparatedValues,
    toLocalDateTimeValue,
} from "@/components/settings/bulk-campaign-manager-shared";
import { BulkCampaignAudienceTab } from "@/components/settings/bulk-campaign-audience-tab";
import { BulkCampaignCampaignList } from "@/components/settings/bulk-campaign-campaign-list";
import { BulkCampaignMessageTab } from "@/components/settings/bulk-campaign-message-tab";
import { BulkCampaignScheduleTab } from "@/components/settings/bulk-campaign-schedule-tab";
import {
    formatBulkCampaignManualEntries,
    parseBulkCampaignManualEntries,
} from "@/lib/bulk-campaign-audience";
import { listTemplateVariableKeys, renderTemplateContent } from "@/lib/templates";

function mapCampaignToForm(campaign: CampaignRecord): CampaignFormState {
    return {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description || "",
        status: campaign.status,
        type: campaign.type,
        mediaUrl: campaign.mediaUrl,
        mediaType: campaign.mediaType,
        mediaFileName: campaign.mediaFileName,
        batchSize: campaign.batchSize,
        batchDelayMinutes: campaign.batchDelayMinutes,
        randomDelayMinSeconds: campaign.randomDelayMinSeconds,
        randomDelayMaxSeconds: campaign.randomDelayMaxSeconds,
        scheduledStartAt: toLocalDateTimeValue(campaign.scheduledStartAt),
        respectBusinessHours: campaign.respectBusinessHours,
        stopOnReply: campaign.stopOnReply,
        audienceMode: campaign.audienceFilters?.mode || "filters",
        audienceStatuses: campaign.audienceFilters?.statuses || [],
        audienceTags: (campaign.audienceFilters?.tags || []).join(", "),
        audienceQuery: campaign.audienceFilters?.query || "",
        audienceLimit: campaign.audienceFilters?.limit ? String(campaign.audienceFilters.limit) : "",
        audienceSelectedContactIds: campaign.audienceFilters?.selectedContactIds || [],
        manualAudienceText: formatBulkCampaignManualEntries(campaign.audienceFilters?.manualEntries || []),
        totalRecipients: campaign.totalRecipients,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        repliedCount: campaign.repliedCount,
        skippedCount: campaign.skippedCount,
        variants: campaign.variants.length > 0
            ? campaign.variants.map((variant) => ({
                label: variant.label,
                content: variant.content,
                weight: variant.weight,
                isActive: variant.isActive,
            }))
            : DEFAULT_VARIANTS,
    };
}

export function BulkCampaignManagerPanel() {
    const { toast } = useToast();
    const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isImportingCsv, setIsImportingCsv] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [form, setForm] = useState<CampaignFormState>(EMPTY_FORM);
    const [activeVariantIndex, setActiveVariantIndex] = useState(0);
    const [csvImportStatus, setCsvImportStatus] = useState("lead");
    const [csvImportTag, setCsvImportTag] = useState("");
    const [audiencePreview, setAudiencePreview] = useState<AudiencePreview | null>(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

    const resetForm = useCallback(() => {
        setForm(EMPTY_FORM);
        setActiveVariantIndex(0);
        setAudiencePreview(null);
    }, []);

    const loadCampaigns = useCallback(async (preserveSelection = true) => {
        setIsLoading(true);
        try {
            const response = await fetch("/api/bulk-campaigns", { cache: "no-store" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudieron cargar las campañas");

            const nextCampaigns = (result.campaigns || []) as CampaignRecord[];
            setCampaigns(nextCampaigns);

            if (preserveSelection && form.id) {
                const refreshed = nextCampaigns.find((campaign) => campaign.id === form.id);
                if (refreshed) {
                    setForm(mapCampaignToForm(refreshed));
                }
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudieron cargar las campañas",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    }, [form.id, toast]);

    useEffect(() => {
        void loadCampaigns();
    }, [loadCampaigns]);

    useEffect(() => {
        const interval = setInterval(() => {
            void loadCampaigns();
        }, 15_000);
        return () => clearInterval(interval);
    }, [loadCampaigns]);

    const filteredCampaigns = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return campaigns;
        return campaigns.filter((campaign) =>
            [campaign.name, campaign.description || "", campaign.status]
                .join(" ")
                .toLowerCase()
                .includes(query),
        );
    }, [campaigns, search]);

    const activeVariant = form.variants[Math.min(activeVariantIndex, Math.max(form.variants.length - 1, 0))] || DEFAULT_VARIANTS[0];
    const previewContent = useMemo(
        () =>
            renderTemplateContent(activeVariant?.content || "", {
                contact: {
                    name: "Karen",
                    company: "Zen Estates",
                    phone: "9991234567",
                },
                agentName: "Joel",
            }),
        [activeVariant?.content],
    );

    const detectedVariables = useMemo(() => {
        const keys = form.variants.flatMap((variant) => listTemplateVariableKeys(variant.content));
        return keys.filter((key, index) => keys.indexOf(key) === index);
    }, [form.variants]);

    const manualEntries = useMemo(
        () => parseBulkCampaignManualEntries(form.manualAudienceText),
        [form.manualAudienceText],
    );

    const audiencePayload = useMemo(() => ({
        mode: form.audienceMode,
        statuses: form.audienceStatuses,
        tags: splitCommaSeparatedValues(form.audienceTags),
        query: form.audienceQuery,
        limit: form.audienceLimit.trim() ? Number.parseInt(form.audienceLimit, 10) : null,
        selectedContactIds: form.audienceSelectedContactIds,
        manualEntries,
    }), [
        form.audienceLimit,
        form.audienceMode,
        form.audienceQuery,
        form.audienceSelectedContactIds,
        form.audienceStatuses,
        form.audienceTags,
        manualEntries,
    ]);

    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setIsPreviewLoading(true);
            try {
                const response = await fetch("/api/bulk-campaigns/preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ audienceFilters: audiencePayload }),
                    signal: controller.signal,
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "No se pudo cargar la vista previa de audiencia");
                setAudiencePreview(result.preview as AudiencePreview);
            } catch {
                if (!controller.signal.aborted) {
                    setAudiencePreview(null);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsPreviewLoading(false);
                }
            }
        }, 320);

        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [audiencePayload]);

    const updateVariant = useCallback((index: number, updater: (variant: CampaignVariantFormState) => CampaignVariantFormState) => {
        setForm((current) => ({
            ...current,
            variants: current.variants.map((variant, variantIndex) =>
                variantIndex === index ? updater(variant) : variant,
            ),
        }));
    }, []);

    const addVariant = () => {
        setForm((current) => ({
            ...current,
            variants: [
                ...current.variants,
                {
                    label: String.fromCharCode(65 + current.variants.length),
                    content: "",
                    weight: 1,
                    isActive: true,
                },
            ],
        }));
        setActiveVariantIndex(form.variants.length);
    };

    const removeVariant = (index: number) => {
        if (form.variants.length === 1) return;
        setForm((current) => ({
            ...current,
            variants: current.variants.filter((_, variantIndex) => variantIndex !== index),
        }));
        setActiveVariantIndex((current) => Math.max(0, Math.min(current, form.variants.length - 2)));
    };

    const saveCampaign = async () => {
        setIsSaving(true);
        try {
            const payload = {
                name: form.name,
                description: form.description,
                type: form.type,
                mediaUrl: form.type === "text" ? null : form.mediaUrl,
                mediaType: form.type === "text" ? null : form.mediaType,
                mediaFileName: form.type === "text" ? null : form.mediaFileName,
                batchSize: form.batchSize,
                batchDelayMinutes: form.batchDelayMinutes,
                randomDelayMinSeconds: form.randomDelayMinSeconds,
                randomDelayMaxSeconds: form.randomDelayMaxSeconds,
                scheduledStartAt: form.scheduledStartAt ? new Date(form.scheduledStartAt).toISOString() : null,
                respectBusinessHours: form.respectBusinessHours,
                stopOnReply: form.stopOnReply,
                audienceFilters: audiencePayload,
                variants: form.variants.map((variant, index) => ({
                    ...variant,
                    sortOrder: index,
                })),
            };

            const response = await fetch(form.id ? `/api/bulk-campaigns/${form.id}` : "/api/bulk-campaigns", {
                method: form.id ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo guardar la campaña");

            const campaign = result.campaign as CampaignRecord;
            setForm(mapCampaignToForm(campaign));
            setCampaigns((current) => {
                const rest = current.filter((entry) => entry.id !== campaign.id);
                return [campaign, ...rest];
            });

            toast({
                title: form.id ? "Campaña actualizada" : "Campaña creada",
            });
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo guardar la campaña",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const runAction = async (action: "start" | "pause" | "resume" | "cancel") => {
        if (!form.id) {
            toast({
                title: "Guarda la campaña primero",
                description: "Necesitamos un borrador antes de ejecutarla.",
                variant: "destructive",
            });
            return;
        }

        setActionLoading(action);
        try {
            const response = await fetch(`/api/bulk-campaigns/${form.id}/control`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo ejecutar la acción");

            const campaign = result.campaign as CampaignRecord;
            setForm(mapCampaignToForm(campaign));
            setCampaigns((current) => {
                const rest = current.filter((entry) => entry.id !== campaign.id);
                return [campaign, ...rest];
            });
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo ejecutar la acción",
                variant: "destructive",
            });
        } finally {
            setActionLoading(null);
        }
    };

    const deleteCampaign = async (campaignId: string) => {
        if (!window.confirm("¿Eliminar esta campaña?")) return;

        try {
            const response = await fetch(`/api/bulk-campaigns/${campaignId}`, {
                method: "DELETE",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "No se pudo eliminar la campaña");

            setCampaigns((current) => current.filter((campaign) => campaign.id !== campaignId));
            if (form.id === campaignId) {
                resetForm();
            }
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo eliminar la campaña",
                variant: "destructive",
            });
        }
    };

    const handleMediaUpload = async (file: File) => {
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo subir el archivo");
            }

            setForm((current) => ({
                ...current,
                mediaUrl: result.url,
                mediaType: result.mimeType,
                mediaFileName: result.fileName,
                type: result.mediaCategory === "image" ? "image" : "document",
            }));
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo subir el archivo",
                variant: "destructive",
            });
        } finally {
            setIsUploading(false);
        }
    };

    const handleCsvImport = async (file: File) => {
        setIsImportingCsv(true);
        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("defaultStatus", csvImportStatus);
            formData.append("importTag", csvImportTag.trim());

            const response = await fetch("/api/bulk-campaigns/import-csv", {
                method: "POST",
                body: formData,
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo importar el CSV");
            }

            setForm((current) => ({
                ...current,
                audienceStatuses: current.audienceStatuses.includes(csvImportStatus)
                    ? current.audienceStatuses
                    : [...current.audienceStatuses, csvImportStatus],
                audienceTags: csvImportTag.trim()
                    ? appendCommaSeparatedValue(current.audienceTags, csvImportTag.trim())
                    : current.audienceTags,
            }));
        } catch (error) {
            toast({
                title: "Error",
                description: error instanceof Error ? error.message : "No se pudo importar el CSV",
                variant: "destructive",
            });
        } finally {
            setIsImportingCsv(false);
        }
    };

    const totalPreviewRecipients = audiencePreview?.totals.finalRecipients || form.totalRecipients;
    const averageDelaySeconds = Math.round((form.randomDelayMinSeconds + form.randomDelayMaxSeconds) / 2);
    const messageIntervals = Math.max(totalPreviewRecipients - 1, 0);
    const longPauseCount = form.batchSize > 0
        ? Math.max(Math.ceil(totalPreviewRecipients / form.batchSize) - 1, 0)
        : 0;
    const estimatedDeliveryMinutes = Math.round(
        ((Math.max(messageIntervals - longPauseCount, 0) * averageDelaySeconds) +
            (longPauseCount * form.batchDelayMinutes * 60)) / 60,
    );

    const filteredCampaignList = filteredCampaigns;

    return (
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
            <BulkCampaignCampaignList
                campaigns={filteredCampaignList}
                search={search}
                onSearchChange={setSearch}
                selectedCampaignId={form.id}
                onSelectCampaign={(campaign) => {
                    setForm(mapCampaignToForm(campaign));
                    setActiveVariantIndex(0);
                }}
                onCreateCampaign={resetForm}
                onRefreshCampaigns={() => { void loadCampaigns(false); }}
                isLoading={isLoading}
                form={form}
            />

            <div className="min-w-0 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 min-[1800px]:grid-cols-4">
                    <div className="min-w-0 rounded-[1.6rem] border bg-card p-4 shadow-[0_22px_48px_-40px_rgba(15,23,42,0.5)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Users className="h-4 w-4" />
                            <span className="text-sm">Audiencia final</span>
                        </div>
                        <p className="mt-3 text-2xl font-semibold">{totalPreviewRecipients}</p>
                    </div>
                    <div className="min-w-0 rounded-[1.6rem] border bg-card p-4 shadow-[0_22px_48px_-40px_rgba(15,23,42,0.5)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock3 className="h-4 w-4" />
                            <span className="text-sm">Delay aleatorio</span>
                        </div>
                        <p className="mt-3 text-2xl font-semibold">{form.randomDelayMinSeconds}-{form.randomDelayMaxSeconds}s</p>
                    </div>
                    <div className="min-w-0 rounded-[1.6rem] border bg-card p-4 shadow-[0_22px_48px_-40px_rgba(15,23,42,0.5)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <CalendarClock className="h-4 w-4" />
                            <span className="text-sm">Inicio</span>
                        </div>
                        <p className="mt-3 text-base font-semibold leading-tight">
                            {form.scheduledStartAt ? formatDateTime(new Date(form.scheduledStartAt).toISOString()) : "Inmediato"}
                        </p>
                    </div>
                    <div className="min-w-0 rounded-[1.6rem] border bg-card p-4 shadow-[0_22px_48px_-40px_rgba(15,23,42,0.5)]">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <BarChart3 className="h-4 w-4" />
                            <span className="text-sm">Duración estimada</span>
                        </div>
                        <p className="mt-3 text-2xl font-semibold">{estimatedDeliveryMinutes}m</p>
                    </div>
                </div>

                <div className="min-w-0 rounded-[1.9rem] border bg-card p-5 shadow-[0_28px_70px_-48px_rgba(15,23,42,0.55)]">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <Megaphone className="h-5 w-5 text-primary" />
                                <h2 className="text-xl font-semibold">Constructor de campaña</h2>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Define contenido, audiencia y cadencia desde la misma pantalla.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getStatusBadgeVariant(form.status)} className="capitalize">
                                {form.status}
                            </Badge>
                            <Button onClick={saveCampaign} disabled={isSaving}>
                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Guardar cambios
                            </Button>
                        </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                        {(form.status === "draft" || form.status === "completed" || form.status === "cancelled" || form.status === "failed") && (
                            <Button onClick={() => void runAction("start")} disabled={actionLoading !== null}>
                                {actionLoading === "start" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                                {form.scheduledStartAt ? "Programar campaña" : "Iniciar campaña"}
                            </Button>
                        )}
                        {form.status === "running" && (
                            <Button variant="outline" onClick={() => void runAction("pause")} disabled={actionLoading !== null}>
                                {actionLoading === "pause" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-2 h-4 w-4" />}
                                Pausar
                            </Button>
                        )}
                        {form.status === "paused" && (
                            <Button variant="outline" onClick={() => void runAction("resume")} disabled={actionLoading !== null}>
                                {actionLoading === "resume" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                                Reanudar
                            </Button>
                        )}
                        {(form.status === "running" || form.status === "paused") && (
                            <Button variant="destructive" onClick={() => void runAction("cancel")} disabled={actionLoading !== null}>
                                {actionLoading === "cancel" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
                                Cancelar
                            </Button>
                        )}
                        {form.id && (
                            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void deleteCampaign(form.id!)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar
                            </Button>
                        )}
                    </div>

                    <div className="mt-6 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Nombre de la acción</Label>
                            <Input
                                value={form.name}
                                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                                placeholder="PROMO REACTIVACIÓN 27/03"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Tipo de envío</Label>
                            <Select
                                value={form.type}
                                onValueChange={(value: CampaignFormState["type"]) => setForm((current) => ({ ...current, type: value }))}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Selecciona un tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="text">Solo texto</SelectItem>
                                    <SelectItem value="image">Imagen + caption</SelectItem>
                                    <SelectItem value="document">Documento + caption</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Tabs defaultValue="message" className="mt-6 min-w-0 space-y-6">
                        <TabsList
                            variant="line"
                            className="h-auto w-full flex-wrap justify-start rounded-2xl border bg-muted/20 p-1"
                        >
                            <TabsTrigger value="message" className="min-h-10 rounded-xl px-4">Mensaje</TabsTrigger>
                            <TabsTrigger value="audience" className="min-h-10 rounded-xl px-4">Audiencia</TabsTrigger>
                            <TabsTrigger value="schedule" className="min-h-10 rounded-xl px-4">Programación</TabsTrigger>
                        </TabsList>

                        <TabsContent value="message" className="min-w-0">
                            <BulkCampaignMessageTab
                                form={form}
                                activeVariantIndex={activeVariantIndex}
                                onActiveVariantIndexChange={setActiveVariantIndex}
                                activeVariant={activeVariant}
                                previewContent={previewContent}
                                detectedVariables={detectedVariables}
                                isUploading={isUploading}
                                onMediaUpload={handleMediaUpload}
                                onFormChange={(updater) => setForm(updater)}
                                onVariantChange={updateVariant}
                                onAddVariant={addVariant}
                                onRemoveVariant={removeVariant}
                            />
                        </TabsContent>

                        <TabsContent value="audience" className="min-w-0">
                            <BulkCampaignAudienceTab
                                form={form}
                                audiencePreview={audiencePreview}
                                isPreviewLoading={isPreviewLoading}
                                manualEntryCount={manualEntries.length}
                                csvImportStatus={csvImportStatus}
                                csvImportTag={csvImportTag}
                                isImportingCsv={isImportingCsv}
                                onFormChange={(updater) => setForm(updater)}
                                onContactToggle={(contactId, checked) =>
                                    setForm((current) => ({
                                        ...current,
                                        audienceMode: checked && current.audienceMode === "filters" ? "mixed" : current.audienceMode,
                                        audienceSelectedContactIds: checked
                                            ? Array.from(new Set([...current.audienceSelectedContactIds, contactId]))
                                            : current.audienceSelectedContactIds.filter((id) => id !== contactId),
                                    }))
                                }
                                onSelectVisibleCandidates={() =>
                                    setForm((current) => ({
                                        ...current,
                                        audienceMode: current.audienceMode === "filters" ? "mixed" : current.audienceMode,
                                        audienceSelectedContactIds: Array.from(new Set([
                                            ...current.audienceSelectedContactIds,
                                            ...(audiencePreview?.candidates.map((contact) => contact.id) || []),
                                        ])),
                                    }))
                                }
                                onClearSelectedContacts={() =>
                                    setForm((current) => ({
                                        ...current,
                                        audienceSelectedContactIds: [],
                                    }))
                                }
                                onCsvImportStatusChange={setCsvImportStatus}
                                onCsvImportTagChange={setCsvImportTag}
                                onCsvImport={handleCsvImport}
                            />
                        </TabsContent>

                        <TabsContent value="schedule" className="min-w-0">
                            <BulkCampaignScheduleTab
                                form={form}
                                totalPreviewRecipients={totalPreviewRecipients}
                                estimatedDeliveryMinutes={estimatedDeliveryMinutes}
                                onFormChange={(updater) => setForm(updater)}
                            />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
