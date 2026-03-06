import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
    try {
        const { messageId, reaction } = await request.json();
        if (!messageId) {
            return NextResponse.json({ error: "messageId required" }, { status: 400 });
        }

        const updated = await prisma.message.update({
            where: { id: messageId },
            data: { reaction: reaction || null }, // null to clear reaction
        });

        return NextResponse.json({ success: true, messageId: updated.id, reaction: updated.reaction });
    } catch (error) {
        console.error("[Reaction API] Error:", error);
        return NextResponse.json({ error: "Failed to update reaction" }, { status: 500 });
    }
}
