"use client";

import React, { useState, useCallback, useTransition, useEffect, useRef } from "react";
import {
    DndContext,
    DragEndEvent,
    DragOverEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors,
    pointerWithin,
    closestCenter,
    CollisionDetection,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { PipelineColumn } from "./pipeline-column";
import { DealCard } from "./deal-card";
import { DealDetailPanel } from "./deal-detail-panel";
import { NewLeadDialog } from "./new-lead-dialog";
import { StageAutomationDialog } from "./stage-automation-dialog";
import { FunnelEditorDialog } from "./funnel-editor-dialog";
import { getPipelineData, getPipelineStageDeals, moveDealToStage } from "@/app/actions/pipeline";
import { MoreHorizontal, Zap, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface PipelineStageData {
    id: string;
    name: string;
    color: string;
    order: number;
    isIncoming: boolean;
    isClosedWon: boolean;
    isClosedLost: boolean;
}

export interface DealData {
    id: string;
    title: string;
    value: number;
    stageId: string;
    source: string;
    notes: string | null;
    priority: string;
    contactId: string | null;
    assignedTo: string | null;
    createdAt: string;
    updatedAt: string;
    contact: {
        id: string;
        phone: string;
        name: string | null;
        lastName: string | null;
        email: string | null;
        company: string | null;
    } | null;
    stage: PipelineStageData;
    lastMessage: string | null;
    dealTags: {
        id: string;
        tag: { id: string; name: string; color: string };
    }[];
    intelligence?: {
        id?: string;
        score: number;
        interestStatus: string;
        currentStep: string;
        stepProgress: number;
        capturedName: string | null;
        capturedEmail: string | null;
        sameDayInboundCount: number;
    } | null;
}

interface PipelineBoardProps {
    initialStages: PipelineStageData[];
    initialDeals: DealData[];
    initialStageStats: PipelineStageStats;
    initialSummary: PipelineSummary;
}

type PipelineStageStats = Record<string, { totalCount: number; totalValue: number }>;

interface PipelineSummary {
    totalCount: number;
    totalValue: number;
}

type DealDataFromServer = Omit<DealData, "createdAt" | "updatedAt"> & {
    createdAt: string | Date;
    updatedAt: string | Date;
};

// Custom collision: use pointer position first, fall back to closest center
const customCollision: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return closestCenter(args);
};

export function PipelineBoard({
    initialStages,
    initialDeals,
    initialStageStats,
    initialSummary,
}: PipelineBoardProps) {
    const [stages, setStages] = useState<PipelineStageData[]>(initialStages);
    const [deals, setDeals] = useState<DealData[]>(initialDeals);
    const [stageStats, setStageStats] = useState<PipelineStageStats>(initialStageStats);
    const [summary, setSummary] = useState<PipelineSummary>(initialSummary);
    const [loadingStageIds, setLoadingStageIds] = useState<Set<string>>(new Set());
    const [activeDeal, setActiveDeal] = useState<DealData | null>(null);
    const [selectedDeal, setSelectedDeal] = useState<DealData | null>(null);
    const [, startTransition] = useTransition();

    // Dialog states
    const [showAutomationDialog, setShowAutomationDialog] = useState(false);
    const [showFunnelEditor, setShowFunnelEditor] = useState(false);

    // --- DnD stability refs ---
    const isDraggingRef = useRef(false);
    const skipNextPollRef = useRef(false);
    const originalStageIdRef = useRef<string | null>(null);
    const dealsRef = useRef(deals);
    const stagesRef = useRef(stages);

    useEffect(() => {
        dealsRef.current = deals;
    }, [deals]);

    useEffect(() => {
        stagesRef.current = stages;
    }, [stages]);

    const mapServerDeals = useCallback((serverDeals: DealDataFromServer[]) => (
        serverDeals.map((deal) => ({
            ...deal,
            createdAt: typeof deal.createdAt === "string" ? deal.createdAt : deal.createdAt.toISOString(),
            updatedAt: typeof deal.updatedAt === "string" ? deal.updatedAt : deal.updatedAt.toISOString(),
        })) as DealData[]
    ), []);

    // Refresh pipeline data from server
    const refreshPipelineData = useCallback(() => {
        // Skip refresh while dragging or right after a drop
        if (isDraggingRef.current) return;
        if (skipNextPollRef.current) {
            skipNextPollRef.current = false;
            return;
        }

        startTransition(async () => {
            const stageLimits = Object.fromEntries(stagesRef.current.map((stage) => [
                stage.id,
                Math.max(20, dealsRef.current.filter((deal) => deal.stageId === stage.id).length),
            ]));
            const data = await getPipelineData(stageLimits);
            // Double-check we're not mid-drag when the async response arrives
            if (isDraggingRef.current) return;

            if (data.stages) {
                setStages(data.stages as PipelineStageData[]);
            }
            if (data.deals) {
                const mappedDeals = mapServerDeals(data.deals as DealDataFromServer[]);
                setDeals(mappedDeals);
                setSelectedDeal((prev) => prev ? mappedDeals.find((deal) => deal.id === prev.id) || prev : prev);
            }
            setStageStats(data.stageStats);
            setSummary(data.summary);
        });
    }, [mapServerDeals]);

    // Keep the board fresh without repeatedly transferring every deal.
    useEffect(() => {
        const interval = setInterval(() => {
            refreshPipelineData();
        }, 10000);

        return () => clearInterval(interval);
    }, [refreshPipelineData]);

    const handleLoadMoreStage = useCallback(async (stageId: string) => {
        if (loadingStageIds.has(stageId)) return;

        setLoadingStageIds((current) => new Set(current).add(stageId));
        try {
            const loadedDealIds = dealsRef.current
                .filter((deal) => deal.stageId === stageId)
                .map((deal) => deal.id);
            const result = await getPipelineStageDeals(stageId, loadedDealIds, 20);

            if (!result.success) return;

            const incomingDeals = mapServerDeals(result.deals as DealDataFromServer[]);
            setDeals((current) => {
                const byId = new Map(current.map((deal) => [deal.id, deal]));
                for (const deal of incomingDeals) byId.set(deal.id, deal);
                return Array.from(byId.values());
            });
            setStageStats((current) => ({
                ...current,
                [stageId]: {
                    totalCount: result.totalCount,
                    totalValue: result.totalValue,
                },
            }));
        } finally {
            setLoadingStageIds((current) => {
                const next = new Set(current);
                next.delete(stageId);
                return next;
            });
        }
    }, [loadingStageIds, mapServerDeals]);

    const isActiveStage = useCallback((stageId: string) => {
        const stage = stagesRef.current.find((item) => item.id === stageId);
        return Boolean(stage && !stage.isClosedWon && !stage.isClosedLost);
    }, []);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const handleDragStart = useCallback((event: DragStartEvent) => {
        const deal = dealsRef.current.find((d) => d.id === event.active.id);
        if (deal) {
            isDraggingRef.current = true;
            originalStageIdRef.current = deal.stageId;
            setActiveDeal(deal);
        }
    }, []);

    // Helper to find which stage a sortable ID belongs to
    const findStageId = useCallback(
        (id: string): string | undefined => {
            // Is it a stage directly?
            if (stages.find((s) => s.id === id)) return id;
            // Is it a deal? Return its stageId from the ref (always fresh)
            const deal = dealsRef.current.find((d) => d.id === id);
            return deal?.stageId;
        },
        [stages]
    );

    // Handle drag over for cross-column movement (live preview)
    const handleDragOver = useCallback(
        (event: DragOverEvent) => {
            const { active, over } = event;
            if (!over) return;

            const activeId = active.id as string;
            const overId = over.id as string;

            const activeStageId = findStageId(activeId);
            const overStageId = findStageId(overId);

            if (!activeStageId || !overStageId || activeStageId === overStageId) return;

            // Move deal to new column (optimistic, live during drag)
            setDeals((prev) => {
                const activeIndex = prev.findIndex((d) => d.id === activeId);
                if (activeIndex === -1) return prev;

                const updated = [...prev];
                updated[activeIndex] = { ...updated[activeIndex], stageId: overStageId };

                // If dropped on a deal, insert near it
                const overDealIndex = updated.findIndex((d) => d.id === overId);
                if (overDealIndex !== -1 && overDealIndex !== activeIndex) {
                    const [item] = updated.splice(activeIndex, 1);
                    const newOverIndex = updated.findIndex((d) => d.id === overId);
                    updated.splice(newOverIndex, 0, item);
                }

                return updated;
            });
        },
        [findStageId]
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;

            // Always clear drag state
            isDraggingRef.current = false;
            setActiveDeal(null);

            if (!over) {
                // Dropped outside — revert to original stage
                const origStageId = originalStageIdRef.current;
                if (origStageId) {
                    setDeals((prev) =>
                        prev.map((d) =>
                            d.id === (active.id as string) ? { ...d, stageId: origStageId } : d
                        )
                    );
                }
                originalStageIdRef.current = null;
                return;
            }

            const activeId = active.id as string;
            const overId = over.id as string;

            // Use ref to get CURRENT stageId (handleDragOver already updated it)
            const currentStageId = dealsRef.current.find((d) => d.id === activeId)?.stageId;
            const overStageId = findStageId(overId);
            const origStageId = originalStageIdRef.current;
            originalStageIdRef.current = null;

            if (!currentStageId || !overStageId) return;

            if (activeId === overId && currentStageId === origStageId) {
                // No movement at all
                return;
            }

            if (currentStageId === overStageId && origStageId === overStageId) {
                // Same column reorder
                setDeals((prev) => {
                    const stageDeals = prev.filter((d) => d.stageId === currentStageId);
                    const otherDeals = prev.filter((d) => d.stageId !== currentStageId);
                    const oldIndex = stageDeals.findIndex((d) => d.id === activeId);
                    const newIndex = stageDeals.findIndex((d) => d.id === overId);
                    if (oldIndex === -1 || newIndex === -1) return prev;
                    const reordered = arrayMove(stageDeals, oldIndex, newIndex);
                    return [...otherDeals, ...reordered];
                });
            } else {
                // Cross-column move — state is already updated by handleDragOver
                // Skip next poll to prevent stale server data from reverting
                skipNextPollRef.current = true;

                // Server update
                startTransition(async () => {
                    const targetStage = overStageId;
                    const movedDeal = dealsRef.current.find((deal) => deal.id === activeId);
                    const result = await moveDealToStage(activeId, targetStage);
                    if (!result.success) {
                        // Revert on failure using the stable ref
                        if (origStageId) {
                            setDeals((prev) =>
                                prev.map((d) =>
                                    d.id === activeId ? { ...d, stageId: origStageId } : d
                                )
                            );
                        }
                    } else if (origStageId && origStageId !== targetStage && movedDeal) {
                        setStageStats((current) => ({
                            ...current,
                            [origStageId]: {
                                totalCount: Math.max(0, (current[origStageId]?.totalCount || 0) - 1),
                                totalValue: Math.max(0, (current[origStageId]?.totalValue || 0) - movedDeal.value),
                            },
                            [targetStage]: {
                                totalCount: (current[targetStage]?.totalCount || 0) + 1,
                                totalValue: (current[targetStage]?.totalValue || 0) + movedDeal.value,
                            },
                        }));

                        const sourceIsActive = isActiveStage(origStageId);
                        const targetIsActive = isActiveStage(targetStage);
                        if (sourceIsActive !== targetIsActive) {
                            setSummary((current) => ({
                                totalCount: Math.max(0, current.totalCount + (targetIsActive ? 1 : -1)),
                                totalValue: Math.max(0, current.totalValue + (targetIsActive ? movedDeal.value : -movedDeal.value)),
                            }));
                        }
                    }
                });
            }
        },
        [findStageId, isActiveStage]
    );

    const handleDealClick = useCallback((deal: DealData) => {
        setSelectedDeal(deal);
    }, []);

    const handleDealUpdate = useCallback((updatedDeal: DealData) => {
        const previousDeal = dealsRef.current.find((deal) => deal.id === updatedDeal.id);
        setDeals((prev) =>
            prev.map((d) => (d.id === updatedDeal.id ? updatedDeal : d))
        );
        setSelectedDeal(updatedDeal);
        if (previousDeal) {
            const valueDifference = updatedDeal.value - previousDeal.value;
            if (valueDifference !== 0) {
                setStageStats((current) => ({
                    ...current,
                    [updatedDeal.stageId]: {
                        totalCount: current[updatedDeal.stageId]?.totalCount || 0,
                        totalValue: Math.max(0, (current[updatedDeal.stageId]?.totalValue || 0) + valueDifference),
                    },
                }));
                if (isActiveStage(updatedDeal.stageId)) {
                    setSummary((current) => ({
                        ...current,
                        totalValue: Math.max(0, current.totalValue + valueDifference),
                    }));
                }
            }
        }
    }, [isActiveStage]);

    const handleDealRemove = useCallback((dealId: string) => {
        const removedDeal = dealsRef.current.find((deal) => deal.id === dealId);
        setDeals((prev) => prev.filter((d) => d.id !== dealId));
        if (selectedDeal?.id === dealId) {
            setSelectedDeal(null);
        }
        if (removedDeal) {
            setStageStats((current) => ({
                ...current,
                [removedDeal.stageId]: {
                    totalCount: Math.max(0, (current[removedDeal.stageId]?.totalCount || 0) - 1),
                    totalValue: Math.max(0, (current[removedDeal.stageId]?.totalValue || 0) - removedDeal.value),
                },
            }));
            if (isActiveStage(removedDeal.stageId)) {
                setSummary((current) => ({
                    totalCount: Math.max(0, current.totalCount - 1),
                    totalValue: Math.max(0, current.totalValue - removedDeal.value),
                }));
            }
        }
    }, [isActiveStage, selectedDeal]);

    const activeDealId = activeDeal?.id ?? null;

    return (
        <div className="flex flex-col h-full gap-3 md:gap-4">
            <div className="surface-panel flex items-center justify-between px-4 py-3 md:px-5">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                        Pipeline
                    </h1>
                    <p className="text-sm mt-1 text-muted-foreground">
                        Gestión visual de leads y oportunidades
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Global summary bar — excludes closed stages */}
                    <span className="text-sm font-medium text-foreground">
                        {summary.totalCount} leads: ${summary.totalValue.toLocaleString("es-MX")}
                    </span>

                    {/* ⋯ Three-dot menu */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 rounded-full border-border/80"
                            >
                                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                                onClick={() => setShowAutomationDialog(true)}
                                className="cursor-pointer"
                            >
                                <Zap className="h-4 w-4 mr-2 text-amber-500" />
                                Automatización
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => setShowFunnelEditor(true)}
                                className="cursor-pointer"
                            >
                                <Settings2 className="h-4 w-4 mr-2 text-muted-foreground" />
                                Editar embudo
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <NewLeadDialog stages={stages} />
                </div>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={customCollision}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div className="flex-1 overflow-x-auto">
                    <div className="flex h-full min-w-max gap-4 pb-4">
                        {stages.map((stage) => {
                            const stageDeals = deals.filter((d) => d.stageId === stage.id);
                            const stats = stageStats[stage.id] || {
                                totalCount: stageDeals.length,
                                totalValue: stageDeals.reduce((total, deal) => total + deal.value, 0),
                            };
                            return (
                                <PipelineColumn
                                    key={stage.id}
                                    stage={stage}
                                    deals={stageDeals}
                                    onDealClick={handleDealClick}
                                    activeDealId={activeDealId}
                                    totalCount={stats.totalCount}
                                    totalValue={stats.totalValue}
                                    isLoadingMore={loadingStageIds.has(stage.id)}
                                    onLoadMore={() => void handleLoadMoreStage(stage.id)}
                                />
                            );
                        })}
                    </div>
                </div>

                <DragOverlay dropAnimation={null}>
                    {activeDeal ? (
                        <DealCard
                            deal={activeDeal}
                            isOverlay
                            onDealClick={() => { }}
                        />
                    ) : null}
                </DragOverlay>
            </DndContext>

            {selectedDeal && (
                <DealDetailPanel
                    deal={selectedDeal}
                    onClose={() => setSelectedDeal(null)}
                    onUpdate={handleDealUpdate}
                    onDelete={handleDealRemove}
                />
            )}

            {/* Dialogs */}
            <StageAutomationDialog
                open={showAutomationDialog}
                onOpenChange={setShowAutomationDialog}
                stages={stages}
            />
            <FunnelEditorDialog
                open={showFunnelEditor}
                onOpenChange={setShowFunnelEditor}
                stages={stages}
                onStagesChanged={refreshPipelineData}
            />
        </div>
    );
}
