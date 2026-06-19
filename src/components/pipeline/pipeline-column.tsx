"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DealCard } from "./deal-card";
import type { PipelineStageData, DealData } from "./pipeline-board";
import { Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PipelineColumnProps {
    stage: PipelineStageData;
    deals: DealData[];
    onDealClick: (deal: DealData) => void;
    activeDealId: string | null;
    totalCount: number;
    totalValue: number;
    isLoadingMore: boolean;
    onLoadMore: () => void;
}

const isClosed = (stage: PipelineStageData) => stage.isClosedWon || stage.isClosedLost;

export function PipelineColumn({
    stage,
    deals,
    onDealClick,
    activeDealId,
    totalCount,
    totalValue,
    isLoadingMore,
    onLoadMore,
}: PipelineColumnProps) {
    const { isOver, setNodeRef } = useDroppable({
        id: stage.id,
    });

    const hasMore = deals.length < totalCount;

    // Check if the active deal is currently in this column (dragged here via handleDragOver)
    const hasActiveDeal = activeDealId ? deals.some((d) => d.id === activeDealId) : false;

    return (
        <div
            ref={setNodeRef}
            className={`flex h-full min-w-[208px] w-[208px] flex-col rounded-2xl border transition-all duration-200 md:w-[224px] md:min-w-[224px] 2xl:w-[256px] 2xl:min-w-[256px] ${isOver
                ? "border-dashed border-primary/45 ring-2 ring-primary/20 bg-accent/55"
                : hasActiveDeal
                    ? "border-border/80 bg-card shadow-soft ring-1 ring-primary/20"
                    : "border-border/80 bg-card shadow-soft"
                }`}
            style={{
                borderColor: isOver ? stage.color : undefined,
            }}
        >
            {/* Column Header */}
            <div
                className="rounded-t-2xl border-b border-border/75 bg-card px-4 py-3"
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div
                            className="h-3 w-3 rounded-full flex-shrink-0"
                            style={{
                                backgroundColor: stage.color,
                                boxShadow: `0 0 6px ${stage.color}40`,
                            }}
                        />
                        <h3
                            className="font-semibold text-sm truncate text-foreground"
                            style={{ maxWidth: "112px" }}
                        >
                            {stage.name}
                        </h3>
                        <span
                            className="flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={{
                                backgroundColor: `${stage.color}15`,
                                color: stage.color,
                            }}
                        >
                            {totalCount}
                        </span>
                    </div>
                    {stage.isIncoming && (
                        <div className="flex items-center gap-1 text-xs text-primary font-medium">
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span>Auto</span>
                        </div>
                    )}
                </div>
                {/* Kommo-style summary */}
                <p className="text-xs mt-1 text-muted-foreground">
                    {isClosed(stage)
                        ? `${totalCount} ${totalCount === 1 ? "Lead cerrado" : "Leads cerrados"}`
                        : `${totalCount} ${totalCount === 1 ? "Cliente potencial" : "Clientes potenciales"}: $${totalValue.toLocaleString("es-MX")}`
                    }
                </p>
            </div>

            {/* Cards Area */}
            <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3" style={{ minHeight: "100px" }}>
                    {deals.length === 0 && isOver && (
                        /* Empty column drop placeholder */
                        <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 h-[72px] flex items-center justify-center">
                            <span className="text-xs text-primary/50 font-medium">Soltar aquí</span>
                        </div>
                    )}
                    {deals.map((deal) => (
                        <DealCard
                            key={deal.id}
                            deal={deal}
                            onDealClick={onDealClick}
                        />
                    ))}
                    {hasMore ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 w-full rounded-xl border-dashed text-xs"
                            onClick={onLoadMore}
                            disabled={isLoadingMore}
                        >
                            {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {isLoadingMore
                                ? "Cargando..."
                                : `Cargar mas (${totalCount - deals.length})`}
                        </Button>
                    ) : totalCount > 0 ? (
                        <p className="py-1 text-center text-[10px] text-muted-foreground/70">
                            Todos los leads cargados
                        </p>
                    ) : null}
                </div>
            </SortableContext>
        </div>
    );
}
