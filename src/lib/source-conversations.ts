import { prisma } from "@/lib/db";
import type { MessageSourceType } from "@/lib/message-source";

export async function findOrCreateActiveConversationForContactSource(params: {
    contactId: string;
    sourceType: MessageSourceType;
    sourceId?: string | null;
    defaults?: {
        assignedUserId?: string | null;
        botActive?: boolean;
        sessionExpiresAt?: Date | null;
    };
}) {
    const sourceId = params.sourceId?.trim() || null;

    const existingConversation = await prisma.conversation.findFirst({
        where: {
            contactId: params.contactId,
            status: "active",
            sourceType: params.sourceType,
            sourceId,
        },
        orderBy: { updatedAt: "desc" },
    });

    if (existingConversation) {
        return existingConversation;
    }

    return prisma.conversation.create({
        data: {
            contactId: params.contactId,
            status: "active",
            sourceType: params.sourceType,
            sourceId,
            assignedUserId: params.defaults?.assignedUserId || undefined,
            botActive: params.defaults?.botActive ?? true,
            sessionExpiresAt: params.defaults?.sessionExpiresAt || undefined,
        },
    });
}
