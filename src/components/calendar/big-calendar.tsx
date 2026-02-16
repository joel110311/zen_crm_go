"use client";

import React, { useState, useCallback, useMemo } from "react";
import { Calendar, dateFnsLocalizer, Views, View, EventProps } from "react-big-calendar";
import withDragAndDrop, { withDragAndDropProps } from "react-big-calendar/lib/addons/dragAndDrop";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { es } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";

import { createAppointment, updateAppointment, deleteAppointment } from "@/app/actions/calendar";

// Setup localizer
const locales = {
    "es": es,
};
const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
});

// @ts-ignore
const DragAndDropCalendar = withDragAndDrop(Calendar);

interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    notes?: string;
    resource?: any;
}

interface BigCalendarProps {
    initialEvents: CalendarEvent[];
}

export function BigCalendar({ initialEvents, onSelectSlot, onSelectEvent }: BigCalendarProps & {
    onSelectSlot: (slot: any) => void;
    onSelectEvent: (event: any) => void;
}) {
    const [events, setEvents] = useState<CalendarEvent[]>(() => {
        return initialEvents.map(e => ({
            ...e,
            start: new Date(e.start),
            end: new Date(e.end)
        }));
    });
    const [view, setView] = useState<View>(Views.MONTH);
    const [date, setDate] = useState(new Date());

    const { toast } = useToast();

    // Stable min/max times for the day (today's date) to ensure correct height calculation and drag stability
    const { min, max } = useMemo(() => ({
        min: new Date(new Date().setHours(7, 0, 0, 0)),
        max: new Date(new Date().setHours(22, 0, 0, 0))
    }), []);

    // Sync events if initialEvents changes (optional, but good if parent refetches)
    React.useEffect(() => {
        // Ensure dates are parsed correctly to avoid "sliver" rendering issues
        const parsed = initialEvents.map(e => ({
            ...e,
            start: new Date(e.start),
            end: new Date(e.end)
        }));
        setEvents(parsed);
    }, [initialEvents]);

    const onEventResize = useCallback(
        async (args: any) => {
            const { event, start, end } = args;
            const resizedEvent = { ...event, start: new Date(start), end: new Date(end) } as CalendarEvent;

            setEvents((prev) => {
                const filtered = prev.filter((e) => e.id !== event.id);
                return [...filtered, resizedEvent];
            });

            try {
                await updateAppointment(event.id as string, {
                    startTime: new Date(start),
                    endTime: new Date(end),
                });
                toast({ title: "Cita actualizada", description: "Duración modificada." });
            } catch (error) {
                toast({ title: "Error", description: "No se pudo actualizar la cita.", variant: "destructive" });
            }
        },
        [toast]
    );

    const onEventDrop = useCallback(
        async (args: any) => {
            const { event, start, end } = args;
            const movedEvent = { ...event, start: new Date(start), end: new Date(end) } as CalendarEvent;

            setEvents((prev) => {
                const filtered = prev.filter((e) => e.id !== event.id);
                return [...filtered, movedEvent];
            });

            try {
                await updateAppointment(event.id as string, {
                    startTime: new Date(start),
                    endTime: new Date(end),
                });
                toast({ title: "Cita reprogramada", description: `Movida a ${format(new Date(start), "PPP p", { locale: es })}` });
            } catch (error) {
                toast({ title: "Error", description: "No se pudo mover la cita.", variant: "destructive" });
            }
        },
        [toast]
    );

    // Custom Event Component
    const CustomEvent = ({ event }: EventProps<CalendarEvent>) => {
        const isPast = new Date(event.end) < new Date();
        // @ts-ignore
        const isCompleted = event.resource?.status === 'completed';

        // Styling Logic: Red for Past/Completed, Green for Future/Scheduled
        const isRed = isCompleted || isPast;

        const baseClasses = "flex items-start gap-2 h-full w-full px-1.5 py-0.5 leading-tight rounded-r-md border-l-[6px] transition-all shadow-sm overflow-hidden";
        const colorClasses = isRed
            ? "bg-red-50 border-red-500 text-red-700 hover:bg-red-100"
            : "bg-emerald-50 border-emerald-500 text-emerald-700 hover:bg-emerald-100";

        const dotColor = isRed ? "bg-red-500" : "bg-emerald-500";
        const dotShadow = isRed ? "shadow-[0_0_6px_rgba(239,68,68,0.6)]" : "shadow-[0_0_6px_rgba(16,185,129,0.6)]";

        return (
            <div className={`${baseClasses} ${colorClasses}`}>
                {/* Glowing Dot */}
                <div className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${dotColor} ${dotShadow}`} />

                <div className="overflow-hidden flex flex-col justify-start">
                    <div className="font-semibold text-xs truncate leading-snug">
                        {event.title}
                    </div>
                    <div className="text-[10px] opacity-85 truncate leading-tight">
                        {format(event.start, "EEE d MMM h:mm a", { locale: es })}
                    </div>
                </div>
            </div>
        );
    };

    // Custom Toolbar
    const CustomToolbar = (toolbar: any) => {
        const goToBack = () => {
            toolbar.onNavigate('PREV');
            setDate(new Date(toolbar.date.getFullYear(), toolbar.date.getMonth() - 1, 1)); // Approximate update
        };
        const goToNext = () => {
            toolbar.onNavigate('NEXT');
        };
        const goToToday = () => {
            toolbar.onNavigate('TODAY');
        };

        const label = () => {
            const date = new Date(toolbar.date);
            if (toolbar.view === 'day') {
                return (
                    <span className="text-lg font-bold capitalize text-foreground">
                        {format(date, "EEEE d 'de' MMMM yyyy", { locale: es })}
                    </span>
                );
            }
            if (toolbar.view === 'week') {
                // Optional: Show range if desired, but sticking to Month Year for now as per previous style, 
                // or we could embellish. Let's keep it simple but accurate.
                // Actually, week view spanning months might differ, but sticking to Month Year of the start date is safe-ish.
                // However, user specifically complained about Day view.
                return (
                    <span className="text-lg font-bold capitalize text-foreground">
                        {format(date, "MMMM yyyy", { locale: es })}
                    </span>
                );
            }
            return (
                <span className="text-lg font-bold capitalize text-foreground">
                    {format(date, "MMMM yyyy", { locale: es })}
                </span>
            );
        };

        return (
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                    {label()}
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex bg-muted rounded-md p-1 gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={goToBack}
                            className="h-7 w-7 p-0 hover:bg-background"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={goToToday}
                            className="h-7 text-xs px-2 hover:bg-background"
                        >
                            Today
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={goToNext}
                            className="h-7 w-7 p-0 hover:bg-background"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="flex bg-muted rounded-md p-1 gap-1">
                        <Button
                            variant={toolbar.view === 'month' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => toolbar.onView('month')}
                            className={`h-7 text-xs ${toolbar.view !== 'month' ? 'hover:bg-background' : ''}`}
                        >
                            Month
                        </Button>
                        <Button
                            variant={toolbar.view === 'week' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => toolbar.onView('week')}
                            className={`h-7 text-xs ${toolbar.view !== 'week' ? 'hover:bg-background' : ''}`}
                        >
                            Week
                        </Button>
                        <Button
                            variant={toolbar.view === 'day' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => toolbar.onView('day')}
                            className={`h-7 text-xs ${toolbar.view !== 'day' ? 'hover:bg-background' : ''}`}
                        >
                            Day
                        </Button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col big-calendar-wrapper">
            <style jsx global>{`
                .rbc-calendar { font-family: inherit; }
                .rbc-toolbar { margin-bottom: 1rem; }
                
                .rbc-event { 
                    background-color: transparent !important; 
                    border: none !important; 
                    padding: 0 !important;
                    outline: none !important;
                    box-shadow: none !important;
                    box-shadow: none !important;
                    width: 100% !important;
                    z-index: 10; 
                }
                .rbc-event-content {
                    height: 100% !important;
                    display: block !important;
                }
                .rbc-event:focus { outline: none !important; }
                .rbc-event-content { font-size: 11px; }

                /* Theme Colors */
                .rbc-today { background-color: hsl(var(--accent) / 0.3) !important; }
                .rbc-off-range-bg { background-color: hsl(var(--muted) / 0.5) !important; }
                
                .rbc-header { 
                    padding: 8px; 
                    font-weight: 600; 
                    font-size: 0.875rem; 
                    color: hsl(var(--muted-foreground)); 
                    border-bottom: 1px solid hsl(var(--border)) !important; 
                }
                
                .rbc-date-cell { 
                    padding: 4px; 
                    font-size: 0.875rem; 
                    font-weight: 500; 
                    color: hsl(var(--foreground)); 
                }
                
                .rbc-day-bg + .rbc-day-bg { border-left: 1px solid hsl(var(--border)) !important; }
                
                .rbc-month-view { 
                    border: 1px solid hsl(var(--border)) !important; 
                    border-radius: 0.5rem; 
                    overflow: hidden; 
                    background-color: hsl(var(--card));
                }
                
                .rbc-time-view { 
                    border: 1px solid hsl(var(--border)) !important; 
                    border-radius: 0.5rem; 
                    background-color: hsl(var(--card));
                }
                
                .rbc-time-header-content { border-left: 1px solid hsl(var(--border)) !important; }
                .rbc-timeslot-group { border-bottom: 1px solid hsl(var(--border)) !important; }
                
                /* Grid Lines - Matching the reference image */
                .rbc-day-slot .rbc-time-slot { 
                    border-top: 1px dotted #cbd5e1 !important; /* Dotted slate-300 */
                }
                .rbc-timeslot-group { 
                    border-bottom: 1px dotted #cbd5e1 !important; 
                    min-height: 80px !important; /* 1 hour = 80px. 30mins = 40px (perfect for 2 lines) */
                }
                .rbc-time-content > * + * > * { 
                    border-left: 1px solid #e2e8f0 !important;
                }
                
                /* Hide default RBC label (e.g. "9:00 - 9:30") so our CustomEvent has space */
                .rbc-event-label { display: none !important; }
                
                /* Hide current time indicator as requested */
                
                /* Hide current time indicator as requested */
                .rbc-current-time-indicator { display: none !important; }
                
                .rbc-time-gutter .rbc-timeslot-group { 
                    border-bottom: 1px dotted #cbd5e1 !important; 
                    color: hsl(var(--muted-foreground));
                }
                
                /* Month view row borders */
                .rbc-month-row + .rbc-month-row { border-top: 1px solid hsl(var(--border)) !important; }
                
            `}</style>

            <DragAndDropCalendar
                localizer={localizer}
                events={events}
                startAccessor={(event: any) => event.start}
                endAccessor={(event: any) => event.end}
                style={{ height: "100%" }}
                views={[Views.MONTH, Views.WEEK, Views.DAY]}
                view={view}
                onView={setView}
                date={date}
                onNavigate={setDate}
                selectable
                resizable
                onEventDrop={onEventDrop}
                onEventResize={onEventResize}
                onSelectSlot={onSelectSlot}
                onSelectEvent={onSelectEvent}
                messages={{
                    next: "Siguiente",
                    previous: "Anterior",
                    today: "Hoy",
                    month: "Mes",
                    week: "Semana",
                    day: "Día",
                    noEventsInRange: "No hay citas en este rango",
                }}
                components={{
                    toolbar: CustomToolbar,
                    event: CustomEvent as any
                }}
                culture="es"
                step={15}
                timeslots={4}
                min={min}
                max={max}
            />
        </div>
    );
}
