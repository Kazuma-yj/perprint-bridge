/* global PreprintBridgeCCFEntries */
var PreprintBridgeCCF = (() => {
  const entries = PreprintBridgeCCFEntries;
  const edition = /\s*[（(]\s*([A-Z][A-Z0-9+./&-]{1,19})(?:\s*(?:19|20)?\d{2})?\s*[）)]\s*$/i;
  const key = value => String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[（(]原[^）)]*[）)]/g, "")
    .replace(edition, "")
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
      if (normalized.length < 6) continue;
      const matches = pool.filter(entry => key(entry.title) === normalized);
      if (matches.length === 1) return matches[0];
    }
    for (const name of names) {
      const normalized = String(name).trim().toUpperCase();
      const suffix = edition.exec(normalized)?.[1];
      const abbreviation = suffix || normalized;
      const alias = abbreviation === "KDD" ? "SIGKDD" : abbreviation === "NIPS" ? "NEURIPS" :
        /^NAACL-HLT(?:\s+\(\d+\))?$/.test(abbreviation) ? "NAACL" : abbreviation;
      if (!/^[A-Z0-9+./&-]{2,20}$/.test(alias)) continue;
      const matches = pool.filter(entry => entry.acronym.toUpperCase() === alias);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }
  return { lookup };
})();
