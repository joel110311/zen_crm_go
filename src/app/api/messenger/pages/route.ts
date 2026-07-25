import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectMessengerPage, listMessengerPages } from "@/lib/meta-messenger";

async function requireSuperadmin() {
  const session = await auth();
  const user = session?.user as { role?: string } | undefined;
  return user?.role === "SUPERADMIN";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  if (!(await requireSuperadmin())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const userAccessToken = readString(body?.userAccessToken);
  const pageId = readString(body?.pageId);
  if (!userAccessToken) {
    return NextResponse.json({ error: "Falta el token de Facebook." }, { status: 400 });
  }

  try {
    if (!pageId) {
      const pages = await listMessengerPages(userAccessToken);
      return NextResponse.json({
        pages: pages.map((page) => ({
          id: page.id,
          name: page.name,
          pictureUrl: page.pictureUrl,
          tasks: page.tasks,
        })),
      });
    }

    const snapshot = await connectMessengerPage({ userAccessToken, pageId });
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/inbox");
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron consultar las Paginas." },
      { status: 500 },
    );
  }
}
