import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  disconnectMessengerPage,
  getMessengerConnectionSnapshot,
  saveMessengerConfiguration,
} from "@/lib/meta-messenger";

async function requireSuperadmin() {
  const session = await auth();
  const user = session?.user as { role?: string } | undefined;
  return user?.role === "SUPERADMIN";
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  try {
    return NextResponse.json(await getMessengerConnectionSnapshot());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo consultar Messenger." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireSuperadmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "JSON invalido." }, { status: 400 });
  }

  try {
    const snapshot = await saveMessengerConfiguration({
      appId: typeof body.appId === "string" ? body.appId : undefined,
      appSecret: typeof body.appSecret === "string" ? body.appSecret : undefined,
      graphApiVersion: typeof body.graphApiVersion === "string" ? body.graphApiVersion : undefined,
      webhookBaseUrl: typeof body.webhookBaseUrl === "string" ? body.webhookBaseUrl : undefined,
      webhookVerifyToken: typeof body.webhookVerifyToken === "string" ? body.webhookVerifyToken : undefined,
    });
    revalidatePath("/dashboard/settings");
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar Messenger." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  if (!(await requireSuperadmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  try {
    const snapshot = await disconnectMessengerPage();
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/inbox");
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo desconectar Messenger." },
      { status: 500 },
    );
  }
}
