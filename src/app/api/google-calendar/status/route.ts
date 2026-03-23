import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    disconnectGoogleCalendar,
    getGoogleCalendarRedirectUri,
    getGoogleCalendarStatus,
    syncGoogleCalendarToCrm,
} from "@/lib/google-calendar";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
        ...(await getGoogleCalendarStatus()),
        redirectUri: getGoogleCalendarRedirectUri(request.nextUrl.origin),
    });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    if (action === "sync") {
        const result = await syncGoogleCalendarToCrm(true);
        return NextResponse.json({
            ...(await getGoogleCalendarStatus()),
            sync: result,
        });
    }

    if (action === "disconnect") {
        await disconnectGoogleCalendar();
        return NextResponse.json(await getGoogleCalendarStatus());
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
