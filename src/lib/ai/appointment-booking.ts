import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { generateCompletion } from "@/lib/ai/openai";
import {
    AppointmentSchedulingError,
    createManagedAppointment,
    formatAppointmentSuggestions,
    getBusinessHoursConfig,
    validateManagedAppointment,
} from "@/lib/calendar/appointments";
import {
    findGoogleSpecialistByMention,
    getGoogleCalendarBookingContext,
} from "@/lib/google-calendar";
import {
    formatBusinessScheduleLines,
    formatDateTimeInZone,
    getBusinessDateKey,
    zonedDateTimeToUtc,
} from "@/lib/calendar/business-hours";
import { getContactFullName } from "@/lib/contact-name";

type PlannerResult = {
    intent: "schedule" | "other";
    action: "create" | "ask_missing" | "ignore";
    title?: string | null;
    notes?: string | null;
    localDate?: string | null;
    localTime?: string | null;
    durationMinutes?: number | null;
    missingFields?: string[];
};

type AppointmentHandlingMode = "validate" | "create";

export type AppointmentHandlingResult =
    | { kind: "none"; reply: null }
    | { kind: "missing"; reply: string }
    | { kind: "unavailable"; reply: string }
    | { kind: "created"; reply: string }
    | {
        kind: "validated";
        reply: null;
        availableSlot: {
            title: string;
            localDate: string;
            localTime: string;
            durationMinutes: number;
            startTime: Date;
            endTime: Date;
            label: string;
        };
    };

const APPOINTMENT_KEYWORDS = [
    "cita",
    "agendar",
    "agenda",
    "agendame",
    "programa",
    "programar",
    "reunion",
    "reunion",
    "llamada",
    "consulta",
    "demo",
    "reservar",
    "reservame",
];

function stripCodeFences(value: string) {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return fenced?.[1]?.trim() || value.trim();
}

function parsePlannerResult(raw: string): PlannerResult | null {
    try {
        const clean = stripCodeFences(raw);
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start === -1 || end === -1) return null;
        return JSON.parse(clean.slice(start, end + 1)) as PlannerResult;
    } catch {
        return null;
    }
}

function hasAppointmentContext(history: string[], latestUserMessage: string) {
    const combined = [latestUserMessage, ...history].join(" ").toLowerCase();
    return APPOINTMENT_KEYWORDS.some((keyword) => combined.includes(keyword));
}

function buildConversationTranscript(
    messages: Array<{ content: string; direction: string; senderType: string | null }>,
) {
    return messages
        .slice(-8)
        .map((message) => {
            const role =
                message.direction === "outbound" || message.senderType === "bot"
                    ? "Asistente"
                    : "Cliente";
            return `${role}: ${message.content}`;
        })
        .join("\n");
}

function buildMissingInfoReply(
    missingFields: string[],
    config: Awaited<ReturnType<typeof getBusinessHoursConfig>>,
) {
    const needsDate = missingFields.includes("date");
    const needsTime = missingFields.includes("time");
    const hoursLabel = ["Horario comercial:", formatBusinessScheduleLines(config)].join("\n");

    if (needsDate && needsTime) {
        return [
            "*Si puedo agendar la cita.*",
            "",
            "Solo necesito que me compartas *la fecha* y *la hora*.",
            hoursLabel,
        ].join("\n");
    }

    if (needsDate) {
        return [
            "*Si puedo agendarla.*",
            "",
            "Solo me falta *la fecha*.",
            hoursLabel,
        ].join("\n");
    }

    if (needsTime) {
        return [
            "*Si puedo agendarla.*",
            "",
            "Solo me falta *la hora*.",
            hoursLabel,
        ].join("\n");
    }

    return [
        "*Si puedo ayudarte a agendar la cita.*",
        "",
        "Comparteme por favor la *fecha* y la *hora* que prefieres.",
        hoursLabel,
    ].join("\n");
}

function buildSpecialistReply(
    specialists: Array<{ specialistName?: string | null; summary: string }>,
) {
    const names = specialists
        .map((specialist) => specialist.specialistName || specialist.summary)
        .filter(Boolean);

    return [
        "*Claro, puedo ayudarte a agendarla.*",
        "",
        `Solo necesito saber *con quien* prefieres la cita: ${names.join(", ")}.`,
    ].join("\n");
}

