import Link from "next/link";
import {
    ArrowRight,
    Bot,
    CalendarDays,
    Check,
    ChevronDown,
    DownloadCloud,
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

function startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

function endOfToday() {
    const date = new Date();
    date.setHours(23, 59, 59, 999);
    return date;
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function monthKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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

async function getDashboardStats() {
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const weekStart = addDays(todayStart, -6);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const chartStart = new Date(todayStart.getFullYear(), todayStart.getMonth() - 7, 1);

    const [
        totalContacts,
        newContactsThisMonth,
        activeConversations,
        messagesThisWeek,
        totalDeals,
        dealsByStage,
        closedWonDeals,
        recentDeals,
        todayAppointments,
        upcomingAppointments,
        contactsForSegments,
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
            where: { stage: { isClosedWon: true }, updatedAt: { gte: chartStart } },
            select: { value: true, updatedAt: true },
            orderBy: { updatedAt: "asc" },
        }),
        prisma.deal.findMany({
            take: 5,
            orderBy: { updatedAt: "desc" },
            include: {
                contact: { select: { name: true, lastName: true, phone: true } },
                stage: { select: { name: true, isClosedWon: true, isClosedLost: true } },
            },
        }),
        prisma.appointment.findMany({
            where: { startTime: { gte: todayStart, lte: todayEnd } },
            take: 6,
            orderBy: { startTime: "asc" },
            include: { contact: { select: { name: true, lastName: true } } },
        }),
        prisma.appointment.findMany({
            where: { startTime: { gte: new Date() } },
            take: 5,
            orderBy: { startTime: "asc" },
            include: { contact: { select: { name: true, lastName: true } } },
        }),
        prisma.contact.findMany({
            take: 200,
            orderBy: { updatedAt: "desc" },
            select: { status: true, tags: true, company: true },
        }),
    ]);

    const pipelineValue = dealsByStage
        .filter((stage) => !stage.isClosedLost)
        .reduce((sum, stage) => sum + stage.deals.reduce((stageSum, deal) => stageSum + deal.value, 0), 0);

    const closedWonValue = dealsByStage
        .filter((stage) => stage.isClosedWon)
        .reduce((sum, stage) => sum + stage.deals.reduce((stageSum, deal) => stageSum + deal.value, 0), 0);

    const wonDealsCount = dealsByStage
        .filter((stage) => stage.isClosedWon)
        .reduce((sum, stage) => sum + stage._count.deals, 0);

    const lostDealsCount = dealsByStage
        .filter((stage) => stage.isClosedLost)
        .reduce((sum, stage) => sum + stage._count.deals, 0);

    const openDealsCount = Math.max(totalDeals - wonDealsCount - lostDealsCount, 0);
    const conversionRate = totalDeals > 0 ? Math.round((wonDealsCount / totalDeals) * 100) : 0;

    const months = Array.from({ length: 8 }, (_, index) => {
        const date = new Date(todayStart.getFullYear(), todayStart.getMonth() - (7 - index), 1);
        return { key: monthKey(date), label: shortMonth(date), total: 0 };
    });

    closedWonDeals.forEach((deal) => {
        const bucket = months.find((month) => month.key === monthKey(deal.updatedAt));
        if (bucket) bucket.total += deal.value;
    });

    const segmentMap = new Map<string, number>();
    contactsForSegments.forEach((contact) => {
        const label = contact.company?.trim() || contact.tags[0]?.trim() || contact.status || "Sin segmento";
        segmentMap.set(label, (segmentMap.get(label) || 0) + 1);
    });

    const topSegments = Array.from(segmentMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([label, count]) => ({ label, count }));

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
        recentDeals,
        todayAppointments,
        upcomingAppointments,
        months,
        topSegments,
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
    trend: string;
    positive?: boolean;
    icon: typeof Users;
}) {
    const TrendIcon = positive ? TrendingUp : TrendingDown;
    return (
        <Card>
            <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                            <Icon className="h-4 w-4" />
                            {title}
                        </div>
                        <div>
                            <div className="text-3xl font-semibold tracking-normal text-foreground">{value}</div>
                            <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
                        </div>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground">
                        <TrendIcon className="h-3.5 w-3.5" />
                        {trend}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export default async function DashboardPage() {
    const [stats, session] = await Promise.all([getDashboardStats(), auth()]);
    const userName = session?.user?.name || "Usuario";
    const today = startOfToday();
    const weekDays = Array.from({ length: 7 }, (_, index) => addDays(today, index - 3));
    const lineValues = stats.months.map((month) => month.total);
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
        <div className="space-y-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-muted-foreground">Bienvenido de nuevo</p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
                        Hola, {userName}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        Vista ejecutiva de clientes, pipeline, conversaciones y agenda del dia.
                    </p>
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

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                            {["1D", "1S", "1M", "1A"].map((label, index) => (
                                <span key={label} className={index === 3 ? "rounded-lg bg-card px-3 py-1.5 text-foreground shadow-soft" : "px-3 py-1.5"}>
                                    {label}
                                </span>
                            ))}
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
                            <div className="mt-2 grid grid-cols-8 text-xs font-medium text-muted-foreground">
                                {stats.months.map((month) => (
                                    <span key={month.key} className="text-center capitalize">{month.label}</span>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
                        <div>
                            <CardTitle className="text-base">Citas del dia</CardTitle>
                            <p className="mt-1 text-sm text-muted-foreground">{today.toLocaleDateString("es-MX", { month: "long", day: "numeric" })}</p>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                            <Link href="/dashboard/calendar">
                                Hoy
                                <ChevronDown className="h-4 w-4" />
                            </Link>
                        </Button>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="grid grid-cols-7 gap-1 border-b border-border pb-4 text-center">
                            {weekDays.map((day) => {
                                const isToday = day.toDateString() === today.toDateString();
                                return (
                                    <div key={day.toISOString()} className="space-y-1">
                                        <div className="text-xs font-semibold text-muted-foreground capitalize">
                                            {day.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "")}
                                        </div>
                                        <div className={isToday ? "mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" : "text-sm font-semibold text-foreground/70"}>
                                            {day.getDate()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-4 space-y-3">
                            {stats.todayAppointments.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border bg-secondary/50 p-5 text-sm text-muted-foreground">
                                    No hay citas programadas para hoy.
                                </div>
                            ) : (
                                stats.todayAppointments.map((appointment) => (
                                    <div key={appointment.id} className="rounded-xl border border-border bg-secondary/45 p-4">
                                        <p className="font-semibold text-foreground">{appointment.title}</p>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {shortTime(appointment.startTime)} - {shortTime(appointment.endTime)}
                                        </p>
                                        {appointment.contact ? (
                                            <p className="mt-3 text-xs font-semibold text-muted-foreground">
                                                {getContactFullName(appointment.contact)}
                                            </p>
                                        ) : null}
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
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
                    <CardHeader className="border-b border-border pb-4">
                        <CardTitle className="text-base">Top segmentos</CardTitle>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="space-y-4">
                            {stats.topSegments.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Aun no hay segmentos disponibles.</p>
                            ) : (
                                stats.topSegments.map((segment, index) => {
                                    const percentage = stats.totalContacts > 0 ? Math.round((segment.count / stats.totalContacts) * 100) : 0;
                                    return (
                                        <div key={segment.label} className="flex items-center gap-3">
                                            <span className="w-5 text-sm font-semibold text-muted-foreground">{index + 1}.</span>
                                            <span className="min-w-0 flex-1 truncate font-semibold">{segment.label}</span>
                                            <span className="text-sm text-muted-foreground">{percentage}%</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
                        <CardTitle className="text-base">Actividad reciente</CardTitle>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/dashboard/pipeline">
                                Ver todo <ArrowRight className="h-4 w-4" />
                            </Link>
                        </Button>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="space-y-3">
                            {stats.recentDeals.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No hay actividad reciente.</p>
                            ) : (
                                stats.recentDeals.map((deal) => (
                                    <div key={deal.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 p-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                                            {(deal.contact?.name || deal.title).charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-semibold">
                                                {deal.contact ? getContactFullName(deal.contact, deal.title) : deal.title}
                                            </p>
                                            <p className="truncate text-sm text-muted-foreground">
                                                {deal.stage.name} - {currency.format(deal.value)}
                                            </p>
                                        </div>
                                        <Check className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between border-b border-border pb-4">
                        <CardTitle className="text-base">Proximas acciones</CardTitle>
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/dashboard/calendar">
                                Agenda <ArrowRight className="h-4 w-4" />
                            </Link>
                        </Button>
                    </CardHeader>
                    <CardContent className="p-5">
                        <div className="space-y-3">
                            {stats.upcomingAppointments.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No tienes acciones proximas.</p>
                            ) : (
                                stats.upcomingAppointments.map((appointment) => (
                                    <div key={appointment.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/35 p-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
                                            <CalendarDays className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-semibold">{appointment.title}</p>
                                            <p className="truncate text-sm text-muted-foreground">
                                                {appointment.startTime.toLocaleDateString("es-MX", { day: "numeric", month: "short" })} - {shortTime(appointment.startTime)}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
                    <Bot className="h-5 w-5" />
                    <p className="mt-3 text-sm font-semibold">Cerebro IA</p>
                    <p className="mt-1 text-sm text-muted-foreground">Listo para asistir conversaciones.</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
                    <DownloadCloud className="h-5 w-5" />
                    <p className="mt-3 text-sm font-semibold">Exportaciones</p>
                    <p className="mt-1 text-sm text-muted-foreground">Reportes listos desde cada modulo.</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
                    <Wallet className="h-5 w-5" />
                    <p className="mt-3 text-sm font-semibold">CLV estimado</p>
                    <p className="mt-1 text-sm text-muted-foreground">{currency.format(stats.wonDealsCount ? stats.closedWonValue / stats.wonDealsCount : 0)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
                    <Users className="h-5 w-5" />
                    <p className="mt-3 text-sm font-semibold">Base activa</p>
                    <p className="mt-1 text-sm text-muted-foreground">{compactNumber.format(stats.totalContacts)} contactos en CRM.</p>
                </div>
            </div>
        </div>
    );
}
