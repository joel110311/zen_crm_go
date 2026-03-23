import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";
import {
    deleteAppointmentFromGoogleCalendar,
    getGoogleCalendarBookingContext,
    syncAppointmentToGoogleCalendar,
    syncGoogleCalendarToCrm,
} from "@/lib/google-calendar";
import {
    BusinessHoursConfig,
    businessBoundsForDate,
    formatDateTimeInZone,
    formatTimeLabel,
    getBusinessDateKey,
    normalizeBusinessHours,
    shiftDateKey,
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";

type AppointmentInput = {
    title: string;
    startTime: Date;
    endTime: Date;
    notes?: string;
    contactId?: string;
    userId?: string;
    status?: string;
    googleCalendarId?: string | null;
    googleCalendarName?: string | null;
    googleCalendarColor?: string | null;
    specialistName?: string | null;
    blockingCalendarIds?: string[];
};

type ConflictCheckInput = {
    startTime: Date;
    endTime: Date;
    excludeAppointmentId?: string;
    googleCalendarId?: string | null;
    blockingCalendarIds?: string[];
};

type AvailableSlotOptions = {
    from?: Date;
    limit?: number;
    excludeAppointmentId?: string;
    calendarIds?: string[];
};

export class AppointmentSchedulingError extends Error {
    code: "INVALID_RANGE" | "OUTSIDE_BUSINESS_HOURS" | "TIME_CONFLICT";
    suggestions: Date[];

    constructor(
        code: AppointmentSchedulingError["code"],
        message: string,
        suggestions: Date[] = [],
    ) {
        super(message);
        this.code = code;
        this.suggestions = suggestions;
    }
}

export async function getBusinessHoursConfig(): Promise<BusinessHoursConfig> {
    const settings = await getSystemSettingsOrDefaults();
    return normalizeBusinessHours(settings);
}

export async function findConflictingAppointments({
    startTime,
    endTime,
    excludeAppointmentId,
    blockingCalendarIds,
}: ConflictCheckInput) {
    return prisma.appointment.findMany({
        where: {
            ...(excludeAppointmentId
                ? { id: { not: excludeAppointmentId } }
                : {}),
            ...(blockingCalendarIds && blockingCalendarIds.length > 0
                ? { googleCalendarId: { in: blockingCalendarIds } }
                : {}),
            startTime: { lt: endTime },
            endTime: { gt: startTime },
        },
        orderBy: { startTime: "asc" },
        include: {
            contact: true,
        },
    });
}

export function formatAppointmentSuggestions(
    suggestions: Date[],
    config: BusinessHoursConfig,
) {
    return suggestions.map((slot) =>
        `- ${formatDateTimeInZone(slot, config.timeZone, "es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "numeric",
            minute: "2-digit",
        })}`,
    );
}

async function ensureAppointmentIsSchedulable(
    startTime: Date,
    endTime: Date,
    config: BusinessHoursConfig,
    excludeAppointmentId?: string,
    blockingCalendarIds?: string[],
) {
    if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime()) || !(endTime instanceof Date) || Number.isNaN(endTime.getTime())) {
        throw new AppointmentSchedulingError("INVALID_RANGE", "La fecha u hora de la cita no son validas.");
    }

    if (endTime <= startTime) {
        throw new AppointmentSchedulingError("INVALID_RANGE", "La cita debe terminar despues de la hora de inicio.");
    }

    const startBounds = businessBoundsForDate(startTime, config);
    const endBounds = businessBoundsForDate(endTime, config);

    if (
        !startBounds.isOpen ||
        startBounds.dateKey !== endBounds.dateKey ||
        startTime < startBounds.start ||
        endTime > startBounds.end
    ) {
        const suggestions = await suggestAvailableSlots(startTime, endTime.getTime() - startTime.getTime(), config, {
            from: startTime > startBounds.start ? startTime : startBounds.start,
            excludeAppointmentId,
        });
        const message = !startBounds.isOpen
            ? "Ese dia el negocio esta cerrado."
            : `La cita esta fuera del horario comercial de ese dia (${formatTimeLabel(startBounds.schedule.start)} - ${formatTimeLabel(startBounds.schedule.end)}).`;
        throw new AppointmentSchedulingError(
            "OUTSIDE_BUSINESS_HOURS",
            message,
            suggestions,
        );
    }

    const conflicts = await findConflictingAppointments({
        startTime,
        endTime,
        excludeAppointmentId,
        blockingCalendarIds,
    });

    if (conflicts.length > 0) {
        const suggestions = await suggestAvailableSlots(startTime, endTime.getTime() - startTime.getTime(), config, {
            from: startTime,
            limit: 3,
            excludeAppointmentId,
            calendarIds: blockingCalendarIds,
        });
        throw new AppointmentSchedulingError(
            "TIME_CONFLICT",
            "Ya existe otra cita ocupando ese horario.",
            suggestions,
        );
    }
}

export async function validateManagedAppointment(
    input: ConflictCheckInput,
) {
    const config = await getBusinessHoursConfig();
    const blockingCalendarIds =
        input.blockingCalendarIds && input.blockingCalendarIds.length > 0
            ? input.blockingCalendarIds
            : input.googleCalendarId
                ? [input.googleCalendarId]
                : undefined;
    try {
        await syncGoogleCalendarToCrm(false);
    } catch (syncError) {
        console.error("[Google Calendar] Pre-sync failed before validation:", syncError);
    }

    await ensureAppointmentIsSchedulable(
        input.startTime,
        input.endTime,
        config,
        input.excludeAppointmentId,
        blockingCalendarIds,
    );

    return config;
}

