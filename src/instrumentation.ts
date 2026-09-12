export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    if (process.env.BULK_CAMPAIGN_WORKER_DISABLED !== "true") {
        const { startBulkCampaignWorker } = await import("@/lib/bulk-campaign-worker");
        startBulkCampaignWorker();
    }

    if (process.env.BOT_REPLY_WORKER_DISABLED !== "true") {
        const { startBotReplyWorker } = await import("@/lib/bot-reply-queue");
        startBotReplyWorker();
    }
}
