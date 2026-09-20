function comparableText(value: string) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es-MX")
        .replace(/\s+/g, " ")
        .trim();
}

const SELF_IDENTIFICATION = /^(?:hola[,!]?\s+)?(?:mi nombre es|me llamo|soy(?!\s+(?:de|del|en))|nombre completo(?: es)?|puedes poner(?:me)? como)\s+/i;
const NON_NAME_REPLY = /\b(?:gracias|pulc?eras?|pulseras?|glowsync|audiorritmicas?|audioritmicas?|precio|cotizacion|piezas?|unidades?|guerrero\s+\d)\b/i;
const LOCATION_REPLY = /^(?:(?:estado|ciudad|municipio|colonia|calle)\s+de\b|nuevo leon\b|baja california\b|san luis potosi\b)/i;

/**
 * A standalone word after a name question is too ambiguous: it can be a
 * city, product or courtesy reply. Require an explicit self-identification
 * for one-word names; an unprefixed full name must be the entire response.
 */
export function hasReliableNameEvidence(candidate: string, sourceText: string) {
    const normalizedCandidate = comparableText(candidate);
    const normalizedSource = comparableText(sourceText);
    if (!normalizedCandidate || !normalizedSource) return false;
    if (NON_NAME_REPLY.test(normalizedCandidate)) return false;
    if (LOCATION_REPLY.test(normalizedCandidate)) return false;

    const explicit = SELF_IDENTIFICATION.test(normalizedSource);
    const parts = normalizedCandidate.split(" ").filter(Boolean);
    if (parts.length === 1 && !explicit) return false;

    if (!explicit) {
        if (/[\d@\n]/.test(sourceText)) return false;
        if (normalizedCandidate !== normalizedSource.replace(/[.!]+$/g, "").trim()) return false;
    }

    return true;
}
