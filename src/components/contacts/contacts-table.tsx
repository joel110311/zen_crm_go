"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useDebouncedCallback } from "use-debounce";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
    ChevronLeft,
    ChevronRight,
    Download,
    RotateCw,
    Search,
    Star,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NewContactDialog } from "@/components/contacts/new-contact-dialog";
import { ContactActions } from "@/components/contacts/contact-actions";
import { getContactFullName, getContactInitial } from "@/lib/contact-name";

interface ContactsPageProps {
    contacts: any[];
}

const PAGE_SIZE = 10;

function getHostMeta(contact: any) {
    const conversation = contact.conversations?.[0];

    if (!conversation) {
        return {
            label: "Sin asignar",
            detail: "Sin conversacion",
            classes: "bg-slate-100 text-slate-600",
        };
    }

    if (conversation.botActive) {
        return {
            label: "IA",
            detail: conversation.assignedUser?.name || "Atencion automatica",
            classes: "bg-emerald-100 text-emerald-700",
        };
    }

    return {
        label: "Humano",
        detail: conversation.assignedUser?.name || "Asignacion manual",
        classes: "bg-amber-50 text-amber-700",
    };
}

function getStatusMeta(contact: any) {
    const stage = contact.deals?.[0]?.stage;
    const fallbackMap: Record<string, { label: string; color: string }> = {
        lead: { label: "Nuevo lead", color: "#94A3B8" },
        qualified: { label: "Calificado", color: "#10B981" },
        customer: { label: "Cliente", color: "#2563EB" },
    };
    const fallback = fallbackMap[contact.status] || fallbackMap.lead;

    return {
        label: stage?.name || fallback.label,
        color: stage?.color || fallback.color,
    };
}

function getScoreMeta(contact: any) {
    const score = contact.deals?.[0]?.intelligence?.score ?? 0;
    const tone =
        score >= 70 ? "text-emerald-600" : score >= 40 ? "text-amber-500" : "text-slate-400";
    return { score, tone };
}

