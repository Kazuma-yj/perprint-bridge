/* Pure discovery logic. No Zotero globals: the same code is exercised by Node tests. */
var PreprintBridgeCore = (() => {
  const normal = (s) => String(s || "").normalize("NFKC").toLowerCase()
    .replace(/&(?:amp|quot|apos);/gi, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const decode = (s) => String(s || "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, (s) => ({
      "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">"
    })[s.toLowerCase()] || s);
  const strip = (s) => decode(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const arxivID = (value) => {
    const m = String(value || "").match(/(?:arxiv(?:\.org)?\/(?:abs|pdf|html)\/|arxiv\s*:\s*|10\.48550\/arxiv\.)(\d{4}\.\d{4,5})(?:v\d+)?/i);
    return m?.[1] || null;
  };
  const sameTitle = (a, b) => !!normal(a) && normal(a) === normal(b);
  const authorMatches = (authors, first) => {
    if (!first) return true;
    if (!authors || !authors.length) return false;
    return normal(authors[0]).split(" ").includes(normal(first).split(" ").at(-1));
  };
  const arxivDOI = (doi) => /(?:^|\/)arxiv\./i.test(String(doi || ""));
  const yearFrom = (s) => /(?:19|20)\d{2}/.exec(String(s || ""))?.[0] || "";

  function parseJSON(body, contentType, provider) {
    const raw = String(body || "").trim();
    if (/^\s*</.test(raw) || /html/i.test(String(contentType || ""))) {
      throw Error(provider + " returned HTML instead of JSON (possible bot check or proxy page)");
    }
    try { return JSON.parse(raw); }
    catch { throw Error(provider + " returned invalid JSON"); }
  }
  function tag(html, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("<meta\\b(?=[^>]*\\bname=[\\\"']" + escaped + "[\\\"'])[^>]*\\bcontent=[\\\"']([^\\\"']*)[\\\"'][^>]*>", "gi");
    return [...String(html).matchAll(re)].map(m => decode(m[1]));
  }
  function arxivComment(html) {
    const m = String(html).match(/<td[^>]*class=["'][^"']*comments[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
    return m ? strip(m[1]) : "";
  }
  function icmlYear(comment) {
    return /\bICML\s*['’,-]?\s*(20\d{2})\b/i.exec(comment)?.[1] || null;
  }
  function acceptedProceedings(comment, title, arxivId) {
    if (!/\b(?:accepted|to appear)\b/i.test(comment)) return null;
    // A preprint author may announce an acceptance before the publisher indexes
    // the paper. This is provisional metadata, not a publisher DOI or record.
    const match = /\b(Proceedings of (?:the )?((?:19|20)\d{2})\s+([A-Za-z][^();.]{5,110}?)\s*\(\s*([A-Z][A-Za-z0-9+./&-]{1,15})\s*['’]?(?:20)?(\d{2})\s*\))/i.exec(comment);
    if (!match || match[2].slice(-2) !== match[5]) return null;
    const year = match[2];
    return {
      source: "arXiv acceptance note", publicationStatus: "accepted",
      itemType: "conferencePaper", title,
      venue: match[1], conferenceName: `${match[3].trim()} (${match[4].toUpperCase()} ${year})`,
      year, url: `https://arxiv.org/abs/${arxivId}`, catalog: "arXiv"
    };
  }
  function pmlrVolume(indexHTML, year) {
    for (const m of String(indexHTML).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      if (!new RegExp("\\bICML\\s+" + year + "\\b", "i").test(strip(m[1]))) continue;
      const volume = /href=["'](?:\.\/)?v(\d+)\/?["']/i.exec(m[1])?.[1];
      if (volume) return volume;
    }
    return null;
  }
  function pmlrLink(volumeHTML, title, firstAuthor) {
    for (const match of String(volumeHTML).matchAll(/<div\b[^>]*class=["']paper["'][^>]*>([\s\S]*?)<\/div>/gi)) {
      const body = match[1];
      const foundTitle = /<p\b[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/p>/i.exec(body)?.[1];
      if (!sameTitle(title, strip(foundTitle))) continue;
      const authors = strip(/<span\b[^>]*class=["']authors["'][^>]*>([\s\S]*?)<\/span>/i.exec(body)?.[1]);
      if (firstAuthor && !normal(authors).split(" ").includes(normal(firstAuthor).split(" ").at(-1))) continue;
      const url = /href=["'](https:\/\/proceedings\.mlr\.press\/v\d+\/[^"']+\.html)["']/i.exec(body)?.[1];
      if (url) return url;
    }
    return null;
  }
  function fromPMLR(html, url, volume, title, firstAuthor) {
    const paperTitle = tag(html, "citation_title")[0];
    const authors = tag(html, "citation_author");
    if (!sameTitle(title, paperTitle) || !authorMatches(authors, firstAuthor)) return null;
    const first = tag(html, "citation_firstpage")[0];
    const last = tag(html, "citation_lastpage")[0];
    const published = tag(html, "citation_publication_date")[0] || "";
    const dateMatch = /\b((?:19|20)\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(published);
    // PMLR's recommended BibTeX contains the full proceedings title and series.
    // The citation_conference_title meta tag can omit the conference edition.
    const pageText = strip(html);
    const booktitle = /\bbooktitle\s*=\s*\{([^{}]+)\}/i.exec(pageText)?.[1];
    const series = /\bseries\s*=\s*\{([^{}]+)\}/i.exec(pageText)?.[1];
    return {
      source: "PMLR", itemType: "conferencePaper", title: paperTitle,
      venue: booktitle || "Proceedings of the International Conference on Machine Learning",
      conferenceName: booktitle?.replace(/^Proceedings of (?:the )?/i, "") ||
        tag(html, "citation_conference_title")[0] || "International Conference on Machine Learning",
      year: yearFrom(published),
      date: dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}` : "",
      pages: first && last ? first + "-" + last : first || "",
      volume: String(volume), series: series || "", publisher: "PMLR", url,
      catalog: "Proceedings of Machine Learning Research",
      pdfURL: tag(html, "citation_pdf_url")[0] || "", authors
    };
  }
  function fromDBLP(json, title, firstAuthor) {
    const hits = json?.result?.hits?.hit || [];
    const result = [];
    for (const hit of Array.isArray(hits) ? hits : [hits]) {
      const info = hit?.info || {};
      const authors = info.authors?.author || info.author || [];
      const list = (Array.isArray(authors) ? authors : [authors]).map(a => typeof a === "string" ? a : a?.text || "");
      if (!sameTitle(title, String(info.title || "").replace(/\.$/, "")) || !authorMatches(list, firstAuthor)) continue;
      if (/^(corr|arxiv)$/i.test(info.venue || "")) continue;
      const url = typeof info.ee === "string" ? info.ee : Array.isArray(info.ee) ? info.ee[0] : info.url;
      if (!url || !/^https:\/\//i.test(url) || /(?:^|\.)arxiv\.org/i.test(new URL(url).hostname)) continue;
      result.push({
        source: "DBLP", itemType: /journal/i.test(info.type || "") ? "journalArticle" : "conferencePaper",
        title: strip(info.title).replace(/\.$/, ""), venue: strip(info.venue),
        year: String(info.year || ""), pages: String(info.pages || ""),
        volume: String(info.volume || ""), publisher: "", url,
        doi: arxivDOI(info.doi) ? "" : String(info.doi || ""), authors: list
      });
    }
    return result;
  }
  function fromCrossref(json, title, firstAuthor) {
    const records = json?.message?.items || [];
    const result = [];
    for (const info of records) {
      if (!["journal-article", "proceedings-article"].includes(info.type)) continue;
      const authors = (info.author || []).map(a => [a.given, a.family].filter(Boolean).join(" "));
      if (!sameTitle(title, info.title?.[0]) || !authorMatches(authors, firstAuthor)) continue;
      if (!info.DOI || arxivDOI(info.DOI)) continue;
      result.push({
        source: "Crossref", itemType: info.type === "journal-article" ? "journalArticle" : "conferencePaper",
        title: info.title[0], venue: info["container-title"]?.[0] || "",
        year: String(info.published?.["date-parts"]?.[0]?.[0] || ""),
        pages: String(info.page || ""), volume: String(info.volume || ""),
        publisher: String(info.publisher || ""), doi: info.DOI,
        url: "https://doi.org/" + encodeURIComponent(info.DOI), authors
      });
    }
    return result;
  }

  async function discover({ title, firstAuthor, arxivId }, request) {
    const checks = [], candidates = [];
    let acceptance = null;
    async function attempt(source, fn) {
      try {
        const result = await fn();
        const found = Array.isArray(result) ? result : result ? [result] : [];
        candidates.push(...found);
        checks.push({ source, outcome: found.length ? "found" : "not_found" });
      } catch (error) {
        checks.push({ source, outcome: "error", detail: String(error?.message || error).slice(0, 200) });
      }
    }
    if (arxivId) {
      let comment = "";
      await attempt("arXiv", async () => {
        const reply = await request("https://arxiv.org/abs/" + arxivId);
        comment = arxivComment(reply.body);
        acceptance = acceptedProceedings(comment, title, arxivId);
        return null;
      });
      if (checks.at(-1)?.source === "arXiv" && checks.at(-1).outcome === "not_found") {
        checks.at(-1).outcome = "checked";
      }
      const year = icmlYear(comment);
      if (year) await attempt("PMLR", async () => {
        const home = await request("https://proceedings.mlr.press/");
        const volume = pmlrVolume(home.body, year);
        if (!volume) return null;
        const listing = await request(`https://proceedings.mlr.press/v${volume}/`, { maxBytes: 6_000_000 });
        const link = pmlrLink(listing.body, title, firstAuthor);
        if (!link) return null;
        const page = await request(link);
        return fromPMLR(page.body, link, volume, title, firstAuthor);
      });
    }
    // An official PMLR match is conclusive; avoid extra traffic and rate limits.
    if (!candidates.length) await attempt("DBLP", async () => {
      const query = [title, firstAuthor].filter(Boolean).join(" ");
      const url = "https://dblp.org/search/publ/api?q=" + encodeURIComponent(query) + "&format=json&h=100";
      const reply = await request(url);
      return fromDBLP(parseJSON(reply.body, reply.contentType, "DBLP"), title, firstAuthor);
    });
    if (!candidates.length) await attempt("Crossref", async () => {
      const url = "https://api.crossref.org/works?query.title=" + encodeURIComponent(title) + "&rows=10";
      const reply = await request(url);
      return fromCrossref(parseJSON(reply.body, reply.contentType, "Crossref"), title, firstAuthor);
    });
    if (!candidates.length && acceptance) {
      candidates.push(acceptance);
      checks.push({ source: "arXiv acceptance note", outcome: "accepted" });
      return { status: "accepted", candidates, checks };
    }
    return { status: candidates.length ? "found" : checks.some(c => c.outcome === "error") ? "partial_failure" : "not_found", candidates, checks };
  }
  return { arxivID, sameTitle, parseJSON, arxivComment, icmlYear, acceptedProceedings, pmlrVolume, pmlrLink, fromPMLR, fromDBLP, fromCrossref, discover };
})();
