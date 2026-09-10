"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { getAppointments, deleteAppointment } from "@/app/actions/calendar";
import { getSystemSettings } from "@/app/actions/settings";
import { BigCalendar } from "@/components/calendar/big-calendar";
import { AppointmentList } from "@/components/calendar/appointment-list";
import { AppointmentDialog } from "@/components/calendar/appointment-dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Plus,
    LayoutList,
    Calendar as CalendarIcon,
    Filter,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { formatBusinessScheduleSummary, normalizeBusinessHours } from "@/lib/calendar/business-hours";

type CalendarSourceFilter = {
    calendarId: string;
    summary: string;
    backgroundColor?: string | null;
    isSelected: boolean;
    isSpecialist: boolean;
    specialistName?: string | null;
};

type CalendarFilterOption = {
    id: string;
    label: string;
    color: string;
    caption: string;
};

const DEFAULT_FILTER_COLOR = "#111111";
const INTERNAL_FILTER_COLOR = "#64748B";
const ALL_FILTER_COLOR = "#0F172A";

function normalizeFilterColor(value?: string | null) {
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_FILTER_COLOR;
}

function normalizeAppointments(data: any[]) {
    const now = new Date();
    return data.map((apt) => {
        if (apt.status === "scheduled" && new Date(apt.endTime) < now) {
            return { ...apt, status: "completed" };
        }
        return apt;
    });
}

