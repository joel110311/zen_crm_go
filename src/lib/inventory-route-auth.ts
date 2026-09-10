import { NextResponse } from "next/server";

export function inventorySessionUser(session: unknown) {
    const user = (session as { user?: { id?: string; role?: string } } | null)?.user;
    return user?.id ? { id: user.id, role: user.role || "" } : null;
}

export function inventoryUnauthorizedResponse() {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}

export function inventoryAdminResponse() {
    return NextResponse.json({ error: "Solo un Super Admin puede ejecutar esta operación." }, { status: 403 });
}
