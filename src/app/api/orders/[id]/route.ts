import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
    CUSTOMER_ORDER_INCLUDE,
    ORDER_STATUSES,
    getCustomerOrder,
    normalizeOrderItems,
    refreshOrderRollup,
    serializeOrder,
    toDateOrNull,
    toMoneyNumber,
} from "@/lib/orders";

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

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { id } = await params;
        const order = await getCustomerOrder(id);
        if (!order) {
            return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
        }

        return NextResponse.json({ order });
    } catch (error) {
        console.error("[Orders] GET by id failed:", error);
        return NextResponse.json({ error: "No se pudo cargar el pedido" }, { status: 500 });
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { id } = await params;
        const body = await request.json();
        const existing = await prisma.customerOrder.findUnique({
            where: { id },
            include: { payments: true },
        });

        if (!existing) {
            return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
        }

        const nextData: Record<string, unknown> = {};
        if (typeof body.title === "string") nextData.title = body.title.trim() || existing.title;
        if (typeof body.status === "string" && ORDER_STATUSES.includes(body.status as (typeof ORDER_STATUSES)[number])) nextData.status = body.status;
        if (typeof body.currency === "string") nextData.currency = body.currency.trim().slice(0, 3).toUpperCase() || existing.currency;
        if (body.eventDate !== undefined) nextData.eventDate = toDateOrNull(body.eventDate);
        if (body.deliveryDate !== undefined) nextData.deliveryDate = toDateOrNull(body.deliveryDate);
        if (body.notes !== undefined) nextData.notes = toOptionalString(body.notes);
        if (body.stageId !== undefined) nextData.stageId = toOptionalString(body.stageId);

        const shouldReplaceItems = Array.isArray(body.items);
        if (shouldReplaceItems) {
            const items = normalizeOrderItems(body.items, body.totalAmount ?? existing.totalAmount);
            const totalAmount = items.reduce((sum, item) => sum + toMoneyNumber(item.totalAmount), 0);
            nextData.totalAmount = totalAmount.toFixed(2);
        } else if (body.totalAmount !== undefined) {
            nextData.totalAmount = toMoneyNumber(body.totalAmount).toFixed(2);
        }

        await prisma.$transaction(async (tx) => {
            if (shouldReplaceItems) {
                const items = normalizeOrderItems(body.items, nextData.totalAmount ?? existing.totalAmount);
                await tx.customerOrderItem.deleteMany({ where: { orderId: id } });
                await tx.customerOrderItem.createMany({ data: items.map((item) => ({ ...item, orderId: id })) });
            }

            await tx.customerOrder.update({
                where: { id },
                data: nextData,
            });
        });

        const refreshed = await refreshOrderRollup(id);
        const order = refreshed || await prisma.customerOrder.findUnique({ where: { id }, include: CUSTOMER_ORDER_INCLUDE });

        return NextResponse.json({ success: true, order: order ? serializeOrder(order) : null });
    } catch (error) {
        console.error("[Orders] PATCH failed:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo actualizar el pedido" },
            { status: 400 },
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        if (body?.confirmation !== "ELIMINAR") {
            return NextResponse.json({ error: "Escribe ELIMINAR para confirmar el borrado." }, { status: 400 });
        }

        await prisma.customerOrder.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[Orders] DELETE failed:", error);
        return NextResponse.json({ error: "No se pudo eliminar el pedido" }, { status: 500 });
    }
}
