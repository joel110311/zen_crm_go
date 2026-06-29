"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Edit2, Trash2 } from "lucide-react";
import { getContactFullName } from "@/lib/contact-name";

interface AppointmentListProps {
    appointments: any[];
    onEdit: (apt: any) => void;
    onDelete: (id: string) => void;
}

export function AppointmentList({ appointments, onEdit, onDelete }: AppointmentListProps) {
    if (!appointments || appointments.length === 0) {
        return (
            <div className="text-center py-10 text-muted-foreground bg-white rounded-lg border">
                No hay citas programadas.
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border overflow-hidden">
            <Table>
                <TableHeader className="bg-slate-50">
                    <TableRow>
                        <TableHead className="font-semibold text-slate-600">FECHA/HORA</TableHead>
                        <TableHead className="font-semibold text-slate-600">CLIENTE</TableHead>
                        <TableHead className="font-semibold text-slate-600">MOTIVO</TableHead>
                        <TableHead className="font-semibold text-slate-600">DURACION</TableHead>
                        <TableHead className="font-semibold text-slate-600">ESTADO</TableHead>
                        <TableHead className="text-right font-semibold text-slate-600">ACCIONES</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {appointments.map((apt) => {
                        const durationMins = Math.round((new Date(apt.endTime).getTime() - new Date(apt.startTime).getTime()) / 60000);
                        const calendarLabel = apt.specialistName || apt.googleCalendarName;
                        const calendarColor = apt.googleCalendarColor || "#111111";

                        return (
                            <TableRow key={apt.id} className="hover:bg-slate-50/50">
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="font-bold text-slate-900">
                                            {format(new Date(apt.startTime), "d/M/yyyy")}
                                        </span>
                                        <span className="text-sm text-slate-500">
                                            {format(new Date(apt.startTime), "HH:mm")}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-col min-w-0">
                                            <span className="font-medium text-slate-900">
                                                {apt.contact ? getContactFullName(apt.contact, "Cliente desconocido") : "Cliente desconocido"}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {apt.contact?.phone || "Sin telefono"}
                                            </span>
                                            {calendarLabel && (
                                                <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500">
                                                    <span
                                                        className="h-2.5 w-2.5 rounded-full"
                                                        style={{ backgroundColor: calendarColor }}
                                                    />
                                                    <span className="truncate">{calendarLabel}</span>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col">
                                        <span className="font-medium text-slate-700">{apt.title}</span>
                                        {apt.notes && (
                                            <span className="text-xs text-slate-400 truncate max-w-[200px] block">
                                                {apt.notes}
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-slate-600">{durationMins} min</TableCell>
                                <TableCell>
                                    <Badge
                                        variant={apt.status === "completed" ? "default" : "secondary"}
                                        className={
                                            apt.status === "scheduled"
                                                ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-none shadow-none"
                                                : apt.status === "completed"
                                                    ? "bg-secondary text-foreground hover:bg-accent border-none shadow-none"
                                                    : ""
                                        }
                                    >
                                        {apt.status === "scheduled" ? "Pendiente" : "Completada"}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-gray-400 hover:text-foreground"
                                            onClick={() => onEdit(apt)}
                                        >
                                            <Edit2 className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                            onClick={() => onDelete(apt.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
