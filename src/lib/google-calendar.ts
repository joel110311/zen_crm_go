import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const SYNC_THROTTLE_MS = 60 * 1000;

type TokenResponse = {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
};

type GoogleEventDateTime = {
    dateTime?: string;
    date?: string;
    timeZone?: string;
};

type GoogleCalendarEvent = {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    updated?: string;
    start?: GoogleEventDateTime;
    end?: GoogleEventDateTime;
    extendedProperties?: {
        private?: Record<string, string>;
    };
};

type GoogleCalendarStatus = {
    configured: boolean;
    connected: boolean;
    connectedEmail?: string | null;
    calendarId?: string | null;
    lastSyncedAt?: string | null;
};

function resolveGoogleOAuthBaseUrl(fallbackOrigin?: string) {
    const candidates = [process.env.APP_BASE_URL, process.env.AUTH_URL, fallbackOrigin];

    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            return new URL(candidate).toString();
        } catch {
            continue;
        }
    }

    throw new Error("No se pudo resolver la URL publica del CRM para Google Calendar.");
}

export function getGoogleCalendarRedirectUri(fallbackOrigin?: string) {
    return new URL("/api/google-calendar/callback", resolveGoogleOAuthBaseUrl(fallbackOrigin)).toString();
}

function getCalendarId(value?: string | null) {
    return (value || "primary").trim() || "primary";
}

function hasGoogleConfig(settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>) {
    return Boolean(settings.googleClientId && settings.googleClientSecret);
}

function hasGoogleConnection(settings: Awaited<ReturnType<typeof getSystemSettingsOrDefaults>>) {
    return Boolean(
        hasGoogleConfig(settings) &&
        settings.googleAccessToken &&
        settings.googleRefreshToken,
    );
}

function buildGoogleCalendarEventPayload(
    appointment: {
        id: string;
        title: string;
        notes: string | null;
        startTime: Date;
        endTime: Date;
        contactId?: string | null;
    },
    timeZone: string,
) {
    return {
        summary: appointment.title,
        description: appointment.notes || "",
        start: {
            dateTime: appointment.startTime.toISOString(),
            timeZone,
        },
        end: {
            dateTime: appointment.endTime.toISOString(),
            timeZone,
        },
        extendedProperties: {
            private: {
                crmAppointmentId: appointment.id,
                ...(appointment.contactId ? { crmContactId: appointment.contactId } : {}),
            },
        },
    };
}

async function updateGoogleTokens(
    settingsId: string,
    tokens: TokenResponse,
) {
    const expiresAt = new Date(Date.now() + Math.max(tokens.expires_in - 60, 60) * 1000);

    return prisma.systemSettings.update({
        where: { id: settingsId },
        data: {
            googleAccessToken: tokens.access_token,
            googleRefreshToken: tokens.refresh_token || undefined,
            googleTokenExpiresAt: expiresAt,
        },
    });
}

async function fetchGoogleJson<T>(
    url: string,
    init: RequestInit,
) {
    const response = await fetch(url, init);
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Google Calendar API error (${response.status}): ${body}`);
    }
    return response.json() as Promise<T>;
}

async function getValidGoogleAccessToken() {
    const settings = await getSystemSettingsOrDefaults();
    if (!hasGoogleConnection(settings) || !settings.id) {
        throw new Error("Google Calendar no esta conectado.");
    }

    if (
        settings.googleAccessToken &&
        settings.googleTokenExpiresAt &&
        settings.googleTokenExpiresAt.getTime() > Date.now() + 30_000
    ) {
        return {
            accessToken: settings.googleAccessToken,
            settings,
        };
    }

    const body = new URLSearchParams({
        client_id: settings.googleClientId || "",
        client_secret: settings.googleClientSecret || "",
        refresh_token: settings.googleRefreshToken || "",
        grant_type: "refresh_token",
    });

    const tokens = await fetchGoogleJson<TokenResponse>(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    const updated = await updateGoogleTokens(settings.id, tokens);

    return {
        accessToken: updated.googleAccessToken || tokens.access_token,
        settings: {
            ...settings,
            ...updated,
        },
    };
}

async function googleCalendarRequest<T>(
    path: string,
    init: RequestInit = {},
) {
    const { accessToken, settings } = await getValidGoogleAccessToken();
    const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Google Calendar API error (${response.status}): ${body}`);
    }

    if (response.status === 204) {
        return {
            data: null as T | null,
            settings,
        };
    }

    return {
        data: (await response.json()) as T,
        settings,
    };
}

