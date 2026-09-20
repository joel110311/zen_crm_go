import assert from "node:assert/strict";
import test from "node:test";

import { formatBotReplyForReadability } from "../src/lib/ai/reply-format.ts";

test("separates an introduction, product options and closing question", () => {
    const compact = "¡Con gusto! Te explico las opciones:\nAudiorítmicas: Se activan con la música.\nGlowSync: Controla efectos.\nVideos: Muestra mensajes.\n¿Cuál te interesa?";
    assert.equal(
        formatBotReplyForReadability(compact),
        "¡Con gusto! Te explico las opciones:\n\nAudiorítmicas: Se activan con la música.\n\nGlowSync: Controla efectos.\n\nVideos: Muestra mensajes.\n\n¿Cuál te interesa?",
    );
});

test("keeps a numbered list compact and does not multiply blank lines", () => {
    const reply = "Opciones:\n\n1. Audiorítmicas\n2. GlowSync\n\n¿Cuál prefieres?";
    assert.equal(formatBotReplyForReadability(reply), reply);
});
