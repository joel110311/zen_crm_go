"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { sendWhatsAppMessage } from "@/lib/ycloud";
import { enrichContactFromMessage } from "@/lib/ai-enrichment";

export async function getConversations() {
    try {
        const conversations = await prisma.conversation.findMany({
            include: {
                contact: true,
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
            orderBy: { updatedAt: "desc" },
        });
        return conversations;
    } catch (error) {
        console.error("Failed to fetch conversations:", error);
        return [];
    }
}

export async function getMessages(conversationId: string) {
    try {
        const messages = await prisma.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: "asc" },
        });
        return messages;
    } catch (error) {
        console.error("Failed to fetch messages:", error);
        return [];
    }
}

export async function sendMessage(conversationId: string, content: string, direction: "inbound" | "outbound" = "outbound") {
    console.log("!!! [SendMessage] FUNCTION CALLED !!!", { conversationId, content, direction });
    try {
        // Get conversation with contact to get phone number
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true },
        });

        if (!conversation) {
            throw new Error("Conversation not found");
        }

        // Create message in database first
        const message = await prisma.message.create({
            data: {
                conversationId,
                content,
                direction,
                status: "sending",
                type: "text",
            },
        });

        console.log("[SendMessage] Created message:", message.id);
        console.log("[SendMessage] Direction:", direction);
        console.log("[SendMessage] Contact phone:", conversation.contact?.phone);

        // If outbound, send via YCloud WhatsApp API
        if (direction === "outbound" && conversation.contact?.phone) {
            console.log("[SendMessage] Attempting to send via YCloud...");
            try {
                const result = await sendWhatsAppMessage(conversation.contact.phone, content);
                console.log("[SendMessage] YCloud result:", result);

                // Update message status to sent
                await prisma.message.update({
                    where: { id: message.id },
                    data: { status: result.success ? "sent" : "failed" },
                });
            } catch (whatsappError) {
                console.error("[SendMessage] WhatsApp send error:", whatsappError);
                // Update message status to failed
                await prisma.message.update({
                    where: { id: message.id },
                    data: { status: "failed" },
                });
            }
        } else {
            console.log("[SendMessage] Skipping YCloud - direction:", direction, "phone:", conversation.contact?.phone);
            // For inbound or no phone, just mark as sent
            await prisma.message.update({
                where: { id: message.id },
                data: { status: "sent" },
            });
        }

        await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
        });

        revalidatePath(`/dashboard/inbox`);
        return message;
    } catch (error) {
        console.error("Failed to send message:", error);
        throw new Error("Failed to send message");
    }
}

export async function createConversation(contactId: string) {
    try {
        let conversation = await prisma.conversation.findFirst({
            where: { contactId, status: 'active' }
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    contactId,
                    status: 'active'
                }
            });
        }

        revalidatePath('/dashboard/inbox');
        return conversation;
    } catch (error) {
        console.error("Error creating conversation:", error);
        throw new Error("Failed to create conversation");
    }
}

// Process incoming webhook message and store in database
export async function processInboundMessage(
    from: string,
    text: string,
    customerName?: string,
    media?: {
        type?: string;
        mediaUrl?: string;
        mediaType?: string;
        mediaFileName?: string;
    }
) {
    try {
        // Find or create contact by phone number
        let contact = await prisma.contact.findUnique({
            where: { phone: from },
        });

        let isNewContact = false;

        if (!contact) {
            isNewContact = true;
            contact = await prisma.contact.create({
                data: {
                    phone: from,
                    name: customerName || null,
                    status: "lead",
                },
            });
        } else if (customerName && !contact.name) {
            // Update contact name if we got it from webhook and it's not set
            contact = await prisma.contact.update({
                where: { id: contact.id },
                data: { name: customerName },
            });
        }

        // Find or create conversation
        let conversation = await prisma.conversation.findFirst({
            where: { contactId: contact.id, status: "active" },
        });

        if (!conversation) {
            conversation = await prisma.conversation.create({
                data: {
                    contactId: contact.id,
                    status: "active",
                },
            });
        }

        // Create inbound message with optional media
        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                content: text,
                direction: "inbound",
                status: "delivered",
                type: media?.type || "text",
                mediaUrl: media?.mediaUrl || null,
                mediaType: media?.mediaType || null,
                mediaFileName: media?.mediaFileName || null,
            },
        });

        // Update conversation timestamp and reset 24h window
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
                updatedAt: new Date(),
                sessionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            },
        });

        // ── Auto-create Deal for contacts without a deal ──
        // Every contact should be mapped in the pipeline
        try {
            const existingDeal = await prisma.deal.findFirst({
                where: { contactId: contact.id },
            });

            if (!existingDeal) {
                const incomingStage = await prisma.pipelineStage.findFirst({
                    where: { isIncoming: true },
                });

                if (incomingStage) {
                    const dealTitle = (contact.name || customerName)
                        ? `Lead - ${contact.name || customerName}`
                        : `Lead WhatsApp - ${from}`;

                    await prisma.deal.create({
                        data: {
                            title: dealTitle,
                            value: 0,
                            stageId: incomingStage.id,
                            contactId: contact.id,
                            source: "whatsapp",
                            priority: "medium",
                        },
                    });
                    console.log(`[Pipeline] Auto-created deal for contact without deal: ${dealTitle}`);
                    revalidatePath("/dashboard/pipeline");
                }
            }
        } catch (dealError) {
            console.error("[Pipeline] Failed to auto-create deal:", dealError);
            // Don't fail the whole message processing
        }

        // ── CHATBOT / N8N FORWARDING ──
        try {
            const settings = await prisma.systemSettings.findFirst();
            if (settings?.isBotEnabled && settings?.n8nWebhookUrl) {
                console.log(`[Chatbot] Bot enabled. Forwarding message from ${from} to n8n...`);

                // Send payload compatible with n8n Webhook node
                const n8nPayload = {
                    from,
                    text,
                    customerName: customerName || contact.name,
                    contactId: contact.id,
                    conversationId: conversation.id,
                    direction: "inbound",
                    senderType: "customer",
                    media,
                    timestamp: new Date().toISOString(),
                };

                // Non-blocking fetch to avoid delaying the webhook response
                fetch(settings.n8nWebhookUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(n8nPayload),
                }).then(res => {
                    console.log(`[Chatbot] n8n response status: ${res.status}`);
                }).catch(err => {
                    console.error("[Chatbot] Failed to forward to n8n:", err);
                });
            } else {
                // Only do AI enrichment if Bot is DISABLED (or maybe we want both?)
                // For now, let's keep enrichment active as it just updates contact info
                console.log("[Chatbot] Bot disabled or no webhook URL. Skipping forwarding.");
            }
        } catch (botError) {
            console.error("[Chatbot] Error checking bot settings:", botError);
        }

        // ── AI Contact Enrichment (fire-and-forget) ──
        enrichContactFromMessage(contact.id, text).catch((err) => {
            console.error("[AI Enrichment] Background enrichment failed:", err);
        });

        revalidatePath("/dashboard/inbox");
        return { contact, conversation, message };
    } catch (error) {
        console.error("Failed to process inbound message:", error);
        throw error;
    }
}
