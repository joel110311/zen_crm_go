"use client";

import { FileImage, FileText, Loader2, Plus, Trash2, Upload, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WhatsAppTemplatePreview } from "@/components/templates/whatsapp-template-preview";
import { getSafeMediaUrl } from "@/lib/media-url";
import { TEMPLATE_VARIABLES } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type {
    CampaignFormState,
    CampaignVariantFormState,
} from "@/components/settings/bulk-campaign-manager-shared";

type BulkCampaignMessageTabProps = {
    form: CampaignFormState;
    activeVariantIndex: number;
    onActiveVariantIndexChange: (index: number) => void;
    activeVariant: CampaignVariantFormState;
    previewContent: string;
    detectedVariables: string[];
    isUploading: boolean;
    onMediaUpload: (file: File) => Promise<void>;
    onFormChange: (updater: (current: CampaignFormState) => CampaignFormState) => void;
    onVariantChange: (
        index: number,
        updater: (variant: CampaignVariantFormState) => CampaignVariantFormState,
    ) => void;
    onAddVariant: () => void;
    onRemoveVariant: (index: number) => void;
};

export function BulkCampaignMessageTab({
    form,
    activeVariantIndex,
    onActiveVariantIndexChange,
    activeVariant,
    previewContent,
    detectedVariables,
    isUploading,
    onMediaUpload,
    onFormChange,
    onVariantChange,
    onAddVariant,
    onRemoveVariant,
}: BulkCampaignMessageTabProps) {
    const previewMediaUrl = getSafeMediaUrl(form.mediaUrl);

    return (
        <div className="space-y-5">
            {form.type !== "text" ? (
                <div className="rounded-[1.5rem] border bg-muted/15 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="font-medium">Adjunto compartido</p>
                            <p className="text-sm text-muted-foreground">
                                La pieza va en todos los envíos; las variantes cambian el caption.
                            </p>
                        </div>
                        <label className="inline-flex cursor-pointer items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted/40">
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            Subir archivo
                            <input
                                type="file"
                                className="hidden"
                                accept={form.type === "image" ? "image/*" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) void onMediaUpload(file);
                                    event.currentTarget.value = "";
                                }}
                            />
                        </label>
                    </div>

                    <div className="mt-4 rounded-2xl border bg-background/85 p-4">
                        {form.mediaUrl ? (
                            form.type === "image" ? (
                                previewMediaUrl ? (
                                    <img
                                        src={previewMediaUrl}
                                        alt={form.mediaFileName || "Campaña"}
                                        className="max-h-56 rounded-2xl object-contain"
                                    />
                                ) : (
                                    <div className="flex h-44 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                                        <FileImage className="h-9 w-9" />
                                    </div>
                                )
                            ) : (
                                <div className="flex items-center gap-3">
                                    <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">{form.mediaFileName || "Documento"}</p>
                                        <p className="text-xs text-muted-foreground">{form.mediaType || "application/octet-stream"}</p>
                                    </div>
                                </div>
                            )
                        ) : (
                            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                                Esta campaña aún no tiene archivo adjunto.
                            </div>
                        )}
                    </div>
                </div>
            ) : null}

            <div className="grid gap-5 min-[1800px]:grid-cols-[0.95fr_1.05fr]">
                <div className="min-w-0 space-y-4 rounded-[1.5rem] border bg-muted/15 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h3 className="font-medium">Variaciones del mensaje</h3>
                            <p className="text-sm text-muted-foreground">
                                Cada destinatario toma una variante activa para bajar la repetición.
                            </p>
                        </div>
                        <Button variant="outline" size="sm" onClick={onAddVariant}>
                            <Plus className="mr-2 h-4 w-4" />
                            Agregar
                        </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {form.variants.map((variant, index) => (
                            <button
                                key={`${variant.label}-${index}`}
                                type="button"
                                onClick={() => onActiveVariantIndexChange(index)}
                                className={cn(
                                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                                    index === activeVariantIndex
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "hover:border-primary/35",
                                )}
                            >
                                {variant.label}
                            </button>
                        ))}
                    </div>

                    <div className="space-y-3 rounded-[1.3rem] border bg-background/90 p-4">
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(120px,0.7fr)_auto]">
                            <div className="space-y-2">
                                <Label>Etiqueta</Label>
                                <Input
                                    value={activeVariant.label}
                                    onChange={(event) =>
                                        onVariantChange(activeVariantIndex, (variant) => ({
                                            ...variant,
                                            label: event.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Peso</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    value={String(activeVariant.weight)}
                                    onChange={(event) =>
                                        onVariantChange(activeVariantIndex, (variant) => ({
                                            ...variant,
                                            weight: Number.parseInt(event.target.value || "1", 10) || 1,
                                        }))
                                    }
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Activa</Label>
                                <div className="flex h-11 items-center justify-between rounded-xl border px-3">
                                    <Switch
                                        checked={activeVariant.isActive}
                                        onCheckedChange={(checked) =>
                                            onVariantChange(activeVariantIndex, (variant) => ({
                                                ...variant,
                                                isActive: checked,
                                            }))
                                        }
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-destructive hover:text-destructive"
                                        onClick={() => onRemoveVariant(activeVariantIndex)}
                                        disabled={form.variants.length === 1}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Mensaje / caption</Label>
                            <Textarea
                                value={activeVariant.content}
                                onChange={(event) =>
                                    onVariantChange(activeVariantIndex, (variant) => ({
                                        ...variant,
                                        content: event.target.value,
                                    }))
                                }
                                placeholder={form.type === "text" ? "Escribe la variante del mensaje..." : "Caption opcional para esta variación..."}
                                className="min-h-[200px]"
                            />
                        </div>
                    </div>

                    <div className="rounded-[1.3rem] border bg-background/90 p-4">
                        <p className="font-medium">Variables disponibles</p>
                        <p className="text-sm text-muted-foreground">
                            Se reemplazan con datos del contacto y del agente en el envío real.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {TEMPLATE_VARIABLES.map((variable) => (
                                <button
                                    key={variable.key}
                                    type="button"
                                    onClick={() =>
                                        onVariantChange(activeVariantIndex, (variant) => ({
                                            ...variant,
                                            content: variant.content
                                                ? `${variant.content}${variant.content.endsWith(" ") ? "" : " "}${variable.placeholder}`
                                                : variable.placeholder,
                                        }))
                                    }
                                    className="rounded-full border px-3 py-1 text-xs font-medium hover:border-primary hover:text-primary"
                                >
                                    {variable.placeholder}
                                </button>
                            ))}
                        </div>
                        {detectedVariables.length > 0 ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                                Detectadas: {detectedVariables.map((key) => `{{${key}}}`).join(", ")}
                            </p>
                        ) : null}
                    </div>
                </div>

                <div className="min-w-0 space-y-4">
                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <div className="flex items-center gap-2">
                            <WandSparkles className="h-4 w-4 text-primary" />
                            <p className="font-medium">Vista previa de WhatsApp</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Render con datos de ejemplo para validar tono, estructura y adjunto.
                        </p>
                        <div className="mt-4">
                            <WhatsAppTemplatePreview
                                title={form.name || "Campaña masiva"}
                                subtitle={`Variante ${activeVariant.label || "A"}`}
                                type={form.type}
                                content={previewContent}
                                mediaUrl={previewMediaUrl}
                                mediaType={form.mediaType}
                                mediaFileName={form.mediaFileName}
                            />
                        </div>
                    </div>

                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <p className="font-medium">Estrategia aplicada</p>
                        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                            <div className="rounded-xl border bg-background/80 p-3">
                                En cada mini-lote se enviarán <span className="font-semibold text-foreground">{form.batchSize}</span> mensajes,
                                cada uno con un delay aleatorio entre <span className="font-semibold text-foreground">{form.randomDelayMinSeconds}</span> y <span className="font-semibold text-foreground">{form.randomDelayMaxSeconds}</span> segundos.
                            </div>
                            <div className="rounded-xl border bg-background/80 p-3">
                                Después del sublote, el motor esperará <span className="font-semibold text-foreground">{form.batchDelayMinutes}</span> minutos antes de volver a disparar.
                            </div>
                            <div className="rounded-xl border bg-background/80 p-3">
                                {form.stopOnReply
                                    ? "Si el contacto responde, la campaña lo marca como respondido y corta seguimiento automático."
                                    : "La campaña no se detendrá automáticamente cuando detecte respuesta."}
                            </div>
                        </div>
                    </div>

                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <p className="font-medium">Borrador</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border bg-background/80 p-3 text-sm">
                                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tipo</p>
                                <p className="mt-2 font-medium">{form.type}</p>
                            </div>
                            <div className="rounded-xl border bg-background/80 p-3 text-sm">
                                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Variantes activas</p>
                                <p className="mt-2 font-medium">{form.variants.filter((variant) => variant.isActive).length}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Descripción interna</Label>
                <Textarea
                    value={form.description}
                    onChange={(event) => onFormChange((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Para auditar esta ola, equipo responsable, objetivo, etc."
                    className="min-h-[90px]"
                />
            </div>
        </div>
    );
}