function buildSuccessReply(
    title: string,
    startTime: Date,
    durationMinutes: number,
    timeZone: string,
    specialistName?: string | null,
) {
    return [
        "*Tu cita quedo agendada*",
        "",
        `*Motivo:* ${title}`,
        ...(specialistName ? [`*Especialista:* ${specialistName}`] : []),
        `*Fecha:* ${formatDateTimeInZone(startTime, timeZone, "es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
        })}`,
        `*Hora:* ${formatDateTimeInZone(startTime, timeZone, "es-MX", {
            hour: "numeric",
            minute: "2-digit",
        })}`,
        `*Duracion:* ${durationMinutes} min`,
        "",
        "Si necesitas reprogramarla, dimelo y la movemos.",
    ].join("\n");
}

function buildUnavailableReply(
    error: AppointmentSchedulingError,
    config: Awaited<ReturnType<typeof getBusinessHoursConfig>>,
) {
    const suggestions = formatAppointmentSuggestions(error.suggestions, config);

    if (error.code === "OUTSIDE_BUSINESS_HOURS") {
        return [
            "*Ese horario no esta disponible.*",
            "",
            error.message,
            ...(suggestions.length > 0
                ? ["", "*Te puedo proponer estos horarios:*", ...suggestions]
                : []),
        ].join("\n");
    }

    if (error.code === "TIME_CONFLICT") {
        return [
            "*Ese horario ya esta ocupado.*",
            ...(suggestions.length > 0
                ? ["", "*Te puedo proponer estos horarios:*", ...suggestions]
                : []),
        ].join("\n");
    }

    return error.message;
}

function buildValidatedSlotLabel(
    startTime: Date,
    timeZone: string,
) {
    const dateLabel = formatDateTimeInZone(startTime, timeZone, "es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
    });
    const timeLabel = formatDateTimeInZone(startTime, timeZone, "es-MX", {
        hour: "numeric",
        minute: "2-digit",
    });

    return `${dateLabel} a las ${timeLabel}`;
}

async function planAppointmentFromConversation(
    conversationId: string,
    latestUserMessage: string,
) {
    const [conversation, config] = await Promise.all([
        prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
                contact: true,
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 16,
                },
            },
        }),
        getBusinessHoursConfig(),
    ]);

    if (!conversation) {
        return null;
    }

    const historyTexts = conversation.messages
        .map((message) => message.content)
        .filter(Boolean);

    if (!hasAppointmentContext(historyTexts, latestUserMessage)) {
        return null;
    }

    const now = new Date();
    const transcript = buildConversationTranscript(
        [...conversation.messages].reverse().map((message) => ({
            content: message.content,
            direction: message.direction,
            senderType: message.senderType,
        })),
    );

    const parserPrompt = `
Analiza la conversacion y decide si el cliente quiere *agendar una cita nueva*.
Devuelve SOLO JSON valido, sin markdown, con esta forma exacta:
{
  "intent": "schedule" | "other",
  "action": "create" | "ask_missing" | "ignore",
  "title": string | null,
  "notes": string | null,
  "localDate": "YYYY-MM-DD" | null,
  "localTime": "HH:mm" | null,
  "durationMinutes": number | null,
  "missingFields": string[]
}

CONTEXTO
- Fecha y hora local actual: ${formatDateTimeInZone(now, config.timeZone, "es-MX")}
- Fecha local actual ISO: ${getBusinessDateKey(now, config.timeZone)}
- Zona horaria del negocio: ${config.timeZone}
- Horario comercial por dia:
${formatBusinessScheduleLines(config)}
- Nombre del cliente: ${conversation.contact?.name || "Sin nombre"}

REGLAS
- Usa el historial para resolver mensajes como "manana a las 3" o "si, a esa hora".
- Solo marca intent = "schedule" si realmente quiere una cita, reunion, llamada, demo o consulta.
- Si falta fecha o falta hora, usa action = "ask_missing".
- Si no hay intencion clara de cita, usa intent = "other" y action = "ignore".
- Si no mencionan duracion, deja durationMinutes en null.
- El titulo debe ser corto y util.
- No inventes fecha ni hora si no se pueden deducir con seguridad.

HISTORIAL
${transcript || "Sin historial"}

ULTIMO MENSAJE
Cliente: ${latestUserMessage}
    `.trim();

    const raw = await generateCompletion(
        [{ role: "system", content: parserPrompt }],
        0,
    );

    return {
        conversation,
        config,
        planner: parsePlannerResult(raw || ""),
    };
}

