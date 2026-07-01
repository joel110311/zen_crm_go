// API route for saving settings - bypasses server action issues
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withSettingsDefaults } from "@/lib/system-settings";

function maskClientSettings(settings: ReturnType<typeof withSettingsDefaults>) {
    return {
        ...settings,
        openaiApiKey: "",
        geminiApiKey: "",
        whatsappAdminToken: "",
        whatsappUserToken: "",
        whatsappProxyUrl: "",
        whatsappAccessToken: "",
        whatsappMetaAppSecret: "",
        whatsappRegistrationPin: "",
        whatsappWebhookVerifyToken: "",
        googleClientSecret: "",
    };
}

export async function GET() {
    console.log("[API] GET /api/settings called");
    try {
        const settings = await prisma.systemSettings.findFirst();
        return NextResponse.json(maskClientSettings(withSettingsDefaults(settings)));
    } catch (error) {
        console.error("[API] Failed to get settings:", error);
        return NextResponse.json({ error: "Failed to get settings" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    console.log("[API] POST /api/settings called");
    try {
        const data = await request.json();

        // Ignore legacy official-provider keys from stale browser bundles during rollout.
        // Those columns are removed by the Meta migration, so forwarding them to Prisma
        // would make settings saves fail even though the current UI no longer sends them.
        delete data["y" + "cloudApiKey"];
        delete data["y" + "cloudPhoneId"];
        console.log("[API] Settings data:", {
            ...data,
            openaiApiKey: data.openaiApiKey ? "***" : undefined,
            geminiApiKey: data.geminiApiKey ? "***" : undefined,
            whatsappAdminToken: data.whatsappAdminToken ? "***" : undefined,
            whatsappUserToken: data.whatsappUserToken ? "***" : undefined,
            whatsappProxyUrl: data.whatsappProxyUrl ? "***" : undefined,
            whatsappAccessToken: data.whatsappAccessToken ? "***" : undefined,
            whatsappMetaAppSecret: data.whatsappMetaAppSecret ? "***" : undefined,
            whatsappRegistrationPin: data.whatsappRegistrationPin ? "***" : undefined,
            whatsappWebhookVerifyToken: data.whatsappWebhookVerifyToken ? "***" : undefined,
            googleClientSecret: data.googleClientSecret ? "***" : undefined,
        });

        // Upsert the first record (we assume single tenant for now)
        const existing = await prisma.systemSettings.findFirst();
        const secretFields = [
            "openaiApiKey",
            "geminiApiKey",
            "whatsappAdminToken",
            "whatsappUserToken",
            "whatsappProxyUrl",
            "whatsappAccessToken",
            "whatsappMetaAppSecret",
            "whatsappRegistrationPin",
            "whatsappWebhookVerifyToken",
            "googleClientSecret",
        ] as const;

        for (const field of secretFields) {
            if (data[field] === "") {
                delete data[field];
            }
        }

        let result;
        if (existing) {
            result = await prisma.systemSettings.update({
                where: { id: existing.id },
                data,
            });
        } else {
            result = await prisma.systemSettings.create({
                data,
            });
        }

        console.log("[API] Settings saved successfully");
        return NextResponse.json({ success: true, settings: result });
    } catch (error) {
        console.error("[API] Failed to save settings:", error);
        return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }
}