function getGoogleEventLocalId(event: GoogleCalendarEvent) {
    return event.extendedProperties?.private?.crmAppointmentId || null;
}

function getGoogleEventContactId(event: GoogleCalendarEvent) {
    return event.extendedProperties?.private?.crmContactId || null;
}

function parseTimedEventDate(value?: GoogleEventDateTime) {
    if (value?.dateTime) {
        return new Date(value.dateTime);
    }
    return null;
}

async function applyGoogleEventToCrm(event: GoogleCalendarEvent) {
    const localId = getGoogleEventLocalId(event);
    const existing =
        (localId
            ? await prisma.appointment.findUnique({ where: { id: localId } })
            : null) ||
        (event.id
            ? await prisma.appointment.findUnique({ where: { googleEventId: event.id } })
            : null);

    if (event.status === "cancelled") {
        if (existing) {
            await prisma.appointment.delete({ where: { id: existing.id } });
        }
        return;
    }

    const startTime = parseTimedEventDate(event.start);
    const endTime = parseTimedEventDate(event.end);
    if (!startTime || !endTime) {
        return;
    }

    const data = {
        title: event.summary || "Evento de Google Calendar",
        notes: event.description || null,
        startTime,
        endTime,
        status: "scheduled",
        googleEventId: event.id,
        googleEventUpdatedAt: event.updated ? new Date(event.updated) : null,
        contactId: getGoogleEventContactId(event) || existing?.contactId || undefined,
        userId: existing?.userId || undefined,
    };

    if (existing) {
        await prisma.appointment.update({
            where: { id: existing.id },
            data,
        });
        return;
    }

    await prisma.appointment.create({
        data,
    });
}

async function listGoogleCalendarEvents(syncToken?: string | null) {
    const settings = await getSystemSettingsOrDefaults();
    const calendarId = encodeURIComponent(getCalendarId(settings.googleCalendarId));
    let nextPageToken: string | null = null;
    const events: GoogleCalendarEvent[] = [];
    let nextSyncToken = syncToken || null;

    do {
        const params = new URLSearchParams({
            singleEvents: "true",
            showDeleted: "true",
            maxResults: "250",
        });

        if (nextPageToken) {
            params.set("pageToken", nextPageToken);
        }

        if (syncToken) {
            params.set("syncToken", syncToken);
        } else {
            params.set("timeMin", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
            params.set("timeMax", new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());
            params.set("orderBy", "startTime");
        }

        const { data } = await googleCalendarRequest<{
            items?: GoogleCalendarEvent[];
            nextPageToken?: string;
            nextSyncToken?: string;
        }>(`/calendars/${calendarId}/events?${params.toString()}`);

        events.push(...(data?.items || []));
        nextPageToken = data?.nextPageToken || null;
        nextSyncToken = data?.nextSyncToken || nextSyncToken;
    } while (nextPageToken);

    return { events, nextSyncToken };
}

export async function getGoogleCalendarAuthUrl(redirectUri: string, state?: string) {
    const settings = await getSystemSettingsOrDefaults();
    if (!hasGoogleConfig(settings)) {
        throw new Error("Primero configura Google Client ID y Google Client Secret.");
    }

    const params = new URLSearchParams({
        client_id: settings.googleClientId || "",
        redirect_uri: redirectUri,
        response_type: "code",
        scope: `${GOOGLE_CALENDAR_SCOPE} openid email`,
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "select_account consent",
    });

    if (state) {
        params.set("state", state);
    }

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function completeGoogleCalendarOAuth(code: string, redirectUri: string) {
    const settings = await getSystemSettingsOrDefaults();
    if (!settings.id || !hasGoogleConfig(settings)) {
        throw new Error("Faltan las credenciales de Google Calendar.");
    }

    const body = new URLSearchParams({
        code,
        client_id: settings.googleClientId || "",
        client_secret: settings.googleClientSecret || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
    });

    const tokens = await fetchGoogleJson<TokenResponse>(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    await updateGoogleTokens(settings.id, tokens);

    const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
            Authorization: `Bearer ${tokens.access_token}`,
        },
    });
    const profile = profileResponse.ok
        ? await profileResponse.json() as { email?: string }
        : {};

    await prisma.systemSettings.update({
        where: { id: settings.id },
        data: {
            googleConnectedEmail: profile.email || null,
            googleSyncToken: null,
            googleLastSyncedAt: null,
        },
    });

    return {
        email: profile.email || null,
    };
}

