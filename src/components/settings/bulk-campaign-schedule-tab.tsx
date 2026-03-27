"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarClock, CheckCircle2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { CampaignFormState } from "@/components/settings/bulk-campaign-manager-shared";
import { formatDateTime, getAudienceModeLabel } from "@/components/settings/bulk-campaign-manager-shared";
import { cn } from "@/lib/utils";

type BulkCampaignScheduleTabProps = {
    form: CampaignFormState;
    totalPreviewRecipients: number;
    estimatedDeliveryMinutes: number;
    onFormChange: (updater: (current: CampaignFormState) => CampaignFormState) => void;
};

function padDatePart(value: number) {
    return String(value).padStart(2, "0");
}

function buildLocalDateTimeValue(date: Date) {
    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function parseLocalDateTimeValue(value: string) {
    if (!value) return null;

    const [datePart, timePart] = value.split("T");
    if (!datePart || !timePart) return null;

    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);

    if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
        return null;
    }

    return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function buildDefaultScheduledStartValue() {
    const next = new Date();
    next.setSeconds(0, 0);

    const roundedMinutes = Math.ceil(next.getMinutes() / 5) * 5;
    if (roundedMinutes >= 60) {
        next.setHours(next.getHours() + 1, 0, 0, 0);
    } else {
        next.setMinutes(roundedMinutes, 0, 0);
    }

    return buildLocalDateTimeValue(next);
}

type ScheduledStartPickerProps = {
    value: string;
    onChange: (value: string) => void;
};

