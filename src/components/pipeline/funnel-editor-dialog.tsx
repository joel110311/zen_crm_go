"use client";

import React, { useState, useTransition, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Lock, Loader2, GripVertical, AlertTriangle } from "lucide-react";
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors,
    closestCenter,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    createPipelineStage,
    updatePipelineStage,
    deletePipelineStage,
    reorderPipelineStages,
} from "@/app/actions/pipeline";
import type { PipelineStageData } from "./pipeline-board";

interface FunnelEditorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    stages: PipelineStageData[];
    onStagesChanged: () => void;
}

const STAGE_COLORS = [
    "#3B82F6", // Blue
    "#10B981", // Emerald
    "#F59E0B", // Amber
    "#EF4444", // Red
    "#8B5CF6", // Violet
    "#EC4899", // Pink
    "#6366F1", // Indigo
    "#14B8A6", // Teal
    "#F97316", // Orange
    "#64748B", // Slate
];

export function FunnelEditorDialog({
    open,
    onOpenChange,
    stages,
    onStagesChanged,
}: FunnelEditorDialogProps) {
    const [editingStages, setEditingStages] = useState<PipelineStageData[]>(stages);
    const [isPending, startTransition] = useTransition();
    const [showAddForm, setShowAddForm] = useState(false);
    const [newStageName, setNewStageName] = useState("");
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);

    // Sync when props change, but only if not dragging/editing locally to avoid jumps
    useEffect(() => {
        if (!activeId) {
            setEditingStages(stages);
        }
    }, [stages, activeId]);

    const isLocked = (stage: PipelineStageData) =>
        stage.isIncoming || stage.isClosedWon || stage.isClosedLost;

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (over && active.id !== over.id) {
            setEditingStages((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over.id);
                const newItems = arrayMove(items, oldIndex, newIndex);

                // Optimistic update -> Server sync
                startTransition(async () => {
                    await reorderPipelineStages(newItems.map((s) => s.id));
                    onStagesChanged();
                });

                return newItems;
            });
        }
    };

    const handleAddStage = () => {
        if (!newStageName.trim()) return;
        startTransition(async () => {
            const res = await createPipelineStage({
                name: newStageName,
                color: STAGE_COLORS[Math.floor(Math.random() * STAGE_COLORS.length)],
            });
            if (res.success) {
                setNewStageName("");
                setShowAddForm(false);
                onStagesChanged();
            }
        });
    };

    const handleRename = (id: string, name: string) => {
        if (!name.trim()) return;
        setEditingStages((prev) =>
            prev.map((s) => (s.id === id ? { ...s, name } : s))
        );
        startTransition(async () => {
            await updatePipelineStage(id, { name });
            onStagesChanged();
        });
    };

    const handleColorChange = (id: string, color: string) => {
        setEditingStages((prev) =>
            prev.map((s) => (s.id === id ? { ...s, color } : s))
        );
        startTransition(async () => {
            await updatePipelineStage(id, { color });
            onStagesChanged();
        });
    };

    const handleDelete = (id: string) => {
        startTransition(async () => {
            const res = await deletePipelineStage(id);
            if (res.success) {
                setDeleteConfirm(null);
                onStagesChanged();
            } else {
                alert("Error al eliminar etapa: " + res.error);
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[520px] max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        ✏️ Editar Embudo
                    </DialogTitle>
                    <DialogDescription>
                        Arrastra para reordenar. Agrega, renombra o elimina etapas.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 mt-2">
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={editingStages.map((s) => s.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {editingStages.map((stage) => (
                                <SortableStageItem
                                    key={stage.id}
                                    stage={stage}
                                    isLocked={isLocked(stage)}
                                    editingStages={editingStages}
                                    setEditingStages={setEditingStages}
                                    setDeleteConfirm={setDeleteConfirm}
                                    deleteConfirm={deleteConfirm}
                                    handleRename={handleRename}
                                    handleDelete={handleDelete}
                                    handleColorChange={handleColorChange}
                                    isPending={isPending}
                                />
                            ))}
                        </SortableContext>
                        <DragOverlay>
                            {activeId ? (
                                (() => {
                                    const stage = editingStages.find((s) => s.id === activeId);
                                    if (!stage) return null;
                                    return (
                                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border bg-white shadow-lg opacity-90">
                                            <GripVertical className="h-4 w-4 text-gray-400 cursor-grabbing" />
                                            <div
                                                className="h-4 w-4 rounded-full"
                                                style={{ backgroundColor: stage.color }}
                                            />
                                            <span className="text-sm font-medium">{stage.name}</span>
                                        </div>
                                    );
                                })()
                            ) : null}
                        </DragOverlay>
                    </DndContext>

                    {/* Add stage form */}
                    {showAddForm ? (
                        <div
                            className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-blue-300 bg-blue-50"
                        >
                            <Input
                                className="flex-1 h-8 text-sm"
                                placeholder="Nombre de la nueva etapa"
                                value={newStageName}
                                onChange={(e) => setNewStageName(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleAddStage();
                                    if (e.key === "Escape") setShowAddForm(false);
                                }}
                            />
                            <Button size="sm" onClick={handleAddStage} disabled={isPending}>
                                Guardar
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowAddForm(false)}
                            >
                                Cancelar
                            </Button>
                        </div>
                    ) : (
                        <Button
                            variant="outline"
                            className="w-full border-dashed text-muted-foreground"
                            onClick={() => setShowAddForm(true)}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Agregar nueva etapa
                        </Button>
                    )}
                </div>

                <div
                    className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md text-xs"
                    style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}
                >
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    Al eliminar una etapa, sus leads se mueven a "Nuevo Lead".
                </div>
            </DialogContent>
        </Dialog>
    );
}

// Sub-component for sortable item
function SortableStageItem({
    stage,
    isLocked,
    setDeleteConfirm,
    deleteConfirm,
    handleRename,
    handleDelete,
    handleColorChange,
    isPending,
}: {
    stage: PipelineStageData;
    isLocked: boolean;
    editingStages: PipelineStageData[];
    setEditingStages: React.Dispatch<React.SetStateAction<PipelineStageData[]>>;
    setDeleteConfirm: (id: string | null) => void;
    deleteConfirm: string | null;
    handleRename: (id: string, name: string) => void;
    handleDelete: (id: string) => void;
    handleColorChange: (id: string, color: string) => void;
    isPending: boolean;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: stage.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        border: "1px solid #E2E8F0",
        backgroundColor: "#FFFFFF",
        position: "relative" as const,
        zIndex: isDragging ? 999 : "auto",
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg mb-2"
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab hover:text-gray-600 text-gray-400 p-1"
            >
                <GripVertical className="h-4 w-4" />
            </div>

            {/* Color dot */}
            <div className="relative group">
                <div
                    className="h-4 w-4 rounded-full cursor-pointer flex-shrink-0 transition-transform hover:scale-110"
                    style={{ backgroundColor: stage.color }}
                    title={isLocked ? "Color fijo" : "Cambiar color"}
                />
                {!isLocked && (
                    <div
                        className="absolute left-0 top-6 z-50 hidden group-hover:flex flex-wrap gap-1 p-2 bg-white rounded-lg shadow-xl border"
                        style={{ width: "150px" }}
                    >
                        {STAGE_COLORS.map((c) => (
                            <button
                                key={c}
                                className="h-5 w-5 rounded-full transition-transform hover:scale-125"
                                style={{
                                    backgroundColor: c,
                                    border:
                                        c === stage.color
                                            ? "2px solid #0F172A"
                                            : "1px solid #E2E8F0",
                                }}
                                onClick={() => handleColorChange(stage.id, c)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Stage name */}
            {isLocked ? (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Lock className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#94A3B8" }} />
                    <span
                        className="text-sm font-medium truncate"
                        style={{ color: "#64748B" }}
                    >
                        {stage.name}
                    </span>
                    <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: "#F1F5F9", color: "#94A3B8" }}
                    >
                        {stage.isIncoming
                            ? "Fija"
                            : stage.isClosedWon
                                ? "Ganado"
                                : "Perdido"}
                    </span>
                </div>
            ) : (
                <Input
                    className="flex-1 h-8 text-sm"
                    defaultValue={stage.name}
                    onBlur={(e) => {
                        if (e.target.value !== stage.name) {
                            handleRename(stage.id, e.target.value);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                />
            )}

            {/* Delete button */}
            {!isLocked && (
                <div>
                    {deleteConfirm === stage.id ? (
                        <div className="flex items-center gap-1">
                            <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs"
                                onClick={() => handleDelete(stage.id)}
                                disabled={isPending}
                            >
                                Eliminar
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => setDeleteConfirm(null)}
                            >
                                No
                            </Button>
                        </div>
                    ) : (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setDeleteConfirm(stage.id)}
                            disabled={isPending}
                        >
                            <Trash2 className="h-3.5 w-3.5" style={{ color: "#DC2626" }} />
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
