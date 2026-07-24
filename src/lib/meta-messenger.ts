import { timingSafeEqual } from "node:crypto";
import { verifyMetaWebhookSignature } from "@/lib/meta-whatsapp";

export type MessengerWebhookEventKind =
  | "message"
  | "message_echo"
  | "postback"
  | "delivery"
  | "read"
  | "unknown";

export type MessengerWebhookEventSummary = {
  kind: MessengerWebhookEventKind;
  pageId: string;
  senderId: string;
  recipientId: string;
  timestamp: number | null;
};

type MessengerMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { is_echo?: boolean };
  postback?: unknown;
  delivery?: unknown;
  read?: unknown;
};

export type MessengerWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: MessengerMessagingEvent[];
  }>;
};

export function getMessengerWebhookVerifyToken() {
  return (process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN || "").trim();
}

export function verifyMessengerWebhookToken(receivedToken: string | null) {
  const expectedToken = getMessengerWebhookVerifyToken();
  if (!expectedToken || !receivedToken) {
    return false;
  }

  const expected = Buffer.from(expectedToken, "utf8");
  const received = Buffer.from(receivedToken, "utf8");

  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function verifyMessengerWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
) {
  // Both Meta channels sign the raw request body with the app secret.
  return verifyMetaWebhookSignature(rawBody, signatureHeader);
}

function getEventKind(event: MessengerMessagingEvent): MessengerWebhookEventKind {
  if (event.message?.is_echo) {
    return "message_echo";
  }
  if (event.message) {
    return "message";
  }
  if (event.postback) {
    return "postback";
  }
  if (event.delivery) {
    return "delivery";
  }
  if (event.read) {
    return "read";
  }
  return "unknown";
}

export function summarizeMessengerWebhookEvents(
  payload: MessengerWebhookPayload,
): MessengerWebhookEventSummary[] {
  if (payload.object !== "page") {
    return [];
  }

  return (payload.entry || []).flatMap((entry) =>
    (entry.messaging || []).map((event) => ({
      kind: getEventKind(event),
      pageId: entry.id?.trim() || event.recipient?.id?.trim() || "",
      senderId: event.sender?.id?.trim() || "",
      recipientId: event.recipient?.id?.trim() || "",
      timestamp:
        typeof event.timestamp === "number" && Number.isFinite(event.timestamp)
          ? event.timestamp
          : null,
    })),
  );
}
