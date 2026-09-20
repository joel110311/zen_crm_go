type AutomatedMediaCategory = "image" | "document";

function decodedHeader(dataUrl: string) {
    const match = dataUrl.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=]+)/);
    if (!match) throw new Error("El archivo descargado no tiene un formato multimedia válido.");
    return Buffer.from(match[1].slice(0, 64), "base64");
}

/** Trust the file signature rather than an unreliable remote Content-Type. */
export function identifyAutomatedMediaMimeType(category: AutomatedMediaCategory, dataUrl: string) {
    const header = decodedHeader(dataUrl);

    if (category === "document") {
        if (header.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
        throw new Error("El enlace no devolvió un PDF válido.");
    }

    if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (header.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
    if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";

    throw new Error("El enlace no devolvió una imagen compatible con WhatsApp.");
}

export function normalizeAutomatedMediaDataUrl(dataUrl: string, mimeType: string) {
    return dataUrl.replace(/^data:[^;,]+;base64,/, `data:${mimeType};base64,`);
}
