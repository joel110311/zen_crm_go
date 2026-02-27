// API route for sending messages - supports text and media
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendWhatsAppMessage, sendWhatsAppMedia } from "@/lib/ycloud";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const logMsg = (msg: string) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    try { fs.appendFileSync(path.join(process.cwd(), "media-upload.log"), line); } catch { }
};

// Convert audio to MP3 using ffmpeg — MP3 is the only format confirmed to work
// with the full pipeline: ffmpeg → catbox.moe (serves as audio/mpeg) → YCloud → WhatsApp
// Browser records WebM/Opus but saves as .ogg — WhatsApp rejects that mismatch.
async function convertAudioForWhatsApp(inputPath: string): Promise<string | null> {
    try {
        const outputPath = inputPath.replace(/\.[^.]+$/, ".mp3");

        logMsg(`[CONVERT] Converting ${path.basename(inputPath)} to MP3`);

        // Try system ffmpeg first (Docker), then fall back to ffmpeg-static (Windows dev)
        let ffmpegBin = "ffmpeg";
        const ffmpegStaticPath = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
        if (fs.existsSync(ffmpegStaticPath)) {
            ffmpegBin = ffmpegStaticPath;
            logMsg(`[CONVERT] Using ffmpeg-static: ${ffmpegBin}`);
        } else {
            logMsg(`[CONVERT] Using system ffmpeg`);
        }

        await execFileAsync(ffmpegBin, [
            "-i", inputPath,
            "-c:a", "libmp3lame", // MP3 codec — universally supported
            "-b:a", "128k",       // Bitrate
            "-ar", "44100",       // Sample rate
            "-ac", "1",           // Mono
            "-y",                 // Overwrite
            outputPath
        ]);

        if (fs.existsSync(outputPath)) {
            const size = fs.statSync(outputPath).size;
            logMsg(`[CONVERT] Success: ${path.basename(outputPath)} (${size} bytes)`);
            return outputPath;
        }

        logMsg("[CONVERT] ERROR: Output file not created");
        return null;
    } catch (error: any) {
        logMsg(`[CONVERT] ERROR: ${error.message}`);
        return null;
    }
}

// Upload file to catbox.moe (permanent hosting, serves correct MIME types)
async function uploadToCatbox(filePath: string): Promise<string | null> {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        logMsg(`[UPLOAD] Uploading ${fileName} (${fileBuffer.length} bytes) to catbox.moe...`);

        const formData = new FormData();
        formData.append("reqtype", "fileupload");
        formData.append("fileToUpload", new Blob([fileBuffer]), fileName);

        const response = await fetch("https://catbox.moe/user/api.php", {
            method: "POST",
            body: formData,
        });

        const url = (await response.text()).trim();

        if (url.startsWith("https://")) {
            logMsg(`[UPLOAD] Success: ${url}`);
            return url;
        }

        logMsg(`[UPLOAD] ERROR: Unexpected response: ${url}`);
        return null;
    } catch (error: any) {
        logMsg(`[UPLOAD] ERROR: ${error.message}`);
        return null;
    }
}

// Convert a local media URL to a publicly accessible one
// For audio: converts to OGG/Opus + uploads to catbox
// For other media: uploads directly to catbox
async function resolveMediaUrl(mediaUrl: string, mediaType?: string): Promise<string | null> {
    // If already a full external URL (not localhost or our own domain), return as-is
    // We treat crm.logicapp.net as "local" because Docker networking might prevent YCloud from determining it,
    // or static files might not be served correctly by Next.js standalone.
    // By falling through, we upload the local file to Catbox to guarantee a public URL.
    const isLocal = mediaUrl.includes("localhost") || mediaUrl.includes("crm.logicapp.net");
    if (mediaUrl.startsWith("https://") && !isLocal) {
        logMsg(`[RESOLVE] Already external URL: ${mediaUrl}`);
        return mediaUrl;
    }

    // Extract filename from the URL
    let filename = "";
    if (mediaUrl.includes("/uploads/")) {
        filename = mediaUrl.substring(mediaUrl.lastIndexOf("/") + 1);
    } else if (mediaUrl.startsWith("/")) {
        filename = path.basename(mediaUrl);
    }

    if (!filename) {
        logMsg(`[RESOLVE] ERROR: Cannot extract filename from: ${mediaUrl}`);
        return null;
    }

    // Verify file exists locally
    const localPath = path.join(process.cwd(), "public", "uploads", filename);
    if (!fs.existsSync(localPath)) {
        logMsg(`[RESOLVE] ERROR: File not found: ${localPath}`);
        return null;
    }

    let fileToUpload = localPath;

    // For audio files, convert to OGG/Opus (WhatsApp native format)
    if (mediaType === "audio" || filename.match(/\.(m4a|mp4|webm|ogg|wav|aac|amr)$/i)) {
        const convertedPath = await convertAudioForWhatsApp(localPath);
        if (convertedPath) {
            fileToUpload = convertedPath;
        } else {
            logMsg("[RESOLVE] WARNING: FFmpeg conversion failed, uploading original file");
        }
    }

    // Upload to catbox for a public URL
    const publicUrl = await uploadToCatbox(fileToUpload);
    if (!publicUrl) {
        logMsg("[RESOLVE] ERROR: Failed to upload to catbox");
        return null;
    }

    logMsg(`[RESOLVE] Final public URL: ${publicUrl}`);
    return publicUrl;
}

