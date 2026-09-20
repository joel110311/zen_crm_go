import assert from "node:assert/strict";
import test from "node:test";

import {
    identifyAutomatedMediaMimeType,
    normalizeAutomatedMediaDataUrl,
} from "../src/lib/automated-media-validation.ts";

test("recognizes a valid JPEG even when a server reports a generic MIME type", () => {
    const jpeg = `data:application/octet-stream;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`;
    assert.equal(identifyAutomatedMediaMimeType("image", jpeg), "image/jpeg");
    assert.match(normalizeAutomatedMediaDataUrl(jpeg, "image/jpeg"), /^data:image\/jpeg;base64,/);
});

test("rejects an HTML error page masquerading as an image", () => {
    const html = `data:image/jpeg;base64,${Buffer.from("<html>Not found</html>").toString("base64")}`;
    assert.throws(() => identifyAutomatedMediaMimeType("image", html), /imagen compatible/);
});

test("rejects an invalid PDF and accepts a real PDF signature", () => {
    const html = `data:application/pdf;base64,${Buffer.from("<html>Login</html>").toString("base64")}`;
    const pdf = `data:application/octet-stream;base64,${Buffer.from("%PDF-1.7").toString("base64")}`;
    assert.throws(() => identifyAutomatedMediaMimeType("document", html), /PDF válido/);
    assert.equal(identifyAutomatedMediaMimeType("document", pdf), "application/pdf");
});
