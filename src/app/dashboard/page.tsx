import { StatsCard } from "@/components/dashboard/stats-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, MessageSquare, DollarSign, TrendingUp, Calendar, KanbanSquare, ArrowRight, Wallet } from "lucide-react";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { Button } from "@/components/ui/button";

async function getDashboardStats() {
    const [
        totalContacts,
        activeConversations,
        totalDeals,
        dealsByStage,
        recentDeals,
        upcomingAppointments,
    ] = await Promise.all([
        prisma.contact.count(),
        prisma.conversation.count({ where: { status: "active" } }),
        prisma.deal.count(),
        prisma.pipelineStage.findMany({
            orderBy: { order: "asc" },
            include: {
                _count: { select: { deals: true } },
                deals: { select: { value: true } },
            },
        }),
        prisma.deal.findMany({
            take: 5,
            orderBy: { createdAt: "desc" },
            include: {
                contact: { select: { name: true, phone: true } },
                stage: { select: { name: true, color: true } },
            },
        }),
        prisma.appointment.findMany({
            where: { startTime: { gte: new Date() } },
            take: 5,
            orderBy: { startTime: "asc" },
            include: { contact: { select: { name: true } } },
        }),
    ]);

    const pipelineValue = dealsByStage
        .filter(s => !s.isClosedLost)
        .reduce((sum, s) => sum + s.deals.reduce((v, d) => v + d.value, 0), 0);

    const closedWonValue = dealsByStage
        .filter(s => s.isClosedWon)
        .reduce((sum, s) => sum + s.deals.reduce((v, d) => v + d.value, 0), 0);

    return {
        totalContacts,
        activeConversations,
        totalDeals,
        pipelineValue,
        closedWonValue,
        dealsByStage,
        recentDeals,
        upcomingAppointments,
    };
}

