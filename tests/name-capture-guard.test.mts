import assert from "node:assert/strict";
import test from "node:test";

import { hasReliableNameEvidence } from "../src/lib/ai/name-capture-guard.ts";

test("a city and date are not a name even after the bot asks for one", () => {
    assert.equal(hasReliableNameEvidence("Guerrero", "Guerrero\n29 de diciembre 2026"), false);
    assert.equal(hasReliableNameEvidence("Estado de México", "Estado de México"), false);
});

test("a product or courtesy reply is never captured as a name", () => {
    assert.equal(hasReliableNameEvidence("pulceras", "100 pulceras"), false);
    assert.equal(hasReliableNameEvidence("Gracias", "Gracias"), false);
    assert.equal(hasReliableNameEvidence("Muchas Gracias", "Muchas Gracias"), false);
});

test("an unprefixed full name must be the whole response", () => {
    assert.equal(hasReliableNameEvidence("Diana López", "Diana López"), true);
    assert.equal(hasReliableNameEvidence("Diana López", "Diana López\n29 de diciembre"), false);
    assert.equal(hasReliableNameEvidence("Diana López", "Para Diana López"), false);
});

test("a person can explicitly identify themselves with one name", () => {
    assert.equal(hasReliableNameEvidence("Diana", "Me llamo Diana"), true);
    assert.equal(hasReliableNameEvidence("Diana", "Mi nombre es Diana"), true);
    assert.equal(hasReliableNameEvidence("Guerrero", "Soy de Guerrero"), false);
});
