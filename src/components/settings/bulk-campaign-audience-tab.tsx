"use client";

import { BarChart3, Loader2, Phone, Upload, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
    AUDIENCE_MODE_OPTIONS,
    type AudiencePreview,
    type CampaignFormState,
    CONTACT_STATUSES,
    formatPhone,
    getPreviewMatchLabel,
} from "@/components/settings/bulk-campaign-manager-shared";

function AudienceBreakdownBars({
    items,
    tone = "primary",
}: {
    items: Array<{ label: string; value: number }>;
    tone?: "primary" | "emerald";
}) {
    const total = items.reduce((sum, item) => sum + item.value, 0);

    if (items.length === 0 || total === 0) {
        return (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                Todavía no hay suficiente audiencia para graficar.
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {items.map((item) => {
                const percentage = Math.max(4, Math.round((item.value / total) * 100));
                return (
                    <div key={item.label} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium text-foreground">{item.label}</span>
                            <span className="text-muted-foreground">{item.value}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted/60">
                            <div
                                className={cn(
                                    "h-full rounded-full",
                                    tone === "primary" ? "bg-primary" : "bg-emerald-500",
                                )}
                                style={{ width: `${percentage}%` }}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

type BulkCampaignAudienceTabProps = {
    form: CampaignFormState;
    audiencePreview: AudiencePreview | null;
    isPreviewLoading: boolean;
    manualEntryCount: number;
    csvImportStatus: string;
    csvImportTag: string;
    isImportingCsv: boolean;
    onFormChange: (updater: (current: CampaignFormState) => CampaignFormState) => void;
    onContactToggle: (contactId: string, checked: boolean) => void;
    onSelectVisibleCandidates: () => void;
    onClearSelectedContacts: () => void;
    onCsvImportStatusChange: (value: string) => void;
    onCsvImportTagChange: (value: string) => void;
    onCsvImport: (file: File) => Promise<void>;
};

export function BulkCampaignAudienceTab({
    form,
    audiencePreview,
    isPreviewLoading,
    manualEntryCount,
    csvImportStatus,
    csvImportTag,
    isImportingCsv,
    onFormChange,
    onContactToggle,
    onSelectVisibleCandidates,
    onClearSelectedContacts,
    onCsvImportStatusChange,
    onCsvImportTagChange,
    onCsvImport,
}: BulkCampaignAudienceTabProps) {
    return (
        <div className="space-y-5">
            <div className="rounded-[1.5rem] border bg-muted/15 p-4">
                <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <p className="font-medium">Cómo se arma la audiencia</p>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                    Elige si quieres usar todo lo filtrado, una lista fija, o una mezcla de ambas.
                </p>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    {AUDIENCE_MODE_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => onFormChange((current) => ({ ...current, audienceMode: option.value }))}
                            className={cn(
                                "rounded-[1.25rem] border px-4 py-4 text-left transition-all",
                                form.audienceMode === option.value
                                    ? "border-primary bg-primary/5 shadow-[0_18px_40px_-34px_rgba(37,99,235,0.55)]"
                                    : "hover:border-border/80 hover:bg-background/80",
                            )}
                        >
                            <p className="font-medium">{option.label}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{option.hint}</p>
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid gap-5 min-[1800px]:grid-cols-[1.08fr_0.92fr]">
                <div className="min-w-0 space-y-5">
                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="font-medium">Filtros del CRM</p>
                                <p className="text-sm text-muted-foreground">
                                    Esta tabla te muestra los contactos visibles para agregar o para incluir por filtro.
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                {audiencePreview ? `${audiencePreview.totals.filterMatches} coincidencias` : "Sin datos"}
                            </div>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Estados</Label>
                                <div className="grid gap-2 rounded-[1.25rem] border bg-background/80 p-3">
                                    {CONTACT_STATUSES.map((status) => (
                                        <label key={status.value} className="flex items-center gap-3 text-sm">
                                            <Checkbox
                                                checked={form.audienceStatuses.includes(status.value)}
                                                onCheckedChange={(checked) =>
                                                    onFormChange((current) => ({
                                                        ...current,
                                                        audienceStatuses: checked
                                                            ? Array.from(new Set([...current.audienceStatuses, status.value]))
                                                            : current.audienceStatuses.filter((value) => value !== status.value),
                                                    }))
                                                }
                                            />
                                            <span>{status.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="space-y-2">
                                    <Label>Tags (coma separada)</Label>
                                    <Input
                                        value={form.audienceTags}
                                        onChange={(event) =>
                                            onFormChange((current) => ({ ...current, audienceTags: event.target.value }))
                                        }
                                        placeholder="vip, reacondicionado, norte"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Búsqueda / límite</Label>
                                    <Input
                                        value={form.audienceQuery}
                                        onChange={(event) =>
                                            onFormChange((current) => ({ ...current, audienceQuery: event.target.value }))
                                        }
                                        placeholder="Nombre, empresa o teléfono"
                                    />
                                    <Input
                                        type="number"
                                        min={1}
                                        value={form.audienceLimit}
                                        onChange={(event) =>
                                            onFormChange((current) => ({ ...current, audienceLimit: event.target.value }))
                                        }
                                        placeholder="Límite opcional"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 min-w-0 overflow-hidden rounded-[1.3rem] border bg-background/85">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                                <div>
                                    <p className="text-sm font-medium">Contactos visibles para agregar</p>
                                    <p className="text-xs text-muted-foreground">
                                        Puedes marcar contactos puntuales para una lista fija.
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={onSelectVisibleCandidates} disabled={!audiencePreview?.candidates.length}>
                                        Seleccionar visibles
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={onClearSelectedContacts} disabled={form.audienceSelectedContactIds.length === 0}>
                                        Limpiar selección
                                    </Button>
                                </div>
                            </div>

                            <Table className="min-w-[720px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12">Sel.</TableHead>
                                        <TableHead>Contacto</TableHead>
                                        <TableHead>Empresa</TableHead>
                                        <TableHead>Teléfono</TableHead>
                                        <TableHead>Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(audiencePreview?.candidates || []).length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                                                {isPreviewLoading ? "Calculando audiencia..." : "No hay contactos visibles con esos filtros."}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        audiencePreview?.candidates.map((contact) => {
                                            const fullName = [contact.name, contact.lastName].filter(Boolean).join(" ").trim() || "Sin nombre";
                                            const isSelected = form.audienceSelectedContactIds.includes(contact.id);
                                            return (
                                                <TableRow key={contact.id}>
                                                    <TableCell>
                                                        <Checkbox
                                                            checked={isSelected}
                                                            onCheckedChange={(checked) => onContactToggle(contact.id, checked === true)}
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <div>
                                                            <p className="font-medium">{fullName}</p>
                                                            {contact.email ? (
                                                                <p className="text-xs text-muted-foreground">{contact.email}</p>
                                                            ) : null}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>{contact.company || "—"}</TableCell>
                                                    <TableCell>{formatPhone(contact.phone)}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="capitalize">
                                                            {contact.status}
                                                        </Badge>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-primary" />
                            <p className="font-medium">Números agregados manualmente</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Un número por línea. Puedes usar <span className="font-medium text-foreground">Nombre | teléfono</span> o solo teléfono.
                        </p>
                        <Textarea
                            value={form.manualAudienceText}
                            onChange={(event) =>
                                onFormChange((current) => ({ ...current, manualAudienceText: event.target.value }))
                            }
                            className="mt-4 min-h-[170px]"
                            placeholder={`Karen | +5215512345678\n+5215511223344\nBodega norte, +5215511122233`}
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                            Se detectaron {manualEntryCount} entradas válidas.
                        </p>
                    </div>

                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <p className="font-medium">Importar datos por CSV</p>
                                <p className="text-sm text-muted-foreground">
                                    Sube contactos al CRM para incorporarlos a esta audiencia.
                                </p>
                            </div>
                            <label className="inline-flex cursor-pointer items-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted/40">
                                {isImportingCsv ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                Subir CSV
                                <input
                                    type="file"
                                    className="hidden"
                                    accept=".csv,text/csv"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) void onCsvImport(file);
                                        event.currentTarget.value = "";
                                    }}
                                />
                            </label>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Estado base</Label>
                                <Select value={csvImportStatus} onValueChange={onCsvImportStatusChange}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Selecciona un estado" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CONTACT_STATUSES.map((status) => (
                                            <SelectItem key={status.value} value={status.value}>
                                                {status.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Tag opcional</Label>
                                <Input
                                    value={csvImportTag}
                                    onChange={(event) => onCsvImportTagChange(event.target.value)}
                                    placeholder="hot-list-marzo"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="min-w-0 space-y-5">
                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="font-medium">Resumen gráfico</p>
                                <p className="text-sm text-muted-foreground">
                                    Para validar mezcla de fuentes y distribución del público.
                                </p>
                            </div>
                            {isPreviewLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                            <div className="min-w-0 rounded-[1.2rem] border bg-background/85 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Fuentes
                                </p>
                                <div className="mt-4">
                                    <AudienceBreakdownBars items={audiencePreview?.sourceBreakdown || []} />
                                </div>
                            </div>
                            <div className="min-w-0 rounded-[1.2rem] border bg-background/85 p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Estados
                                </p>
                                <div className="mt-4">
                                    <AudienceBreakdownBars
                                        items={(audiencePreview?.statusBreakdown || []).map((item) => ({
                                            label: item.status,
                                            value: item.value,
                                        }))}
                                        tone="emerald"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                        <div className="flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-primary" />
                            <p className="font-medium">Contactos a los que se les va a enviar</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Vista previa de la audiencia final ya mezclada y deduplicada.
                        </p>

                        <div className="mt-4 min-w-0 overflow-hidden rounded-[1.3rem] border bg-background/85">
                            <Table className="min-w-[640px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Contacto</TableHead>
                                        <TableHead>Teléfono</TableHead>
                                        <TableHead>Fuente</TableHead>
                                        <TableHead>Entrada</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(audiencePreview?.finalRecipients || []).length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                                                Todavía no hay destinatarios armados para esta campaña.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        audiencePreview?.finalRecipients.map((recipient) => (
                                            <TableRow key={recipient.key}>
                                                <TableCell>
                                                    <div>
                                                        <p className="font-medium">{recipient.name}</p>
                                                        {recipient.company ? (
                                                            <p className="text-xs text-muted-foreground">{recipient.company}</p>
                                                        ) : null}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{formatPhone(recipient.phone)}</TableCell>
                                                <TableCell>
                                                    <Badge variant={recipient.source === "crm" ? "outline" : "secondary"}>
                                                        {recipient.source === "crm" ? "CRM" : "Manual"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{getPreviewMatchLabel(recipient.matchedBy)}</Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {audiencePreview && audiencePreview.totals.finalRecipients > audiencePreview.finalRecipients.length ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                                Mostrando {audiencePreview.finalRecipients.length} de {audiencePreview.totals.finalRecipients} destinatarios finales.
                            </p>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
