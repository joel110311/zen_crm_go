import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { processInboundMessage, type InboundMediaPayload } from "@/app/actions/chat";
import { prisma } from "@/lib/db";
import {
  getMessengerConnectionSnapshot,
  getMessengerProfile,
  verifyMessengerWebhookSignature,
  verifyMessengerWebhookToken,
} from "@/lib/meta-messenger";
import { MESSAGE_SOURCE_MESSENGER } from "@/lib/message-source";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type MessengerAttachment = {
  type?: string;
  payload?: {
    url?: string;
    sticker_id?: number;
  };
};

type MessengerMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  attachments?: MessengerAttachment[];
  quick_reply?: { payload?: string };
};

type MessengerMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: MessengerMessage;
  postback?: {
    title?: string;
    payload?: string;
    referral?: { ref?: string; source?: string; type?: string };
  };
  referral?: { ref?: string; source?: string; type?: string };
  delivery?: { mids?: string[]; watermark?: number };
  read?: { watermark?: number };
};

type MessengerWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: MessengerMessagingEvent[];
  }>;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function eventDate(timestamp?: number) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return new Date();
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function mediaFromMessage(message: MessengerMessage): InboundMediaPayload | undefined {
  const attachment = message.attachments?.find((candidate) => readString(candidate.payload?.url));
  if (!attachment?.payload?.url) return undefined;
  const rawType = readString(attachment.type).toLowerCase();
  const type = rawType === "file" ? "document" : rawType === "image" || rawType === "audio" || rawType === "video"
    ? rawType
    : "document";
  return {
    type,
    mediaUrl: attachment.payload.url,
    mediaFileName: rawType === "file" ? "Archivo de Messenger" : undefined,
  };
}

function contentFromEvent(event: MessengerMessagingEvent) {
  const messageText = readString(event.message?.text);
  if (messageText) return messageText;
  const postbackTitle = readString(event.postback?.title);
  if (postbackTitle) return postbackTitle;
  const quickReply = readString(event.message?.quick_reply?.payload);
  if (quickReply) return quickReply;
  const postbackPayload = readString(event.postback?.payload);
  if (postbackPayload) return postbackPayload;
  const referral = readString(event.referral?.ref) || readString(event.postback?.referral?.ref);
  if (referral) return referral;
  const attachmentType = readString(event.message?.attachments?.[0]?.type);
  return attachmentType ? `[${attachmentType}]` : "[mensaje de Messenger]";
}

async function updateDeliveryStatus(event: MessengerMessagingEvent, pageId: string) {
  const mids = (event.delivery?.mids || []).map(readString).filter(Boolean);
  if (mids.length > 0) {
    await prisma.message.updateMany({
      where: {
        sourceType: MESSAGE_SOURCE_MESSENGER,
        sourceId: pageId,
        providerMessageId: { in: mids },
        status: { in: ["sending", "sent"] },
      },
      data: { status: "delivered" },
    });
  }

  const watermark = event.delivery?.watermark;
  const recipientId = readString(event.sender?.id);
  if (typeof watermark === "number" && recipientId) {
    await updateMessagesThroughWatermark(pageId, recipientId, watermark, "delivered");
  }
}

