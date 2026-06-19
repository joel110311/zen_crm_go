import {
    PipelineBoard,
    type DealData,
    type PipelineStageData,
} from "@/components/pipeline/pipeline-board";
import { getPipelineData } from "@/app/actions/pipeline";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
    let stages: PipelineStageData[] = [];
    let deals: DealData[] = [];
    let stageStats: Record<string, { totalCount: number; totalValue: number }> = {};
    let summary = { totalCount: 0, totalValue: 0 };

    try {
        const data = await getPipelineData();
        stages = data.stages;
        stageStats = data.stageStats;
        summary = data.summary;
        deals = data.deals.map((d) => ({
            ...d,
            createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : String(d.createdAt),
            updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : String(d.updatedAt),
        })) as DealData[];
    } catch (error) {
        console.warn("Failed to fetch pipeline data (likely during build):", error);
    }

    return (
        <PipelineBoard
            initialStages={stages}
            initialDeals={deals}
            initialStageStats={stageStats}
            initialSummary={summary}
        />
    );
}
