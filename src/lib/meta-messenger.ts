import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

const MESSENGER_SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_deliveries",
  "message_reads",
] as const;

type UnknownRecord = Record<string, unknown>;

export type MessengerPage = {
  id: string;
  name: string;
  accessToken: string;
  pictureUrl: string | null;
  tasks: string[];
};

export type MessengerConnectionSnapshot = {
  configured: boolean;
  connected: boolean;
  appId: string | null;
  appSecretConfigured: boolean;
  graphApiVersion: string;
  webhookBaseUrl: string | null;
  webhookVerifyTokenConfigured: boolean;
  callbackUrl: string | null;
  pageId: string | null;
  pageName: string | null;
  webhookSubscribed: boolean;
  connectedAt: Date | null;
};

export class MessengerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessengerConfigError";
  }
}

export class MessengerApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "MessengerApiError";
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeGraphVersion(value: string) {
  const normalized = value.trim();
  return /^v\d+\.\d+$/.test(normalized) ? normalized : "v23.0";
}

function graphUrl(version: string, pathname: string) {
  return `https://graph.facebook.com/${normalizeGraphVersion(version)}${pathname}`;
}

function apiErrorMessage(payload: unknown, fallback: string) {
  const record = payload && typeof payload === "object" ? payload as UnknownRecord : {};
  const error = record.error && typeof record.error === "object" ? record.error as UnknownRecord : {};
  return readString(error.message) || fallback;
}

async function graphRequest(
  pathname: string,
  accessToken: string,
  graphApiVersion: string,
  init?: RequestInit,
) {
  const response = await fetch(graphUrl(graphApiVersion, pathname), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorRecord = payload && typeof payload === "object"
      ? (payload as UnknownRecord).error as UnknownRecord | undefined
      : undefined;
    const code = typeof errorRecord?.code === "number" ? errorRecord.code : undefined;
    throw new MessengerApiError(
      apiErrorMessage(payload, `Meta Graph API devolvio ${response.status}.`),
      response.status,
      code,
    );
  }

  return payload as UnknownRecord;
}

export async function getMessengerConnectionSnapshot(): Promise<MessengerConnectionSnapshot> {
  const settings = await getSystemSettingsOrDefaults();
  const appId = readString(settings.messengerAppId);
  const appSecret = readString(settings.messengerAppSecret);
  const graphApiVersion = normalizeGraphVersion(settings.messengerGraphApiVersion);
  const webhookBaseUrl = normalizeBaseUrl(readString(settings.messengerWebhookBaseUrl));
  const verifyToken = readString(settings.messengerWebhookVerifyToken);
  const pageId = readString(settings.messengerPageId);
  const pageToken = readString(settings.messengerPageAccessToken);

  return {
    configured: Boolean(appId && appSecret && verifyToken && webhookBaseUrl),
    connected: Boolean(pageId && pageToken),
    appId: appId || null,
    appSecretConfigured: Boolean(appSecret),
    graphApiVersion,
    webhookBaseUrl: webhookBaseUrl || null,
    webhookVerifyTokenConfigured: Boolean(verifyToken),
    callbackUrl: webhookBaseUrl ? `${webhookBaseUrl}/api/webhooks/messenger` : null,
    pageId: pageId || null,
    pageName: readString(settings.messengerPageName) || null,
    webhookSubscribed: Boolean(settings.messengerWebhookSubscribed),
    connectedAt: settings.messengerConnectedAt || null,
  };
}

export async function saveMessengerConfiguration(input: {
  appId?: string;
  appSecret?: string;
  graphApiVersion?: string;
  webhookBaseUrl?: string;
  webhookVerifyToken?: string;
}) {
  const existing = await prisma.systemSettings.findFirst();
  const data = {
    messengerAppId: readString(input.appId) || undefined,
    messengerAppSecret: readString(input.appSecret) || undefined,
    messengerGraphApiVersion: normalizeGraphVersion(input.graphApiVersion || "v23.0"),
    messengerWebhookBaseUrl: normalizeBaseUrl(readString(input.webhookBaseUrl)) || undefined,
    messengerWebhookVerifyToken: readString(input.webhookVerifyToken) || undefined,
  };

  if (existing) {
    await prisma.systemSettings.update({ where: { id: existing.id }, data });
  } else {
    await prisma.systemSettings.create({ data });
  }

  return getMessengerConnectionSnapshot();
}

