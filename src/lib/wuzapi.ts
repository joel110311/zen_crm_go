import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

type WuzapiUser = {
    id?: string | number;
    ID?: string | number;
    name?: string;
    Name?: string;
    token?: string;
    Token?: string;
    webhook?: string;
    Webhook?: string;
    events?: string;
    Events?: string;
    jid?: string;
    JID?: string;
    connected?: boolean;
    Connected?: boolean;
    qrcode?: string;
    QRCode?: string;
};

type WuzapiConfig = {
    baseUrl: string;
    adminToken: string;
    userToken: string;
    instanceName: string;
    proxyEnabled: boolean;
    proxyUrl: string;
};

type WuzapiRequestMode = "admin" | "user";

type WuzapiSessionStatus = {
    connected: boolean;
    loggedIn: boolean;
    jid?: string;
    qrcode?: string;
    webhook?: string;
    events?: string;
    name?: string;
};

type WuzapiSendResult = {
    Id?: string;
    Timestamp?: string | number;
};

type SendMediaParams = {
    phone: string;
    mediaCategory: "image" | "audio" | "video" | "document";
    dataUrl: string;
    caption?: string;
    fileName?: string;
    mimeType?: string;
};

type DownloadMediaKind = "image" | "audio" | "video" | "document" | "sticker";

type DownloadMediaParams = {
    Url: string;
    DirectPath?: string;
    MediaKey: string;
    Mimetype: string;
    FileEncSHA256?: string;
    FileSHA256: string;
    FileLength: number;
};

export type WuzapiAvatarRecord = {
    URL?: string;
    Url?: string;
    url?: string;
    ID?: string;
    Id?: string;
    PictureID?: string;
    DirectPath?: string;
};

export type WuzapiContactRecord = {
    BusinessName?: string;
    FirstName?: string;
    Found?: boolean;
    FullName?: string;
    PushName?: string;
};

export type WuzapiHistoryIndexRecord = {
    chat_jid?: string;
    last_updated?: string;
    ChatJID?: string;
    LastUpdated?: string;
};

export type WuzapiHistoryMessageRecord = {
    id?: number;
    user_id?: string;
    chat_jid?: string;
    sender_jid?: string;
    message_id?: string;
    timestamp?: string | number;
    message_type?: string;
    text_content?: string;
    media_link?: string;
    quoted_message_id?: string;
    data_json?: string;
};

const WUZAPI_RETRYABLE_SEND_ERRORS = [
    "cannot start a transaction within a transaction",
    "failed to save cached sessions",
    "context deadline exceeded",
    "deadline exceeded",
    "timeout",
    "timed out",
    "i/o timeout",
    "connection reset",
    "connection refused",
    "connection closed",
    "temporary network",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "devolvio 500",
    "devolvio 502",
    "devolvio 503",
    "devolvio 504",
    "websocket",
    "not connected",
    "no session",
    "session not connected",
];
const WUZAPI_SUBSCRIBED_EVENTS = ["Message", "HistorySync"];
const WUZAPI_DEFAULT_TIMEOUT_MS = 20000;
const WUZAPI_STATUS_TIMEOUT_MS = 6500;
const WUZAPI_SEND_TIMEOUT_MS = 60000;

let wuzapiRecoveryPromise: Promise<void> | null = null;

export class WuzapiConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WuzapiConfigError";
    }
}

function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function normalizeProxyUrl(value: string) {
    return value.trim();
}

function isSupportedProxyUrl(value: string) {
    return /^(https?|socks5):\/\/.+:\d+\/?$/i.test(value.trim());
}

