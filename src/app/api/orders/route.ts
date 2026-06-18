import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
    CUSTOMER_ORDER_INCLUDE,
    createOrderNumber,
    listCustomerOrders,
    normalizeOrderPayload,
    serializeOrder,
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

export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const { searchParams } = new URL(request.url);
        const orders = await listCustomerOrders({
            contactId: searchParams.get("contactId"),
            status: searchParams.get("status"),
            query: searchParams.get("q"),
        });

        return NextResponse.json({ orders });
    } catch (error) {
        console.error("[Orders] GET failed:", error);
        return NextResponse.json({ error: "No se pudieron cargar los pedidos" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        const unauthorized = ensureAuthenticated(session);
        if (unauthorized) return unauthorized;

        const body = await request.json();
        const payload = normalizeOrderPayload(body);
        const orderNumber = await createOrderNumber();
        const createdById = getSessionUserId(session);

        const order = await prisma.customerOrder.create({
            data: {
                orderNumber,
                title: payload.title,
                status: payload.status,
                currency: payload.currency,
                totalAmount: payload.totalAmount,
                paidAmount: payload.paidAmount,
                balanceAmount: payload.balanceAmount,
                eventDate: payload.eventDate,
                deliveryDate: payload.deliveryDate,
                nextPaymentDueDate: payload.nextPaymentDueDate,
                notes: payload.notes,
                contactId: payload.contactId,
                conversationId: payload.conversationId,
                stageId: payload.stageId,
                createdById,
                items: {
                    create: payload.items,
                },
                payments: {
                    create: payload.payments,
                },
            },
            include: CUSTOMER_ORDER_INCLUDE,
        });

        return NextResponse.json({ success: true, order: serializeOrder(order) });
    } catch (error) {
        console.error("[Orders] POST failed:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "No se pudo crear el pedido" },
            { status: 400 },
        );
    }
}
