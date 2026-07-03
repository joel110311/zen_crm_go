import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
    WuzapiConfigError,
    connectWuzapiSession,
    disconnectWuzapiSession,
    deleteWuzapiInstance,
    ensureWuzapiUserToken,
    getWuzapiQrCode,
    getWuzapiSessionStatus,
    logoutWuzapiSession,
    provisionWuzapiInstance,
} from "@/lib/wuzapi";
import { clearCrmChatHistory, importWhatsAppHistory } from "@/lib/whatsapp-history-import";
import { deleteMetaWhatsAppConnection, getMetaWhatsAppSessionSnapshot } from "@/lib/meta-whatsapp";

async function getMetaSessionSnapshot() {
    try {
        return await getMetaWhatsAppSessionSnapshot();
    } catch (error) {
        return {
            metaConfigured: false,
            embeddedSignupConfigured: false,
            phoneNumberId: null as string | null,
            displayPhoneNumber: null as string | null,
            wabaId: null as string | null,
            businessId: null as string | null,
            metaError: error instanceof Error ? error.message : "No se pudo consultar Meta WhatsApp",
        };
    }
}

type WuzapiSessionStatus = Awaited<ReturnType<typeof getWuzapiSessionStatus>>;

function readFirstField(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        if (key in record && record[key] !== undefined && record[key] !== null) {
            return record[key];
        }
    }

    return undefined;
}

function parseBooleanLike(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        return value === 1 ? true : value === 0 ? false : undefined;
    }

    if (typeof value !== "string") {
        return undefined;
    }

    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!normalized) {
        return undefined;
    }

    if ([
        "1",
        "true",
        "yes",
        "connected",
        "online",
        "open",
        "active",
        "ready",
        "paired",
        "loggedin",
        "logged_in",
        "authenticated",
    ].includes(normalized)) {
        return true;
    }

    if ([
        "0",
        "false",
        "no",
        "disconnected",
        "offline",
        "closed",
        "inactive",
        "not_connected",
        "loggedout",
        "logged_out",
        "unauthenticated",
    ].includes(normalized)) {
        return false;
    }

    return undefined;
}

function stringifyField(value: unknown): string | undefined {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    if (typeof value === "number") {
        return String(value);
    }

    return undefined;
}

function normalizeWuzapiSessionStatus(status: WuzapiSessionStatus): WuzapiSessionStatus {
    const record = status as Record<string, unknown>;
    const jid = stringifyField(readFirstField(record, [
        "jid",
        "JID",
        "Jid",
        "user",
        "User",
        "me",
        "Me",
        "phone",
        "Phone",
        "number",
        "Number",
    ]));
    const connectedValue = readFirstField(record, [
        "connected",
        "Connected",
        "isConnected",
        "IsConnected",
        "status",
        "Status",
        "state",
        "State",
    ]);
    const loggedInValue = readFirstField(record, [
        "loggedIn",
        "LoggedIn",
        "isLoggedIn",
        "IsLoggedIn",
        "logged_in",
        "authenticated",
        "Authenticated",
        "isAuthenticated",
        "IsAuthenticated",
    ]);
    const connected = parseBooleanLike(connectedValue);
    const loggedIn = parseBooleanLike(loggedInValue);
    const hasLinkedIdentity = Boolean(jid && (jid.includes("@s.whatsapp.net") || /\d{8,}/.test(jid)));
    const normalizedLoggedIn = loggedIn ?? (hasLinkedIdentity ? true : connected ?? false);
    const normalizedConnected = connected ?? (hasLinkedIdentity && normalizedLoggedIn ? true : false);

    return {
        ...status,
        connected: normalizedConnected,
        loggedIn: normalizedLoggedIn,
        jid: jid ?? status.jid,
    };
}

