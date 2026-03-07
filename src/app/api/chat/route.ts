// API route for chat operations - with robust error handling
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
                    contact: true,
                    messages: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                    },
                },
                orderBy: { updatedAt: "desc" },
                take: 100, // Limit to 100 most recent conversations
            });

            // Transform for frontend
            const result = conversations.map((conv) => ({
                id: conv.id,
                contactName: conv.contact?.name || "Unknown",
                contactPhone: conv.contact?.phone,
                contactEmail: conv.contact?.email,
                contactStatus: conv.contact?.status,
                lastMessage: conv.messages[0]?.content || "",
                lastMessageTime: conv.messages[0]?.createdAt || conv.updatedAt,
                lastMessageType: conv.messages[0]?.type || "text",
                lastMessageDirection: conv.messages[0]?.direction || "inbound",
                status: conv.status,
                isMuted: conv.isMuted,
                isFavorite: conv.isFavorite,
                isGroup: conv.isGroup,
                botActive: conv.botActive,
                sessionExpiresAt: conv.sessionExpiresAt,
            }));

            return NextResponse.json(result);
        }
    } catch (error) {
        console.error("[API] Chat error:", error);
        return NextResponse.json([]);
    }
}