export async function suggestAvailableSlots(
    reference: Date,
    durationMs: number,
    config: BusinessHoursConfig,
    options: AvailableSlotOptions = {},
) {
    const stepMs = 15 * 60 * 1000;
    const safeDurationMs = Math.max(durationMs, 15 * 60 * 1000);
    const limit = options.limit ?? 3;
    const suggestions: Date[] = [];

    for (let dayOffset = 0; dayOffset < 10 && suggestions.length < limit; dayOffset += 1) {
        const dateKey = shiftDateKey(getBusinessDateKey(reference, config.timeZone), dayOffset);
        const dayReference = zonedDateTimeToUtc(dateKey, "12:00", config.timeZone);
        const dayBounds = businessBoundsForDate(dayReference, config);

        if (!dayBounds.isOpen) {
            continue;
        }

        const dayStart = dayBounds.start;
        const dayEnd = dayBounds.end;
        const dayAppointments = await prisma.appointment.findMany({
            where: {
                ...(options.excludeAppointmentId
                    ? { id: { not: options.excludeAppointmentId } }
                    : {}),
                ...(options.calendarIds && options.calendarIds.length > 0
                    ? { googleCalendarId: { in: options.calendarIds } }
                    : {}),
                startTime: { lt: dayEnd },
                endTime: { gt: dayStart },
            },
            orderBy: { startTime: "asc" },
        });

        const firstCursor = options.from && dayOffset === 0 && options.from > dayStart
            ? new Date(Math.ceil(options.from.getTime() / stepMs) * stepMs)
            : dayStart;

        for (let cursor = firstCursor.getTime(); cursor + safeDurationMs <= dayEnd.getTime(); cursor += stepMs) {
            const slotStart = new Date(cursor);
            const slotEnd = new Date(cursor + safeDurationMs);

            const conflict = dayAppointments.some((appointment) =>
                appointment.startTime < slotEnd && appointment.endTime > slotStart,
            );

            if (!conflict) {
                suggestions.push(slotStart);
            }

            if (suggestions.length >= limit) {
                break;
            }
        }
    }

    return suggestions;
}

export async function createManagedAppointment(input: AppointmentInput) {
    const config = await getBusinessHoursConfig();
    try {
        await syncGoogleCalendarToCrm(false);
    } catch (syncError) {
        console.error("[Google Calendar] Pre-sync failed before create:", syncError);
    }
    const bookingContext = await getGoogleCalendarBookingContext();
    const resolvedWriteTarget =
        (input.googleCalendarId
            ? bookingContext.allSources.find((source) => source.calendarId === input.googleCalendarId)
            : null) ||
        bookingContext.writeTarget;
    const blockingCalendarIds =
        input.blockingCalendarIds && input.blockingCalendarIds.length > 0
            ? input.blockingCalendarIds
            : resolvedWriteTarget?.calendarId
                ? [resolvedWriteTarget.calendarId]
                : undefined;

    await ensureAppointmentIsSchedulable(
        input.startTime,
        input.endTime,
        config,
        undefined,
        blockingCalendarIds,
    );

    const appointment = await prisma.appointment.create({
        data: {
            title: input.title,
            startTime: input.startTime,
            endTime: input.endTime,
            notes: input.notes,
            contactId: input.contactId,
            userId: input.userId,
            status: input.status || "scheduled",
            googleCalendarId: input.googleCalendarId || resolvedWriteTarget?.calendarId || null,
            googleCalendarName: input.googleCalendarName || resolvedWriteTarget?.summary || null,
            googleCalendarColor: input.googleCalendarColor || resolvedWriteTarget?.backgroundColor || null,
            specialistName: input.specialistName || resolvedWriteTarget?.specialistName || null,
        },
        include: {
            contact: true,
            user: true,
        },
    });

    try {
        await syncAppointmentToGoogleCalendar(appointment.id);
    } catch (syncError) {
        console.error("[Google Calendar] Push failed after create:", syncError);
    }
    return appointment;
}

export async function updateManagedAppointment(id: string, input: Partial<AppointmentInput>) {
    const existing = await prisma.appointment.findUnique({
        where: { id },
    });

    if (!existing) {
        throw new Error("La cita no existe.");
    }

    const startTime = input.startTime || existing.startTime;
    const endTime = input.endTime || existing.endTime;
    const blockingCalendarIds =
        input.blockingCalendarIds && input.blockingCalendarIds.length > 0
            ? input.blockingCalendarIds
            : existing.googleCalendarId
                ? [existing.googleCalendarId]
                : undefined;
    const config = await getBusinessHoursConfig();
    try {
        await syncGoogleCalendarToCrm(false);
    } catch (syncError) {
        console.error("[Google Calendar] Pre-sync failed before update:", syncError);
    }
    await ensureAppointmentIsSchedulable(
        startTime,
        endTime,
        config,
        id,
        blockingCalendarIds,
    );

    const appointment = await prisma.appointment.update({
        where: { id },
        data: {
            ...input,
            updatedAt: new Date(),
        },
        include: {
            contact: true,
            user: true,
        },
    });

    try {
        await syncAppointmentToGoogleCalendar(appointment.id);
    } catch (syncError) {
        console.error("[Google Calendar] Push failed after update:", syncError);
    }
    return appointment;
}

export async function deleteManagedAppointment(id: string) {
    try {
        await deleteAppointmentFromGoogleCalendar(id);
    } catch (syncError) {
        console.error("[Google Calendar] Delete sync failed:", syncError);
    }
    return prisma.appointment.delete({
        where: { id },
    });
}