function buildWuzapiUserPayload(config: WuzapiConfig, webhookUrl: string, events: string) {
    const proxyUrl = normalizeProxyUrl(config.proxyUrl);

    if (config.proxyEnabled && !isSupportedProxyUrl(proxyUrl)) {
        throw new WuzapiConfigError(
            "El proxy de WhatsApp debe incluir protocolo, credenciales/host y puerto. Ejemplo: http://usuario:password@host:10000",
        );
    }

    return {
        name: config.instanceName,
        token: config.userToken,
        webhook: webhookUrl,
        events,
        proxyConfig: {
            enabled: Boolean(config.proxyEnabled && proxyUrl),
            proxyURL: config.proxyEnabled ? proxyUrl : "",
        },
    };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeObjectList<T extends object>(payload: unknown): T[] {
    if (Array.isArray(payload)) {
        return payload.filter((entry): entry is T => Boolean(entry) && typeof entry === "object");
    }

    if (!isObjectRecord(payload)) {
        return [];
    }

    return Object.values(payload).flatMap((entry) => {
        if (Array.isArray(entry)) {
            return entry.filter((item): item is T => Boolean(item) && typeof item === "object");
        }

        if (entry && typeof entry === "object") {
            return [entry as T];
        }

        return [];
    });
}

function unwrapResponse<T>(payload: unknown): T {
    if (isObjectRecord(payload)) {
        const record = payload as Record<string, unknown>;
        for (const key of ["data", "result", "Result"]) {
            if (key in record) {
                return unwrapResponse<T>(record[key]);
            }
        }

        const keys = Object.keys(record);
        if (keys.length === 1 && "Data" in record && (isObjectRecord(record.Data) || Array.isArray(record.Data))) {
            return unwrapResponse<T>(record.Data);
        }
    }
    return payload as T;
}

function readString(value: unknown): string | undefined {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }

    return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;

    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        const words = normalized.replace(/[_-]+/g, " ");

        if (
            [
                "false",
                "0",
                "no",
                "disconnected",
                "loggedout",
                "logged out",
                "logged_out",
                "not connected",
                "no conectado",
                "sin conectar",
                "offline",
                "closed",
                "inactive",
                "desconectado",
            ].includes(normalized) ||
            /\b(disconnected|logged\s*out|not\s+connected|no\s+conectado|sin\s+conectar|offline|closed|inactive|desconectado)\b/.test(
                words,
            )
        ) {
            return false;
        }

        if (
            [
                "true",
                "1",
                "yes",
                "si",
                "connected",
                "loggedin",
                "logged in",
                "logged_in",
                "active",
                "ready",
                "online",
                "open",
                "conectado",
                "activo",
            ].includes(normalized) ||
            /\b(connected|logged\s*in|active|ready|online|open|conectado|activo)\b/.test(words)
        ) {
            return true;
        }
    }

    return undefined;
}

function normalizeWuzapiSessionStatus(payload: unknown): WuzapiSessionStatus {
    const status = unwrapResponse<unknown>(payload);
    if (!isObjectRecord(status)) {
        const statusFlag = readBoolean(status);

        return {
            connected: statusFlag ?? false,
            loggedIn: statusFlag ?? false,
            name: readString(status),
        };
    }

    const record = isObjectRecord(status) ? status : {};
    const textStatus =
        readBoolean(record.status) ??
        readBoolean(record.Status) ??
        readBoolean(record.details) ??
        readBoolean(record.Details) ??
        readBoolean(record.message) ??
        readBoolean(record.Message) ??
        readBoolean(record.Data) ??
        readBoolean(record.data);
    const jid =
        readString(record.jid) ||
        readString(record.JID) ||
        readString(record.phone) ||
        readString(record.Phone) ||
        readString(record.number) ||
        readString(record.Number) ||
        readString(record.connectedPhone) ||
        readString(record.ConnectedPhone);
    const explicitConnected =
        readBoolean(record.connected) ??
        readBoolean(record.Connected) ??
        readBoolean(record.isConnected) ??
        readBoolean(record.IsConnected) ??
        textStatus;
    const explicitLoggedIn =
        readBoolean(record.loggedIn) ??
        readBoolean(record.LoggedIn) ??
        readBoolean(record.logged_in) ??
        readBoolean(record.isLoggedIn) ??
        readBoolean(record.IsLoggedIn) ??
        textStatus;
    const loggedIn = explicitLoggedIn ?? Boolean(jid);

    return {
        connected: explicitConnected ?? loggedIn,
        loggedIn,
        jid,
        qrcode: readString(record.qrcode) || readString(record.QRCode),
        webhook: readString(record.webhook) || readString(record.Webhook),
        events: readString(record.events) || readString(record.Events),
        name: readString(record.name) || readString(record.Name),
    };
}