function ScheduledStartPicker({ value, onChange }: ScheduledStartPickerProps) {
    const [open, setOpen] = useState(false);
    const [draftValue, setDraftValue] = useState(value || buildDefaultScheduledStartValue());

    const draftDate = useMemo(
        () => parseLocalDateTimeValue(draftValue) ?? parseLocalDateTimeValue(buildDefaultScheduledStartValue()) ?? new Date(),
        [draftValue],
    );

    const draftTime = `${padDatePart(draftDate.getHours())}:${padDatePart(draftDate.getMinutes())}`;
    const triggerLabel = value
        ? formatDateTime(parseLocalDateTimeValue(value)?.toISOString() || null)
        : "Seleccionar fecha y hora";

    const handleDateChange = (date: Date | undefined) => {
        if (!date) return;

        const nextDate = new Date(date);
        nextDate.setHours(draftDate.getHours(), draftDate.getMinutes(), 0, 0);
        setDraftValue(buildLocalDateTimeValue(nextDate));
    };

    const handleTimeChange = (nextTime: string) => {
        const [hours, minutes] = nextTime.split(":").map(Number);
        if ([hours, minutes].some((part) => Number.isNaN(part))) {
            return;
        }

        const nextDate = new Date(draftDate);
        nextDate.setHours(hours, minutes, 0, 0);
        setDraftValue(buildLocalDateTimeValue(nextDate));
    };

    const handleCancel = () => {
        setDraftValue(value || buildDefaultScheduledStartValue());
        setOpen(false);
    };

    const handleApply = () => {
        onChange(draftValue);
        setOpen(false);
    };

    const handleClear = () => {
        onChange("");
        setDraftValue(buildDefaultScheduledStartValue());
        setOpen(false);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (nextOpen) {
            setDraftValue(value || buildDefaultScheduledStartValue());
        }
        setOpen(nextOpen);
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full justify-between rounded-xl px-3 font-normal"
                >
                    <span className={cn("truncate text-left", !value && "text-muted-foreground")}>
                        {triggerLabel}
                    </span>
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-[min(100vw-2rem,24rem)] p-0">
                <div className="border-b px-4 py-3">
                    <p className="font-medium">Programar inicio</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Elige fecha y hora y confirma con <span className="font-medium text-foreground">Aplicar</span>.
                    </p>
                </div>

                <div className="space-y-4 p-4">
                    <div className="rounded-[1.25rem] border bg-background/90 p-2">
                        <Calendar
                            mode="single"
                            selected={draftDate}
                            onSelect={handleDateChange}
                            locale={es}
                            initialFocus
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="bulk-campaign-start-time">Hora de inicio</Label>
                        <Input
                            id="bulk-campaign-start-time"
                            type="time"
                            step={60}
                            value={draftTime}
                            onChange={(event) => handleTimeChange(event.target.value)}
                        />
                    </div>

                    <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                        Quedará programada para{" "}
                        <span className="font-medium text-foreground">
                            {format(draftDate, "PPP '·' p", { locale: es })}
                        </span>
                        .
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
                    <Button type="button" variant="ghost" size="sm" onClick={handleClear} disabled={!value}>
                        Quitar programación
                    </Button>
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                            Cancelar
                        </Button>
                        <Button type="button" size="sm" onClick={handleApply}>
                            Aplicar
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function BulkCampaignScheduleTab({
    form,
    totalPreviewRecipients,
    estimatedDeliveryMinutes,
    onFormChange,
}: BulkCampaignScheduleTabProps) {
    return (
        <div className="grid gap-5 min-[1800px]:grid-cols-[1.02fr_0.98fr]">
            <div className="min-w-0 space-y-5">
                <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-primary" />
                        <p className="font-medium">Disparo inicial</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Si dejas este campo vacío, la campaña inicia en cuanto pulses empezar.
                    </p>
                    <div className="mt-4 space-y-2">
                        <Label>Programar inicio</Label>
                        <ScheduledStartPicker
                            value={form.scheduledStartAt}
                            onChange={(value) =>
                                onFormChange((current) => ({ ...current, scheduledStartAt: value }))
                            }
                        />
                    </div>
                </div>

                <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-primary" />
                        <p className="font-medium">Pacing humano</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Así rompes el patrón rígido entre mensajes y haces más natural la campaña.
                    </p>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Delay mínimo por mensaje (segundos)</Label>
                            <Input
                                type="number"
                                min={5}
                                max={1800}
                                value={String(form.randomDelayMinSeconds)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        randomDelayMinSeconds: Number.parseInt(event.target.value || "25", 10) || 25,
                                    }))
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Delay máximo por mensaje (segundos)</Label>
                            <Input
                                type="number"
                                min={5}
                                max={1800}
                                value={String(form.randomDelayMaxSeconds)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        randomDelayMaxSeconds: Number.parseInt(event.target.value || "75", 10) || 75,
                                    }))
                                }
                            />
                        </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Tamaño de sublote</Label>
                            <Input
                                type="number"
                                min={1}
                                max={100}
                                value={String(form.batchSize)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        batchSize: Number.parseInt(event.target.value || "3", 10) || 3,
                                    }))
                                }
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Pausa larga tras cada sublote (minutos)</Label>
                            <Input
                                type="number"
                                min={0}
                                max={1440}
                                value={String(form.batchDelayMinutes)}
                                onChange={(event) =>
                                    onFormChange((current) => ({
                                        ...current,
                                        batchDelayMinutes: Number.parseInt(event.target.value || "0", 10) || 0,
                                    }))
                                }
                            />
                        </div>
                    </div>
                </div>

                <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <p className="font-medium">Guardarraíles</p>
                    </div>
                    <div className="mt-4 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[1.2rem] border bg-background/85 px-4 py-3">
                            <div>
                                <p className="font-medium">Respetar horario hábil del CRM</p>
                                <p className="text-sm text-muted-foreground">
                                    Usa la franja horaria definida en configuración.
                                </p>
                            </div>
                            <Switch
                                checked={form.respectBusinessHours}
                                onCheckedChange={(checked) =>
                                    onFormChange((current) => ({ ...current, respectBusinessHours: checked }))
                                }
                                className="shrink-0"
                            />
                        </div>

                        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[1.2rem] border bg-background/85 px-4 py-3">
                            <div>
                                <p className="font-medium">Cortar seguimiento si el lead responde</p>
                                <p className="text-sm text-muted-foreground">
                                    Evita insistir cuando ya hubo interacción humana.
                                </p>
                            </div>
                            <Switch
                                checked={form.stopOnReply}
                                onCheckedChange={(checked) =>
                                    onFormChange((current) => ({ ...current, stopOnReply: checked }))
                                }
                                className="shrink-0"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="min-w-0 space-y-5">
                <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                    <div className="flex items-center gap-2">
                        <Clock3 className="h-4 w-4 text-primary" />
                        <p className="font-medium">Simulación de arranque</p>
                    </div>
                    <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                        <div className="rounded-xl border bg-background/85 p-3">
                            Primer disparo: <span className="font-semibold text-foreground">{form.scheduledStartAt ? formatDateTime(new Date(form.scheduledStartAt).toISOString()) : "cuando pulses iniciar"}</span>
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            Luego el sistema intercalará delays de <span className="font-semibold text-foreground">{form.randomDelayMinSeconds}</span> a <span className="font-semibold text-foreground">{form.randomDelayMaxSeconds}</span> segundos por mensaje.
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            Cada {form.batchSize} mensajes aplicará una pausa larga de {form.batchDelayMinutes} minutos.
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            Duración estimada para esta audiencia: <span className="font-semibold text-foreground">{estimatedDeliveryMinutes} minutos</span> para {totalPreviewRecipients} contactos.
                        </div>
                    </div>
                </div>

                <div className="min-w-0 rounded-[1.5rem] border bg-muted/15 p-4">
                    <p className="font-medium">Resumen operativo</p>
                    <div className="mt-4 grid gap-3 text-sm">
                        <div className="rounded-xl border bg-background/85 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Estado actual</p>
                            <p className="mt-2 font-medium capitalize">{form.status}</p>
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Modo de audiencia</p>
                            <p className="mt-2 font-medium">{getAudienceModeLabel(form.audienceMode)}</p>
                        </div>
                        <div className="rounded-xl border bg-background/85 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cadencia</p>
                            <p className="mt-2 font-medium">
                                {form.batchSize} mensajes por sublote, {form.batchDelayMinutes} min de pausa larga.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
