import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculateOrderRollup, refreshOrderRollup, serializeOrder, toDateOrNull, toMoneyNumber } from "@/lib/orders";

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
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { id } = await params;
        const body = await request.json();
        const amount = toMoneyNumber(body.amount);
        if (amount <= 0) {
            return NextResponse.json({ error: "El abono debe ser mayor a cero" }, { status: 400 });
        }

        const existingOrder = await prisma.customerOrder.findUnique({
            where: { id },
            select: { totalAmount: true, payments: { select: { amount: true, status: true, dueDate: true } } },
        });
        if (!existingOrder) {
            return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
        }

        const currentRollup = calculateOrderRollup(existingOrder.totalAmount, existingOrder.payments);
        const currentBalance = toMoneyNumber(currentRollup.balanceAmount);
        if (body.status !== "pending" && amount > currentBalance) {
            return NextResponse.json(
                { error: `El abono no puede superar el saldo pendiente de ${currentBalance.toFixed(2)}.` },
                { status: 400 },
            );
        }

        const status = body.status === "pending" ? "pending" : "paid";
        await prisma.orderPayment.create({
            data: {
                orderId: id,
                label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : status === "paid" ? "Abono" : "Pago programado",
                amount: amount.toFixed(2),
                status,
                dueDate: toDateOrNull(body.dueDate),
                paidAt: status === "paid" ? toDateOrNull(body.paidAt) || new Date() : null,
                method: toOptionalString(body.method),
                reference: toOptionalString(body.reference),
                receiptUrl: toOptionalString(body.receiptUrl),
                receiptFileName: toOptionalString(body.receiptFileName),
                notes: toOptionalString(body.notes),
            },
        });

        const order = await refreshOrderRollup(id);
        return NextResponse.json({ success: true, order: order ? serializeOrder(order) : null });
    } catch (error) {
        console.error("[OrderPayments] POST failed:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo registrar el pago" },
            { status: 400 },
        );
    }
}