function normalizeWuzapiUserSessionStatus(user: WuzapiUser): WuzapiSessionStatus {
    const status = normalizeWuzapiSessionStatus(user);
    const loggedIn = status.loggedIn || Boolean(status.jid);

    return {
        ...status,
        connected: status.connected || loggedIn,
        loggedIn,
    };
}

function getWuzapiUserName(user: WuzapiUser) {
    return readString(user.name) || readString(user.Name) || "";
}

function getWuzapiUserToken(user: WuzapiUser) {
    return readString(user.token) || readString(user.Token) || "";
}

function getWuzapiUserId(user: WuzapiUser) {
    return readString(user.id) || readString(user.ID);
}

async function syncStoredWuzapiUserToken(token: string) {
    const nextToken = token.trim();
    if (!nextToken) return;

    const settings = await prisma.systemSettings.findFirst();
    if (!settings || settings.whatsappUserToken === nextToken) return;

    await prisma.systemSettings.update({
        where: { id: settings.id },
        data: { whatsappUserToken: nextToken },
    });
}

function findConfiguredWuzapiUser(users: WuzapiUser[], config: WuzapiConfig) {
    const configuredToken = config.userToken.trim();
    const configuredName = config.instanceName.trim().toLowerCase();

    return (
        users.find((user) => getWuzapiUserToken(user) === configuredToken) ||
        users.find((user) => getWuzapiUserName(user).trim().toLowerCase() === configuredName) ||
        null
    );
}

async function listWuzapiAdminUsers() {
    const payload = await requestWuzapi<unknown>("admin", "/admin/users", { method: "GET" });
    return normalizeObjectList<WuzapiUser>(payload);
}

async function getConfiguredWuzapiAdminUser(config: WuzapiConfig) {
    const users = await listWuzapiAdminUsers();
    return findConfiguredWuzapiUser(users, config);
}

function normalizeWuzapiSendResult(payload: unknown): WuzapiSendResult {
    const result = unwrapResponse<unknown>(payload);
    if (!isObjectRecord(result)) {
        return { Id: readString(result) };
    }

    const nestedMessage = isObjectRecord(result.message) ? result.message : {};
    const id =
        readString(result.Id) ||
        readString(result.ID) ||
        readString(result.id) ||
        readString(result.MessageId) ||
        readString(result.messageId) ||
        readString(result.messageID) ||
        readString(nestedMessage.Id) ||
        readString(nestedMessage.ID) ||
        readString(nestedMessage.id);
    const timestamp =
        readString(result.Timestamp) ||
        readString(result.timestamp) ||
        readString(nestedMessage.Timestamp) ||
        readString(nestedMessage.timestamp);

    return {
        Id: id,
        Timestamp: timestamp,
    };
}

