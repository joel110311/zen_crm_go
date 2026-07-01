import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { provisionMetaWhatsAppNumber } from "@/lib/meta-whatsapp";

type ProvisioningBody = {
    waba_id?: unknown;
    phone_number_id?: unknown;
    display_phone_number?: unknown;
    access_token?: unknown;
    business_name?: unknown;
    client?: unknown;
};

function timingSafeBearerMatches(header: string | null) {
    const expected = (process.env.PROVISIONING_SECRET || "").trim();
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

    if (!expected || !token) return false;

    const expectedBuffer = Buffer.from(expected);
    const tokenBuffer = Buffer.from(token);
    return expectedBuffer.length === tokenBuffer.length && crypto.timingSafeEqual(expectedBuffer, tokenBuffer);
}

function readRequiredString(body: ProvisioningBody, key: keyof ProvisioningBody) {
    const value = body[key];
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function POST(request: NextRequest) {
    if (!timingSafeBearerMatches(request.headers.get("authorization"))) {
        return NextResponse.json({ ok: false, error: "Credencial de provisioning invalida." }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as ProvisioningBody | null;
    if (!body) {
        return NextResponse.json({ ok: false, error: "JSON invalido." }, { status: 400 });
    }

    const wabaId = readRequiredString(body, "waba_id");
    const phoneNumberId = readRequiredString(body, "phone_number_id");
    const displayPhoneNumber = readRequiredString(body, "display_phone_number");
    const accessToken = readRequiredString(body, "access_token");

    if (!wabaId || !phoneNumberId || !displayPhoneNumber || !accessToken) {
        return NextResponse.json(
            { ok: false, error: "waba_id, phone_number_id, display_phone_number y access_token son obligatorios." },
            { status: 400 },
        );
    }

    const settings = await provisionMetaWhatsAppNumber({
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        display_phone_number: displayPhoneNumber,
        access_token: accessToken,
        business_name: typeof body.business_name === "string" ? body.business_name : undefined,
        client: typeof body.client === "string" ? body.client : undefined,
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/inbox");

    return NextResponse.json({
        ok: true,
        systemSettingsId: settings.id,
        phone_number_id: settings.whatsappPhoneNumberId,
        display_phone_number: settings.whatsappDisplayPhoneNumber,
    });
}
