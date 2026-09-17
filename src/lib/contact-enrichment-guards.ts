function normalizeComparableText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es-MX")
        .replace(/\s+/g, " ")
        .trim();
}

export function hasExplicitCompanyDisclosure(messageText: string) {
    const normalized = normalizeComparableText(messageText);
    if (!normalized) return false;

    return [
        /\bmi (?:empresa|negocio|compania)\b/,
        /\b(?:la|nuestra) (?:empresa|compania) (?:se llama|es)\b/,
        /\b(?:trabajo|laboro) (?:en|para)\b/,
        /\b(?:soy|vengo) de (?:la empresa|la compania)\b/,
        /\brepresento a\b/,
        /\bempresa:\s*\S+/,
        /\bcompania:\s*\S+/,
    ].some((pattern) => pattern.test(normalized));
}

export function hasExplicitContactDisclosure(messageText: string) {
    const normalized = normalizeComparableText(messageText);
    if (!normalized) return false;

    const hasEmail = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(messageText);
    const hasExplicitName = [
        /\bme llamo\s+[a-z][a-z .'-]{1,80}/,
        /\bmi nombre es\s+[a-z][a-z .'-]{1,80}/,
        /\bnombre:\s*[a-z][a-z .'-]{1,80}/,
    ].some((pattern) => pattern.test(normalized));

    return hasEmail || hasExplicitName || hasExplicitCompanyDisclosure(messageText);
}
