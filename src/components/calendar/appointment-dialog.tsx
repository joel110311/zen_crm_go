"use client";

import { useState, useEffect, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea"; // Assuming you have this, otherwise Input
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, Clock, Check, ChevronsUpDown, Loader2, User } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { createAppointment, updateAppointment, deleteAppointment } from "@/app/actions/calendar"; // Ensure these exist
import { createContact, getContacts } from "@/app/actions/contacts"; // Need a search function for contacts
import { useToast } from "@/components/ui/use-toast";
import { getContactFullName } from "@/lib/contact-name";
import type { GoogleCalendarSourceSummary } from "@/lib/google-calendar";
import {
    formatTimeLabel,
    getBusinessDayScheduleForDate,
    getNextOpenDate,
    isBusinessDayOpen,
    timeToMinutes,
    type BusinessHoursConfig,
} from "@/lib/calendar/business-hours";

interface AppointmentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedEvent?: any; // Replace with proper type
    selectedSlot?: { start: Date; end: Date } | null;
    onSuccess: () => void;
    businessHours: BusinessHoursConfig;
}

type GoogleCalendarStatusPayload = {
    sources: GoogleCalendarSourceSummary[];
};

export function AppointmentDialog({ open, onOpenChange, selectedEvent, selectedSlot, onSuccess, businessHours }: AppointmentDialogProps) {
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    // Form State
    const [title, setTitle] = useState("");
    const [contactId, setContactId] = useState("");
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [time, setTime] = useState("09:00");
    const [duration, setDuration] = useState("30"); // minutes
    const [notes, setNotes] = useState("");
    const [calendarSources, setCalendarSources] = useState<GoogleCalendarSourceSummary[]>([]);
    const [selectedCalendarId, setSelectedCalendarId] = useState<string>("general");

    // Contact Search State
    const [contacts, setContacts] = useState<any[]>([]);
    const [openCombobox, setOpenCombobox] = useState(false);
    const [query, setQuery] = useState("");

    // New Contact Form State
    const [isCreatingContact, setIsCreatingContact] = useState(false);
    const [newContactName, setNewContactName] = useState("");
    const [newContactPhone, setNewContactPhone] = useState("");
    const [isSubmittingContact, setIsSubmittingContact] = useState(false);

    const clampTimeToSchedule = (value: string, targetDate: Date) => {
        const { schedule } = getBusinessDayScheduleForDate(targetDate, businessHours);
        if (!schedule.enabled) {
            return businessHours.start;
        }

        const minutes = timeToMinutes(value);
        if (minutes < timeToMinutes(schedule.start) || minutes >= timeToMinutes(schedule.end)) {
            return schedule.start;
        }

        return value;
    };

    // Initialize form when opening
    useEffect(() => {
        if (open) {
            if (selectedEvent) {
                setTitle(selectedEvent.title);
                setContactId(selectedEvent.resource?.contact?.id || "");
                setDate(selectedEvent.start);
                setTime(clampTimeToSchedule(format(selectedEvent.start, "HH:mm"), selectedEvent.start));
                const diffMins = (selectedEvent.end.getTime() - selectedEvent.start.getTime()) / 60000;
                setDuration(diffMins.toString());
                setNotes(selectedEvent.notes || "");
            } else if (selectedSlot) {
                const nextDate = isBusinessDayOpen(selectedSlot.start, businessHours)
                    ? selectedSlot.start
                    : getNextOpenDate(selectedSlot.start, businessHours);
                setTitle("");
                setContactId("");
                setDate(nextDate);
                setTime(clampTimeToSchedule(format(selectedSlot.start, "HH:mm"), nextDate));
                setDuration(String(businessHours.defaultDurationMinutes));
                setNotes("");
            } else {
                const nextOpenDate = getNextOpenDate(new Date(), businessHours);
                setTitle("");
                setContactId("");
                setDate(nextOpenDate);
                setTime(clampTimeToSchedule(businessHours.start, nextOpenDate));
                setDuration(String(businessHours.defaultDurationMinutes));
                setNotes("");
            }
        }
    }, [businessHours, open, selectedEvent, selectedSlot]);

    useEffect(() => {
        if (!open) return;

        const loadGoogleCalendars = async () => {
            try {
                const response = await fetch("/api/google-calendar/status", { cache: "no-store" });
                if (!response.ok) return;
                const payload = (await response.json()) as GoogleCalendarStatusPayload;
                const sources = (payload.sources || []).filter((source) => source.isSelected);
                setCalendarSources(sources);

                const selectedFromEvent = selectedEvent?.resource?.googleCalendarId as string | undefined;
                const specialistCalendars = sources.filter((source) => source.isSpecialist && source.writable);
                const defaultWriteTarget = sources.find((source) => source.isWriteTarget && source.writable);

                if (selectedFromEvent && sources.some((source) => source.calendarId === selectedFromEvent)) {
                    setSelectedCalendarId(selectedFromEvent);
                    return;
                }

                if (specialistCalendars.length === 1) {
                    setSelectedCalendarId(specialistCalendars[0].calendarId);
                    return;
                }

                if (defaultWriteTarget) {
                    setSelectedCalendarId(defaultWriteTarget.calendarId);
                    return;
                }

                setSelectedCalendarId("general");
            } catch (error) {
                console.error("Failed to load Google calendars for dialog:", error);
            }
        };

        void loadGoogleCalendars();
    }, [open, selectedEvent]);

    // Fetch contacts on query change (simple debounce could be added)
    useEffect(() => {
        const fetchContacts = async () => {
            // We need a search action. Using getContacts with query if available, or just fetch all for now if small list.
            // Assuming getContacts accepts query. If not, we might need to update it or filter client side.
            // For now, let's assume we can fetch recent/all.
            const res = await getContacts(query);
            if (res) setContacts(res);
        };
        fetchContacts();
    }, [query]);

    useEffect(() => {
        if (!date) return;
        const clamped = clampTimeToSchedule(time, date);
        if (clamped !== time) {
            setTime(clamped);
        }
    }, [businessHours, date, time]);

    const selectedDaySchedule = date
        ? getBusinessDayScheduleForDate(date, businessHours).schedule
        : null;
    const selectedDayStart = selectedDaySchedule?.enabled ? selectedDaySchedule.start : businessHours.start;
    const selectedDayEnd = selectedDaySchedule?.enabled ? selectedDaySchedule.end : businessHours.end;
    const writableSources = calendarSources.filter((source) => source.writable);
    const specialistSources = writableSources.filter((source) => source.isSpecialist);
    const selectedCalendar =
        writableSources.find((source) => source.calendarId === selectedCalendarId) ||
        writableSources.find((source) => source.isWriteTarget) ||
        null;


    const handleSubmit = () => {
        if (!date || !time || !title) {
            toast({ title: "Faltan datos", description: "Por favor completa los campos obligatorios.", variant: "destructive" });
            return;
        }

        const { schedule } = getBusinessDayScheduleForDate(date, businessHours);
        if (!schedule.enabled) {
            toast({
                title: "Dia cerrado",
                description: "Ese dia no tiene horario comercial configurado. Elige otra fecha.",
                variant: "destructive",
            });
            return;
        }

        const [hours, minutes] = time.split(":").map(Number);
        const startTime = new Date(date);
        startTime.setHours(hours, minutes);

        const endTime = new Date(startTime.getTime() + parseInt(duration) * 60000);
        const blockingCalendarIds = selectedCalendar?.calendarId ? [selectedCalendar.calendarId] : undefined;
        const specialistName = selectedCalendar?.isSpecialist
            ? (selectedCalendar.specialistName || selectedCalendar.summary)
            : undefined;

        startTransition(async () => {
            try {
                if (selectedEvent) {
                    const result = await updateAppointment(selectedEvent.id, {
                        title,
                        startTime,
                        endTime,
                        notes,
                        contactId: contactId || undefined,
                        googleCalendarId: selectedCalendar?.calendarId,
                        googleCalendarName: selectedCalendar?.summary,
                        googleCalendarColor: selectedCalendar?.backgroundColor || undefined,
                        specialistName,
                        blockingCalendarIds,
                    });
                    if (!result.success) {
                        throw new Error(result.error || "No se pudo actualizar la cita.");
                    }
                    toast({ title: "Cita actualizada" });
                } else {
                    const result = await createAppointment({
                        title,
                        startTime,
                        endTime,
                        notes,
                        contactId: contactId || undefined,
                        googleCalendarId: selectedCalendar?.calendarId,
                        googleCalendarName: selectedCalendar?.summary,
                        googleCalendarColor: selectedCalendar?.backgroundColor || undefined,
                        specialistName,
                        blockingCalendarIds,
                    });
                    if (!result.success) {
                        throw new Error(result.error || "No se pudo agendar la cita.");
                    }
                    toast({ title: "Cita agendada" });
                }
                onSuccess();
                onOpenChange(false);
            } catch (error) {
                console.error(error);
                toast({ title: "Error", description: "No se pudo guardar la cita.", variant: "destructive" });
            }
        });
    };

    const handleDelete = async () => {
        if (!selectedEvent) return;
        if (!confirm("¿Eliminar cita?")) return;

        startTransition(async () => {
            await deleteAppointment(selectedEvent.id);
            toast({ title: "Cita eliminada" });
            onSuccess();
            onOpenChange(false);
        });
    };

    const handleCreateContact = async () => {
        if (!newContactName.trim() || !newContactPhone.trim()) {
            toast({ title: "Error", description: "Nombre y teléfono son obligatorios", variant: "destructive" });
            return;
        }
        setIsSubmittingContact(true);
        try {
            const formData = new FormData();
            formData.append("name", newContactName);
            formData.append("phone", newContactPhone);

            const result = await createContact(formData);
            if (result.success && result.contact) {
                toast({ title: "Contacto creado exitosamente" });
                // Auto-select the new contact
                setContacts(prev => [result.contact, ...prev]);
                setContactId(result.contact.id);
                // Auto-fill title
                if (!title) setTitle(`Cita con ${getContactFullName(result.contact)}`);

                // Reset form state
                setIsCreatingContact(false);
                setNewContactName("");
                setNewContactPhone("");
                setOpenCombobox(false);
            } else {
                toast({ title: "Error", description: result.error || "No se pudo crear", variant: "destructive" });
            }
        } catch (error) {
            toast({ title: "Error", description: "Error al crear contacto", variant: "destructive" });
        } finally {
            setIsSubmittingContact(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] bg-card">
                <DialogHeader className="pb-4 border-b">
                    <DialogTitle className="text-xl font-semibold text-foreground">
                        {selectedEvent ? "Editar Cita" : "Nueva Cita"}
                    </DialogTitle>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Client Search */}
                    <div className="space-y-2">
                        <Label>Datos del cliente</Label>
                        <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={openCombobox}
                                    className="w-full justify-between bg-background h-11"
                                >
                                    {contactId
                                        ? getContactFullName(contacts.find((c) => c.id === contactId), "Cliente seleccionado")
                                        : "Buscar cliente..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0">
                                <Command shouldFilter={false}>
                                    <CommandInput placeholder="Buscar cliente..." onValueChange={setQuery} />
                                    <CommandList>
                                        <CommandEmpty>No se encontraron clientes.</CommandEmpty>
                                        <CommandGroup>
                                            {contacts.map((contact) => (
                                                <CommandItem
                                                    key={contact.id}
                                                    value={contact.id}
                                                    onSelect={(currentValue) => {
                                                        setContactId(currentValue === contactId ? "" : currentValue);
                                                        setOpenCombobox(false);
                                                        // Auto-fill title if empty
                                                        if (!title) setTitle(`Reunión con ${getContactFullName(contact)}`);
                                                    }}
                                                >
                                                    <Check
                                                        className={cn(
                                                            "mr-2 h-4 w-4",
                                                            contactId === contact.id ? "opacity-100" : "opacity-0"
                                                        )}
                                                    />
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{getContactFullName(contact)}</span>
                                                        <span className="text-xs text-secondary-foreground">{contact.email || contact.phone}</span>
                                                    </div>
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>

                                    <div className="p-2 border-t mt-1">
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start text-primary font-medium"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                setIsCreatingContact(true);
                                                setOpenCombobox(false);
                                            }}
                                        >
                                            + Registrar nuevo contacto
                                        </Button>
                                    </div>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* New Contact Inline Form */}
                    {isCreatingContact && (
                        <div className="p-4 bg-muted/30 rounded-lg border space-y-4 mb-2 -mt-2 animate-in fade-in slide-in-from-top-2">
                            <div className="flex items-center justify-between pb-2 border-b">
                                <h4 className="font-medium text-sm text-foreground flex items-center">
                                    <User className="w-4 h-4 mr-2 text-primary" />
                                    Registrar Contacto Rápido
                                </h4>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setIsCreatingContact(false)}>
                                    Cancelar
                                </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">Nombre *</Label>
                                    <Input
                                        size={1}
                                        value={newContactName}
                                        onChange={e => setNewContactName(e.target.value)}
                                        placeholder="Ej. Juan Pérez"
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Teléfono *</Label>
                                    <Input
                                        size={1}
                                        value={newContactPhone}
                                        onChange={e => setNewContactPhone(e.target.value)}
                                        placeholder="Ej. 521..."
                                        className="h-8 text-sm"
                                    />
                                </div>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                className="w-full h-8"
                                onClick={handleCreateContact}
                                disabled={isSubmittingContact || !newContactName || !newContactPhone}
                            >
                                {isSubmittingContact ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
                                Guardar y Seleccionar
                            </Button>
                        </div>
                    )}

                    {/* Title */}
                    <div className="space-y-2">
                        <Label>Título / Motivo</Label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="bg-background h-11"
                            placeholder="Ej. Demo de producto"
                        />
                    </div>

                    {writableSources.length > 0 ? (
                        <div className="space-y-2">
                            <Label>Calendario / Especialista</Label>
                            <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
                                <SelectTrigger className="bg-background h-11">
                                    <SelectValue placeholder="Selecciona donde guardar la cita" />
                                </SelectTrigger>
                                <SelectContent>
                                    {writableSources.map((source) => (
                                        <SelectItem key={source.calendarId} value={source.calendarId}>
                                            {source.isSpecialist
                                                ? `${source.specialistName || source.summary} · Especialista`
                                                : source.summary}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                {specialistSources.length > 0
                                    ? `Especialistas activos: ${specialistSources.map((source) => source.specialistName || source.summary).join(", ")}.`
                                    : "Si eliges un calendario de escritura, la cita se sincronizara directamente ahi."}
                            </p>
                        </div>
                    ) : null}

                    {/* Date and Time Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Fecha *</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal bg-background h-11",
                                            !date && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? format(date, "PPP", { locale: es }) : <span>Seleccionar fecha</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={date}
                                        onSelect={setDate}
                                        disabled={(calendarDate) => !isBusinessDayOpen(calendarDate, businessHours)}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-2">
                            <Label>Hora *</Label>
                            {selectedDaySchedule?.enabled ? (
                                <p className="text-xs text-muted-foreground">
                                    Disponible entre {formatTimeLabel(selectedDayStart)} y {formatTimeLabel(selectedDayEnd)}.
                                </p>
                            ) : (
                                <p className="text-xs text-amber-600">
                                    Este dia esta cerrado en el horario comercial.
                                </p>
                            )}
                            <div className="relative">
                                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    type="time"
                                    value={time}
                                    onChange={(e) => setTime(e.target.value)}
                                    className="pl-9 bg-background h-11"
                                    min={selectedDayStart}
                                    max={selectedDayEnd}
                                    disabled={!selectedDaySchedule?.enabled}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Duration */}
                    <div className="space-y-2">
                        <Label>Duración (minutos)</Label>
                        <Select value={duration} onValueChange={setDuration}>
                            <SelectTrigger className="bg-background h-11">
                                <SelectValue placeholder="Seleccionar duración" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="15">15 minutos</SelectItem>
                                <SelectItem value="30">30 minutos</SelectItem>
                                <SelectItem value="45">45 minutos</SelectItem>
                                <SelectItem value="60">1 hora</SelectItem>
                                <SelectItem value="90">1.5 horas</SelectItem>
                                <SelectItem value="120">2 horas</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                        <Label>Notas / Descripción</Label>
                        <Input // Or Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="bg-background h-11"
                            placeholder="Detalles adicionales..."
                        />
                    </div>
                </div>

                <DialogFooter className="flex justify-between sm:justify-between items-center bg-card p-4 -mx-6 -mb-6 border-t mt-4 rounded-b-lg">
                    {selectedEvent ? (
                        <Button variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handleDelete} type="button">
                            Eliminar
                        </Button>
                    ) : (
                        <div /> // Spacer
                    )}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {selectedEvent ? "Actualizar Cita" : "Agendar Cita"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
