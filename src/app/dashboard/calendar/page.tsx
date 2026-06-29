"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { getAppointments, deleteAppointment } from "@/app/actions/calendar";
import { getSystemSettings } from "@/app/actions/settings";
import { BigCalendar } from "@/components/calendar/big-calendar";
import { AppointmentList } from "@/components/calendar/appointment-list";
import { AppointmentDialog } from "@/components/calendar/appointment-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Plus,
    LayoutList,
    Calendar as CalendarIcon,
    Clock,
    CheckCircle,
    CalendarDays,
    Check,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { isSameWeek, isToday } from "date-fns";
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
    const [view, setView] = useState("list");
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

    const filteredAppointments = useMemo(() => {
        if (activeCalendarFilter === "all") {
            return appointments;
        }

        if (activeCalendarFilter === "internal") {
            return appointments.filter((apt) => !apt.googleCalendarId);
        }

        return appointments.filter((apt) => apt.googleCalendarId === activeCalendarFilter);
    }, [activeCalendarFilter, appointments]);

    const activeFilterMeta = useMemo(
        () => filterOptions.find((option) => option.id === activeCalendarFilter) || filterOptions[0],
        [activeCalendarFilter, filterOptions],
    );

    const stats = useMemo(() => {
        const now = new Date();
        return {
            today: filteredAppointments.filter((apt) => isToday(new Date(apt.startTime))).length,
            week: filteredAppointments.filter((apt) => isSameWeek(new Date(apt.startTime), now)).length,
            pending: filteredAppointments.filter((apt) => apt.status === "scheduled").length,
            completed: filteredAppointments.filter((apt) => apt.status === "completed").length,
        };
    }, [filteredAppointments]);

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
        await deleteAppointment(id);
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
        <div className="flex h-full flex-col gap-2 bg-background">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Gestión de Citas</h1>
                    <p className="text-muted-foreground text-sm">Gestiona las citas agendadas con tus clientes.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Horario comercial: {formatBusinessScheduleSummary(businessHours)}
                    </p>
                </div>
                <Button onClick={handleNew} size="sm" className="shadow-sm">
                    <Plus className="mr-2 h-4 w-4" /> Nueva Cita
                </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
                <Card className="border-none shadow-sm bg-card">
                    <CardContent className="flex items-center justify-between p-3">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Hoy</p>
                            <h2 className="text-xl font-bold text-foreground">{stats.today}</h2>
                        </div>
                        <div className="h-8 w-8 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                            <CalendarDays className="h-4 w-4" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-card">
                    <CardContent className="flex items-center justify-between p-3">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Semana</p>
                            <h2 className="text-xl font-bold text-foreground">{stats.week}</h2>
                        </div>
                        <div className="h-8 w-8 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                            <CalendarIcon className="h-4 w-4" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-card">
                    <CardContent className="flex items-center justify-between p-3">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Pendientes</p>
                            <h2 className="text-xl font-bold text-foreground">{stats.pending}</h2>
                        </div>
                        <div className="h-8 w-8 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                            <Clock className="h-4 w-4" />
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-card">
                    <CardContent className="flex items-center justify-between p-3">
                        <div>
                            <p className="text-xs font-medium text-muted-foreground">Completadas</p>
                            <h2 className="text-xl font-bold text-foreground">{stats.completed}</h2>
                        </div>
                        <div className="h-8 w-8 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                            <CheckCircle className="h-4 w-4" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="shrink-0 rounded-xl border bg-card/80 p-3 shadow-sm">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-foreground">Calendarios visibles</p>
                            <p className="text-xs text-muted-foreground">
                                Filtra el calendario y la lista por especialista o agenda.
                            </p>
                        </div>
                        <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                            <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: activeFilterMeta?.color || DEFAULT_FILTER_COLOR }}
                            />
                            <span>Vista actual: {activeFilterMeta?.label || "Todos"}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {filterOptions.map((option) => {
                            const isActive = activeCalendarFilter === option.id;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setActiveCalendarFilter(option.id)}
                                    className={`inline-flex min-w-[140px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all ${
                                        isActive
                                            ? "border-transparent bg-primary/5 shadow-sm ring-2 ring-primary/10"
                                            : "border-border bg-background hover:border-primary/20 hover:bg-muted/40"
                                    }`}
                                >
                                    <span
                                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border"
                                        style={{
                                            borderColor: option.color,
                                            backgroundColor: isActive ? option.color : "transparent",
                                            color: isActive ? "#FFFFFF" : option.color,
                                        }}
                                    >
                                        {isActive ? <Check className="h-3.5 w-3.5" /> : null}
                                    </span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-sm font-medium text-foreground">{option.label}</span>
                                        <span className="truncate text-[11px] text-muted-foreground">{option.caption}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <Tabs defaultValue="calendar" className="flex flex-col flex-1 w-full overflow-hidden" onValueChange={setView}>
                <div className="flex items-center justify-between mb-2 shrink-0">
                    <TabsList className="bg-card border h-8">
                        <TabsTrigger value="list" className="text-xs h-6 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                            <LayoutList className="mr-2 h-3 w-3" /> Lista
                        </TabsTrigger>
                        <TabsTrigger value="calendar" className="text-xs h-6 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                            <CalendarIcon className="mr-2 h-3 w-3" /> Calendario
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="list" className="mt-0 flex-1 overflow-auto border rounded-lg bg-card">
                    <AppointmentList appointments={filteredAppointments} onEdit={handleEdit} onDelete={handleDelete} />
                </TabsContent>

                <TabsContent value="calendar" className="mt-0 flex-1 bg-card rounded-lg border p-2 overflow-hidden flex flex-col">
                    <BigCalendar
                        initialEvents={events}
                        onSelectSlot={handleSelectSlot}
                        onSelectEvent={handleSelectEvent}
                        onAppointmentTimeChange={handleAppointmentTimeChange}
                        onMutationSettled={fetchAppointments}
                        businessHours={businessHours}
                    />
                </TabsContent>
            </Tabs>

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
