import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refreshOrderRollup, serializeOrder, toDateOrNull, toMoneyNumber } from "@/lib/orders";

function getSessionUserId(session: unknown) {
    return (session as { user?: { id?: string } } | null)?.user?.id || null;
}

function ensureAuthenticated(session: unknown) {
    if (!getSessionUserId(session)) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return null;
}

function toOptionalString(value: unknown) {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || null;
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { id, paymentId } = await params;
        const body = await request.json();
        const data: Record<string, unknown> = {};
        if (typeof body.label === "string") data.label = body.label.trim() || "Pago";
        if (body.amount !== undefined) data.amount = toMoneyNumber(body.amount).toFixed(2);
        if (["pending", "paid", "overdue", "cancelled"].includes(body.status)) data.status = body.status;
        if (body.dueDate !== undefined) data.dueDate = toDateOrNull(body.dueDate);
        if (body.paidAt !== undefined) data.paidAt = toDateOrNull(body.paidAt);
        if (body.method !== undefined) data.method = toOptionalString(body.method);
        if (body.reference !== undefined) data.reference = toOptionalString(body.reference);
        if (body.notes !== undefined) data.notes = toOptionalString(body.notes);
        if (body.status === "paid" && body.paidAt === undefined) data.paidAt = new Date();
        if (body.status === "pending") data.paidAt = null;

        const payment = await prisma.orderPayment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
        if (!payment || payment.orderId !== id) {
            return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
        }

        await prisma.orderPayment.update({ where: { id: paymentId }, data });
        const order = await refreshOrderRollup(id);
        return NextResponse.json({ success: true, order: order ? serializeOrder(order) : null });
    } catch (error) {
        console.error("[OrderPayments] PATCH failed:", error);
        return NextResponse.json({ error: "No se pudo actualizar el pago" }, { status: 500 });
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { id, paymentId } = await params;
        const payment = await prisma.orderPayment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
        if (!payment || payment.orderId !== id) {
            return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
        }

        await prisma.orderPayment.delete({ where: { id: paymentId } });
        const order = await refreshOrderRollup(id);
        return NextResponse.json({ success: true, order: order ? serializeOrder(order) : null });
    } catch (error) {
        console.error("[OrderPayments] DELETE failed:", error);
        return NextResponse.json({ error: "No se pudo eliminar el pago" }, { status: 500 });
    }
}
