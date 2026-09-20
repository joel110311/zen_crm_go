const LIST_ITEM = /^\s*(?:[-•*]|\d+[.)])\s+/;

/** Keep short lists compact, but separate prose and labeled options into paragraphs. */
export function formatBotReplyForReadability(reply: string) {
    const lines = reply.replace(/\r\n?/g, "\n").trim().split("\n");
    const formatted: string[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            if (formatted.length > 0 && formatted[formatted.length - 1] !== "") formatted.push("");
            continue;
        }

        const previous = formatted[formatted.length - 1];
        if (previous && !(LIST_ITEM.test(previous) && LIST_ITEM.test(line))) {
            formatted.push("");
        }
        formatted.push(line);
    }

    return formatted.join("\n").trim();
}
