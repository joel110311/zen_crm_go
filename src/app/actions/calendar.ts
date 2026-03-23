"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
    AppointmentSchedulingError,
    createManagedAppointment,
    deleteManagedAppointment,
    updateManagedAppointment,
} from "@/lib/calendar/appointments";
import { syncGoogleCalendarToCrm } from "@/lib/google-calendar";

export async function getAppointments() {
    try {
        try {
            await syncGoogleCalendarToCrm(false);
        } catch (syncError) {
            console.error("[Google Calendar] Background sync failed while loading appointments:", syncError);
        }

        const settings = await prisma.systemSettings.findFirst({
            include: {
                googleCalendars: true,
            },
        });
        const visibleCalendarIds = settings?.googleCalendars
            .filter((source) => source.isSelected)
            .map((source) => source.calendarId) || [];

        return await prisma.appointment.findMany({
            where: {
                OR: [
                    { googleCalendarId: null },
                    ...(visibleCalendarIds.length > 0
                        ? [{ googleCalendarId: { in: visibleCalendarIds } }]
                        : []),
                ],
            },
            orderBy: { startTime: "asc" },
            include: { user: true, contact: true }
        });
    } catch (error) {
        console.error("Failed to get appointments:", error);
        return [];
    }
}

export async function createAppointment(data: {
    title: string;
    startTime: Date;
    endTime: Date;
    notes?: string;
    contactId?: string;
    userId?: string;
    googleCalendarId?: string;
    googleCalendarName?: string;
    googleCalendarColor?: string;
    specialistName?: string;
    blockingCalendarIds?: string[];
}) {
    try {
        await createManagedAppointment(data);
        revalidatePath("/dashboard/calendar");
        return { success: true };
    } catch (error) {
        console.error("Failed to create appointment:", error);
        if (error instanceof AppointmentSchedulingError) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "Failed to create appointment" };
    }
}

export async function updateAppointment(id: string, data: {
    title?: string;
    startTime?: Date;
    endTime?: Date;
    notes?: string;
    contactId?: string;
    userId?: string;
    googleCalendarId?: string;
    googleCalendarName?: string;
    googleCalendarColor?: string;
    specialistName?: string;
    blockingCalendarIds?: string[];
}) {
    try {
        await updateManagedAppointment(id, data);
        revalidatePath("/dashboard/calendar");
        return { success: true };
    } catch (error) {
        console.error("Failed to update appointment:", error);
        if (error instanceof AppointmentSchedulingError) {
            return { success: false, error: error.message };
        }
        return { success: false, error: "Failed to update appointment" };
    }
}

export async function deleteAppointment(id: string) {
    try {
        await deleteManagedAppointment(id);
        revalidatePath("/dashboard/calendar");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete appointment:", error);
        return { success: false, error: "Failed to delete appointment" };
    }
}