async function getMessengerProviderConfig() {
  const settings = await getSystemSettingsOrDefaults();
  const appId = readString(settings.messengerAppId);
  const appSecret = readString(settings.messengerAppSecret);
  if (!appId || !appSecret) {
    throw new MessengerConfigError("Configura el App ID y App Secret de Messenger.");
  }

  return {
    appId,
    appSecret,
    graphApiVersion: normalizeGraphVersion(settings.messengerGraphApiVersion),
  };
}

async function exchangeForLongLivedUserToken(userAccessToken: string) {
  const config = await getMessengerProviderConfig();
  const url = new URL(graphUrl(config.graphApiVersion, "/oauth/access_token"));
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("fb_exchange_token", userAccessToken);

  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as UnknownRecord;
  if (!response.ok) {
    throw new MessengerApiError(
      apiErrorMessage(payload, "No se pudo extender la sesion de Facebook."),
      response.status,
    );
  }

  return readString(payload.access_token) || userAccessToken;
}

export async function listMessengerPages(userAccessToken: string): Promise<MessengerPage[]> {
  if (!userAccessToken.trim()) {
    throw new MessengerConfigError("Facebook no devolvio un access token.");
  }
  const config = await getMessengerProviderConfig();
  const longLivedToken = await exchangeForLongLivedUserToken(userAccessToken.trim());
  const payload = await graphRequest(
    "/me/accounts?fields=id,name,access_token,tasks,picture.type(square)&limit=100",
    longLivedToken,
    config.graphApiVersion,
  );
  const rows = Array.isArray(payload.data) ? payload.data : [];

  return rows.flatMap((value): MessengerPage[] => {
    if (!value || typeof value !== "object") return [];
    const page = value as UnknownRecord;
    const id = readString(page.id);
    const accessToken = readString(page.access_token);
    if (!id || !accessToken) return [];
    const picture = page.picture && typeof page.picture === "object" ? page.picture as UnknownRecord : {};
    const pictureData = picture.data && typeof picture.data === "object" ? picture.data as UnknownRecord : {};
    return [{
      id,
      name: readString(page.name) || id,
      accessToken,
      pictureUrl: readString(pictureData.url) || null,
      tasks: Array.isArray(page.tasks) ? page.tasks.map(readString).filter(Boolean) : [],
    }];
  });
}

export async function connectMessengerPage(input: {
  userAccessToken: string;
  pageId: string;
}) {
  const connection = await getMessengerConnectionSnapshot();
  if (!connection.configured || !connection.callbackUrl) {
    throw new MessengerConfigError(
      "Completa App ID, App Secret, URL publica y token de verificacion antes de conectar la Pagina.",
    );
  }
  const callbackUrl = new URL(connection.callbackUrl);
  if (callbackUrl.protocol !== "https:") {
    throw new MessengerConfigError("El webhook de Messenger requiere una URL publica HTTPS.");
  }

  const pages = await listMessengerPages(input.userAccessToken);
  const page = pages.find((candidate) => candidate.id === input.pageId.trim());
  if (!page) {
    throw new MessengerConfigError("La Pagina seleccionada no pertenece a la cuenta autorizada.");
  }

  const config = await getMessengerProviderConfig();
  await graphRequest(
    `/${encodeURIComponent(page.id)}/subscribed_apps`,
    page.accessToken,
    config.graphApiVersion,
    {
      method: "POST",
      body: JSON.stringify({ subscribed_fields: MESSENGER_SUBSCRIBED_FIELDS }),
    },
  );
  const subscriptions = await graphRequest(
    `/${encodeURIComponent(page.id)}/subscribed_apps?fields=id,name,subscribed_fields`,
    page.accessToken,
    config.graphApiVersion,
  );
  const subscribedApps = Array.isArray(subscriptions.data) ? subscriptions.data : [];
  const currentApp = subscribedApps.find((value) => (
    value
    && typeof value === "object"
    && readString((value as UnknownRecord).id) === config.appId
  ));
  if (!currentApp) {
    throw new MessengerApiError("Meta no confirmo la suscripcion de la Pagina al webhook.");
  }

  const existing = await prisma.systemSettings.findFirst();
  const data = {
    messengerPageId: page.id,
    messengerPageName: page.name,
    messengerPageAccessToken: page.accessToken,
    messengerWebhookSubscribed: true,
    messengerConnectedAt: new Date(),
  };
  if (existing) {
    await prisma.systemSettings.update({ where: { id: existing.id }, data });
  } else {
    await prisma.systemSettings.create({ data });
  }

  return getMessengerConnectionSnapshot();
}

