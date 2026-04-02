"use client";

import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Phone } from "lucide-react";
import type { DealData } from "./pipeline-board";

interface DealCardProps {
    deal: DealData;
    onDealClick: (deal: DealData) => void;
    isOverlay?: boolean;
}

export function DealCard({ deal, onDealClick, isOverlay }: DealCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: deal.id,
        disabled: isOverlay,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    const contactName = [deal.contact?.name, deal.contact?.lastName]
        .filter(Boolean)
        .join(" ") || "Sin nombre";
    const contactPhone = deal.contact?.phone || "";
    const messagePreview = deal.lastMessage?.trim() || "";
    const tags = deal.dealTags?.map((dt) => dt.tag) || [];

    // When this card is being dragged, show a dashed placeholder in its original spot
    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 h-[72px]"
            />
        );
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className="cursor-pointer group"
            suppressHydrationWarning
            onClick={() => onDealClick(deal)}
        >
            <div
                className={`h-[108px] overflow-hidden rounded-xl border border-border/75 bg-card px-3 py-2.5 transition-all duration-150 ${isOverlay ? "scale-105 rotate-[2deg] shadow-soft-hover" : "shadow-soft group-hover:border-primary/35 group-hover:shadow-soft-hover"
                    }`}
            >
                {/* Contact row: avatar + name/phone + value */}
                <div className="flex items-center gap-2">
                    <div
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary"
                    >
                        {contactName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold leading-tight text-foreground">
                            {contactName}
                        </p>
                        {contactPhone && (
                            <p className="truncate text-xs leading-tight text-muted-foreground">
                                <Phone className="h-2.5 w-2.5 inline mr-0.5" />
                                +{contactPhone}
                            </p>
                        )}
                    </div>
                    {deal.value > 0 && (
                        <span
                            className="text-sm font-bold flex-shrink-0 text-foreground"
                        >
                            ${deal.value.toLocaleString("es-MX")}
                        </span>
                    )}
                </div>

                {/* Message preview */}
                <p
                    className="text-xs mt-1.5 leading-snug text-muted-foreground truncate whitespace-nowrap"
                    title={messagePreview || undefined}
                >
                    {messagePreview || "\u00A0"}
                </p>

                {/* Tags */}
                {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {tags.map((tag) => (
                            <span
                                key={tag.id}
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{
                                    backgroundColor: tag.color + "15",
                                    color: tag.color,
                                    border: `1px solid ${tag.color}30`,
                                }}
                            >
                                {tag.name}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
