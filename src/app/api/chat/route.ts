// API route for chat operations - with robust error handling
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refreshWhatsAppAvatarForContactsInBackground } from "@/lib/whatsapp-avatar";

let lastAvatarRefreshKickAt = 0;

function shouldKickAvatarRefresh() {
    const now = Date.now();
    if (now - lastAvatarRefreshKickAt < 60_000) {
        return false;
    }
    lastAvatarRefreshKickAt = now;
    return true;
}

function formatPhone(phone: string | null | undefined) {
    if (!phone) return null;

    const cleaned = phone.replace(/\D/g, "");
    if (!cleaned) return null;

    if (cleaned.length === 12 && cleaned.startsWith("52")) {
        return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
    }

    if (cleaned.length === 10) {
        return `+52 ${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
    }

    return `+${cleaned}`;
}

function normalizeContactName(name?: string | null) {
    const normalized = name?.trim().replace(/\s+/g, " ") || "";
    if (!normalized) return null;

    if (/^(unknown|desconocido|sin nombre|null|undefined|n\/a|na)$/i.test(normalized)) {
        return null;
    }

    return normalized;
}

function getConversationContactName(contact: {
    name?: string | null;
    lastName?: string | null;
    phone?: string | null;
} | null | undefined) {
    const firstName = normalizeContactName(contact?.name);
    const lastName = normalizeContactName(contact?.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    if (fullName) return fullName;
    return formatPhone(contact?.phone) || "Contacto sin nombre";
}

// GET /api/chat - Get all conversations or messages for a specific conversation
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");

    const since = searchParams.get("since");

    try {
        if (conversationId) {
            // Get messages for a specific conversation
            const whereClause: any = { conversationId };
            if (since) {
                // Subtract 1 second to handle Postgres millisecond truncation race conditions
                const sinceDate = new Date(since);
                sinceDate.setSeconds(sinceDate.getSeconds() - 1);
                whereClause.createdAt = { gt: sinceDate };
            }

            const messages = await prisma.message.findMany({
                where: whereClause,
                orderBy: { createdAt: "desc" }, // Get newest first
                take: since ? undefined : 75, // Limit initial load to 75
            });
            // Reverse so they are chronological for UI
            return NextResponse.json(messages.reverse());
        } else {
            // Get all conversations with last message
            const conversations = await prisma.conversation.findMany({
                include: {
                    contact: {
                        include: {
                            deals: {
                                orderBy: { updatedAt: "desc" },
                                take: 1,
                                include: {
                                    stage: true,
                                    intelligence: true,
                                },
                            },
                        },
                    },
                    assignedUser: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true,
                        },
                    },
                    messages: {
                        where: {
                            type: {
                                not: "system",
                            },
                        },
                        orderBy: { createdAt: "desc" },
                        take: 1,
                    },
                },
                orderBy: { updatedAt: "desc" },
                take: 100, // Limit to 100 most recent conversations
            });

            // Transform for frontend
            const result = conversations.map((conv) => ({
                currentDeal: conv.contact?.deals?.[0]
                    ? {
                        id: conv.contact.deals[0].id,
                        stageName: conv.contact.deals[0].stage?.name || null,
                    }
                    : null,
                id: conv.id,
                contactId: conv.contact?.id || null,
                contactName: getConversationContactName(conv.contact),
                contactPhone: conv.contact?.phone,
                contactEmail: conv.contact?.email,
                contactCompany: conv.contact?.company,
                contactStatus: conv.contact?.status,
                contactAvatarUrl: conv.contact?.whatsappAvatarUrl || null,
                lastMessage: conv.messages[0]?.content || "",
                lastMessageTime: conv.messages[0]?.createdAt || conv.updatedAt,
                updatedAt: conv.updatedAt,
                lastMessageType: conv.messages[0]?.type || "text",
                lastMessageDirection: conv.messages[0]?.direction || "inbound",
                lastMessageSenderType: conv.messages[0]?.senderType || null,
                status: conv.status,
                isMuted: conv.isMuted,
                isFavorite: conv.isFavorite,
                isGroup: conv.isGroup,
                botActive: conv.botActive,
                assignedUserId: conv.assignedUserId,
                assignedUser: conv.assignedUser,
                leadIntelligence: conv.contact?.deals?.[0]?.intelligence
                    ? {
                        score: conv.contact.deals[0].intelligence.score,
                        interestStatus: conv.contact.deals[0].intelligence.interestStatus,
                        currentStep: conv.contact.deals[0].intelligence.currentStep,
                        stepProgress: conv.contact.deals[0].intelligence.stepProgress,
                        capturedName: conv.contact.deals[0].intelligence.capturedName,
                        capturedEmail: conv.contact.deals[0].intelligence.capturedEmail,
                        sameDayInboundCount: conv.contact.deals[0].intelligence.sameDayInboundCount,
                    }
                    : null,
            }));

            const contactIds = conversations
                .map((conv) => conv.contact?.id)
                .filter((id): id is string => Boolean(id))
                .slice(0, 20);
            if (shouldKickAvatarRefresh()) {
                refreshWhatsAppAvatarForContactsInBackground(contactIds, {
                    limit: 8,
                    concurrency: 2,
                });
            }

            return NextResponse.json(result);
        }
    } catch (error) {
        console.error("[API] Chat error:", error);
        return NextResponse.json([]);
    }
}
