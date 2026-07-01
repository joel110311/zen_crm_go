import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createMetaTemplate, deleteMetaTemplate, listMetaTemplates } from "@/lib/meta-whatsapp";

function getSessionRole(session: unknown) {
    return (session as { user?: { role?: string } } | null)?.user?.role || null;
}

function ensureAuthenticated(session: unknown) {
    if (!(session as { user?: { id?: string } } | null)?.user?.id) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return null;
}

function ensureSuperadmin(session: unknown) {
    const role = getSessionRole(session);
    if (role !== "SUPERADMIN") {
        return NextResponse.json({ error: "Solo superadmin puede solicitar plantillas oficiales" }, { status: 403 });
    }
    return null;
}

function asItems(payload: unknown) {
    if (!payload || typeof payload !== "object") return [];

    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.templates)) return record.templates;

    return [];
}

export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { searchParams } = new URL(request.url);
        const limit = Number.parseInt(searchParams.get("limit") || "100", 10);
        const page = Number.parseInt(searchParams.get("page") || "1", 10);
        const wabaId = searchParams.get("wabaId") || undefined;

        const payload = await listMetaTemplates({
            limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 100,
            page: Number.isFinite(page) ? Math.max(page, 1) : 1,
            wabaId,
        });

        return NextResponse.json({
            items: asItems(payload),
            raw: payload,
        });
    } catch (error) {
        console.error("[Meta Templates] GET failed:", error);
        const message = error instanceof Error ? error.message : "No se pudieron cargar las plantillas oficiales.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;
        const forbidden = ensureSuperadmin(session);
        if (forbidden) return forbidden;

        const body = await request.json();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const category = typeof body.category === "string" ? body.category.trim().toUpperCase() : "";
        const language = typeof body.language === "string" ? body.language.trim() : "es";
        const wabaId = typeof body.wabaId === "string" ? body.wabaId.trim() : "";

        if (!name || !category || !Array.isArray(body.components) || body.components.length === 0) {
            return NextResponse.json(
                { error: "name, category y components son obligatorios." },
                { status: 400 },
            );
        }

        const payload = {
            wabaId,
            name,
            category,
            language,
            components: body.components,
            allowCategoryChange: body.allowCategoryChange === true,
        } satisfies Record<string, unknown>;

        const created = await createMetaTemplate(payload as Parameters<typeof createMetaTemplate>[0]);
        return NextResponse.json({ success: true, template: created }, { status: 201 });
    } catch (error) {
        console.error("[Meta Templates] POST failed:", error);
        const message = error instanceof Error ? error.message : "No se pudo solicitar la plantilla oficial.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;
        const forbidden = ensureSuperadmin(session);
        if (forbidden) return forbidden;

        const { searchParams } = new URL(request.url);
        const wabaId = (searchParams.get("wabaId") || "").trim();
        const name = (searchParams.get("name") || "").trim();
        const language = (searchParams.get("language") || "").trim();

        if (!wabaId || !name) {
            return NextResponse.json({ error: "name es obligatorio." }, { status: 400 });
        }

        void language;
        const result = await deleteMetaTemplate({ wabaId: wabaId || undefined, name });

        return NextResponse.json({ success: true, result });
    } catch (error) {
        console.error("[Meta Templates] DELETE failed:", error);
        const message = error instanceof Error ? error.message : "No se pudo eliminar la plantilla oficial.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
