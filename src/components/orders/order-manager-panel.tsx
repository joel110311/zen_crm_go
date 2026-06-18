"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
    AlertCircle,
    CalendarClock,
    Check,
    CheckCircle2,
    ChevronRight,
    ChevronsUpDown,
    ClipboardList,
    CreditCard,
    DollarSign,
    Loader2,
    MessageSquare,
    Plus,
    ReceiptText,
    Search,
    Trash2,
    WalletCards,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type OrderContactOption = {
    id: string;
    name: string | null;
    lastName: string | null;
    phone: string | null;
    email: string | null;
    company: string | null;
    whatsappAvatarUrl?: string | null;
};

type OrderItemView = {
    id?: string;
    description: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
};

type OrderPaymentView = {
    id: string;
    label: string;
    amount: number;
    status: string;
    dueDate?: string | null;
    paidAt?: string | null;
    method?: string | null;
    reference?: string | null;
};

export type OrderRecordView = {
    id: string;
    orderNumber: string;
    title: string;
    status: string;
    currency: string;
    totalAmount: number;
    paidAmount: number;
    balanceAmount: number;
    eventDate?: string | null;
    deliveryDate?: string | null;
    nextPaymentDueDate?: string | null;
    notes?: string | null;
    contactId: string;
    conversationId?: string | null;
    contact: OrderContactOption;
    conversation?: { id: string; sourceType: string; sourceId?: string | null; status: string } | null;
    items: OrderItemView[];
    payments: OrderPaymentView[];
    createdAt: string;
    updatedAt: string;
};

type OrderFormItem = { description: string; quantity: string; unitPrice: string };
type OrderFormPayment = { label: string; amount: string; dueDate: string; status: string };
type OrderFormState = {
    contactId: string;
    conversationId: string | null;
    title: string;
    status: string;
    eventDate: string;
    deliveryDate: string;
    notes: string;
    items: OrderFormItem[];
    payments: OrderFormPayment[];
};

const STATUS_LABELS: Record<string, string> = {
    quoted: "Cotizado",
    reserved: "Apartado",
    in_production: "En produccion",
    pending_balance: "Pendiente de saldo",
    paid: "Pagado",
    delivered: "Entregado",
    cancelled: "Cancelado",
};

