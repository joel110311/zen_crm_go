import Link from "next/link";
import {
    ArrowRight,
    ChevronDown,
    MessageSquare,
    Plus,
    TrendingDown,
    TrendingUp,
    Users,
    Wallet,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getContactFullName } from "@/lib/contact-name";

const currency = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
});

const compactNumber = new Intl.NumberFormat("es-MX", {
    notation: "compact",
    maximumFractionDigits: 1,
});

const REVENUE_RANGES = ["1D", "1S", "1M", "1A"] as const;
type RevenueRange = (typeof REVENUE_RANGES)[number];

type DashboardSearchParams = Record<string, string | string[] | undefined>;

function startOfDay(date: Date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}

function endOfDay(date: Date) {
    const next = new Date(date);
    next.setHours(23, 59, 59, 999);
    return next;
}

function startOfToday() {
    return startOfDay(new Date());
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function addHours(date: Date, hours: number) {
    const next = new Date(date);
    next.setHours(next.getHours() + hours);
    return next;
}

function addMonths(date: Date, months: number) {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
}

function sameDay(left: Date, right: Date) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function formatDateParam(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getSingleParam(params: DashboardSearchParams | undefined, key: string) {
    const value = params?.[key];
    return Array.isArray(value) ? value[0] : value;
}

function parseDateParam(value?: string) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfToday();
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(year, month - 1, day);
    if (Number.isNaN(parsed.getTime())) return startOfToday();
    return startOfDay(parsed);
}

function normalizeRevenueRange(value?: string): RevenueRange {
    return REVENUE_RANGES.includes(value as RevenueRange) ? value as RevenueRange : "1A";
}

function dashboardHref(range: RevenueRange, date: Date) {
    const today = startOfToday();
    const params = new URLSearchParams();
    if (range !== "1A") params.set("revenueRange", range);
    if (!sameDay(date, today)) params.set("date", formatDateParam(date));
    const query = params.toString();
    return query ? `/dashboard?${query}` : "/dashboard";
}

function shortMonth(date: Date) {
    return date.toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
}

function shortTime(date: Date) {
    return date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function buildLinePath(values: number[], width = 720, height = 220) {
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);
    return values
        .map((value, index) => {
            const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
            const y = height - ((value - min) / range) * (height - 28) - 14;
            return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ");
}

function buildRevenueBuckets(range: RevenueRange) {
    const today = startOfToday();

    if (range === "1D") {
        return Array.from({ length: 24 }, (_, index) => {
            const start = addHours(today, index);
            return {
                start,
                end: addHours(start, 1),
                label: `${String(index).padStart(2, "0")}h`,
                showLabel: index % 4 === 0 || index === 23,
                total: 0,
            };
        });
    }

    if (range === "1S") {
        const start = addDays(today, -6);
        return Array.from({ length: 7 }, (_, index) => {
            const day = addDays(start, index);
            return {
                start: day,
                end: addDays(day, 1),
                label: day.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", ""),
                showLabel: true,
                total: 0,
            };
        });
    }

    if (range === "1M") {
        const start = addDays(today, -29);
        return Array.from({ length: 30 }, (_, index) => {
            const day = addDays(start, index);
            return {
                start: day,
                end: addDays(day, 1),
                label: String(day.getDate()),
                showLabel: index % 5 === 0 || index === 29,
                total: 0,
            };
        });
    }

    const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    return Array.from({ length: 12 }, (_, index) => {
        const month = addMonths(start, index);
        return {
            start: month,
            end: addMonths(month, 1),
            label: shortMonth(month),
            showLabel: true,
            total: 0,
        };
    });
}

function messagePreview(message: { content: string; type: string; mediaFileName?: string | null }) {
    const content = message.content?.trim();
    if (content && !content.startsWith("[")) return content;
    if (message.type === "image") return "Imagen";
    if (message.type === "audio") return "Audio";
    if (message.type === "video") return "Video";
    if (message.type === "document") return message.mediaFileName || "Documento";
    return content || "Mensaje";
}

function chatTime(date: Date) {
    const today = startOfToday();
    if (sameDay(date, today)) return shortTime(date);
    if (sameDay(date, addDays(today, -1))) return "Ayer";
    return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
}

async function getDashboardStats({ revenueRange, selectedDate }: { revenueRange: RevenueRange; selectedDate: Date }) {
    const todayStart = startOfToday();
    const weekStart = addDays(todayStart, -6);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const selectedStart = startOfDay(selectedDate);
    const selectedEnd = endOfDay(selectedDate);
    const revenueBuckets = buildRevenueBuckets(revenueRange);
    const revenueStart = revenueBuckets[0]?.start || todayStart;
    const revenueEnd = revenueBuckets[revenueBuckets.length - 1]?.end || endOfDay(todayStart);

    const [
        totalContacts,
        newContactsThisMonth,
        activeConversations,
        messagesThisWeek,
        totalDeals,
        dealsByStage,
        closedWonDeals,
        selectedAppointments,
        recentMessages,
    ] = await Promise.all([
        prisma.contact.count(),
        prisma.contact.count({ where: { createdAt: { gte: monthStart } } }),
        prisma.conversation.count({ where: { status: "active" } }),
        prisma.message.count({ where: { createdAt: { gte: weekStart } } }),
        prisma.deal.count(),
        prisma.pipelineStage.findMany({
            orderBy: { order: "asc" },
            include: {
                _count: { select: { deals: true } },
                deals: { select: { value: true } },
            },
        }),
        prisma.deal.findMany({
            where: { stage: { isClosedWon: true }, updatedAt: { gte: revenueStart, lt: revenueEnd } },
            select: { value: true, updatedAt: true },
            orderBy: { updatedAt: "asc" },
        }),
        prisma.appointment.findMany({
            where: { startTime: { gte: selectedStart, lte: selectedEnd } },
            take: 8,
            orderBy: { startTime: "asc" },
            include: { contact: { select: { name: true, lastName: true, phone: true } } },
        }),
        prisma.message.findMany({
            take: 100,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                conversationId: true,
                content: true,
                type: true,
                mediaFileName: true,
                createdAt: true,
                conversation: {
                    select: {
                        id: true,
                        sourceType: true,
                        contact: {
                            select: {
                                id: true,
                                name: true,
                                lastName: true,
                                phone: true,
                                whatsappAvatarUrl: true,
                            },
                        },
                    },
                },
            },
        }),
    ]);

    closedWonDeals.forEach((deal) => {
        const bucket = revenueBuckets.find((item, index) => {
            const isLast = index === revenueBuckets.length - 1;
            return deal.updatedAt >= item.start && (isLast ? deal.updatedAt <= item.end : deal.updatedAt < item.end);
        });
        if (bucket) bucket.total += deal.value;
    });

    const pipelineValue = dealsByStage
        .filter((stage) => !stage.isClosedLost)
        .reduce((sum, stage) => sum + stage.deals.reduce((stageSum, deal) => stageSum + deal.value, 0), 0);

    const wonDealsCount = dealsByStage
        .filter((stage) => stage.isClosedWon)
        .reduce((sum, stage) => sum + stage._count.deals, 0);

    const lostDealsCount = dealsByStage
        .filter((stage) => stage.isClosedLost)
        .reduce((sum, stage) => sum + stage._count.deals, 0);

    const openDealsCount = Math.max(totalDeals - wonDealsCount - lostDealsCount, 0);
    const conversionRate = totalDeals > 0 ? Math.round((wonDealsCount / totalDeals) * 100) : 0;
    const closedWonValue = revenueBuckets.reduce((sum, bucket) => sum + bucket.total, 0);

    const seenConversations = new Set<string>();
    const recentChats = recentMessages
        .filter((message) => {
            if (seenConversations.has(message.conversationId)) return false;
            seenConversations.add(message.conversationId);
            return true;
        })
        .slice(0, 10)
        .map((message) => ({
            id: message.conversation.id,
            sourceType: message.conversation.sourceType,
            contact: message.conversation.contact,
            preview: messagePreview(message),
            createdAt: message.createdAt,
        }));

    return {
        totalContacts,
        newContactsThisMonth,
        activeConversations,
        messagesThisWeek,
        totalDeals,
        pipelineValue,
        closedWonValue,
        wonDealsCount,
        lostDealsCount,
        openDealsCount,
        conversionRate,
        dealsByStage,
        selectedAppointments,
        revenueBuckets,
        recentChats,
    };
}

function MetricCard({
    title,
    value,
    meta,
    trend,
    positive = true,
    icon: Icon,
}: {
    title: string;
    value: string;
    meta: string;
    trend?: string;
    positive?: boolean;
    icon: typeof Users;
}) {
    const TrendIcon = positive ? TrendingUp : TrendingDown;
    return (
        <Card>
            <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                            <Icon className="h-4 w-4" />
                            {title}
                        </div>
                        <div>
                            <div className="truncate text-3xl font-semibold tracking-normal text-foreground">{value}</div>
                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{meta}</p>
                        </div>
                    </div>
                    {trend ? (
                        <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground">
                            <TrendIcon className="h-3.5 w-3.5" />
                            {trend}
                        </div>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
}

export default async function DashboardPage({
    searchParams,
}: {
    searchParams?: Promise<DashboardSearchParams>;
}) {
    const params = await searchParams;
    const revenueRange = normalizeRevenueRange(getSingleParam(params, "revenueRange"));
    const selectedDate = parseDateParam(getSingleParam(params, "date"));
    const [stats, session] = await Promise.all([getDashboardStats({ revenueRange, selectedDate }), auth()]);
    const userName = session?.user?.name || "Usuario";
    const today = startOfToday();
    const weekDays = Array.from({ length: 7 }, (_, index) => addDays(selectedDate, index - 3));
    const lineValues = stats.revenueBuckets.map((bucket) => bucket.total);
    const linePath = buildLinePath(lineValues);
    const areaPath = `${linePath} L 720 220 L 0 220 Z`;
    const maxStageValue = Math.max(...stats.dealsByStage.map((stage) => stage.deals.reduce((sum, deal) => sum + deal.value, 0)), 1);

    const leadCards = [
        { label: "Abiertos", value: stats.openDealsCount, tone: "bg-foreground" },
        { label: "Ganados", value: stats.wonDealsCount, tone: "bg-foreground/75" },
        { label: "Perdidos", value: stats.lostDealsCount, tone: "bg-foreground/45" },
        { label: "Total", value: stats.totalDeals, tone: "bg-foreground/25" },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                    <h2 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
                        Hola, {userName}
                    </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" asChild>
                        <Link href="/dashboard/contacts">
                            <Plus className="h-4 w-4" />
                            Nuevo contacto
                        </Link>
                    </Button>
                    <Button asChild>
                        <Link href="/dashboard/pipeline">
                            <ArrowRight className="h-4 w-4" />
                            Ver pipeline
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <MetricCard
                    title="Leads"
                    value={stats.totalContacts.toLocaleString("es-MX")}
                    meta={`${stats.newContactsThisMonth} nuevos este mes`}
                    trend="+8%"
                    icon={Users}
                />
                <MetricCard
                    title="Conversion"
                    value={`${stats.conversionRate}%`}
                    meta={`${stats.wonDealsCount} oportunidades ganadas`}
                    trend="+2%"
                    icon={TrendingUp}
                />
                <MetricCard
                    title="Pipeline"
                    value={currency.format(stats.pipelineValue)}
                    meta={`${stats.openDealsCount} oportunidades abiertas`}
                    trend="+12%"
                    icon={Wallet}
                />
                <MetricCard
                    title="Chats"
                    value={stats.activeConversations.toLocaleString("es-MX")}
                    meta={`${stats.messagesThisWeek} mensajes esta semana`}
                    trend="-4%"
                    positive={false}
                    icon={MessageSquare}
                />
                <MetricCard
                    title="Base activa"
                    value={compactNumber.format(stats.totalContacts)}
                    meta="contactos en CRM"
                    icon={Users}
                />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
                <Card className="min-w-0">
                    <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border pb-4">
                        <div>
                            <CardTitle className="text-base">Revenue</CardTitle>
                            <div className="mt-2 flex items-end gap-3">
                                <span className="text-3xl font-semibold tracking-normal">
                                    {currency.format(stats.closedWonValue)}
                                </span>
                                <span className="pb-1 text-sm text-muted-foreground">ventas cerradas</span>
                            </div>
                        </div>
                        <div className="flex rounded-xl border border-border bg-secondary p-1 text-xs font-semibold text-muted-foreground">
                            {REVENUE_RANGES.map((label) => {
                                const isActive = label === revenueRange;
                                return (
                                    <Link
                                        key={label}
                                        href={dashboardHref(label, selectedDate)}
                                        className={isActive
                                            ? "rounded-lg bg-card px-3 py-1.5 text-foreground shadow-soft"
                                            : "px-3 py-1.5 transition-colors hover:text-foreground"}
                                    >
                                        {label}
                                    </Link>
                                );
                            })}
                        </div>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="h-[290px] min-w-0">
                            <svg className="h-full w-full overflow-visible" viewBox="0 0 720 250" preserveAspectRatio="none">
                                {[0, 1, 2, 3, 4].map((line) => (
                                    <line
                                        key={line}
                                        x1="0"
                                        x2="720"
                                        y1={20 + line * 48}
                                        y2={20 + line * 48}
                                        stroke="currentColor"
                                        className="text-border"
                                        strokeDasharray="6 6"
                                        strokeWidth="1"
                                    />
                                ))}
                                <path d={areaPath} fill="currentColor" className="text-foreground/5" />
                                <path d={linePath} fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" className="text-foreground" />
                            </svg>
                            <div className="mt-2 grid text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: `repeat(${stats.revenueBuckets.length}, minmax(0, 1fr))` }}>
                                {stats.revenueBuckets.map((bucket, index) => (
                                    <span key={`${bucket.label}-${index}`} className="text-center capitalize">
                                        {bucket.showLabel ? bucket.label : ""}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
                        <div>
                            <CardTitle className="text-base">Citas del dia</CardTitle>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {selectedDate.toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
                            </p>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                            <Link href={dashboardHref(revenueRange, today)}>
                                Hoy
                                <ChevronDown className="h-4 w-4" />
                            </Link>
                        </Button>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="grid grid-cols-7 gap-1 border-b border-border pb-4 text-center">
                            {weekDays.map((day) => {
                                const isSelected = sameDay(day, selectedDate);
                                return (
                                    <Link key={day.toISOString()} href={dashboardHref(revenueRange, day)} className="space-y-1 rounded-lg py-1 transition-colors hover:bg-secondary">
                                        <div className="text-xs font-semibold text-muted-foreground capitalize">
                                            {day.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "")}
                                        </div>
                                        <div className={isSelected ? "mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" : "mx-auto flex h-8 w-8 items-center justify-center text-sm font-semibold text-foreground/70"}>
                                            {day.getDate()}
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>

                        <div className="mt-4 space-y-3">
                            {stats.selectedAppointments.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border bg-secondary/50 p-5 text-sm text-muted-foreground">
                                    No hay citas programadas para este dia.
                                </div>
                            ) : (
                                stats.selectedAppointments.map((appointment) => (
                                    <Link key={appointment.id} href="/dashboard/calendar" className="block rounded-xl border border-border bg-secondary/45 p-4 transition-colors hover:bg-secondary">
                                        <p className="font-semibold text-foreground">{appointment.title}</p>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {shortTime(appointment.startTime)} - {shortTime(appointment.endTime)}
                                        </p>
                                        {appointment.contact ? (
                                            <p className="mt-3 text-xs font-semibold text-muted-foreground">
                                                {getContactFullName(appointment.contact)}
                                            </p>
                                        ) : null}
                                    </Link>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_390px]">
                <Card>
                    <CardHeader className="border-b border-border pb-4">
                        <CardTitle className="text-base">Leads Management</CardTitle>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="grid grid-cols-2 gap-3">
                            {leadCards.map((item) => (
                                <div key={item.label} className="rounded-xl border border-border bg-secondary/45 p-4">
                                    <div className={`mb-4 h-1.5 w-12 rounded-full ${item.tone}`} />
                                    <p className="text-sm font-semibold">{item.label}</p>
                                    <p className="mt-2 text-2xl font-semibold">{item.value}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="border-b border-border pb-4">
                        <CardTitle className="text-base">Pipeline por etapa</CardTitle>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="flex h-[220px] items-end gap-3">
                            {stats.dealsByStage.map((stage) => {
                                const value = stage.deals.reduce((sum, deal) => sum + deal.value, 0);
                                const height = Math.max((value / maxStageValue) * 100, stage._count.deals ? 12 : 4);
                                return (
                                    <div key={stage.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                                        <div className="w-full rounded-t-lg bg-foreground" style={{ height: `${height}%`, opacity: 0.22 + (height / 100) * 0.7 }} />
                                        <span className="w-full truncate text-center text-[11px] font-medium text-muted-foreground">
                                            {stage.name}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
                        <CardTitle className="text-base">Chats recientes</CardTitle>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/dashboard/inbox">
                                Ver inbox <ArrowRight className="h-4 w-4" />
                            </Link>
                        </Button>
                    </CardHeader>
                    <CardContent className="p-4">
                        <div className="space-y-2">
                            {stats.recentChats.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
                                    Aun no hay chats recientes.
                                </p>
                            ) : (
                                stats.recentChats.map((chat) => {
                                    const name = getContactFullName(chat.contact);
                                    const initial = name.charAt(0).toUpperCase();
                                    return (
                                        <Link
                                            key={chat.id}
                                            href={`/dashboard/inbox?conversationId=${encodeURIComponent(chat.id)}`}
                                            className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-secondary/45 p-3 transition-colors hover:bg-secondary"
                                        >
                                            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-card">
                                                {chat.contact.whatsappAvatarUrl ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={chat.contact.whatsappAvatarUrl} alt={name} className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-foreground">
                                                        {initial}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                                                    <span className="ml-auto shrink-0 text-xs font-medium text-muted-foreground">{chatTime(chat.createdAt)}</span>
                                                </div>
                                                <p className="mt-0.5 truncate text-xs text-muted-foreground">{chat.preview}</p>
                                            </div>
                                        </Link>
                                    );
                                })
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