async function updateMessagesThroughWatermark(
  pageId: string,
  recipientId: string,
  watermark: number,
  status: "delivered" | "read",
) {
  const contact = await prisma.contact.findUnique({
    where: { phone: recipientId },
    select: { id: true },
  });
  if (!contact) return;
  const conversation = await prisma.conversation.findFirst({
    where: {
      contactId: contact.id,
      sourceType: MESSAGE_SOURCE_MESSENGER,
      sourceId: pageId,
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!conversation) return;

  await prisma.message.updateMany({
    where: {
      conversationId: conversation.id,
      sourceType: MESSAGE_SOURCE_MESSENGER,
      sourceId: pageId,
      direction: "outbound",
      createdAt: { lte: eventDate(watermark) },
      ...(status === "delivered"
        ? { status: { in: ["sending", "sent"] } }
        : { status: { not: "failed" } }),
    },
    data: { status },
  });
}

async function storeOutboundEcho(event: MessengerMessagingEvent, pageId: string) {
  const message = event.message;
  const providerMessageId = readString(message?.mid);
  const recipientId = readString(event.recipient?.id);
  if (!message || !recipientId) return;

  if (providerMessageId) {
    const existing = await prisma.message.findFirst({
      where: {
        sourceType: MESSAGE_SOURCE_MESSENGER,
        providerMessageId,
      },
    });
    if (existing) {
      await prisma.message.update({
        where: { id: existing.id },
        data: { status: existing.status === "read" ? "read" : "sent" },
      });
      return;
    }
  }

  const profile = await getMessengerProfile(recipientId, pageId).catch(() => ({
    name: "Contacto de Messenger",
    profilePictureUrl: null,
  }));
  const contact = await prisma.contact.upsert({
    where: { phone: recipientId },
    create: {
      phone: recipientId,
      name: profile.name,
      whatsappAvatarUrl: profile.profilePictureUrl,
      status: "lead",
    },
    update: profile.profilePictureUrl
      ? { whatsappAvatarUrl: profile.profilePictureUrl }
      : {},
  });
  const conversation = await findOrCreateActiveConversationForContactSource({
    contactId: contact.id,
    sourceType: MESSAGE_SOURCE_MESSENGER,
    sourceId: pageId,
    defaults: { botActive: false },
  });
  const media = mediaFromMessage(message);
  const content = contentFromEvent(event);
  const recentDuplicate = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      sourceType: MESSAGE_SOURCE_MESSENGER,
      direction: "outbound",
      content,
      createdAt: { gte: new Date(Date.now() - 15_000) },
    },
  });

  if (recentDuplicate) {
    await prisma.message.update({
      where: { id: recentDuplicate.id },
      data: {
        providerMessageId: recentDuplicate.providerMessageId || providerMessageId || null,
        status: "sent",
      },
    });
  } else {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        content,
        type: media?.type || "text",
        mediaUrl: media?.mediaUrl || null,
        mediaFileName: media?.mediaFileName || null,
        direction: "outbound",
        status: "sent",
        senderType: "human",
        providerMessageId: providerMessageId || null,
        sourceType: MESSAGE_SOURCE_MESSENGER,
        sourceId: pageId,
        createdAt: eventDate(event.timestamp),
      },
    });
  }
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date(), botActive: false },
  });
}

async function processInboundEvent(event: MessengerMessagingEvent, pageId: string) {
  const senderId = readString(event.sender?.id);
  const providerMessageId = readString(event.message?.mid)
    || (event.postback
      ? `postback:${senderId}:${event.timestamp || Date.now()}:${readString(event.postback.payload)}`
      : event.referral
        ? `referral:${senderId}:${event.timestamp || Date.now()}:${readString(event.referral.ref)}`
        : "");
  if (!senderId || !providerMessageId) return;

  const profile = await getMessengerProfile(senderId, pageId).catch(() => ({
    name: "Contacto de Messenger",
    profilePictureUrl: null,
  }));
  const result = await processInboundMessage(
    senderId,
    contentFromEvent(event),
    profile.name,
    event.message ? mediaFromMessage(event.message) : undefined,
    providerMessageId,
    undefined,
    {
      sourceType: MESSAGE_SOURCE_MESSENGER,
      sourceId: pageId,
    },
  );

  if (result?.contact && profile.profilePictureUrl) {
    await prisma.contact.update({
      where: { id: result.contact.id },
      data: { whatsappAvatarUrl: profile.profilePictureUrl },
    });
  }
}

async function processMessengerPayload(payload: MessengerWebhookPayload) {
  if (payload.object !== "page") return;
  const snapshot = await getMessengerConnectionSnapshot();
  if (!snapshot.connected || !snapshot.pageId) {
    throw new Error("Messenger recibio eventos sin una Pagina conectada.");
  }

  for (const entry of payload.entry || []) {
    const pageId = readString(entry.id);
    if (!pageId || pageId !== snapshot.pageId) {
      console.warn("[Messenger Webhook] Se ignoro un evento de otra Pagina.", { pageId });
      continue;
    }

    for (const event of entry.messaging || []) {
      if (event.message?.is_echo) {
        await storeOutboundEcho(event, pageId);
      } else if (event.message || event.postback || event.referral) {
        await processInboundEvent(event, pageId);
      }

      if (event.delivery) {
        await updateDeliveryStatus(event, pageId);
      }
      if (event.read?.watermark && event.sender?.id) {
        await updateMessagesThroughWatermark(
          pageId,
          event.sender.id,
          event.read.watermark,
          "read",
        );
      }
    }
  }

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/contacts");
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";

  if (mode === "subscribe" && await verifyMessengerWebhookToken(token)) {
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        ...noStoreHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  return new NextResponse("Forbidden", {
    status: 403,
    headers: noStoreHeaders,
  });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!(await verifyMessengerWebhookSignature(rawBody, signature))) {
    return NextResponse.json(
      { error: "invalid signature" },
      { status: 401, headers: noStoreHeaders },
    );
  }

  let payload: MessengerWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MessengerWebhookPayload;
  } catch {
    return NextResponse.json(
      { error: "invalid json" },
      { status: 400, headers: noStoreHeaders },
    );
  }

  try {
    await processMessengerPayload(payload);
    return NextResponse.json(
      { received: true },
      { status: 200, headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("[Messenger Webhook] No se pudo procesar el evento:", error);
    return NextResponse.json(
      { error: "processing failed" },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
