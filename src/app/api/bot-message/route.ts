import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMessageSourceType, resolveMessageSourceId } from "@/lib/message-source";
import { sendOutboundConversationMessage, type OutboundMessageType } from "@/lib/outbound-messages";
import { findOrCreateActiveConversationForContactSource } from "@/lib/source-conversations";
import { getSystemSettingsOrDefaults } from "@/lib/system-settings";

/**
 * POST /api/bot-message
 *
 * Called by any external assistant that wants to send a bot message through the CRM.
 * Sends through the configured WhatsApp source and persists the resulting message.
 *
 * Body:
 *   - to: string (phone number of the recipient, e.g. "524772683928")
 *   - text: string (message content)
 *   - type?: string ("text" | "image" | "audio" | "video" | "document")
 *   - mediaUrl?: string
 *   - mediaType?: string
 *   - mediaFileName?: string
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { to, text, type = "text", mediaUrl, mediaType, mediaFileName, sourceType } = body;
        const textContent = typeof text === "string" ? text.trim() : "";
        const requestedType = typeof type === "string" ? type : "text";
        const outboundType: OutboundMessageType = ["text", "image", "audio", "video", "document"].includes(requestedType)
            ? requestedType as OutboundMessageType
            : "text";

        if (!to || (!textContent && !mediaUrl)) {
            return NextResponse.json(
                { error: "Missing required fields: 'to' and ('text' or 'mediaUrl')" },
                { status: 400 },
            );
        }

        // Normalize phone (remove +, spaces, dashes).
        const phone = String(to).replace(/\D/g, "");
        const suffix10 = phone.slice(-10);

        console.log(`[Bot Message] Sending bot response to ${phone}: ${(textContent || outboundType).substring(0, 50)}...`);

        let contact = await prisma.contact.findFirst({
            where: {
                OR: [
                    { phone },
                    { phone: { endsWith: suffix10 } },
                ],
            },
        });

        if (!contact) {
            contact = await prisma.contact.create({
                data: {
                    phone,
                    status: "lead",
                },
            });
            console.log(`[Bot Message] Created contact ${contact.id} for phone ${phone}`);
        }

        const settings = await getSystemSettingsOrDefaults();
        const normalizedSourceType = normalizeMessageSourceType(sourceType);
        const sourceId = resolveMessageSourceId(normalizedSourceType, settings);
        const conversation = await findOrCreateActiveConversationForContactSource({
            contactId: contact.id,
            sourceType: normalizedSourceType,
            sourceId,
        });
        const content = textContent || `[${outboundType}]`;

        const recentDuplicate = await prisma.message.findFirst({
            where: {
                conversationId: conversation.id,
                content,
                direction: "outbound",
                sourceType: normalizedSourceType,
                status: { not: "failed" },
                createdAt: { gte: new Date(Date.now() - 15000) },
            },
        });

        if (recentDuplicate) {
            console.log("[Bot Message] Duplicate detected, skipping");
            return NextResponse.json({ success: true, duplicate: true, messageId: recentDuplicate.id });
        }

        const { message } = await sendOutboundConversationMessage({
            conversationId: conversation.id,
            content,
            type: outboundType,
            sourceType: normalizedSourceType,
            sourceId,
            mediaUrl: mediaUrl || null,
            mediaType: mediaType || null,
            mediaFileName: mediaFileName || null,
            senderType: "bot",
            preserveBotActive: true,
        });

        console.log(`[Bot Message] Sent and stored message ${message.id} for ${contact.name || contact.phone}`);

        return NextResponse.json({
            success: true,
            messageId: message.id,
            contactName: contact.name,
            providerMessageId: message.providerMessageId,
            status: message.status,
        });
    } catch (error: unknown) {
        const details = error instanceof Error ? error.message : "Unknown error";
        console.error("[Bot Message] Error:", error);
        return NextResponse.json(
            { error: "Failed to send bot message", details },
            { status: 500 },
        );
    }
}