export async function POST(request: NextRequest) {
    console.log("[API] /api/send-message called");

    try {
        const body = await request.json();
        const {
            conversationId,
            content,
            direction = "outbound",
            type = "text",
            mediaUrl,
            mediaType,
            mediaFileName,
        } = body;

        console.log("[API] Request body:", { conversationId, content, direction, type, mediaUrl });

        if (!conversationId || (!content && !mediaUrl)) {
            return NextResponse.json(
                { error: "conversationId and content or mediaUrl are required" },
                { status: 400 }
            );
        }

        // Get conversation with contact
        const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true },
        });

        if (!conversation) {
            return NextResponse.json(
                { error: "Conversation not found" },
                { status: 404 }
            );
        }

        console.log("[API] Found conversation, contact phone:", conversation.contact?.phone);

        // Create message in database
        const message = await prisma.message.create({
            data: {
                conversationId,
                content: content || `[${type}]`,
                direction,
                status: "sending",
                type,
                mediaUrl: mediaUrl || null,
                mediaType: mediaType || null,
                mediaFileName: mediaFileName || null,
            },
        });

        console.log("[API] Created message:", message.id);

        // If outbound, send via YCloud WhatsApp API
        if (direction === "outbound" && conversation.contact?.phone) {
            try {
                let result;

                if (type === "text") {
                    console.log("[API] Sending text via YCloud to:", conversation.contact.phone);
                    result = await sendWhatsAppMessage(conversation.contact.phone, content);
                } else if (mediaUrl && (type === "image" || type === "document" || type === "audio" || type === "video")) {
                    // Resolve the media URL to a public one
                    const publicMediaUrl = await resolveMediaUrl(mediaUrl, type);

                    if (!publicMediaUrl) {
                        throw new Error("Unable to resolve public media URL (ngrok not running?)");
                    }

                    console.log("[API] Sending", type, "via YCloud. Public URL:", publicMediaUrl);

                    result = await sendWhatsAppMedia(
                        conversation.contact.phone,
                        publicMediaUrl,
                        type as "image" | "document" | "audio" | "video",
                        content && content !== `[${type}]` ? content : undefined,
                        mediaFileName || undefined
                    );
                } else {
                    result = { success: true };
                }

                console.log("[API] YCloud result:", result);

                await prisma.message.update({
                    where: { id: message.id },
                    data: { status: result.success ? "sent" : "failed" },
                });
            } catch (whatsappError: any) {
                console.error("[API] WhatsApp send error:", whatsappError);
                await prisma.message.update({
                    where: { id: message.id },
                    data: { status: "failed" }, // Keep it simple string
                });

                // Return error to client so they know it failed
                return NextResponse.json({
                    success: false,
                    message: message,
                    error: whatsappError.message || "Failed to send to WhatsApp"
                }, { status: 500 });
            }
        } else {
            await prisma.message.update({
                where: { id: message.id },
                data: { status: "sent" },
            });
        }

        // Update conversation timestamp and 24h window if template
        const updateData: any = { updatedAt: new Date() };
        if (type === "template") {
            updateData.sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }

        await prisma.conversation.update({
            where: { id: conversationId },
            data: updateData,
        });

        // ── Forward outbound message to n8n webhook ──
        try {
            const settings = await prisma.systemSettings.findFirst();
            if (settings?.n8nWebhookUrl) {
                const n8nPayload = {
                    from: conversation.contact?.phone || "",
                    text: content || `[${type}]`,
                    customerName: conversation.contact?.name || "",
                    contactId: conversation.contact?.id || "",
                    conversationId,
                    direction: "outbound",
                    senderType: "human",
                    media: mediaUrl ? { type, mediaUrl, mediaType, mediaFileName } : undefined,
                    timestamp: new Date().toISOString(),
                };

                fetch(settings.n8nWebhookUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(n8nPayload),
                }).then(res => {
                    console.log(`[n8n Forward] Outbound forwarded, status: ${res.status}`);
                }).catch(err => {
                    console.error("[n8n Forward] Failed:", err);
                });
            }
        } catch (fwdError) {
            console.error("[n8n Forward] Settings error:", fwdError);
        }

        return NextResponse.json({ success: true, message });
    } catch (error) {
        console.error("[API] Error:", error);
        return NextResponse.json(
            { error: "Failed to send message" },
            { status: 500 }
        );
    }
}
