const LIST_ITEM = /^\s*(?:[-•*]\s+|\d{1,2}[.)]?\s+\S|\p{Extended_Pictographic}\uFE0F?\s+)/u;
const LABELED_OPTION = /^\s*(?:audior[ií]tmicas?|glowsync|videos?)\s*:/i;

function isListItem(line: string) {
    return LIST_ITEM.test(line) || LABELED_OPTION.test(line);
}

/** Preserve the model's paragraphs, compact list blocks, and separate lists from prose. */
export function formatBotReplyForReadability(reply: string) {
    const lines = reply.replace(/\r\n?/g, "\n").trim().split("\n");
    const formatted: string[] = [];
    let hadBlankLine = false;
    let previousWasListItem: boolean | null = null;

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            hadBlankLine = true;
            continue;
        }

        const currentIsListItem = isListItem(line);
        const startsOrEndsList = previousWasListItem !== null && previousWasListItem !== currentIsListItem;
        const isInsideList = previousWasListItem === true && currentIsListItem;

        if (formatted.length > 0 && !isInsideList && (hadBlankLine || startsOrEndsList)) {
            if (formatted[formatted.length - 1] !== "") formatted.push("");
        }

        // Blank lines inside a contiguous list are collapsed so items stay together.
        if (isInsideList && formatted[formatted.length - 1] === "") {
            formatted.pop();
        }

        formatted.push(line);
        previousWasListItem = currentIsListItem;
        hadBlankLine = false;
    }

    while (formatted[0] === "") formatted.shift();
    while (formatted[formatted.length - 1] === "") formatted.pop();
    return formatted.join("\n");
}