function normalizeWuzapiRecipient(phone: string) {
    const trimmed = phone.trim();
    if (!trimmed) return "";

    if (trimmed.startsWith("me:") || trimmed.includes("@")) {
        return trimmed.replace(/\s+/g, "");
    }

    const digits = trimmed.replace(/\D/g, "");
    if (!digits) return "";

    // WhatsApp linked-device JIDs for Mexico commonly require the legacy mobile
    // marker `1` after country code 52. Some webhook payloads arrive as
    // 52 + 10 digits, but sending back to that form can be acknowledged without
    // reaching the real chat. Canonicalize QR outbound sends to 521 + local 10.
    if (digits.length === 10) {
        return `521${digits}`;
    }

    if (digits.length === 12 && digits.startsWith("52") && !digits.startsWith("521")) {
        return `521${digits.slice(2)}`;
    }

    return digits;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWebhookUrl(appBaseUrl?: string) {
    const baseUrl = (
        process.env.WHATSAPP_WEBHOOK_BASE_URL ||
        process.env.APP_BASE_URL ||
        appBaseUrl ||
        process.env.AUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        ""
    ).trim();

    if (!baseUrl) {
        throw new WuzapiConfigError(
            'No pude resolver la URL publica del CRM. Define `AUTH_URL` o guarda la URL publica antes de preparar el canal de WhatsApp.',
        );
    }

    return `${baseUrl.replace(/\/+$/, "")}/api/webhook`;
}

export async function getWuzapiConfig(): Promise<WuzapiConfig> {
    const settings = await getSystemSettingsOrDefaults();
    const baseUrl = normalizeBaseUrl(settings.whatsappBaseUrl || "");
    const adminToken = (settings.whatsappAdminToken || "").trim();
    const userToken = (settings.whatsappUserToken || "").trim();
    const instanceName = (settings.whatsappInstanceName || "zen-crm").trim() || "zen-crm";
    const proxyEnabled = Boolean(settings.whatsappProxyEnabled);
    const proxyUrl = normalizeProxyUrl(settings.whatsappProxyUrl || "");

    if (!baseUrl) {
        throw new WuzapiConfigError("Falta configurar la URL base del servicio de WhatsApp.");
    }
    if (!userToken) {
        throw new WuzapiConfigError("Falta configurar el token del canal de WhatsApp.");
    }

    return { baseUrl, adminToken, userToken, instanceName, proxyEnabled, proxyUrl };
}

async function requestWuzapi<T>(
    mode: WuzapiRequestMode,
    path: string,
    init?: RequestInit,
): Promise<T> {
    const config = await getWuzapiConfig();
    const url = `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init?.headers || {});

    if (mode === "admin") {
        if (!config.adminToken) {
            throw new WuzapiConfigError("Falta configurar el token maestro del servicio de WhatsApp.");
        }
        headers.set("Authorization", config.adminToken);
    } else {
        headers.set("Token", config.userToken);
    }

    if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const method = (init?.method || "GET").toUpperCase();
    const timeoutMs = path.includes("/session/status") || path.includes("/session/qr")
        ? WUZAPI_STATUS_TIMEOUT_MS
        : path.includes("/chat/send/")
            ? WUZAPI_SEND_TIMEOUT_MS
            : path.includes("/session/history") || path.includes("/chat/history")
                ? WUZAPI_SEND_TIMEOUT_MS
                : method === "GET"
                    ? WUZAPI_DEFAULT_TIMEOUT_MS
                : WUZAPI_DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
        response = await fetch(url, {
            ...init,
            headers,
            cache: "no-store",
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error(`El servicio de WhatsApp no respondio a tiempo (${Math.round(timeoutMs / 1000)}s).`);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }

    const rawBody = await response.text();
    let parsed: unknown = {};
    if (rawBody) {
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            parsed = rawBody;
        }
    }

    if (!response.ok) {
        const errorMessage =
            typeof parsed === "string"
                ? parsed
                : (parsed as { error?: string; message?: string })?.message ||
                  (parsed as { error?: string })?.error ||
                  `El servicio de WhatsApp devolvio ${response.status}`;
        throw new Error(errorMessage);
    }

    return unwrapResponse<T>(parsed);
}

function isRetryableWuzapiSendError(error: unknown) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return WUZAPI_RETRYABLE_SEND_ERRORS.some((fragment) => message.includes(fragment));
}

async function retryWuzapiSend<T>(operation: () => Promise<T>) {
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (!isRetryableWuzapiSendError(error) || attempt === maxAttempts) {
                throw error;
            }

            if (attempt === 1) {
                try {
                    await recoverWuzapiSession();
                } catch (recoveryError) {
                    console.error("[WuzAPI] Soft recovery failed", recoveryError);
                }
            }

            const waitMs = attempt === 1 ? 3200 : attempt * 1200;
            console.warn(
                `[WuzAPI] Retryable send error detected. Retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxAttempts})`,
                error,
            );
            await sleep(waitMs);
        }
    }

    throw new Error("WuzAPI send retry exhausted unexpectedly");
}

export async function provisionWuzapiInstance(appBaseUrl?: string) {
    const config = await getWuzapiConfig();
    const webhookUrl = buildWebhookUrl(appBaseUrl);
    const events = WUZAPI_SUBSCRIBED_EVENTS.join(",");
    const userPayload = buildWuzapiUserPayload(config, webhookUrl, events);
    const users = await listWuzapiAdminUsers();
    const existingUser = findConfiguredWuzapiUser(users, config);

    if (!existingUser) {
        await requestWuzapi<{ id: string | number }>("admin", "/admin/users", {
            method: "POST",
            body: JSON.stringify(userPayload),
        });
    } else if (getWuzapiUserId(existingUser)) {
        const existingUserId = getWuzapiUserId(existingUser);
        let userUpdated = false;

        await requestWuzapi<unknown>("admin", `/admin/users/${existingUserId}`, {
            method: "PUT",
            body: JSON.stringify(userPayload),
        }).then(() => {
            userUpdated = true;
        }).catch((error) => {
            if (config.proxyEnabled) {
                throw error;
            }
            // Older WuzAPI builds do not expose update via admin; webhook will be refreshed below.
        });

        const existingStatus = normalizeWuzapiUserSessionStatus(existingUser);
        const existingToken = getWuzapiUserToken(existingUser);
        if (!userUpdated && existingToken && existingToken !== config.userToken && (existingStatus.connected || existingStatus.loggedIn)) {
            await syncStoredWuzapiUserToken(existingToken);
        }
    } else {
        const existingStatus = normalizeWuzapiUserSessionStatus(existingUser);
        const existingToken = getWuzapiUserToken(existingUser);
        if (existingToken && existingToken !== config.userToken && (existingStatus.connected || existingStatus.loggedIn)) {
            await syncStoredWuzapiUserToken(existingToken);
        }
    }

    await requestWuzapi<unknown>("user", "/webhook", {
        method: "POST",
        body: JSON.stringify({
            webhookURL: webhookUrl,
        }),
    });

    return {
        instanceName: config.instanceName,
        webhookUrl,
    };
}

export async function getWuzapiSessionStatus() {
    const config = await getWuzapiConfig();
    let status: WuzapiSessionStatus = {
        connected: false,
        loggedIn: false,
    };

    try {
        const payload = await requestWuzapi<unknown>("user", "/session/status", { method: "GET" });
        status = normalizeWuzapiSessionStatus(payload);
    } catch (error) {
        console.warn("[WuzAPI] User session status failed; checking admin session snapshot", error);
    }

    if (status.connected || status.loggedIn) {
        return status;
    }

    const adminUser = await getConfiguredWuzapiAdminUser(config).catch((error) => {
        console.warn("[WuzAPI] Could not verify admin user session status", error);
        return null;
    });

    if (!adminUser) {
        return status;
    }

    const adminStatus = normalizeWuzapiUserSessionStatus(adminUser);
    if (!adminStatus.connected && !adminStatus.loggedIn) {
        return status;
    }

    const adminToken = getWuzapiUserToken(adminUser);
    if (adminToken && adminToken !== config.userToken) {
        await syncStoredWuzapiUserToken(adminToken);
    }

    return {
        ...status,
        ...adminStatus,
        connected: adminStatus.connected,
        loggedIn: adminStatus.loggedIn,
    };
}

export async function connectWuzapiSession() {
    return requestWuzapi<{
        details?: string;
        events?: string;
        webhook?: string;
    }>("user", "/session/connect", {
        method: "POST",
        body: JSON.stringify({
            Subscribe: WUZAPI_SUBSCRIBED_EVENTS,
            Immediate: false,
        }),
    });
}

export async function disconnectWuzapiSession() {
    return requestWuzapi<{
        Details?: string;
        details?: string;
    }>("user", "/session/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
    });
}

export async function getWuzapiQrCode() {
    return requestWuzapi<{ QRCode?: string }>("user", "/session/qr", { method: "GET" });
}

export async function logoutWuzapiSession() {
    return requestWuzapi<unknown>("user", "/session/logout", { method: "POST" });
}

async function performWuzapiRecovery() {
    const currentStatus = await getWuzapiSessionStatus().catch(() => null);

    if (!currentStatus?.loggedIn) {
        throw new Error("No se puede autocurar el canal porque la sesion ya no esta vinculada.");
    }

    if (currentStatus.connected) {
        await disconnectWuzapiSession().catch((error) => {
            console.warn("[WuzAPI] Soft disconnect failed during recovery", error);
        });
        await sleep(1200);
    }

    await connectWuzapiSession();
    await sleep(2500);

    const recoveredStatus = await getWuzapiSessionStatus().catch(() => null);
    if (recoveredStatus && recoveredStatus.connected === false) {
        throw new Error("El canal no logro reconectarse despues de la autocuracion.");
    }
}

async function recoverWuzapiSession() {
    if (!wuzapiRecoveryPromise) {
        wuzapiRecoveryPromise = (async () => {
            try {
                console.warn("[WuzAPI] Attempting soft recovery via disconnect/connect");
                await performWuzapiRecovery();
                console.warn("[WuzAPI] Soft recovery completed");
            } finally {
                wuzapiRecoveryPromise = null;
            }
        })();
    }

    return wuzapiRecoveryPromise;
}

export async function deleteWuzapiInstance() {
    const config = await getWuzapiConfig();
    const users = await listWuzapiAdminUsers();
    const existingUser = findConfiguredWuzapiUser(users, config);

    await logoutWuzapiSession().catch(() => {
        // Continue even if the session is already offline.
    });

    const existingUserId = existingUser ? getWuzapiUserId(existingUser) : undefined;
    if (existingUserId) {
        await requestWuzapi<unknown>("admin", `/admin/users/${existingUserId}`, {
            method: "DELETE",
        });
    }

    const settings = await prisma.systemSettings.findFirst();
    if (settings) {
        await prisma.systemSettings.update({
            where: { id: settings.id },
            data: {
                whatsappUserToken: null,
            },
        });
    }

    return { deleted: true };
}

export async function sendWuzapiTextMessage(phone: string, body: string) {
    return retryWuzapiSend(() =>
        requestWuzapi<unknown>("user", "/chat/send/text", {
            method: "POST",
            body: JSON.stringify({
                Phone: normalizeWuzapiRecipient(phone),
                Body: body,
            }),
        }).then(normalizeWuzapiSendResult),
    );
}

export async function sendWuzapiReaction(params: {
    phone: string;
    reaction: string;
    providerMessageId: string;
    ownMessage?: boolean;
}) {
    const phone = normalizeWuzapiRecipient(params.phone);
    const messageId = params.ownMessage ? `me:${params.providerMessageId}` : params.providerMessageId;

    return retryWuzapiSend(() =>
        requestWuzapi<{ Details?: string }>("user", "/chat/react", {
            method: "POST",
            body: JSON.stringify({
                Phone: phone,
                Body: params.reaction,
                Id: messageId,
            }),
        }),
    );
}

export async function sendWuzapiDeleteMessage(params: {
    phone: string;
    providerMessageId: string;
    ownMessage?: boolean;
}) {
    const phone = normalizeWuzapiRecipient(params.phone);
    const messageId = params.providerMessageId.trim();
    if (!messageId) {
        throw new Error("No se pudo eliminar en WhatsApp porque falta el ID del mensaje.");
    }

    const idCandidates = params.ownMessage
        ? [`me:${messageId}`, messageId]
        : [messageId];

    let lastError: unknown = null;

    for (const idCandidate of idCandidates) {
        try {
            return await retryWuzapiSend(() =>
                requestWuzapi<{ Details?: string }>("user", "/chat/delete", {
                    method: "POST",
                    body: JSON.stringify({
                        Phone: phone,
                        Id: idCandidate,
                    }),
                }),
            );
        } catch (error) {
            lastError = error;
            if (idCandidates.length === 1) {
                break;
            }

            const normalizedMessage = error instanceof Error ? error.message.toLowerCase() : "";
            const shouldTryNextCandidate =
                normalizedMessage.includes("not found") ||
                normalizedMessage.includes("invalid") ||
                normalizedMessage.includes("bad request");

            if (!shouldTryNextCandidate) {
                break;
            }
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error("No se pudo eliminar el mensaje en WhatsApp.");
}

export async function sendWuzapiMediaMessage(params: SendMediaParams) {
    const phone = normalizeWuzapiRecipient(params.phone);

    if (params.mediaCategory === "image") {
        return retryWuzapiSend(() =>
            requestWuzapi<unknown>("user", "/chat/send/image", {
                method: "POST",
                body: JSON.stringify({
                    Phone: phone,
                    Caption: params.caption || "",
                    Image: params.dataUrl,
                    MimeType: params.mimeType,
                }),
            }).then(normalizeWuzapiSendResult),
        );
    }

    if (params.mediaCategory === "audio") {
        return retryWuzapiSend(() =>
            requestWuzapi<unknown>("user", "/chat/send/audio", {
                method: "POST",
                body: JSON.stringify({
                    Phone: phone,
                    Audio: params.dataUrl,
                    Caption: params.caption || "",
                    MimeType: params.mimeType,
                    PTT: true,
                }),
            }).then(normalizeWuzapiSendResult),
        );
    }

    if (params.mediaCategory === "video") {
        return retryWuzapiSend(() =>
            requestWuzapi<unknown>("user", "/chat/send/video", {
                method: "POST",
                body: JSON.stringify({
                    Phone: phone,
                    Caption: params.caption || "",
                    Video: params.dataUrl,
                    MimeType: params.mimeType,
                }),
            }).then(normalizeWuzapiSendResult),
        );
    }

    const [, encodedContent = ""] = params.dataUrl.split(",", 2);
    const documentDataUrl = `data:application/octet-stream;base64,${encodedContent}`;

    return retryWuzapiSend(() =>
        requestWuzapi<unknown>("user", "/chat/send/document", {
            method: "POST",
            body: JSON.stringify({
                Phone: phone,
                Caption: params.caption || "",
                FileName: params.fileName || "archivo",
                MimeType: params.mimeType || "application/octet-stream",
                Document: documentDataUrl,
            }),
        }).then(normalizeWuzapiSendResult),
    );
}

export async function downloadWuzapiMedia(kind: DownloadMediaKind, payload: DownloadMediaParams) {
    const endpointByKind: Record<DownloadMediaKind, string> = {
        image: "/chat/downloadimage",
        audio: "/chat/downloadaudio",
        video: "/chat/downloadvideo",
        document: "/chat/downloaddocument",
        sticker: "/chat/downloadsticker",
    };

    const result = await requestWuzapi<unknown>("user", endpointByKind[kind], {
        method: "POST",
        body: JSON.stringify(payload),
    });

    if (typeof result === "string") {
        return { Data: result };
    }

    if (isObjectRecord(result)) {
        return {
            Data: readString(result.Data) || readString(result.data),
            Mimetype: readString(result.Mimetype) || readString(result.mimetype) || readString(result.mimeType),
        };
    }

    return {};
}

export async function getWuzapiContacts() {
    const payload = await requestWuzapi<unknown>("user", "/user/contacts", {
        method: "GET",
    });

    if (!isObjectRecord(payload)) {
        return {};
    }

    const contactsByJid: Record<string, WuzapiContactRecord> = {};
    for (const [jid, entry] of Object.entries(payload)) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            contactsByJid[jid] = entry as WuzapiContactRecord;
        }
    }

    return contactsByJid;
}

export async function getWuzapiAvatar(phoneOrJid: string, preview = true) {
    const target = normalizeWuzapiRecipient(phoneOrJid);
    if (!target) {
        throw new Error("El contacto no tiene un telefono o JID valido para consultar avatar.");
    }

    return requestWuzapi<WuzapiAvatarRecord>("user", "/user/avatar", {
        method: "POST",
        body: JSON.stringify({
            Phone: target,
            Preview: preview,
        }),
    });
}

export async function setWuzapiHistoryLimit(limit: number) {
    return requestWuzapi<{ Details?: string; History?: number }>("user", "/session/history", {
        method: "POST",
        body: JSON.stringify({
            history: Math.max(0, Number.parseInt(String(limit), 10) || 0),
        }),
    });
}

export async function requestWuzapiHistorySync(params?: {
    count?: number;
    chatJid?: string;
    oldestMessageId?: string;
    oldestMessageFromMe?: boolean;
    oldestMessageTimestamp?: number;
}) {
    const searchParams = new URLSearchParams();

    if (params?.count && params.count > 0) {
        searchParams.set("count", String(params.count));
    }
    if (params?.chatJid) {
        searchParams.set("chat_jid", params.chatJid);
    }
    if (params?.oldestMessageId) {
        searchParams.set("oldest_msg_id", params.oldestMessageId);
    }
    if (typeof params?.oldestMessageFromMe === "boolean") {
        searchParams.set("oldest_msg_from_me", params.oldestMessageFromMe ? "true" : "false");
    }
    if (typeof params?.oldestMessageTimestamp === "number" && Number.isFinite(params.oldestMessageTimestamp)) {
        searchParams.set("oldest_msg_timestamp", String(Math.trunc(params.oldestMessageTimestamp)));
    }

    const path = searchParams.size > 0
        ? `/session/history?${searchParams.toString()}`
        : "/session/history";

    return requestWuzapi<{
        details?: string;
        timestamp?: number;
        count?: number;
        chat_jid?: string;
        oldest_msg_id?: string;
        oldest_msg_from_me?: boolean;
        oldest_msg_timestamp?: number;
    }>("user", path, {
        method: "GET",
    });
}

export async function getWuzapiHistoryIndex() {
    const payload = await requestWuzapi<unknown>(
        "user",
        "/chat/history?chat_jid=index",
        { method: "GET" },
    );

    return normalizeObjectList<WuzapiHistoryIndexRecord>(payload);
}

export async function getWuzapiChatHistory(chatJid: string, limit = 5000) {
    const searchParams = new URLSearchParams({
        chat_jid: chatJid,
        limit: String(Math.max(1, Math.trunc(limit))),
    });

    const payload = await requestWuzapi<unknown>(
        "user",
        `/chat/history?${searchParams.toString()}`,
        { method: "GET" },
    );

    return normalizeObjectList<WuzapiHistoryMessageRecord>(payload);
}

export async function ensureWuzapiUserToken() {
    const settings = await prisma.systemSettings.findFirst();
    if (settings?.whatsappUserToken) {
        return settings.whatsappUserToken;
    }

    const token = crypto.randomUUID().replace(/-/g, "");

    if (settings) {
        await prisma.systemSettings.update({
            where: { id: settings.id },
            data: { whatsappUserToken: token },
        });
    } else {
        await prisma.systemSettings.create({
            data: {
                whatsappUserToken: token,
                whatsappInstanceName: "zen-crm",
            },
        });
    }

    return token;
}