export async function disconnectGoogleCalendar() {
    const settings = await prisma.systemSettings.findFirst();
    if (!settings?.id) return;

    await prisma.systemSettings.update({
        where: { id: settings.id },
        data: {
            googleAccessToken: null,
            googleRefreshToken: null,
            googleTokenExpiresAt: null,
            googleConnectedEmail: null,
            googleSyncToken: null,
            googleLastSyncedAt: null,
        },
    });
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
    const settings = await getSystemSettingsOrDefaults();
    return {
        configured: hasGoogleConfig(settings),
        connected: hasGoogleConnection(settings),
        connectedEmail: settings.googleConnectedEmail || null,
        calendarId: getCalendarId(settings.googleCalendarId),
        lastSyncedAt: settings.googleLastSyncedAt?.toISOString() || null,
    };
}

export async function syncAppointmentToGoogleCalendar(appointmentId: string) {
    const settings = await getSystemSettingsOrDefaults();
    if (!hasGoogleConnection(settings)) return;

    const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
    });
    if (!appointment) return;

    const calendarId = encodeURIComponent(getCalendarId(settings.googleCalendarId));
    const payload = buildGoogleCalendarEventPayload(appointment, settings.businessTimeZone);

    const { data } = appointment.googleEventId
        ? await googleCalendarRequest<GoogleCalendarEvent>(
            `/calendars/${calendarId}/events/${encodeURIComponent(appointment.googleEventId)}`,
            {
                method: "PUT",
                body: JSON.stringify(payload),
            },
        )
        : await googleCalendarRequest<GoogleCalendarEvent>(
            `/calendars/${calendarId}/events`,
            {
                method: "POST",
                body: JSON.stringify(payload),
            },
        );

    if (data?.id) {
        await prisma.appointment.update({
            where: { id: appointment.id },
            data: {
                googleEventId: data.id,
                googleEventUpdatedAt: data.updated ? new Date(data.updated) : null,
            },
        });
    }
}

export async function deleteAppointmentFromGoogleCalendar(appointmentId: string) {
    const settings = await getSystemSettingsOrDefaults();
    if (!hasGoogleConnection(settings)) return;

    const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: { googleEventId: true },
    });

    if (!appointment?.googleEventId) return;

    const calendarId = encodeURIComponent(getCalendarId(settings.googleCalendarId));
    try {
        await googleCalendarRequest<null>(
            `/calendars/${calendarId}/events/${encodeURIComponent(appointment.googleEventId)}`,
            { method: "DELETE" },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("(404)")) {
            throw error;
        }
    }
}

export async function syncGoogleCalendarToCrm(force = false) {
    const settings = await getSystemSettingsOrDefaults();
    if (!hasGoogleConnection(settings) || !settings.id) {
        return { synced: false, imported: 0 };
    }

    if (
        !force &&
        settings.googleLastSyncedAt &&
        settings.googleLastSyncedAt.getTime() > Date.now() - SYNC_THROTTLE_MS
    ) {
        return { synced: false, imported: 0 };
    }

    let result;
    try {
        result = await listGoogleCalendarEvents(settings.googleSyncToken);
    } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (settings.googleSyncToken && message.includes("(410)")) {
            await prisma.systemSettings.update({
                where: { id: settings.id },
                data: { googleSyncToken: null },
            });
            result = await listGoogleCalendarEvents(null);
        } else {
            throw error;
        }
    }

    for (const event of result.events) {
        await applyGoogleEventToCrm(event);
    }

    await prisma.systemSettings.update({
        where: { id: settings.id },
        data: {
            googleSyncToken: result.nextSyncToken || settings.googleSyncToken,
            googleLastSyncedAt: new Date(),
        },
    });

    return {
        synced: true,
        imported: result.events.length,
    };
}
