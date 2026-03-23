import React from "react";
import { cn } from "@/lib/utils";

type WhatsAppFormattedTextProps = {
    text: string;
    className?: string;
    variableClassName?: string;
};

function renderInlineSegments(
    text: string,
    keyPrefix: string,
    variableClassName: string,
): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const tokenRegex = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|{{\s*[a-zA-Z0-9_]+\s*}})/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(
                <React.Fragment key={`${keyPrefix}-plain-${index}`}>
                    {text.slice(lastIndex, match.index)}
                </React.Fragment>,
            );
            index += 1;
        }

        const token = match[0];
        const tokenKey = `${keyPrefix}-token-${index}`;

        if (token.startsWith("*") && token.endsWith("*")) {
            nodes.push(
                <strong key={tokenKey} className="font-semibold text-slate-900">
                    {renderInlineSegments(token.slice(1, -1), `${tokenKey}-bold`, variableClassName)}
                </strong>,
            );
        } else if (token.startsWith("_") && token.endsWith("_")) {
            nodes.push(
                <em key={tokenKey}>
                    {renderInlineSegments(token.slice(1, -1), `${tokenKey}-italic`, variableClassName)}
                </em>,
            );
        } else if (token.startsWith("~") && token.endsWith("~")) {
            nodes.push(
                <s key={tokenKey}>
                    {renderInlineSegments(token.slice(1, -1), `${tokenKey}-strike`, variableClassName)}
                </s>,
            );
        } else {
            nodes.push(
                <span key={tokenKey} className={variableClassName}>
                    {token}
                </span>,
            );
        }

        lastIndex = match.index + token.length;
        index += 1;
    }

    if (lastIndex < text.length) {
        nodes.push(
            <React.Fragment key={`${keyPrefix}-tail`}>
                {text.slice(lastIndex)}
            </React.Fragment>,
        );
    }

    return nodes;
}

export function WhatsAppFormattedText({
    text,
    className,
    variableClassName = "rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-700",
}: WhatsAppFormattedTextProps) {
    const lines = text.split("\n");

    return (
        <div className={cn("min-w-0 max-w-full break-words [overflow-wrap:anywhere] [word-break:break-word]", className)}>
            {lines.map((line, lineIndex) => (
                <React.Fragment key={`line-${lineIndex}`}>
                    {renderInlineSegments(line, `line-${lineIndex}`, variableClassName)}
                    {lineIndex < lines.length - 1 ? <br /> : null}
                </React.Fragment>
            ))}
        </div>
    );
}