export async function disconnectMessengerPage() {
  const settings = await getSystemSettingsOrDefaults();
  const pageId = readString(settings.messengerPageId);
  const pageToken = readString(settings.messengerPageAccessToken);
  const graphApiVersion = normalizeGraphVersion(settings.messengerGraphApiVersion);

  if (pageId && pageToken) {
    await graphRequest(
      `/${encodeURIComponent(pageId)}/subscribed_apps`,
      pageToken,
      graphApiVersion,
      { method: "DELETE" },
    );
  }

  const existing = await prisma.systemSettings.findFirst();
  if (existing) {
    await prisma.systemSettings.update({
      where: { id: existing.id },
      data: {
        messengerPageId: null,
        messengerPageName: null,
        messengerPageAccessToken: null,
        messengerWebhookSubscribed: false,
        messengerConnectedAt: null,
      },
    });
  }

  return getMessengerConnectionSnapshot();
}

export async function getMessengerWebhookVerifyToken() {
  const settings = await getSystemSettingsOrDefaults();
  return readString(settings.messengerWebhookVerifyToken);
}

export async function verifyMessengerWebhookToken(receivedToken: string | null) {
  const expectedToken = await getMessengerWebhookVerifyToken();
  if (!expectedToken || !receivedToken) return false;
  const expected = Buffer.from(expectedToken, "utf8");
  const received = Buffer.from(receivedToken, "utf8");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function verifyMessengerWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const settings = await getSystemSettingsOrDefaults();
  const appSecret = readString(settings.messengerAppSecret);
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const received = signatureHeader.slice("sha256=".length);
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (received.length !== expected.length || !/^[a-f0-9]+$/i.test(received)) return false;
  return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

async function getConnectedPageConfig(pageId?: string) {
  const settings = await getSystemSettingsOrDefaults();
  const connectedPageId = readString(settings.messengerPageId);
  const pageAccessToken = readString(settings.messengerPageAccessToken);
  if (!connectedPageId || !pageAccessToken) {
    throw new MessengerConfigError("Conecta una Pagina de Facebook antes de usar Messenger.");
  }
  if (pageId && pageId !== connectedPageId) {
    throw new MessengerConfigError("El evento no pertenece a la Pagina conectada.");
  }
  return {
    pageId: connectedPageId,
    pageAccessToken,
    graphApiVersion: normalizeGraphVersion(settings.messengerGraphApiVersion),
  };
}

export async function getMessengerProfile(psid: string, pageId?: string) {
  const config = await getConnectedPageConfig(pageId);
  const payload = await graphRequest(
    `/${encodeURIComponent(psid)}?fields=first_name,last_name,profile_pic`,
    config.pageAccessToken,
    config.graphApiVersion,
  );
  const name = [readString(payload.first_name), readString(payload.last_name)].filter(Boolean).join(" ");
  return {
    name: name || "Contacto de Messenger",
    profilePictureUrl: readString(payload.profile_pic) || null,
  };
}

export async function sendMessengerMessage(params: {
  recipientId: string;
  text?: string;
  attachmentUrl?: string;
  attachmentType?: "image" | "audio" | "video" | "file";
  pageId?: string | null;
}) {
  const config = await getConnectedPageConfig(params.pageId || undefined);
  const message = params.attachmentUrl
    ? {
        attachment: {
          type: params.attachmentType || "file",
          payload: { url: params.attachmentUrl, is_reusable: true },
        },
      }
    : { text: readString(params.text) };

  if (!params.attachmentUrl && !readString(params.text)) {
    throw new MessengerConfigError("El mensaje de Messenger esta vacio.");
  }

  const payload = await graphRequest(
    `/${encodeURIComponent(config.pageId)}/messages`,
    config.pageAccessToken,
    config.graphApiVersion,
    {
      method: "POST",
      body: JSON.stringify({
        recipient: { id: params.recipientId.trim() },
        messaging_type: "RESPONSE",
        message,
      }),
    },
  );

  return {
    Id: readString(payload.message_id) || null,
    recipientId: readString(payload.recipient_id) || params.recipientId,
    raw: payload,
  };
}
