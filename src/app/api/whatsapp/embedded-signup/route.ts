import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { completeMetaEmbeddedSignup, getMetaEmbeddedSignupConfig } from "@/lib/meta-whatsapp";

type EmbeddedSignupBody = {
    code?: unknown;
    wabaId?: unknown;
    phoneNumberId?: unknown;
    businessId?: unknown;
    client?: unknown;
};

function readString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
    try {
        const config = await getMetaEmbeddedSignupConfig();
        return NextResponse.json({
            ok: true,
            appId: config.appId,
            configId: config.configId,
            solutionId: config.solutionId || null,
            graphApiVersion: config.graphApiVersion,
            webhookBaseUrl: config.webhookBaseUrl || null,
            webhookConfigured: Boolean(config.webhookBaseUrl && config.webhookVerifyToken),
            registrationPinConfigured: Boolean(config.registrationPin),
        });
    } catch (error) {
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : "Falta configuracion para Embedded Signup.",
            },
            { status: 400 },
        );
    }
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null) as EmbeddedSignupBody | null;
    if (!body) {
        return NextResponse.json({ ok: false, error: "JSON invalido." }, { status: 400 });
    }

    const code = readString(body.code);
    const wabaId = readString(body.wabaId);
    const phoneNumberId = readString(body.phoneNumberId);
    const businessId = readString(body.businessId);
    const client = readString(body.client);

    if (!code || !wabaId || !phoneNumberId) {
        return NextResponse.json(
            { ok: false, error: "code, wabaId y phoneNumberId son obligatorios." },
            { status: 400 },
        );
    }

    try {
        const result = await completeMetaEmbeddedSignup({
            code,
            wabaId,
            phoneNumberId,
            businessId: businessId || null,
            client: client || null,
        });

        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/inbox");
        revalidatePath("/dashboard/templates");

        return NextResponse.json({
            ok: true,
            connected: true,
            phoneNumberId: result.settings.whatsappPhoneNumberId,
            displayPhoneNumber: result.settings.whatsappDisplayPhoneNumber,
            wabaId: result.settings.whatsappWabaId,
            businessId: result.settings.whatsappBusinessId,
            webhook: result.subscription,
            registration: result.registration,
        });
    } catch (error) {
        console.error("[Meta Embedded Signup] Finalization failed:", error);
        return NextResponse.json(
            {
                ok: false,
                error: error instanceof Error ? error.message : "No se pudo completar Embedded Signup.",
            },
            { status: 500 },
        );
    }
}
