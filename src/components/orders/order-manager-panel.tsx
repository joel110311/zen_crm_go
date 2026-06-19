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
    CreditCard,
    Download,
    DollarSign,
    ImageIcon,
    Loader2,
    MessageSquare,
    Pencil,
    Plus,
    ReceiptText,
    Search,
    Trash2,
    WalletCards,
    ZoomIn,
    ZoomOut,
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
    receiptUrl?: string | null;
    receiptFileName?: string | null;
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
type ReceiptPreview = { url: string; fileName?: string | null };
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

function formatDateInput(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
    ].join("-");
}

function inputDate(value?: string | null) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return formatDateInput(date);
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

function isImageReceipt(fileName?: string | null, url?: string | null) {
    const value = `${fileName || ""} ${url || ""}`.toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$|\s)/i.test(value);
}

async function uploadReceiptFile(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success || !result.url) {
        throw new Error(result.error || "No se pudo subir el comprobante.");
    }
    return {
        receiptUrl: String(result.url),
        receiptFileName: String(result.fileName || file.name),
    };
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

function numberInput(value: number) {
    return Number.isInteger(value) ? String(value) : String(value || 0);
}

function makeFormFromOrder(order: OrderRecordView): OrderFormState {
    return {
        contactId: order.contactId,
        conversationId: order.conversationId || null,
        title: order.title || "Pedido",
        status: order.status || "quoted",
        eventDate: inputDate(order.eventDate),
        deliveryDate: inputDate(order.deliveryDate),
        notes: order.notes || "",
        items: order.items.length > 0
            ? order.items.map((item) => ({
                description: item.description || "Producto o servicio",
                quantity: numberInput(item.quantity),
                unitPrice: numberInput(item.unitPrice),
            }))
            : [{ description: "Producto o servicio", quantity: "1", unitPrice: "0" }],
        payments: order.payments.length > 0
            ? order.payments.map((payment) => ({
                label: payment.label || "Pago",
                amount: numberInput(payment.amount),
                dueDate: inputDate(payment.dueDate),
                status: payment.status || "pending",
            }))
            : [{ label: "Anticipo", amount: "0", dueDate: "", status: "pending" }],
    };
}