export async function maybeHandleAppointmentBooking(
    conversationId: string,
    latestUserMessage: string,
    options?: {
        mode?: AppointmentHandlingMode;
    },
): Promise<AppointmentHandlingResult> {
    const mode = options?.mode || "create";
    const planned = await planAppointmentFromConversation(conversationId, latestUserMessage);

    if (!planned?.planner || planned.planner.intent !== "schedule") {
        return { kind: "none", reply: null };
    }

    const { planner, conversation, config } = planned;
    const durationMinutes = Math.min(
        Math.max(planner.durationMinutes || config.defaultDurationMinutes, 15),
        180,
    );
    const bookingContext = await getGoogleCalendarBookingContext();
    const specialistContextText = [
        latestUserMessage,
        ...conversation.messages.map((message) => message.content),
    ].join("\n");
    let selectedSpecialist = await findGoogleSpecialistByMention(specialistContextText);

    if (!selectedSpecialist && bookingContext.specialists.length === 1) {
        selectedSpecialist = bookingContext.specialists[0];
    }

    if (!selectedSpecialist && bookingContext.specialists.length > 1) {
        return {
            kind: "missing",
            reply: buildSpecialistReply(bookingContext.specialists),
        };
    }

    const targetCalendar = selectedSpecialist || bookingContext.writeTarget;
    const blockingCalendarIds =
        selectedSpecialist?.calendarId
            ? [selectedSpecialist.calendarId]
            : bookingContext.availabilitySources.map((source) => source.calendarId);

    if (planner.action === "ask_missing" || !planner.localDate || !planner.localTime) {
        return {
            kind: "missing",
            reply: buildMissingInfoReply(planner.missingFields || [], config),
        };
    }

    if (planner.action !== "create") {
        return { kind: "none", reply: null };
    }

    try {
        const startTime = zonedDateTimeToUtc(planner.localDate, planner.localTime, config.timeZone);
        const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
        const title =
            planner.title?.trim() ||
            `Cita con ${getContactFullName(conversation.contact, conversation.contact?.phone || "cliente")}`;

        if (mode === "validate") {
            await validateManagedAppointment({
                startTime,
                endTime,
                googleCalendarId: targetCalendar?.calendarId || undefined,
                blockingCalendarIds,
            });

            return {
                kind: "validated",
                reply: null,
                availableSlot: {
                    title,
                    localDate: planner.localDate,
                    localTime: planner.localTime,
                    durationMinutes,
                    startTime,
                    endTime,
                    label: buildValidatedSlotLabel(startTime, config.timeZone),
                },
            };
        }

        await createManagedAppointment({
            title,
            startTime,
            endTime,
            notes: planner.notes?.trim() || latestUserMessage,
            contactId: conversation.contactId,
            userId: conversation.assignedUserId || undefined,
            googleCalendarId: targetCalendar?.calendarId || undefined,
            googleCalendarName: targetCalendar?.summary || undefined,
            googleCalendarColor: targetCalendar?.backgroundColor || undefined,
            specialistName: selectedSpecialist?.specialistName || selectedSpecialist?.summary || undefined,
            blockingCalendarIds,
        });

        revalidatePath("/dashboard/calendar");
        revalidatePath("/dashboard/contacts");

        return {
            kind: "created",
            reply: buildSuccessReply(
                title,
                startTime,
                durationMinutes,
                config.timeZone,
                selectedSpecialist?.specialistName || selectedSpecialist?.summary || null,
            ),
        };
    } catch (error) {
        if (error instanceof AppointmentSchedulingError) {
            return {
                kind: "unavailable",
                reply: buildUnavailableReply(error, config),
            };
        }

        console.error("[Appointments] Failed to book appointment:", error);
        return {
            kind: "unavailable",
            reply: [
                "*No pude agendar la cita en este momento.*",
                "",
                "Si quieres, intenta de nuevo con la fecha y hora exactas.",
            ].join("\n"),
        };
    }
}
