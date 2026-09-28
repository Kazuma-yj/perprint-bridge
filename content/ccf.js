/* global PreprintBridgeCCFEntries */
var PreprintBridgeCCF = (() => {
  const entries = PreprintBridgeCCFEntries;
  const key = value => String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[（(]原[^）)]*[）)]/g, "")
    .replace(/^proceedings of (?:the )?/i, "")
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, "")
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function lookup({ itemType, venue, conferenceName }) {
    const kind = itemType === "conferencePaper" ? "conference" :
      itemType === "journalArticle" ? "journal" : null;
    if (!kind) return null;
    const names = [conferenceName, venue].filter(Boolean);
    const pool = entries.filter(entry => entry.kind === kind);
    // Prefer a full official name over an ambiguous abbreviation (e.g. FSE).
    for (const name of names) {
      const normalized = key(name);
      if (normalized.length < 10) continue;
      const matches = pool.filter(entry => key(entry.title) === normalized);
      if (matches.length === 1) return matches[0];
    }
    for (const name of names) {
      const normalized = String(name).trim().toUpperCase();
      const alias = normalized === "KDD" ? "SIGKDD" : normalized;
      if (!/^[A-Z0-9+./&-]{2,20}$/.test(alias)) continue;
      const matches = pool.filter(entry => entry.acronym.toUpperCase() === alias);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }
  return { lookup };
})();