function orderTotal(items: OrderFormItem[]) {
    return items.reduce((sum, item) => sum + toNumber(item.quantity) * toNumber(item.unitPrice), 0);
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
    const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
    const [deleteOrder, setDeleteOrder] = useState<OrderRecordView | null>(null);
    const [deleteConfirmation, setDeleteConfirmation] = useState("");
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [contactComboboxOpen, setContactComboboxOpen] = useState(false);
    const [contactQuery, setContactQuery] = useState("");
    const [paymentDialogOrderId, setPaymentDialogOrderId] = useState<string | null>(null);
    const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(null);
    const [uploadingReceiptId, setUploadingReceiptId] = useState<string | null>(null);
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
    const editingOrder = editingOrderId ? orders.find((order) => order.id === editingOrderId) || null : null;
    const isEditingOrder = Boolean(editingOrderId);
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

    const openCreateOrderDialog = () => {
        setEditingOrderId(null);
        setForm(makeEmptyForm(initialContactId || "", initialConversationId || null));
        setError(null);
        setNewDialogOpen(true);
    };

    const openEditOrderDialog = (order: OrderRecordView) => {
        setEditingOrderId(order.id);
        setForm(makeFormFromOrder(order));
        setError(null);
        setNewDialogOpen(true);
    };

    const handleSaveOrder = () => {
        setError(null);
        startTransition(async () => {
            try {
                const isEditing = Boolean(editingOrderId);
                const response = await fetch(isEditing ? `/api/orders/${editingOrderId}` : "/api/orders", {
                    method: isEditing ? "PATCH" : "POST",
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
                        ...(isEditing ? {} : { payments: form.payments.map((payment) => ({ ...payment, amount: payment.amount || "0" })) }),
                    }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.order) throw new Error(result.error || (isEditing ? "No se pudo actualizar el pedido." : "No se pudo crear el pedido."));
                updateOrderInList(result.order);
                setNewDialogOpen(false);
                setEditingOrderId(null);
                setForm(makeEmptyForm(initialContactId || "", initialConversationId || null));
            } catch (createError) {
                setError(createError instanceof Error ? createError.message : "No se pudo guardar el pedido.");
            }
        });
    };

    const handleDeleteOrder = () => {
        if (!deleteOrder || deleteConfirmation !== "ELIMINAR") return;
        setDeleteError(null);
        startTransition(async () => {
            try {
                const response = await fetch(`/api/orders/${deleteOrder.id}`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirmation: deleteConfirmation }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || "No se pudo eliminar el pedido.");

                setOrders((current) => current.filter((order) => order.id !== deleteOrder.id));
                if (selectedOrderId === deleteOrder.id) {
                    setSelectedOrderId("");
                }
                setDeleteOrder(null);
                setDeleteConfirmation("");
            } catch (deleteErrorCaught) {
                setDeleteError(deleteErrorCaught instanceof Error ? deleteErrorCaught.message : "No se pudo eliminar el pedido.");
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

    const handleUploadPaymentReceipt = async (orderId: string, paymentId: string, file: File | null | undefined) => {
        if (!file) return;
        setUploadingReceiptId(paymentId);
        try {
            const receipt = await uploadReceiptFile(file);
            const response = await fetch(`/api/orders/${orderId}/payments/${paymentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(receipt),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.order) throw new Error(result.error || "No se pudo guardar el comprobante.");
            updateOrderInList(result.order);
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "No se pudo guardar el comprobante.");
        } finally {
            setUploadingReceiptId(null);
        }
    };

    return (
        <div className="mx-auto flex h-full w-full max-w-none flex-col gap-3">
            <div className="rounded-2xl border bg-card px-4 py-2.5 shadow-[0_12px_28px_-22px_rgba(15,23,42,0.25)]">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                            <ReceiptText className="h-5 w-5 text-primary" />
                            Pedidos y cobranza
                        </h1>
                        <p className="mt-0.5 max-w-3xl text-sm leading-5 text-muted-foreground">
                            Administra pedidos, abonos, saldos y fechas de pago.
                        </p>
                    </div>
                    <Button
                        className="h-9 rounded-xl px-4"
                        onClick={openCreateOrderDialog}
                    >
                        <Plus className="h-4 w-4" />
                        Nuevo pedido
                    </Button>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
                <div className="flex min-h-0 flex-col gap-3">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <StatCard icon={ReceiptText} label="Pedidos" value={String(stats.total)} tone="slate" />
                        <StatCard icon={WalletCards} label="Saldo por cobrar" value={currency(stats.pending)} tone="amber" />
                        <StatCard icon={AlertCircle} label="Pagos vencidos" value={String(stats.overdue)} tone="rose" />
                        <StatCard icon={CheckCircle2} label="Liquidados" value={String(stats.paid)} tone="emerald" />
                    </div>

                    <div className="min-h-0 flex-1 rounded-2xl border bg-card shadow-sm">
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
                </div>

                <OrderDetail
                    order={selectedOrder}
                    isBusy={isPending}
                    uploadingReceiptId={uploadingReceiptId}
                    onEdit={openEditOrderDialog}
                    onDelete={(order) => {
                        setDeleteOrder(order);
                        setDeleteConfirmation("");
                        setDeleteError(null);
                    }}
                    onAddPayment={(orderId) => setPaymentDialogOrderId(orderId)}
                    onMarkPayment={handleMarkPayment}
                    onUploadReceipt={handleUploadPaymentReceipt}
                    onPreviewReceipt={setReceiptPreview}
                />
            </div>

            <Dialog open={newDialogOpen} onOpenChange={(open) => {
                setNewDialogOpen(open);
                if (!open) {
                    setEditingOrderId(null);
                    setContactComboboxOpen(false);
                    setContactQuery("");
                    setError(null);
                }
            }}>
                <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] !max-w-5xl gap-0 overflow-hidden p-0">
                    <DialogHeader className="border-b px-5 py-4 pr-12">
                        <DialogTitle>{isEditingOrder ? "Editar pedido" : "Nuevo pedido"}</DialogTitle>
                        <DialogDescription className="max-w-3xl leading-5">
                            {isEditingOrder
                                ? `Actualiza los datos del pedido${editingOrder ? ` ${editingOrder.orderNumber}` : ""}. Los abonos se conservan como historial.`
                                : "Captura conceptos, fechas y pagos programados. Luego podras registrar abonos desde el detalle."}
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
                                            disabled={isEditingOrder}
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
                                {selectedContact ? (
                                    <p className="text-xs text-muted-foreground">
                                        {isEditingOrder ? "El cliente del pedido no se cambia desde edicion." : `Se vinculara a ${contactName(selectedContact)}.`}
                                    </p>
                                ) : null}
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

                        {isEditingOrder ? (
                            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
                                Los pagos y abonos no se reemplazan desde edicion para conservar el historial contable. Puedes registrar abonos, reabrir pagos o marcarlos como pagados desde el detalle del pedido.
                            </div>
                        ) : (
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
                        )}

                        <div className="mt-5 space-y-2">
                            <Label>Notas internas</Label>
                            <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Detalles del pedido, acuerdos, condiciones o entrega..." className="min-h-24 rounded-xl" />
                        </div>
                        {error ? <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
                    </ScrollArea>
                    <DialogFooter className="border-t bg-background/95 px-5 py-4">
                        <Button type="button" variant="outline" onClick={() => setNewDialogOpen(false)}>Cancelar</Button>
                        <Button type="button" onClick={handleSaveOrder} disabled={isPending || !form.contactId}>
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditingOrder ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                            {isEditingOrder ? "Guardar cambios" : "Crear pedido"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(deleteOrder)} onOpenChange={(open) => {
                if (!open) {
                    setDeleteOrder(null);
                    setDeleteConfirmation("");
                    setDeleteError(null);
                }
            }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Eliminar pedido</DialogTitle>
                        <DialogDescription>
                            Esta accion eliminara el pedido {deleteOrder?.orderNumber}. Para confirmar, escribe ELIMINAR en mayusculas.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Input
                            value={deleteConfirmation}
                            onChange={(event) => setDeleteConfirmation(event.target.value)}
                            placeholder="ELIMINAR"
                            className="h-11 rounded-xl"
                        />
                        {deleteError ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{deleteError}</div> : null}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDeleteOrder(null)}>Cancelar</Button>
                        <Button type="button" variant="destructive" onClick={handleDeleteOrder} disabled={isPending || deleteConfirmation !== "ELIMINAR"}>
                            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Eliminar pedido
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
                    onPreviewReceipt={setReceiptPreview}
                />
            ) : null}

            <ReceiptPreviewDialog receipt={receiptPreview} onOpenChange={(open) => !open && setReceiptPreview(null)} />
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
        <div className="flex min-h-[3.75rem] items-center gap-2.5 rounded-xl border bg-card px-2.5 py-2 shadow-sm">
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", tones[tone])}>
                <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">{label}</div>
                <div className="truncate text-lg font-bold leading-6 tracking-tight">{value}</div>
            </div>
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
    uploadingReceiptId,
    onEdit,
    onDelete,
    onAddPayment,
    onMarkPayment,
    onUploadReceipt,
    onPreviewReceipt,
}: {
    order: OrderRecordView | null;
    isBusy: boolean;
    uploadingReceiptId: string | null;
    onEdit: (order: OrderRecordView) => void;
    onDelete: (order: OrderRecordView) => void;
    onAddPayment: (orderId: string) => void;
    onMarkPayment: (orderId: string, paymentId: string, status: "paid" | "pending") => void;
    onUploadReceipt: (orderId: string, paymentId: string, file: File | null | undefined) => void;
    onPreviewReceipt: (receipt: ReceiptPreview) => void;
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
            <div className="border-b p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{order.orderNumber}</div>
                        <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight">{order.title}</h2>
                        <p className="truncate text-sm text-muted-foreground">{contactName(order.contact)}</p>
                    </div>
                    <StatusBadge status={order.status} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <MiniMoney label="Total" value={currency(order.totalAmount, order.currency)} />
                    <MiniMoney label="Pagado" value={currency(order.paidAmount, order.currency)} tone="emerald" />
                    <MiniMoney label="Saldo" value={currency(order.balanceAmount, order.currency)} tone="amber" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 2xl:grid-cols-4">
                    <Button size="sm" className="h-9 rounded-xl" onClick={() => onAddPayment(order.id)} disabled={isBusy}>
                        <DollarSign className="h-4 w-4" /> Abonar
                    </Button>
                    <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => onEdit(order)} disabled={isBusy}>
                        <Pencil className="h-4 w-4" /> Editar
                    </Button>
                    <Link href={order.conversationId ? `/dashboard/inbox?conversationId=${encodeURIComponent(order.conversationId)}` : `/dashboard/inbox?contactId=${encodeURIComponent(order.contact.id)}`}>
                        <Button size="sm" variant="outline" className="h-9 w-full rounded-xl">
                            <MessageSquare className="h-4 w-4" /> Chat
                        </Button>
                    </Link>
                    <Button size="sm" variant="outline" className="h-9 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(order)} disabled={isBusy}>
                        <Trash2 className="h-4 w-4" /> Eliminar
                    </Button>
                </div>
            </div>

            <ScrollArea className="h-[calc(100vh-22rem)] min-h-[28rem]">
                <div className="space-y-3 p-3">
                    <section>
                        <h3 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> Fechas</h3>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <InfoBox label="Evento" value={shortDate(order.eventDate)} />
                            <InfoBox label="Entrega" value={shortDate(order.deliveryDate)} />
                            <InfoBox label="Proximo pago" value={shortDate(order.nextPaymentDueDate)} />
                            <InfoBox label="Creado" value={shortDate(order.createdAt)} />
                        </div>
                    </section>

                    <section>
                        <h3 className="flex items-center gap-2 font-semibold"><ReceiptText className="h-4 w-4 text-primary" /> Conceptos</h3>
                        <div className="mt-2 max-h-[8rem] overflow-y-auto overscroll-contain rounded-xl border">
                            {order.items.map((item) => (
                                <div key={item.id || item.description} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b px-2.5 py-2 text-sm last:border-0">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{item.description}</div>
                                        <div className="text-xs text-muted-foreground">{item.quantity} x {currency(item.unitPrice, order.currency)}</div>
                                    </div>
                                    <div className="font-semibold">{currency(item.totalAmount, order.currency)}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h3 className="flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4 text-primary" /> Pagos y abonos</h3>
                        <div className="mt-2 max-h-[10.5rem] overflow-y-auto overscroll-contain rounded-xl border bg-background/70">
                            {order.payments.map((payment) => {
                                const overdue = isOverdue(payment);
                                return (
                                    <div key={payment.id} className="border-b px-2.5 py-2 last:border-0">
                                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{payment.label}</div>
                                                <div className="flex flex-wrap gap-x-2 text-[11px] leading-4 text-muted-foreground">
                                                    <span>Vence: {shortDate(payment.dueDate)}</span>
                                                    {payment.paidAt ? <span>Pagado: {shortDate(payment.paidAt)}</span> : null}
                                                    {payment.reference ? <span>Ref: {payment.reference}</span> : null}
                                                    {payment.method ? <span>{payment.method}</span> : null}
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-2 sm:justify-end sm:text-right">
                                                <div className="text-sm font-bold">{currency(payment.amount, order.currency)}</div>
                                                <PaymentBadge status={payment.status} overdue={overdue} />
                                            </div>
                                        </div>
                                        <div className="mt-1 flex flex-wrap justify-end gap-1">
                                            <input
                                                id={`receipt-${payment.id}`}
                                                type="file"
                                                accept="image/*,application/pdf"
                                                className="hidden"
                                                onChange={(event) => {
                                                    onUploadReceipt(order.id, payment.id, event.target.files?.[0]);
                                                    event.currentTarget.value = "";
                                                }}
                                            />
                                            {payment.receiptUrl ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-6 rounded-md px-2 text-[11px]"
                                                    onClick={() => onPreviewReceipt({ url: payment.receiptUrl || "", fileName: payment.receiptFileName })}
                                                >
                                                    <ImageIcon className="h-4 w-4" />
                                                    Ver comprobante
                                                </Button>
                                            ) : null}
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-6 rounded-md px-2 text-[11px]"
                                                onClick={() => document.getElementById(`receipt-${payment.id}`)?.click()}
                                                disabled={isBusy || uploadingReceiptId === payment.id}
                                            >
                                                {uploadingReceiptId === payment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                                                {payment.receiptUrl ? "Cambiar" : "Agregar comprobante"}
                                            </Button>
                                            {payment.status === "paid" ? (
                                                <Button size="sm" variant="outline" className="h-6 rounded-md px-2 text-[11px]" onClick={() => onMarkPayment(order.id, payment.id, "pending")} disabled={isBusy}>
                                                    Reabrir
                                                </Button>
                                            ) : (
                                                <Button size="sm" className="h-6 rounded-md px-2 text-[11px]" onClick={() => onMarkPayment(order.id, payment.id, "paid")} disabled={isBusy}>
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
                            <p className="mt-2 max-h-[4.75rem] overflow-y-auto overscroll-contain rounded-xl border bg-background/70 p-2.5 text-sm text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
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
        <div className="rounded-xl border bg-background/80 p-2.5">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn("mt-1 font-bold", tones[tone])}>{value}</div>
        </div>
    );
}

function InfoBox({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border bg-background/70 p-2.5">
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
    onPreviewReceipt,
}: {
    order: OrderRecordView;
    open: boolean;
    busy: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: (order: OrderRecordView) => void;
    onPreviewReceipt: (receipt: ReceiptPreview) => void;
}) {
    const [amount, setAmount] = useState(() => order.balanceAmount > 0 ? String(order.balanceAmount) : "");
    const [method, setMethod] = useState("transferencia");
    const [paidAt, setPaidAt] = useState(formatDateInput());
    const [reference, setReference] = useState("");
    const [notes, setNotes] = useState("");
    const [receiptUrl, setReceiptUrl] = useState("");
    const [receiptFileName, setReceiptFileName] = useState("");
    const [uploadingReceipt, setUploadingReceipt] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const attachReceipt = async (file: File | null | undefined) => {
        if (!file) return;
        setError(null);
        setUploadingReceipt(true);
        try {
            const receipt = await uploadReceiptFile(file);
            setReceiptUrl(receipt.receiptUrl);
            setReceiptFileName(receipt.receiptFileName);
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir el comprobante.");
        } finally {
            setUploadingReceipt(false);
        }
    };

    const save = async () => {
        setError(null);
        const response = await fetch(`/api/orders/${order.id}/payments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                label: "Abono",
                amount,
                status: "paid",
                paidAt,
                method,
                reference,
                notes,
                receiptUrl: receiptUrl || null,
                receiptFileName: receiptFileName || null,
            }),
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
                    <DialogTitle>Abonar pedido</DialogTitle>
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
                    <div className="space-y-2 sm:col-span-2">
                        <Label>Comprobante opcional</Label>
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-background/70 p-3">
                            <input
                                id={`new-payment-receipt-${order.id}`}
                                type="file"
                                accept="image/*,application/pdf"
                                className="hidden"
                                onChange={(event) => {
                                    void attachReceipt(event.target.files?.[0]);
                                    event.currentTarget.value = "";
                                }}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() => document.getElementById(`new-payment-receipt-${order.id}`)?.click()}
                                disabled={uploadingReceipt}
                            >
                                {uploadingReceipt ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                                {receiptUrl ? "Cambiar comprobante" : "Agregar comprobante"}
                            </Button>
                            {receiptUrl ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="rounded-xl"
                                    onClick={() => onPreviewReceipt({ url: receiptUrl, fileName: receiptFileName })}
                                >
                                    Ver comprobante
                                </Button>
                            ) : (
                                <span className="text-sm text-muted-foreground">Puedes guardar el abono sin imagen.</span>
                            )}
                            {receiptFileName ? <span className="max-w-full truncate text-sm text-muted-foreground">{receiptFileName}</span> : null}
                        </div>
                    </div>
                </div>
                {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button type="button" onClick={save} disabled={busy || uploadingReceipt || !toNumber(amount)}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                        Guardar abono
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ReceiptPreviewDialog({
    receipt,
    onOpenChange,
}: {
    receipt: ReceiptPreview | null;
    onOpenChange: (open: boolean) => void;
}) {
    const receiptKey = receipt?.url || receipt?.fileName || "";
    const [zoomState, setZoomState] = useState({ key: "", value: 1 });
    const zoom = zoomState.key === receiptKey ? zoomState.value : 1;
    const isImage = isImageReceipt(receipt?.fileName, receipt?.url);

    const setReceiptZoom = (nextZoom: number) => {
        setZoomState({ key: receiptKey, value: nextZoom });
    };

    return (
        <Dialog open={Boolean(receipt)} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] !max-w-4xl gap-0 overflow-hidden p-0">
                <DialogHeader className="border-b px-5 py-4 pr-12">
                    <DialogTitle>Comprobante de pago</DialogTitle>
                    <DialogDescription className="truncate">
                        {receipt?.fileName || "Vista previa del comprobante"}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-5 py-3">
                    <div className="text-sm text-muted-foreground">
                        {isImage ? `Zoom ${Math.round(zoom * 100)}%` : "Archivo adjunto"}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {isImage ? (
                            <>
                                <Button type="button" variant="outline" size="sm" onClick={() => setReceiptZoom(Math.max(0.5, zoom - 0.25))}>
                                    <ZoomOut className="h-4 w-4" />
                                    Alejar
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={() => setReceiptZoom(Math.min(3, zoom + 0.25))}>
                                    <ZoomIn className="h-4 w-4" />
                                    Acercar
                                </Button>
                            </>
                        ) : null}
                        {receipt?.url ? (
                            <a href={receipt.url} target="_blank" rel="noreferrer">
                                <Button type="button" variant="outline" size="sm">
                                    <Download className="h-4 w-4" />
                                    Abrir archivo
                                </Button>
                            </a>
                        ) : null}
                    </div>
                </div>
                <div className="max-h-[calc(92vh-9rem)] overflow-auto bg-slate-950/95 p-4">
                    {receipt?.url && isImage ? (
                        <div className="flex min-h-[28rem] items-center justify-center">
                            <img
                                src={receipt.url}
                                alt={receipt.fileName || "Comprobante de pago"}
                                className="h-auto rounded-xl bg-white shadow-2xl"
                                style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
                            />
                        </div>
                    ) : receipt?.url ? (
                        <div className="flex min-h-[24rem] items-center justify-center rounded-2xl border border-white/10 bg-white p-6 text-center">
                            <div>
                                <ReceiptText className="mx-auto h-12 w-12 text-muted-foreground" />
                                <p className="mt-3 font-semibold">Este comprobante no es una imagen.</p>
                                <p className="mt-1 text-sm text-muted-foreground">Abre el archivo para revisarlo o descargarlo.</p>
                                <a href={receipt.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex">
                                    <Button type="button">
                                        <Download className="h-4 w-4" />
                                        Abrir archivo
                                    </Button>
                                </a>
                            </div>
                        </div>
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
