import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const ORDER_STATUSES = [
    "quoted",
    "reserved",
    "in_production",
    "pending_balance",
    "paid",
    "delivered",
    "cancelled",
] as const;

export const ORDER_STATUS_LABELS: Record<string, string> = {
    quoted: "Cotizado",
    reserved: "Apartado",
    in_production: "En produccion",
    pending_balance: "Pendiente de saldo",
    paid: "Pagado",
    delivered: "Entregado",
    cancelled: "Cancelado",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
    pending: "Pendiente",
    paid: "Pagado",
    overdue: "Vencido",
    cancelled: "Cancelado",
};

export const CUSTOMER_ORDER_INCLUDE = {
    contact: {
        select: {
            id: true,
            name: true,
            lastName: true,
            phone: true,
            email: true,
            company: true,
            whatsappAvatarUrl: true,
        },
    },
    conversation: {
        select: {
            id: true,
            sourceType: true,
            sourceId: true,
            status: true,
        },
    },
    stage: {
        select: {
            id: true,
            name: true,
            color: true,
        },
    },
    createdBy: {
        select: {
            id: true,
            name: true,
            email: true,
        },
    },
    items: {
        orderBy: { sortOrder: "asc" as const },
    },
    payments: {
        orderBy: [
            { dueDate: "asc" as const },
            { createdAt: "asc" as const },
        ],
    },
} satisfies Prisma.CustomerOrderInclude;

export type CustomerOrderRecord = Prisma.CustomerOrderGetPayload<{
    include: typeof CUSTOMER_ORDER_INCLUDE;
}>;

export type OrderItemInput = {
    description?: unknown;
    quantity?: unknown;
    unitPrice?: unknown;
    totalAmount?: unknown;
};

export type OrderPaymentInput = {
    label?: unknown;
    amount?: unknown;
    status?: unknown;
    dueDate?: unknown;
    paidAt?: unknown;
    method?: unknown;
    reference?: unknown;
    notes?: unknown;
};

export type OrderPayload = {
    contactId?: unknown;
    conversationId?: unknown;
    stageId?: unknown;
    title?: unknown;
    status?: unknown;
    currency?: unknown;
    totalAmount?: unknown;
    eventDate?: unknown;
    deliveryDate?: unknown;
    nextPaymentDueDate?: unknown;
    notes?: unknown;
    items?: unknown;
    payments?: unknown;
};

export function decimalToNumber(value: unknown) {
    if (value === null || value === undefined) return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") return toMoneyNumber(value);
    if (typeof value === "object" && "toString" in value) {
        return toMoneyNumber(String(value));
    }
    return 0;
}

export function toMoneyNumber(value: unknown) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const normalized = String(value ?? "")
        .replace(/,/g, "")
        .replace(/[^0-9.-]/g, "")
        .trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed * 100) / 100);
}

function moneyString(value: unknown) {
    return toMoneyNumber(value).toFixed(2);
}

function toCleanString(value: unknown, fallback = "") {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return trimmed || fallback;
}