export default async function DashboardPage() {
    const stats = await getDashboardStats();

    return (
        <div className="flex flex-col gap-6 md:gap-8">
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                    Panel de Control
                </h1>
                <p className="text-muted-foreground text-sm">
                    Visualiza el rendimiento general de tu negocio en tiempo real.
                </p>
            </div>

            {/* Stats Overview */}
            <div className="grid gap-4 md:gap-6 grid-cols-2 lg:grid-cols-4">
                <StatsCard
                    title="Contactos Totales"
                    value={stats.totalContacts.toLocaleString("es-MX")}
                    icon={Users}
                    color="#2563EB" // Blue
                    description="Base de datos activa"
                />
                <StatsCard
                    title="Conversaciones Activas"
                    value={stats.activeConversations.toString()}
                    icon={MessageSquare}
                    color="#F59E0B"
                    description="En proceso de atención"
                />
                <StatsCard
                    title="Valor en Pipeline"
                    value={`$${stats.pipelineValue.toLocaleString("es-MX")}`}
                    icon={Wallet}
                    color="#F59E0B" // Amber
                    description="Oportunidades abiertas"
                />
                <StatsCard
                    title="Ventas Cerradas"
                    value={`$${stats.closedWonValue.toLocaleString("es-MX")}`}
                    icon={TrendingUp}
                    color="#0EA5E9"
                    description="Ingresos generados"
                    trend={{ value: 12.5, isPositive: true, label: "vs mes anterior" }}
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid gap-4 md:gap-6 grid-cols-1 xl:grid-cols-12">

                {/* 1. Pipeline Breakdown */}
                <Card className="xl:col-span-7 border border-border/60 shadow-premium h-full rounded-xl">
                    <CardHeader className="flex flex-row items-center justify-between pb-4">
                        <div>
                            <CardTitle className="text-xl font-bold">Distribución del Pipeline</CardTitle>
                            <CardDescription className="text-base">Oportunidades por etapa</CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {(() => {
                            const stageData = stats.dealsByStage.map((stage) => ({
                                name: stage.name,
                                color: stage.color,
                                value: stage.deals.reduce((v, d) => v + d.value, 0),
                                count: stage._count.deals,
                            }));
                            const maxValue = Math.max(...stageData.map(s => s.value), 1);
                            // Round up to a nice number for the Y-axis
                            const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue || 1)));
                            const niceMax = Math.ceil(maxValue / magnitude) * magnitude || 100;
                            const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((niceMax / 4) * (4 - i)));

                            return (
                                <div className="flex gap-0">
                                    {/* Y-axis labels */}
                                    <div className="flex flex-col justify-between pr-2 py-1 text-[11px] text-muted-foreground font-medium" style={{ height: 220 }}>
                                        {yTicks.map((tick) => (
                                            <span key={tick} className="text-right leading-none">${tick.toLocaleString("es-MX")}</span>
                                        ))}
                                    </div>
                                    {/* Chart area */}
                                    <div className="flex-1 relative" style={{ height: 220 }}>
                                        {/* Gridlines */}
                                        {yTicks.map((tick, i) => (
                                            <div
                                                key={tick}
                                                className="absolute left-0 right-0 border-t border-dashed border-border/50"
                                                style={{ top: `${(i / (yTicks.length - 1)) * 100}%` }}
                                            />
                                        ))}
                                        {/* Bars */}
                                        <div className="relative flex items-end justify-around h-full gap-1 px-1">
                                            {stageData.map((stage) => {
                                                const heightPct = Math.max((stage.value / niceMax) * 100, 3);
                                                return (
                                                    <div key={stage.name} className="flex flex-col items-center flex-1 min-w-0 z-10">
                                                        {/* Value label on top */}
                                                        <span className="text-[11px] font-bold text-foreground mb-1 whitespace-nowrap">
                                                            ${stage.value.toLocaleString("es-MX")}
                                                        </span>
                                                        {/* Bar */}
                                                        <div
                                                            className="w-full max-w-[48px] rounded-t-md transition-all duration-700 ease-out shadow-sm"
                                                            style={{
                                                                height: `${heightPct}%`,
                                                                backgroundColor: stage.color,
                                                                minHeight: 6,
                                                            }}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                        {/* Stage labels below the chart */}
                        <div className="flex justify-around mt-2 px-1">
                            {stats.dealsByStage.map((stage) => (
                                <div key={stage.id} className="flex flex-col items-center flex-1 min-w-0">
                                    <span className="text-[11px] font-semibold text-foreground truncate max-w-full text-center leading-tight">
                                        {stage.name}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                        ({stage._count.deals} op.)
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Right Column Stack */}
                <div className="xl:col-span-5 flex flex-col gap-4 md:gap-6">

                    {/* Activity Feed */}
                    <Card className="border border-border/60 shadow-premium flex-1 rounded-xl">
                        <CardHeader className="flex flex-row items-center justify-between pb-4">
                            <div>
                                <CardTitle className="text-xl font-bold">Actividad Reciente</CardTitle>
                                <CardDescription className="text-base">Últimos movimientos</CardDescription>
                            </div>
                            <Button variant="ghost" size="sm" className="h-9 text-sm text-primary font-medium" asChild>
                                <Link href="/dashboard/pipeline">
                                    Ver todo <ArrowRight className="ml-1 h-3 w-3" />
                                </Link>
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-5">
                                {stats.recentDeals.length === 0 ? (
                                    <div className="text-center py-8 text-muted-foreground text-base">
                                        No hay actividad reciente.
                                    </div>
                                ) : (
                                    stats.recentDeals.map((deal) => (
                                        <div key={deal.id} className="flex items-center gap-4">
                                            <div
                                                className="h-10 w-10 md:h-11 md:w-11 rounded-full flex items-center justify-center text-sm font-extrabold flex-shrink-0 shadow-sm"
                                                style={{
                                                    backgroundColor: deal.stage.color + "15",
                                                    color: deal.stage.color,
                                                    border: `1px solid ${deal.stage.color}30`
                                                }}
                                            >
                                                {(deal.contact?.name || deal.title).charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-base font-semibold truncate text-foreground leading-snug mb-0.5">
                                                    {deal.contact?.name || deal.title}
                                                </p>
                                                <p className="text-sm text-muted-foreground truncate">
                                                    {deal.stage.name} • <span className="font-medium text-foreground">${deal.value.toLocaleString("es-MX")}</span>
                                                </p>
                                            </div>
                                            <div className="text-xs text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-lg whitespace-nowrap font-medium">
                                                Ahora
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Upcoming Appointments */}
                    <Card className="border border-border/60 shadow-premium rounded-xl">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-xl font-bold flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-primary" />
                                Próximas Citas
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {stats.upcomingAppointments.length === 0 ? (
                                <p className="text-base text-muted-foreground py-2">No tienes citas próximas.</p>
                            ) : (
                                <div className="space-y-3">
                                    {stats.upcomingAppointments.map((apt) => (
                                        <div key={apt.id} className="flex items-center gap-4 p-3 rounded-xl bg-muted/20 border border-border/40 hover:bg-muted/40 transition-colors">
                                            <div className="bg-primary/10 text-primary h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <span className="text-sm font-bold">
                                                    {new Date(apt.startTime).getDate()}
                                                </span>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-base font-semibold text-foreground truncate">
                                                    {apt.title}
                                                </p>
                                                <p className="text-sm text-muted-foreground mt-0.5">
                                                    {new Date(apt.startTime).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                                                    {apt.contact?.name ? ` • ${apt.contact.name}` : ""}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
