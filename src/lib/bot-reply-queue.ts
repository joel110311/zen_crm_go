import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const BOT_REPLY_QUEUE_NAME = "zen-crm-bot-replies";

type BotReplyJob = {
    conversationId: string;
};

type BotReplyQueueGlobals = {
    queue?: Queue<BotReplyJob>;
    queueConnection?: IORedis;
    worker?: Worker<BotReplyJob>;
    workerConnection?: IORedis;
    warnedMissingRedis?: boolean;
    localBatches?: Map<string, ReturnType<typeof setTimeout>>;
    localProcessing?: Set<string>;
};

const globalForBotReplies = globalThis as typeof globalThis & {
    __zenBotReplyQueue?: BotReplyQueueGlobals;
};

function globals() {
    globalForBotReplies.__zenBotReplyQueue ??= {};
    return globalForBotReplies.__zenBotReplyQueue;
}

function getRedisUrl() {
    return process.env.REDIS_URL?.trim() || "";
}

function createRedisConnection(forWorker = false) {
    return new IORedis(getRedisUrl(), {
        maxRetriesPerRequest: forWorker ? null : 1,
        enableReadyCheck: false,
        enableOfflineQueue: forWorker,
        connectTimeout: 2000,
    });
}

function scheduleLocalBatch(conversationId: string, delay: number) {
    const state = globals();
    state.localBatches ??= new Map();
    const currentTimer = state.localBatches.get(conversationId);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(async () => {
        state.localBatches?.delete(conversationId);
        state.localProcessing ??= new Set();
        if (state.localProcessing.has(conversationId)) {
            scheduleLocalBatch(conversationId, 1000);
            return;
        }
        state.localProcessing.add(conversationId);
        try {
            const { processQueuedInboundBatch } = await import("@/app/actions/chat");
            await processQueuedInboundBatch(conversationId, `local-${Date.now()}`);
        } catch (error) {
            console.error("[Bot Batch] Local fallback failed:", error);
        } finally {
            state.localProcessing.delete(conversationId);
        }
    }, delay);
    state.localBatches.set(conversationId, timer);
}

function getQueue() {
    const state = globals();
    if (!state.queue) {
        state.queueConnection = createRedisConnection();
        state.queue = new Queue<BotReplyJob>(BOT_REPLY_QUEUE_NAME, {
            connection: state.queueConnection,
            defaultJobOptions: {
                attempts: 8,
                backoff: { type: "exponential", delay: 1000 },
                removeOnComplete: 500,
                removeOnFail: 1000,
            },
        });
        state.queue.on("error", (error) => {
            console.error("[Bot Batch] Redis queue error:", error.message);
        });
    }
    return state.queue;
}

export function isBotReplyQueueConfigured() {
    return Boolean(getRedisUrl());
}

export async function enqueueBotReplyBatch(params: {
    conversationId: string;
    windowMs: number;
    maxWaitMs: number;
    firstPendingAt: Date;
    deduplicationId?: string;
}) {
    const now = Date.now();
    const windowMs = Math.max(1000, Math.min(30000, Math.round(params.windowMs)));
    const maxWaitMs = Math.max(windowMs, Math.min(120000, Math.round(params.maxWaitMs)));
    const remainingUntilMaximum = Math.max(0, params.firstPendingAt.getTime() + maxWaitMs - now);
    const delay = Math.min(windowMs, remainingUntilMaximum);

    if (!isBotReplyQueueConfigured()) {
        const state = globals();
        if (!state.warnedMissingRedis) {
            state.warnedMissingRedis = true;
            console.warn("[Bot Batch] REDIS_URL is not configured; using the local fallback.");
        }
        scheduleLocalBatch(params.conversationId, delay);
        return true;
    }

    try {
        await getQueue().add(
            "reply",
            { conversationId: params.conversationId },
            {
                delay,
                deduplication: {
                    id: params.deduplicationId || params.conversationId,
                    ttl: Math.max(1000, delay),
                    extend: true,
                    replace: true,
                },
            },
        );
    } catch (error) {
        console.error("[Bot Batch] Could not enqueue in Redis; using local fallback:", error);
        scheduleLocalBatch(params.conversationId, delay);
    }
    return true;
}

export function startBotReplyWorker() {
    if (!isBotReplyQueueConfigured()) return null;

    const state = globals();
    if (state.worker) return state.worker;

    state.workerConnection = createRedisConnection(true);
    state.worker = new Worker<BotReplyJob>(
        BOT_REPLY_QUEUE_NAME,
        async (job) => {
            const lockKey = `zen-crm:bot-reply-lock:${job.data.conversationId}`;
            const lockValue = `${job.id || "job"}:${Date.now()}`;
            const acquired = await state.workerConnection!.set(lockKey, lockValue, "PX", 120000, "NX");
            if (acquired !== "OK") {
                throw new Error("Conversation batch is already being processed.");
            }
            try {
                const { processQueuedInboundBatch } = await import("@/app/actions/chat");
                await processQueuedInboundBatch(job.data.conversationId, String(job.id || "bot-batch"));
            } finally {
                await state.workerConnection!.eval(
                    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                    1,
                    lockKey,
                    lockValue,
                );
            }
        },
        {
            connection: state.workerConnection,
            concurrency: 4,
        },
    );
    state.worker.on("failed", (job, error) => {
        console.error("[Bot Batch] Worker job failed", {
            jobId: job?.id,
            conversationId: job?.data.conversationId,
            error: error.message,
        });
    });
    state.worker.on("error", (error) => {
        console.error("[Bot Batch] Redis worker error:", error);
    });
    console.log("[Bot Batch] Redis worker started.");
    void import("@/app/actions/chat")
        .then(async ({ recoverPendingInboundBatches }) => {
            const recovered = await recoverPendingInboundBatches();
            if (recovered > 0) {
                console.log(`[Bot Batch] Recovered ${recovered} pending conversation batches.`);
            }
        })
        .catch((error) => {
            console.error("[Bot Batch] Pending batch recovery failed:", error);
        });
    return state.worker;
}