export async function GET(request: NextRequest) {
    try {
        const meta = await getMetaSessionSnapshot();
        const includeQr = request.nextUrl.searchParams.get("includeQr") === "1";
        const status = normalizeWuzapiSessionStatus(await getWuzapiSessionStatus());

        let qrCode: string | undefined;
        if (includeQr && !status.loggedIn) {
            try {
                const qr = await getWuzapiQrCode();
                qrCode = qr.QRCode || status.qrcode || undefined;
            } catch {
                qrCode = status.qrcode || undefined;
            }
        }

        return NextResponse.json({
            configured: true,
            ...meta,
            ...status,
            qrCode,
            qrConfigured: true,
            qrConnected: Boolean(status.connected),
            qrLoggedIn: Boolean(status.loggedIn),
            metaConfigured: Boolean(meta.metaConfigured),
        });
    } catch (error) {
        const meta = await getMetaSessionSnapshot();
        if (error instanceof WuzapiConfigError) {
            return NextResponse.json(
                { configured: false, ...meta, error: error.message },
                { status: 200 },
            );
        }

        return NextResponse.json({
            configured: true,
            ...meta,
            connected: false,
            loggedIn: false,
            qrConfigured: true,
            qrConnected: false,
            qrLoggedIn: false,
            metaConfigured: Boolean(meta.metaConfigured),
            error: error instanceof Error ? error.message : "No se pudo consultar WhatsApp",
        });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { action, months, clearChats } = await request.json();

        if (!action) {
            return NextResponse.json({ error: "action es requerido" }, { status: 400 });
        }

        if (action === "provision") {
            await ensureWuzapiUserToken();
            const result = await provisionWuzapiInstance(request.nextUrl.origin);
            return NextResponse.json({ success: true, ...result });
        }

        if (action === "connect") {
            await ensureWuzapiUserToken();
            await provisionWuzapiInstance(request.nextUrl.origin);
            await connectWuzapiSession();
            const status = normalizeWuzapiSessionStatus(await getWuzapiSessionStatus());
            let qrCode: string | undefined;
            if (!status.loggedIn) {
                try {
                    const qr = await getWuzapiQrCode();
                    qrCode = qr.QRCode || status.qrcode || undefined;
                } catch {
                    qrCode = status.qrcode || undefined;
                }
            }

            return NextResponse.json({
                success: true,
                ...status,
                qrCode,
            });
        }

        if (action === "disconnect") {
            await disconnectWuzapiSession();
            const status = await getWuzapiSessionStatus().catch(() => ({
                connected: false,
                loggedIn: true,
            }));
            return NextResponse.json({ success: true, ...status });
        }

        if (action === "logout") {
            await logoutWuzapiSession();
            return NextResponse.json({ success: true });
        }

        if (action === "delete") {
            await deleteWuzapiInstance();
            if (clearChats) {
                await clearCrmChatHistory();
                revalidatePath("/dashboard/inbox");
                revalidatePath("/dashboard/contacts");
            }

            return NextResponse.json({
                success: true,
                deleted: true,
                clearedChats: Boolean(clearChats),
            });
        }

        if (action === "deleteMeta") {
            const result = await deleteMetaWhatsAppConnection();
            if (clearChats) {
                await clearCrmChatHistory();
                revalidatePath("/dashboard/inbox");
                revalidatePath("/dashboard/contacts");
            }

            revalidatePath("/dashboard/settings");
            revalidatePath("/dashboard/inbox");
            return NextResponse.json({
                success: true,
                ...result,
                clearedChats: Boolean(clearChats),
                ...(await getMetaSessionSnapshot()),
            });
        }

        if (action === "importHistory") {
            const summary = await importWhatsAppHistory({
                months: months === 3 ? 3 : months === 2 ? 2 : 1,
            });

            revalidatePath("/dashboard/inbox");
            revalidatePath("/dashboard/contacts");
            revalidatePath("/dashboard/templates");

            return NextResponse.json({
                success: true,
                summary,
            });
        }

        return NextResponse.json({ error: "Accion no soportada" }, { status: 400 });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo ejecutar la accion de WhatsApp" },
            { status: 500 },
        );
    }
}