export default function CalendarPage() {
    const [appointments, setAppointments] = useState<any[]>([]);
    const [calendarSources, setCalendarSources] = useState<CalendarSourceFilter[]>([]);
    const [activeCalendarFilter, setActiveCalendarFilter] = useState("all");
    const [view, setView] = useState<"list" | "calendar">("calendar");
    const [statusFilter, setStatusFilter] = useState("all");
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<any>(null);
    const [selectedSlot, setSelectedSlot] = useState<{ start: Date; end: Date } | null>(null);
    const [businessHours, setBusinessHours] = useState(() => normalizeBusinessHours());

    const applyAppointmentsState = useCallback((data: any[]) => {
        setAppointments(normalizeAppointments(data));
    }, []);

    const fetchAppointments = useCallback(async () => {
        const calendarStatusPromise = fetch("/api/google-calendar/status", { cache: "no-store" })
            .then(async (response) => (response.ok ? response.json() : null))
            .catch(() => null);

        const [data, settings, calendarStatus] = await Promise.all([
            getAppointments(),
            getSystemSettings(),
            calendarStatusPromise,
        ]);

        applyAppointmentsState(data);
        setBusinessHours(normalizeBusinessHours(settings));
        setCalendarSources(Array.isArray(calendarStatus?.sources) ? calendarStatus.sources : []);
    }, [applyAppointmentsState]);

    useEffect(() => {
        void fetchAppointments();
    }, [fetchAppointments]);

    const filterOptions = useMemo<CalendarFilterOption[]>(() => {
        const options: CalendarFilterOption[] = [
            {
                id: "all",
                label: "Todos",
                color: ALL_FILTER_COLOR,
                caption: `${appointments.length} citas`,
            },
        ];

        const selectedSources = calendarSources.filter((source) => source.isSelected);
        for (const source of selectedSources) {
            options.push({
                id: source.calendarId,
                label: source.isSpecialist
                    ? (source.specialistName || source.summary || source.calendarId)
                    : (source.summary || source.calendarId),
                color: normalizeFilterColor(source.backgroundColor),
                caption: source.isSpecialist ? "Especialista" : "Calendario",
            });
        }

        if (appointments.some((apt) => !apt.googleCalendarId)) {
            options.push({
                id: "internal",
                label: "CRM",
                color: INTERNAL_FILTER_COLOR,
                caption: "Interno",
            });
        }

        return options;
    }, [appointments, calendarSources]);

    useEffect(() => {
        if (activeCalendarFilter === "all") return;
        if (!filterOptions.some((option) => option.id === activeCalendarFilter)) {
            setActiveCalendarFilter("all");
        }
    }, [activeCalendarFilter, filterOptions]);

    const filteredAppointments = useMemo(() => appointments.filter((apt) => {
        const matchesCalendar = activeCalendarFilter === "all"
            || activeCalendarFilter === "internal" && !apt.googleCalendarId
            || apt.googleCalendarId === activeCalendarFilter;
        return matchesCalendar && (statusFilter === "all" || apt.status === statusFilter);
    }), [activeCalendarFilter, appointments, statusFilter]);

    const activeFilterMeta = useMemo(
        () => filterOptions.find((option) => option.id === activeCalendarFilter) || filterOptions[0],
        [activeCalendarFilter, filterOptions],
    );

    const handleEdit = (apt: any) => {
        const event = {
            id: apt.id,
            title: apt.title,
            start: new Date(apt.startTime),
            end: new Date(apt.endTime),
            notes: apt.notes,
            resource: {
                contact: apt.contact,
                googleCalendarId: apt.googleCalendarId,
                googleCalendarName: apt.googleCalendarName,
                googleCalendarColor: apt.googleCalendarColor,
                specialistName: apt.specialistName,
            },
        };
        setSelectedEvent(event);
        setSelectedSlot(null);
        setIsDialogOpen(true);
    };

    const handleSelectSlot = (slot: { start: Date; end: Date }) => {
        setSelectedSlot(slot);
        setSelectedEvent(null);
        setIsDialogOpen(true);
    };

    const handleSelectEvent = (event: any) => {
        setSelectedEvent(event);
        setSelectedSlot(null);
        setIsDialogOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("¿Eliminar cita?")) return;
        const result = await deleteAppointment(id);
        if (!result.success) {
            toast({ title: "No se eliminó la cita", description: result.error, variant: "destructive" });
            return;
        }
        toast({ title: "Cita eliminada" });
        void fetchAppointments();
    };

    const handleNew = () => {
        setSelectedEvent(null);
        setSelectedSlot(null);
        setIsDialogOpen(true);
    };

    const handleAppointmentTimeChange = useCallback((appointmentId: string, start: Date, end: Date) => {
        setAppointments((prev) =>
            normalizeAppointments(
                prev.map((apt) =>
                    apt.id === appointmentId
                        ? {
                              ...apt,
                              startTime: start,
                              endTime: end,
                          }
                        : apt,
                ),
            ),
        );
    }, []);

    const events = useMemo(
        () =>
            filteredAppointments.map((apt) => ({
                id: apt.id,
                title: apt.title,
                start: new Date(apt.startTime),
                end: new Date(apt.endTime),
                notes: apt.notes || "",
                resource: {
                    contact: apt.contact,
                    user: apt.user,
                    status: apt.status,
                    googleCalendarId: apt.googleCalendarId,
                    googleCalendarName: apt.googleCalendarName,
                    googleCalendarColor: apt.googleCalendarColor,
                    specialistName: apt.specialistName,
                },
            })),
        [filteredAppointments],
    );

    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex shrink-0 items-start justify-between gap-4 pb-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Agenda</h1>
                    <p className="text-sm text-muted-foreground">Calendario de citas — selecciona un horario para agendar.</p>
                    <p className="mt-1 text-xs text-muted-foreground">Horario comercial: {formatBusinessScheduleSummary(businessHours)}</p>
                </div>
                <Button onClick={handleNew} size="sm" className="rounded-full px-5 shadow-sm">
                    <Plus className="mr-2 h-4 w-4" /> Nueva cita
                </Button>
            </div>
            <div className="flex shrink-0 flex-col gap-3 border-y border-border py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="inline-flex w-fit rounded-xl border border-border bg-card p-1 shadow-sm">
                    <Button type="button" size="sm" variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}><LayoutList /> Lista</Button>
                    <Button type="button" size="sm" variant={view === "calendar" ? "secondary" : "ghost"} onClick={() => setView("calendar")}><CalendarIcon /> Calendario</Button>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><Filter className="hidden h-4 w-4 text-muted-foreground sm:block" />
                    <Select value={activeCalendarFilter} onValueChange={setActiveCalendarFilter}><SelectTrigger className="w-full bg-card sm:w-[260px]"><span className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeFilterMeta?.color || DEFAULT_FILTER_COLOR }} /><SelectValue /></SelectTrigger><SelectContent>{filterOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.id === "all" ? "Todos los calendarios" : option.label}</SelectItem>)}</SelectContent></Select>
                    <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full bg-card sm:w-[210px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="scheduled">Programadas</SelectItem><SelectItem value="completed">Completadas</SelectItem><SelectItem value="cancelled">Canceladas</SelectItem></SelectContent></Select>
                </div>
            </div>

            <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-soft">
                {view === "list" ? <div className="h-full overflow-auto"><AppointmentList appointments={filteredAppointments} onEdit={handleEdit} onDelete={handleDelete} /></div> : <div className="flex h-full min-h-[640px] flex-col p-2">
                    <BigCalendar
                        initialEvents={events}
                        onSelectSlot={handleSelectSlot}
                        onSelectEvent={handleSelectEvent}
                        onAppointmentTimeChange={handleAppointmentTimeChange}
                        onMutationSettled={fetchAppointments}
                        businessHours={businessHours}
                    />
                </div>}
            </div>

            <AppointmentDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                selectedEvent={selectedEvent}
                selectedSlot={selectedSlot}
                onSuccess={fetchAppointments}
                businessHours={businessHours}
            />
        </div>
    );
}