function toOptionalString(value: unknown) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function toDateOrNull(value: unknown) {
    if (!value || typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeOrderItems(items: unknown, totalFallback: unknown) {
    const rawItems = Array.isArray(items) ? items : [];
    const normalized = rawItems
        .map((entry, index) => {
            const item = (entry || {}) as OrderItemInput;
            const description = toCleanString(item.description, "Producto o servicio");
            const quantity = Math.max(0.01, toMoneyNumber(item.quantity || 1));
            const unitPrice = toMoneyNumber(item.unitPrice);
            const explicitTotal = toMoneyNumber(item.totalAmount);
            const totalAmount = explicitTotal > 0 ? explicitTotal : quantity * unitPrice;

            return {
                description,
                quantity: quantity.toFixed(2),
                unitPrice: unitPrice.toFixed(2),
                totalAmount: totalAmount.toFixed(2),
                sortOrder: index,
            };
        })
        .filter((item) => item.description || Number(item.totalAmount) > 0);

    if (normalized.length > 0) {
        return normalized;
    }

    const fallbackTotal = toMoneyNumber(totalFallback);
    return [
        {
            description: "Producto o servicio",
            quantity: "1.00",
            unitPrice: fallbackTotal.toFixed(2),
            totalAmount: fallbackTotal.toFixed(2),
            sortOrder: 0,
        },
    ];
}

export function normalizeOrderPayments(payments: unknown, totalAmount: number, dueDate: Date | null) {
    const rawPayments = Array.isArray(payments) ? payments : [];
    const normalized = rawPayments
        .map((entry, index) => {
            const payment = (entry || {}) as OrderPaymentInput;
            const status = toCleanString(payment.status, "pending");
            const paidAt = status === "paid" ? toDateOrNull(payment.paidAt) || new Date() : toDateOrNull(payment.paidAt);

            return {
                label: toCleanString(payment.label, index === 0 ? "Anticipo" : `Pago ${index + 1}`),
                amount: moneyString(payment.amount),
                status: ["pending", "paid", "overdue", "cancelled"].includes(status) ? status : "pending",
                dueDate: toDateOrNull(payment.dueDate),
                paidAt,
                method: toOptionalString(payment.method),
                reference: toOptionalString(payment.reference),
                notes: toOptionalString(payment.notes),
            };
        })
        .filter((payment) => Number(payment.amount) > 0);

    if (normalized.length > 0) return normalized;

    return [
        {
            label: "Saldo pendiente",
            amount: totalAmount.toFixed(2),
            status: "pending",
            dueDate,
            paidAt: null,
            method: null,
            reference: null,
            notes: null,
        },
    ];
}

export function calculateOrderRollup(
    totalAmount: unknown,
    payments: Array<{ amount: unknown; status?: string | null; dueDate?: Date | string | null }>,
) {
    const total = toMoneyNumber(totalAmount);
    const paid = payments.reduce((sum, payment) => {
        return payment.status === "paid" ? sum + toMoneyNumber(payment.amount) : sum;
    }, 0);
    const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
    const nextPending = payments
        .filter((payment) => payment.status === "pending" && payment.dueDate)
        .map((payment) => new Date(payment.dueDate as Date | string))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((left, right) => left.getTime() - right.getTime())[0] || null;

    return {
        paidAmount: paid.toFixed(2),
        balanceAmount: balance.toFixed(2),
        nextPaymentDueDate: nextPending,
    };
}

export function serializeOrder(order: CustomerOrderRecord) {
    return {
        ...order,
        totalAmount: decimalToNumber(order.totalAmount),
        paidAmount: decimalToNumber(order.paidAmount),
        balanceAmount: decimalToNumber(order.balanceAmount),
        items: order.items.map((item) => ({
            ...item,
            quantity: decimalToNumber(item.quantity),
            unitPrice: decimalToNumber(item.unitPrice),
            totalAmount: decimalToNumber(item.totalAmount),
        })),
        payments: order.payments.map((payment) => ({
            ...payment,
            amount: decimalToNumber(payment.amount),
        })),
    };
}

export async function listCustomerOrders(filters: { contactId?: string | null; status?: string | null; query?: string | null } = {}) {
    const where: Prisma.CustomerOrderWhereInput = {
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
        ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
        ...(filters.query
            ? {
                OR: [
                    { orderNumber: { contains: filters.query, mode: "insensitive" } },
                    { title: { contains: filters.query, mode: "insensitive" } },
                    { contact: { name: { contains: filters.query, mode: "insensitive" } } },
                    { contact: { phone: { contains: filters.query, mode: "insensitive" } } },
                    { contact: { company: { contains: filters.query, mode: "insensitive" } } },
                ],
            }
            : {}),
    };

    const orders = await prisma.customerOrder.findMany({
        where,
        include: CUSTOMER_ORDER_INCLUDE,
        orderBy: [
            { updatedAt: "desc" },
            { createdAt: "desc" },
        ],
        take: 300,
    });

    return orders.map(serializeOrder);
}

export async function getCustomerOrder(orderId: string) {
    const order = await prisma.customerOrder.findUnique({
        where: { id: orderId },
        include: CUSTOMER_ORDER_INCLUDE,
    });
    return order ? serializeOrder(order) : null;
}

export async function createOrderNumber() {
    const date = new Date();
    const stamp = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("");
    const count = await prisma.customerOrder.count({
        where: {
            createdAt: {
                gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
            },
        },
    });

    return `PED-${stamp}-${String(count + 1).padStart(4, "0")}`;
}

export function normalizeOrderPayload(body: OrderPayload) {
    const contactId = toCleanString(body.contactId);
    if (!contactId) {
        throw new Error("Selecciona un contacto para el pedido.");
    }

    const items = normalizeOrderItems(body.items, body.totalAmount);
    const totalAmount = items.reduce((sum, item) => sum + toMoneyNumber(item.totalAmount), 0);
    const nextPaymentDueDate = toDateOrNull(body.nextPaymentDueDate);
    const payments = normalizeOrderPayments(body.payments, totalAmount, nextPaymentDueDate);
    const rollup = calculateOrderRollup(totalAmount, payments);
    const status = toCleanString(body.status, "quoted");

    return {
        contactId,
        conversationId: toOptionalString(body.conversationId),
        stageId: toOptionalString(body.stageId),
        title: toCleanString(body.title, "Pedido sin titulo"),
        status: ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number]) ? status : "quoted",
        currency: toCleanString(body.currency, "MXN").slice(0, 3).toUpperCase(),
        totalAmount: totalAmount.toFixed(2),
        eventDate: toDateOrNull(body.eventDate),
        deliveryDate: toDateOrNull(body.deliveryDate),
        notes: toOptionalString(body.notes),
        items,
        payments,
        ...rollup,
    };
}

export async function refreshOrderRollup(orderId: string) {
    const order = await prisma.customerOrder.findUnique({
        where: { id: orderId },
        include: { payments: true },
    });

    if (!order) return null;

    const rollup = calculateOrderRollup(order.totalAmount, order.payments);
    const balance = toMoneyNumber(rollup.balanceAmount);
    const nextStatus = order.status === "cancelled" || order.status === "delivered"
        ? order.status
        : balance <= 0
            ? "paid"
            : decimalToNumber(rollup.paidAmount) > 0
                ? "pending_balance"
                : order.status;

    return prisma.customerOrder.update({
        where: { id: orderId },
        data: {
            paidAmount: rollup.paidAmount,
            balanceAmount: rollup.balanceAmount,
            nextPaymentDueDate: rollup.nextPaymentDueDate,
            status: nextStatus,
        },
        include: CUSTOMER_ORDER_INCLUDE,
    });
}