const STATUS_STYLES: Record<string, string> = {
    quoted: "border-slate-200 bg-slate-50 text-slate-700",
    reserved: "border-sky-200 bg-sky-50 text-sky-700",
    in_production: "border-indigo-200 bg-indigo-50 text-indigo-700",
    pending_balance: "border-amber-200 bg-amber-50 text-amber-700",
    paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
    delivered: "border-teal-200 bg-teal-50 text-teal-700",
    cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

const PAYMENT_STYLES: Record<string, string> = {
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
    overdue: "border-rose-200 bg-rose-50 text-rose-700",
    cancelled: "border-slate-200 bg-slate-50 text-slate-600",
};

function currency(value: number, code = "MXN") {
    return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: code || "MXN",
        maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
}

function shortDate(value?: string | null) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function inputDate(value?: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
}

function contactName(contact?: OrderContactOption | null) {
    const fullName = [contact?.name, contact?.lastName].filter(Boolean).join(" ").trim();
    return fullName || contact?.company || contact?.phone || "Sin nombre";
}

function contactInitial(contact?: OrderContactOption | null) {
    return contactName(contact).charAt(0).toUpperCase() || "?";
}

function toNumber(value: string | number) {
    const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function isOverdue(payment: OrderPaymentView) {
    if (payment.status !== "pending" || !payment.dueDate) return false;
    const due = new Date(payment.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
}

function makeEmptyForm(contactId = "", conversationId: string | null = null): OrderFormState {
    return {
        contactId,
        conversationId,
        title: "Pedido nuevo",
        status: "quoted",
        eventDate: "",
        deliveryDate: "",
        notes: "",
        items: [{ description: "Producto o servicio", quantity: "1", unitPrice: "0" }],
        payments: [{ label: "Anticipo", amount: "0", dueDate: "", status: "pending" }],
    };
}

function orderTotal(items: OrderFormItem[]) {
    return items.reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitPrice), 0);
}

function buildReminder(order: OrderRecordView) {
    const pending = order.payments.find((payment) => payment.status === "pending") || null;
    if (!pending) {
        return `Hola ${contactName(order.contact)}, tu pedido ${order.orderNumber} ya aparece liquidado. Gracias por tu pago.`;
    }
    return [
        `Hola ${contactName(order.contact)}, te comparto el recordatorio de tu pedido ${order.orderNumber}.`,
        `Saldo pendiente: ${currency(order.balanceAmount, order.currency)}.`,
        pending.dueDate ? `Fecha sugerida de pago: ${shortDate(pending.dueDate)}.` : null,
        "Cuando realices el pago, puedes enviarnos tu comprobante por este medio.",
    ].filter(Boolean).join("\n");
}

export function OrderManagerPanel({
    initialOrders,
    contacts,
    initialContactId,
    initialConversationId,
    openNew,
}: {
    initialOrders: OrderRecordView[];
    contacts: OrderContactOption[];
    initialContactId?: string | null;
    initialConversationId?: string | null;
    openNew?: boolean;
}) {
    const [orders, setOrders] = useState(initialOrders);
    const [selectedOrderId, setSelectedOrderId] = useState(initialOrders[0]?.id || "");
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [newDialogOpen, setNewDialogOpen] = useState(false);
    const [contactComboboxOpen, setContactComboboxOpen] = useState(false);
    const [contactQuery, setContactQuery] = useState("");
    const [paymentDialogOrderId, setPaymentDialogOrderId] = useState<string | null>(null);
    const [form, setForm] = useState<OrderFormState>(() => makeEmptyForm(initialContactId || "", initialConversationId || null));
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (openNew) {
            setForm(makeEmptyForm(initialContactId || "", initialConversationId || null));
            setNewDialogOpen(true);
        }
    }, [openNew, initialContactId, initialConversationId]);

    const filteredOrders = useMemo(() => {
        const term = query.trim().toLowerCase();
        return orders.filter((order) => {
            const matchesStatus = statusFilter === "all" || order.status === statusFilter;
            const haystack = [
                order.orderNumber,
                order.title,
                contactName(order.contact),
                order.contact.phone,
                order.contact.company,
            ].filter(Boolean).join(" ").toLowerCase();
            return matchesStatus && (!term || haystack.includes(term));
        });
    }, [orders, query, statusFilter]);

    const selectedOrder = orders.find((order) => order.id === selectedOrderId) || filteredOrders[0] || null;
    const selectedPaymentOrder = orders.find((order) => order.id === paymentDialogOrderId) || null;
    const selectedContact = contacts.find((contact) => contact.id === form.contactId) || null;
    const contactSearchResults = useMemo(() => {
        const term = contactQuery.trim().toLowerCase();
        const sortedContacts = [...contacts].sort((left, right) => contactName(left).localeCompare(contactName(right), "es"));
        const matches = term
            ? sortedContacts.filter((contact) => [
                contactName(contact),
                contact.phone,
                contact.email,
                contact.company,
            ].filter(Boolean).join(" ").toLowerCase().includes(term))
            : sortedContacts;
        return matches.slice(0, 8);
    }, [contacts, contactQuery]);
    const total = orderTotal(form.items);

    const stats = useMemo(() => ({
        total: orders.length,
        pending: orders.reduce((sum, order) => sum + order.balanceAmount, 0),
        overdue: orders.filter((order) => order.payments.some(isOverdue)).length,
        paid: orders.filter((order) => order.balanceAmount <= 0 && order.totalAmount > 0).length,
    }), [orders]);

    const updateOrderInList = (nextOrder: OrderRecordView | null) => {
        if (!nextOrder) return;
        setOrders((current) => {
            const exists = current.some((order) => order.id === nextOrder.id);
            const next = exists ? current.map((order) => order.id === nextOrder.id ? nextOrder : order) : [nextOrder, ...current];
            return next.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
        });
        setSelectedOrderId(nextOrder.id);
    };

    const handleCreateOrder = () => {
        setError(null);
        startTransition(async () => {
            try {
                const response = await fetch("/api/orders", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...form,
                        totalAmount: total,
                        items: form.items.map((item, index) => ({
                            description: item.description,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            totalAmount: toNumber(item.quantity) * toNumber(item.unitPrice),
                            sortOrder: index,
                        })),
                        payments: form.payments.map((payment) => ({ ...payment, amount: payment.amount || "0" })),
                    }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.order) throw new Error(result.error || "No se pudo crear el pedido.");
                updateOrderInList(result.order);
                setNewDialogOpen(false);
                setForm(makeEmptyForm(initialContactId || "", initialConversationId || null));
            } catch (createError) {
                setError(createError instanceof Error ? createError.message : "No se pudo crear el pedido.");
            }
        });
    };

    const handleMarkPayment = (orderId: string, paymentId: string, status: "paid" | "pending") => {
        startTransition(async () => {
            const response = await fetch(`/api/orders/${orderId}/payments/${paymentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.order) updateOrderInList(result.order);
        });
    };

    const copyReminder = async (order: OrderRecordView) => {
        const text = buildReminder(order);
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            window.prompt("Copia el recordatorio:", text);
        }
    };

    return (
        <div className="mx-auto flex h-full w-full max-w-none flex-col gap-4">
            <div className="rounded-2xl border bg-card px-5 py-4 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2.5 text-[1.85rem] font-semibold tracking-tight">
                            <ReceiptText className="h-6 w-6 text-primary" />
                            Pedidos y cobranza
                        </h1>
                        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                            Administra pedidos, abonos, saldos y fechas de pago sin tocar la operacion de WhatsApp.
                        </p>
                    </div>
                    <Button
                        className="h-11 rounded-xl px-4"
                        onClick={() => {
                            setForm(makeEmptyForm(initialContactId || "", initialConversationId || null));
                            setError(null);
                            setNewDialogOpen(true);
                        }}
                    >
                        <Plus className="h-4 w-4" />
                        Nuevo pedido
                    </Button>
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
                <StatCard icon={ClipboardList} label="Pedidos" value={String(stats.total)} tone="slate" />
                <StatCard icon={WalletCards} label="Saldo por cobrar" value={currency(stats.pending)} tone="amber" />
                <StatCard icon={AlertCircle} label="Pagos vencidos" value={String(stats.overdue)} tone="rose" />
                <StatCard icon={CheckCircle2} label="Liquidados" value={String(stats.paid)} tone="emerald" />
            </div>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
                <div className="min-h-0 rounded-2xl border bg-card shadow-sm">
                    <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="relative w-full max-w-xl">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Buscar por cliente, folio o telefono..."
                                className="h-11 rounded-xl pl-9"
                            />
                        </div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-11 w-full rounded-xl lg:w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos los estados</SelectItem>
                                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <ScrollArea className="h-[calc(100vh-22rem)] min-h-[24rem]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Pedido</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead>Total</TableHead>
                                    <TableHead>Saldo</TableHead>
                                    <TableHead>Proximo pago</TableHead>
                                    <TableHead className="text-right">Accion</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredOrders.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-40 text-center text-muted-foreground">
                                            Aun no hay pedidos con estos filtros.
                                        </TableCell>
                                    </TableRow>
                                ) : filteredOrders.map((order) => (
                                    <TableRow
                                        key={order.id}
                                        className={cn("cursor-pointer", selectedOrder?.id === order.id && "bg-primary/5 hover:bg-primary/8")}
                                        onClick={() => setSelectedOrderId(order.id)}
                                    >
                                        <TableCell>
                                            <div className="font-semibold text-foreground">{order.orderNumber}</div>
                                            <div className="max-w-[14rem] truncate text-xs text-muted-foreground">{order.title}</div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Avatar className="h-8 w-8 border">
                                                    <AvatarImage src={order.contact.whatsappAvatarUrl || undefined} />
                                                    <AvatarFallback>{contactInitial(order.contact)}</AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <div className="max-w-[13rem] truncate font-medium">{contactName(order.contact)}</div>
                                                    <div className="text-xs text-muted-foreground">{order.contact.phone || "Sin telefono"}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell><StatusBadge status={order.status} /></TableCell>
                                        <TableCell className="font-semibold">{currency(order.totalAmount, order.currency)}</TableCell>
                                        <TableCell className={cn("font-semibold", order.balanceAmount > 0 ? "text-amber-700" : "text-emerald-700")}>
                                            {currency(order.balanceAmount, order.currency)}
                                        </TableCell>
                                        <TableCell>{shortDate(order.nextPaymentDueDate)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" className="h-8 rounded-lg">
                                                Ver <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </div>

                <OrderDetail
                    order={selectedOrder}
                    isBusy={isPending}
                    onAddPayment={(orderId) => setPaymentDialogOrderId(orderId)}
                    onMarkPayment={handleMarkPayment}
                    onCopyReminder={copyReminder}
                />
            </div>

            <Dialog open={newDialogOpen} onOpenChange={setNewDialogOpen}>
                <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] !max-w-5xl gap-0 overflow-hidden p-0">
                    <DialogHeader className="border-b px-5 py-4 pr-12">
                        <DialogTitle>Nuevo pedido</DialogTitle>
                        <DialogDescription className="max-w-3xl leading-5">
                            Captura conceptos, fechas y pagos programados. Luego podras registrar abonos desde el detalle.
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="max-h-[calc(94vh-9rem)] overflow-x-hidden px-5 py-4">
                        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Cliente</Label>
                                <Popover open={contactComboboxOpen} onOpenChange={setContactComboboxOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            role="combobox"
                                            aria-expanded={contactComboboxOpen}
                                            className="h-11 w-full justify-between rounded-xl bg-background px-3 font-normal"
                                        >
                                            <span className="min-w-0 truncate">
                                                {selectedContact
                                                    ? `${contactName(selectedContact)}${selectedContact.phone ? ` - ${selectedContact.phone}` : ""}`
                                                    : "Buscar cliente..."}
                                            </span>
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[min(28rem,calc(100vw-4rem))] p-0" align="start">
                                        <Command shouldFilter={false}>
                                            <CommandInput placeholder="Buscar cliente..." value={contactQuery} onValueChange={setContactQuery} />
                                            <CommandList>
                                                <CommandEmpty>No se encontraron clientes.</CommandEmpty>
                                                <CommandGroup>
                                                    {contactSearchResults.map((contact) => (
                                                        <CommandItem
                                                            key={contact.id}
                                                            value={contact.id}
                                                            onSelect={() => {
                                                                setForm((current) => ({ ...current, contactId: contact.id }));
                                                                setContactComboboxOpen(false);
                                                                setContactQuery("");
                                                            }}
                                                        >
                                                            <Check className={cn("mr-2 h-4 w-4", form.contactId === contact.id ? "opacity-100" : "opacity-0")} />
                                                            <div className="min-w-0">
                                                                <div className="truncate font-medium">{contactName(contact)}</div>
                                                                <div className="truncate text-xs text-muted-foreground">
                                                                    {contact.phone || contact.email || contact.company || "Sin datos de contacto"}
                                                                </div>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                                                {contactQuery.trim()
                                                    ? `Mostrando hasta ${contactSearchResults.length} coincidencias.`
                                                    : "Escribe para filtrar por nombre, telefono o empresa."}
                                            </div>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                                {selectedContact ? <p className="text-xs text-muted-foreground">Se vinculara a {contactName(selectedContact)}.</p> : null}
                            </div>
                            <Field label="Nombre del pedido" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} />
                            <div className="space-y-2">
                                <Label>Estado</Label>
                                <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}>
                                    <SelectTrigger className="h-11 min-w-0 rounded-xl"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field type="date" label="Fecha del evento" value={form.eventDate} onChange={(value) => setForm((current) => ({ ...current, eventDate: value }))} />
                                <Field type="date" label="Entrega" value={form.deliveryDate} onChange={(value) => setForm((current) => ({ ...current, deliveryDate: value }))} />
                            </div>
                        </div>

                        <FormSection title="Conceptos" subtitle="Agrega productos o servicios del pedido.">
                            <Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, items: [...current.items, { description: "", quantity: "1", unitPrice: "0" }] }))}>
                                <Plus className="h-4 w-4" /> Concepto
                            </Button>
                            <div className="mt-4 space-y-3">
                                {form.items.map((item, index) => (
                                    <div key={index} className="grid min-w-0 gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_2.5rem]">
                                        <Input value={item.description} placeholder="Descripcion" onChange={(event) => updateItem(index, "description", event.target.value, setForm)} />
                                        <Input value={item.quantity} inputMode="decimal" placeholder="Cant." onChange={(event) => updateItem(index, "quantity", event.target.value, setForm)} />
                                        <Input value={item.unitPrice} inputMode="decimal" placeholder="Precio" onChange={(event) => updateItem(index, "unitPrice", event.target.value, setForm)} />
                                        <Button type="button" variant="ghost" size="icon" className="justify-self-end sm:justify-self-auto" disabled={form.items.length === 1} onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>
                                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 flex justify-end text-lg font-bold">Total: {currency(total)}</div>
                        </FormSection>

                        <FormSection title="Pagos programados" subtitle="Define anticipo, parcialidades o saldo por fecha.">
                            <Button type="button" variant="outline" size="sm" onClick={() => setForm((current) => ({ ...current, payments: [...current.payments, { label: "Pago", amount: "0", dueDate: "", status: "pending" }] }))}>
                                <Plus className="h-4 w-4" /> Pago
                            </Button>
                            <div className="mt-4 space-y-3">
                                {form.payments.map((payment, index) => (
                                    <div key={index} className="grid min-w-0 gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem] lg:grid-cols-[minmax(0,1fr)_8rem_10rem_9rem_2.5rem]">
                                        <Input value={payment.label} placeholder="Anticipo" onChange={(event) => updatePayment(index, "label", event.target.value, setForm)} />
                                        <Input value={payment.amount} inputMode="decimal" placeholder="Monto" onChange={(event) => updatePayment(index, "amount", event.target.value, setForm)} />
                                        <Input value={payment.dueDate} type="date" onChange={(event) => updatePayment(index, "dueDate", event.target.value, setForm)} />
                                        <Select value={payment.status} onValueChange={(value) => updatePayment(index, "status", value, setForm)}>
                                            <SelectTrigger className="min-w-0"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="pending">Pendiente</SelectItem>
                                                <SelectItem value="paid">Pagado</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Button type="button" variant="ghost" size="icon" className="justify-self-end lg:justify-self-auto" disabled={form.payments.length === 1} onClick={() => setForm((current) => ({ ...current, payments: current.payments.filter((_, paymentIndex) => paymentIndex !== index) }))}>
                                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </FormSection>

                        <div className="mt-5 space-y-2">
                            <Label>Notas internas</Label>
                            <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Detalles del pedido, acuerdos, condiciones o entrega..." className="min-h-24 rounded-xl" />
                        </div>
                        {error ? <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
                    </ScrollArea>
                    <DialogFooter className="border-t bg-background/95 px-5 py-4">
                        <Button type="button" variant="outline" onClick={() => setNewDialogOpen(false)}>Cancelar</Button>
                        <Button type="button" onClick={handleCreateOrder} disabled={isPending || !form.contactId}>
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Crear pedido
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {selectedPaymentOrder ? (
                <PaymentDialog
                    key={selectedPaymentOrder.id}
                    order={selectedPaymentOrder}
                    open
                    busy={isPending}
                    onOpenChange={(open) => !open && setPaymentDialogOrderId(null)}
                    onSaved={(order) => {
                        updateOrderInList(order);
                        setPaymentDialogOrderId(null);
                    }}
                />
            ) : null}
        </div>
    );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone: "slate" | "amber" | "rose" | "emerald" }) {
    const tones = {
        slate: "border-slate-200 bg-slate-50 text-slate-700",
        amber: "border-amber-200 bg-amber-50 text-amber-700",
        rose: "border-rose-200 bg-rose-50 text-rose-700",
        emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
    return (
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl border", tones[tone])}>
                <Icon className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    return <Badge variant="outline" className={cn("border px-2.5 py-1", STATUS_STYLES[status] || STATUS_STYLES.quoted)}>{STATUS_LABELS[status] || status}</Badge>;
}

function PaymentBadge({ status, overdue }: { status: string; overdue?: boolean }) {
    const label = overdue ? "Vencido" : status === "paid" ? "Pagado" : status === "pending" ? "Pendiente" : status;
    const className = overdue ? PAYMENT_STYLES.overdue : PAYMENT_STYLES[status] || PAYMENT_STYLES.pending;
    return <Badge variant="outline" className={cn("border px-2.5 py-1", className)}>{label}</Badge>;
}

function OrderDetail({
    order,
    isBusy,
    onAddPayment,
    onMarkPayment,
    onCopyReminder,
}: {
    order: OrderRecordView | null;
    isBusy: boolean;
    onAddPayment: (orderId: string) => void;
    onMarkPayment: (orderId: string, paymentId: string, status: "paid" | "pending") => void;
    onCopyReminder: (order: OrderRecordView) => void;
}) {
    if (!order) {
        return (
            <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border bg-card p-6 text-center text-muted-foreground shadow-sm">
                <div>
                    <ReceiptText className="mx-auto h-10 w-10" />
                    <p className="mt-3 font-medium">Selecciona un pedido para ver pagos y abonos.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-0 rounded-2xl border bg-card shadow-sm">
            <div className="border-b p-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{order.orderNumber}</div>
                        <h2 className="mt-1 text-xl font-bold tracking-tight">{order.title}</h2>
                        <p className="text-sm text-muted-foreground">{contactName(order.contact)}</p>
                    </div>
                    <StatusBadge status={order.status} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <MiniMoney label="Total" value={currency(order.totalAmount, order.currency)} />
                    <MiniMoney label="Pagado" value={currency(order.paidAmount, order.currency)} tone="emerald" />
                    <MiniMoney label="Saldo" value={currency(order.balanceAmount, order.currency)} tone="amber" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" className="rounded-xl" onClick={() => onAddPayment(order.id)} disabled={isBusy}>
                        <DollarSign className="h-4 w-4" /> Registrar abono
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => onCopyReminder(order)}>
                        <ClipboardList className="h-4 w-4" /> Copiar recordatorio
                    </Button>
                    <Link href={order.conversationId ? `/dashboard/inbox?conversationId=${encodeURIComponent(order.conversationId)}` : `/dashboard/inbox?contactId=${encodeURIComponent(order.contact.id)}`}>
                        <Button size="sm" variant="outline" className="rounded-xl">
                            <MessageSquare className="h-4 w-4" /> Chat
                        </Button>
                    </Link>
                </div>
            </div>

            <ScrollArea className="h-[calc(100vh-25rem)] min-h-[28rem]">
                <div className="space-y-5 p-4">
                    <section>
                        <h3 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> Fechas</h3>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <InfoBox label="Evento" value={shortDate(order.eventDate)} />
                            <InfoBox label="Entrega" value={shortDate(order.deliveryDate)} />
                            <InfoBox label="Proximo pago" value={shortDate(order.nextPaymentDueDate)} />
                            <InfoBox label="Creado" value={shortDate(order.createdAt)} />
                        </div>
                    </section>

                    <section>
                        <h3 className="flex items-center gap-2 font-semibold"><ReceiptText className="h-4 w-4 text-primary" /> Conceptos</h3>
                        <div className="mt-3 overflow-hidden rounded-xl border">
                            {order.items.map((item) => (
                                <div key={item.id || item.description} className="grid grid-cols-[1fr_auto] gap-3 border-b p-3 text-sm last:border-0">
                                    <div>
                                        <div className="font-medium">{item.description}</div>
                                        <div className="text-xs text-muted-foreground">{item.quantity} x {currency(item.unitPrice, order.currency)}</div>
                                    </div>
                                    <div className="font-semibold">{currency(item.totalAmount, order.currency)}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4 text-primary" /> Pagos y abonos</h3>
                        <div className="mt-3 space-y-3">
                            {order.payments.map((payment) => {
                                const overdue = isOverdue(payment);
                                return (
                                    <div key={payment.id} className="rounded-xl border bg-background/70 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-semibold">{payment.label}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    Vence: {shortDate(payment.dueDate)} {payment.paidAt ? `- Pagado: ${shortDate(payment.paidAt)}` : ""}
                                                </div>
                                                {payment.reference ? <div className="text-xs text-muted-foreground">Ref: {payment.reference}</div> : null}
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold">{currency(payment.amount, order.currency)}</div>
                                                <PaymentBadge status={payment.status} overdue={overdue} />
                                            </div>
                                        </div>
                                        <div className="mt-3 flex justify-end gap-2">
                                            {payment.status === "paid" ? (
                                                <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => onMarkPayment(order.id, payment.id, "pending")} disabled={isBusy}>
                                                    Reabrir
                                                </Button>
                                            ) : (
                                                <Button size="sm" className="h-8 rounded-lg" onClick={() => onMarkPayment(order.id, payment.id, "paid")} disabled={isBusy}>
                                                    Marcar pagado
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {order.notes ? (
                        <section>
                            <h3 className="font-semibold">Notas</h3>
                            <p className="mt-2 rounded-xl border bg-background/70 p-3 text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
                        </section>
                    ) : null}
                </div>
            </ScrollArea>
        </div>
    );
}

function MiniMoney({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "emerald" | "amber" }) {
    const tones = { slate: "text-foreground", emerald: "text-emerald-700", amber: "text-amber-700" };
    return (
        <div className="rounded-xl border bg-background/80 p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("mt-1 font-bold", tones[tone])}>{value}</div>
        </div>
    );
}

function InfoBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border bg-background/70 p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 font-medium">{value}</div>
        </div>
    );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl" />
        </div>
    );
}

function FormSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
    const childArray = Array.isArray(children) ? children : [children];
    const [action, ...content] = childArray;
    return (
        <div className="mt-5 rounded-2xl border bg-background/70 p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground">{subtitle}</p>
                </div>
                {action}
            </div>
            {content}
        </div>
    );
}

function updateItem(index: number, field: keyof OrderFormItem, value: string, setForm: React.Dispatch<React.SetStateAction<OrderFormState>>) {
    setForm((current) => ({
        ...current,
        items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
}

function updatePayment(index: number, field: keyof OrderFormPayment, value: string, setForm: React.Dispatch<React.SetStateAction<OrderFormState>>) {
    setForm((current) => ({
        ...current,
        payments: current.payments.map((payment, paymentIndex) => paymentIndex === index ? { ...payment, [field]: value } : payment),
    }));
}

function PaymentDialog({
    order,
    open,
    busy,
    onOpenChange,
    onSaved,
}: {
    order: OrderRecordView;
    open: boolean;
    busy: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: (order: OrderRecordView) => void;
}) {
    const [amount, setAmount] = useState(() => order.balanceAmount > 0 ? String(order.balanceAmount) : "");
    const [method, setMethod] = useState("transferencia");
    const [paidAt, setPaidAt] = useState(inputDate(new Date().toISOString()));
    const [reference, setReference] = useState("");
    const [notes, setNotes] = useState("");
    const [error, setError] = useState<string | null>(null);

    const save = async () => {
        setError(null);
        const response = await fetch(`/api/orders/${order.id}/payments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: "Abono", amount, status: "paid", paidAt, method, reference, notes }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.order) {
            setError(result.error || "No se pudo registrar el abono.");
            return;
        }
        onSaved(result.order);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Registrar abono</DialogTitle>
                    <DialogDescription>
                        Pedido {order.orderNumber} - saldo {currency(order.balanceAmount, order.currency)}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Monto" value={amount} onChange={setAmount} />
                    <Field type="date" label="Fecha de pago" value={paidAt} onChange={setPaidAt} />
                    <div className="space-y-2">
                        <Label>Metodo</Label>
                        <Select value={method} onValueChange={setMethod}>
                            <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="transferencia">Transferencia</SelectItem>
                                <SelectItem value="efectivo">Efectivo</SelectItem>
                                <SelectItem value="tarjeta">Tarjeta</SelectItem>
                                <SelectItem value="deposito">Deposito</SelectItem>
                                <SelectItem value="otro">Otro</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Field label="Referencia" value={reference} onChange={setReference} />
                    <div className="space-y-2 sm:col-span-2">
                        <Label>Notas</Label>
                        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20 rounded-xl" />
                    </div>
                </div>
                {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button type="button" onClick={save} disabled={busy || !toNumber(amount)}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                        Guardar abono
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
