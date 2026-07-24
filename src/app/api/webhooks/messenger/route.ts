import { NextRequest, NextResponse } from "next/server";
import {
  summarizeMessengerWebhookEvents,
  verifyMessengerWebhookSignature,
  verifyMessengerWebhookToken,
  type MessengerWebhookPayload,
} from "@/lib/meta-messenger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";

  if (mode === "subscribe" && verifyMessengerWebhookToken(token)) {
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

  const events = summarizeMessengerWebhookEvents(payload);

  // Persistence starts after Page connection and PSID mapping are implemented.
  if (events.length > 0) {
    const counts = events.reduce<Record<string, number>>((summary, event) => {
      summary[event.kind] = (summary[event.kind] || 0) + 1;
      return summary;
    }, {});

    console.info("[Messenger Webhook] Signed Page events received.", {
      entries: payload.entry?.length || 0,
      events: events.length,
      counts,
    });
  }

  return NextResponse.json(
    { received: true },
    { status: 200, headers: noStoreHeaders },
  );
}