export function ContactsTable({ contacts }: ContactsPageProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [currentPage, setCurrentPage] = useState(1);

    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams);
        if (term) {
            params.set("query", term);
        } else {
            params.delete("query");
        }
        setCurrentPage(1);
        startTransition(() => {
            router.replace(`/dashboard/contacts?${params.toString()}`);
        });
    }, 300);

    const totalPages = Math.max(1, Math.ceil(contacts.length / PAGE_SIZE));
    const safePage = Math.min(currentPage, totalPages);

    const pagedContacts = useMemo(() => {
        const start = (safePage - 1) * PAGE_SIZE;
        return contacts.slice(start, start + PAGE_SIZE);
    }, [contacts, safePage]);

    const handleRefresh = () => {
        startTransition(() => {
            router.refresh();
        });
    };

    const handleExport = () => {
        const rows = contacts.map((contact) => {
            const host = getHostMeta(contact);
            const status = getStatusMeta(contact);
            const score = getScoreMeta(contact);

            return [
                getContactFullName(contact, "Sin nombre"),
                contact.email || "",
                contact.phone || "",
                host.label,
                status.label,
                String(score.score),
                new Date(contact.createdAt).toISOString(),
            ];
        });

        const csv = [
            ["Nombre", "Email", "Telefono", "Anfitrion", "Estado", "Calidad", "Creado"].join(","),
            ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
        ].join("\n");

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "contactos.csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const currentRangeStart = contacts.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
    const currentRangeEnd = Math.min(safePage * PAGE_SIZE, contacts.length);

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b border-border p-5">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">Contactos</h1>
                        <span className="text-sm text-muted-foreground">({contacts.length} total)</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-xl"
                            onClick={handleRefresh}
                            disabled={isPending}
                        >
                            <RotateCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-xl"
                            onClick={handleExport}
                        >
                            <Download className="h-4 w-4" />
                        </Button>
                        <NewContactDialog />
                    </div>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="relative w-full max-w-xl">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por nombre, email, telefono o compania..."
                            className="h-11 w-full rounded-xl border-input bg-background pl-9"
                            defaultValue={searchParams.get("query")?.toString()}
                            onChange={(e) => handleSearch(e.target.value)}
                        />
                    </div>

                    <div className="text-sm text-muted-foreground">
                        Mostrando {currentRangeStart}-{currentRangeEnd} de {contacts.length} contactos
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto bg-card">
                <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
                        <TableRow className="border-b border-border hover:bg-transparent">
                            <TableHead className="text-muted-foreground">Nombre</TableHead>
                            <TableHead className="hidden lg:table-cell text-muted-foreground">Email</TableHead>
                            <TableHead className="text-muted-foreground">Telefono</TableHead>
                            <TableHead className="hidden md:table-cell text-muted-foreground">Anfitrion</TableHead>
                            <TableHead className="hidden md:table-cell text-muted-foreground">Estado</TableHead>
                            <TableHead className="hidden xl:table-cell text-muted-foreground">Creado</TableHead>
                            <TableHead className="text-muted-foreground">Calidad</TableHead>
                            <TableHead className="w-[56px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {contacts.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                                    No se encontraron contactos.
                                </TableCell>
                            </TableRow>
                        ) : (
                            pagedContacts.map((contact) => {
                                const fullName = getContactFullName(contact, "Sin nombre");
                                const host = getHostMeta(contact);
                                const status = getStatusMeta(contact);
                                const score = getScoreMeta(contact);

                                return (
                                    <TableRow
                                        key={contact.id}
                                        className="group border-b border-border/70 transition-colors hover:bg-muted/35"
                                    >
                                        <TableCell>
                                            <Link href={`/dashboard/contacts/${contact.id}`} className="flex items-center gap-3">
                                                <Avatar className="h-10 w-10 border border-primary/10 shadow-sm">
                                                    <AvatarImage
                                                        src={contact.whatsappAvatarUrl || undefined}
                                                        alt={fullName}
                                                    />
                                                    <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                                                        {getContactInitial(contact)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="min-w-0">
                                                    <div className="truncate font-semibold text-foreground transition-colors group-hover:text-primary">
                                                        {fullName}
                                                    </div>
                                                    <div className="truncate text-xs text-muted-foreground">
                                                        {contact.company || "Sin compania"}
                                                    </div>
                                                </div>
                                            </Link>
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell text-sm text-slate-600">
                                            {contact.email || "-"}
                                        </TableCell>
                                        <TableCell className="font-mono text-xs text-slate-600">
                                            {contact.phone || "-"}
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell">
                                            <div className="flex flex-col gap-1">
                                                <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${host.classes}`}>
                                                    {host.label}
                                                </span>
                                                <span className="truncate text-[11px] text-muted-foreground">
                                                    {host.detail}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell">
                                            <span
                                                className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                                                style={{
                                                    backgroundColor: `${status.color}22`,
                                                    color: status.color,
                                                }}
                                            >
                                                {status.label}
                                            </span>
                                        </TableCell>
                                        <TableCell className="hidden xl:table-cell whitespace-nowrap text-sm text-muted-foreground">
                                            {formatDistanceToNow(new Date(contact.createdAt), { addSuffix: true, locale: es })}
                                        </TableCell>
                                        <TableCell>
                                            <div
                                                className={`inline-flex items-center gap-1.5 font-semibold ${score.tone}`}
                                                title="Se calcula por actividad e interes detectado en la conversacion."
                                            >
                                                <Star className="h-4 w-4 fill-current" />
                                                <span>{score.score}/100</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <ContactActions contactId={contact.id} />
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                    Pagina {safePage} de {totalPages}
                </div>

                <div className="flex items-center gap-2 self-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl"
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        disabled={safePage === 1}
                    >
                        <ChevronLeft className="mr-1 h-4 w-4" />
                        Anterior
                    </Button>
                    <div className="min-w-[42px] rounded-xl border border-border bg-background px-3 py-2 text-center text-sm font-medium">
                        {safePage}
                    </div>
                    <div className="text-sm text-muted-foreground">de {totalPages}</div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl"
                        onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                        disabled={safePage === totalPages}
                    >
                        Siguiente
                        <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
