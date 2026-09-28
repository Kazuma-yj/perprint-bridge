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
  // ICML adds an editorial "Position:" label to some published titles.
  // Permit that label only; substantive title changes still require a
  // separately imported publisher record and the manual review command.
  const titleKey = (s) => normal(String(s || "").replace(/^\s*position(?:\s+paper)?\s*:\s*/i, ""));
  const sameTitle = (a, b) => !!titleKey(a) && titleKey(a) === titleKey(b);
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
    const values = [];
    for (const match of String(html).matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      const attrs = {};
      for (const attr of match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
        attrs[attr[1].toLowerCase()] = decode(attr[3]);
      }
      if (attrs.name?.toLowerCase() === name.toLowerCase() && attrs.content) values.push(attrs.content);
    }
    return values;
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
    return pmlrVolumes(indexHTML).find(v => v.year === String(year))?.volume || null;
  }
  function pmlrVolumes(indexHTML) {
    const volumes = [];
    for (const m of String(indexHTML).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      // Exclude "GRaM at ICML" and other workshop volumes from the main
      // conference. They can precede the actual ICML volume in the directory.
      const year = /^(?:Volume\s+\d+\s*)?(?:Proceedings of )?ICML\s+(20\d{2})$/i.exec(strip(m[1]))?.[1];
      const volume = /href=["'](?:(?:https:\/\/proceedings\.mlr\.press\/)|(?:\.\/))?v(\d+)\/?["']/i.exec(m[1])?.[1];
      if (year && volume && !volumes.some(v => v.volume === volume)) volumes.push({ year, volume });
    }
    return volumes;
  }
  function pmlrPapers(volumeHTML) {
    const papers = [];
    for (const match of String(volumeHTML).matchAll(/<div\b[^>]*class=["']paper["'][^>]*>([\s\S]*?)<\/div>/gi)) {
      const body = match[1];
      const foundTitle = /<p\b[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/p>/i.exec(body)?.[1];
      const authors = strip(/<span\b[^>]*class=["']authors["'][^>]*>([\s\S]*?)<\/span>/i.exec(body)?.[1]);
      const url = /href=["'](https:\/\/proceedings\.mlr\.press\/v\d+\/[^"']+\.html)["']/i.exec(body)?.[1];
      if (foundTitle && url) papers.push({ title: strip(foundTitle), authors, url });
    }
    return papers;
  }
  function pmlrLink(volumeHTML, title, firstAuthor) {
    return pmlrPaperLink(pmlrPapers(volumeHTML), title, firstAuthor);
  }
  function pmlrPaperLink(papers, title, firstAuthor) {
    // The full paper page checks the first author again before accepting.
    return papers.find(p => sameTitle(title, p.title) && (!firstAuthor ||
      normal(p.authors).split(" ").includes(normal(firstAuthor).split(" ").at(-1))))?.url || null;
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
    const conference = tag(html, "citation_conference_title")[0];
    if (!(booktitle || conference) || !yearFrom(published)) return null;
    return {
      source: "PMLR", itemType: "conferencePaper", title: paperTitle,
      venue: booktitle || conference,
      conferenceName: booktitle?.replace(/^Proceedings of (?:the )?/i, "") ||
        conference,
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
    const records = json?.message?.items;
    if (!Array.isArray(records)) throw Error("Crossref response is missing the search result");
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

  function dblpGraphURL(title, arxivId) {
    const base = String(title).trim().replace(/\.$/, "");
    const variants = [...new Set([base, base + ".", "Position: " + base, "Position: " + base + "."])];
    // Literals are JSON-escaped (compatible with SPARQL quoted strings); the
    // only interpolated IRI component is a validated modern arXiv identifier.
    const byArxiv = /^\d{4}\.\d{4,5}$/.test(arxivId || "") ? `UNION {
      VALUES ?arxivURL { <https://arxiv.org/abs/${arxivId}> <http://arxiv.org/abs/${arxivId}> }
      ?preprint dblp:documentPage ?arxivURL; dblp:title ?preprintTitle; dblp:hasSignature ?preprintSignature .
      ?preprintSignature a dblp:AuthorSignature; dblp:signatureOrdinal ?preprintOrdinal; dblp:signatureCreator ?creator .
      FILTER (?preprintOrdinal = 1)
      ?paper dblp:authoredBy ?creator; dblp:title ?title .
      FILTER (LCASE(STR(?title)) = LCASE(STR(?preprintTitle)))
    }` : "";
    const query = `PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT DISTINCT ?paper ?title ?kind ?venue ?year ?url ?author ?booktitle ?pages ?doi WHERE {
  { VALUES ?title { ${variants.map(v => JSON.stringify(v)).join(" ")} } ?paper dblp:title ?title . }
  ${byArxiv}
  VALUES ?kind { dblp:Inproceedings dblp:Article }
  ?paper a ?kind; dblp:publishedIn ?venue; dblp:yearOfPublication ?year;
    dblp:primaryDocumentPage ?url; dblp:hasSignature ?signature .
  ?signature a dblp:AuthorSignature; dblp:signatureOrdinal ?ordinal; dblp:signatureDblpName ?author .
  FILTER (?ordinal = 1)
  OPTIONAL { ?paper dblp:publishedAsPartOf ?proceedings . ?proceedings dblp:title ?booktitle . }
  OPTIONAL { ?paper dblp:pagination ?pages . }
  OPTIONAL { ?paper dblp:doi ?doi . }
} LIMIT 50`;
    return "https://sparql.dblp.org/sparql?query=" + encodeURIComponent(query) + "&format=json";
  }

  function fromDBLPGraph(json, title, firstAuthor) {
    if (!Array.isArray(json?.results?.bindings)) throw Error("DBLP graph response is missing the search result");
    const candidates = [], seen = new Set();
    for (const row of json.results.bindings) {
      const value = name => row[name]?.value || "";
      const kind = value("kind");
      if (!["https://dblp.org/rdf/schema#Inproceedings", "https://dblp.org/rdf/schema#Article"].includes(kind)) continue;
      if (!sameTitle(title, value("title")) || !authorMatches([value("author")], firstAuthor)) continue;
      if (/^(?:corr|arxiv)$/i.test(value("venue"))) continue;
      let url;
      try { url = new URL(value("url")); } catch { continue; }
      if (url.protocol !== "https:" || /(^|\.)arxiv\.org$/i.test(url.hostname)) continue;
      if (!value("venue") || !/^\d{4}$/.test(value("year")) || seen.has(value("paper"))) continue;
      const doi = value("doi").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
      if (arxivDOI(doi)) continue;
      seen.add(value("paper"));
      candidates.push({
        source: "DBLP SPARQL", itemType: kind.endsWith("#Article") ? "journalArticle" : "conferencePaper",
        title: value("title").replace(/\.$/, ""), venue: value("booktitle") || value("venue"),
        conferenceName: kind.endsWith("#Inproceedings") ? value("venue") : "",
        year: value("year"), pages: value("pages"), url: url.href, doi,
        catalog: "DBLP", authors: [value("author")]
      });
    }
    return candidates;
  }

  async function discover({ title, firstAuthor, arxivId }, request, { cache = new Map(), currentYear = new Date().getUTCFullYear() } = {}) {
    const checks = [], candidates = [];
    const visitedVolumes = new Set();
    let acceptance = null, comment = "", directory;
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
    // Cache validated, compact directory data, never an HTML challenge or a
    // failed request. The caller may share this bounded cache across items.
    async function cached(key, read) {
      const previous = cache.get(key);
      if (previous && Date.now() - previous.time < 15 * 60_000) return previous.value;
      cache.delete(key);
      const value = await read();
      if (cache.size >= 12) cache.delete(cache.keys().next().value);
      cache.set(key, { value, time: Date.now() });
      return value;
    }
    async function getDirectory() {
      if (directory) return directory;
      directory = await cached("pmlr-directory", async () => {
        const home = await request("https://proceedings.mlr.press/");
        const volumes = pmlrVolumes(home.body);
        if (!volumes.length) throw Error("PMLR volume directory could not be read (possible verification page or changed format)");
        return volumes;
      });
      return directory;
    }
    async function checkVolume({ volume, year }) {
      if (visitedVolumes.has(volume)) return;
      visitedVolumes.add(volume);
      await attempt(`PMLR (ICML ${year})`, async () => {
        const papers = await cached("pmlr-v" + volume, async () => {
          const listing = await request(`https://proceedings.mlr.press/v${volume}/`, { maxBytes: 6_000_000 });
          const entries = pmlrPapers(listing.body);
          if (!entries.length) throw Error("PMLR paper directory could not be read (possible verification page or changed format)");
          return entries;
        });
        const link = pmlrPaperLink(papers, title, firstAuthor);
        if (!link) return null;
        const page = await request(link);
        const candidate = fromPMLR(page.body, link, volume, title, firstAuthor);
        if (!candidate) throw Error("PMLR paper metadata is incomplete or does not match the title and first author");
        return candidate;
      });
    }
    if (arxivId) {
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
      if (year) {
        try {
          const volume = (await getDirectory()).find(v => v.year === year);
          if (volume) await checkVolume(volume);
        } catch (error) {
          checks.push({ source: "PMLR", outcome: "error", detail: String(error.message).slice(0, 200) });
        }
      }
    }
    // An official PMLR match is conclusive; avoid extra traffic and rate limits.
    if (!candidates.length) await attempt("DBLP", async () => {
      const query = normal([title, firstAuthor].filter(Boolean).join(" "));
      const url = "https://dblp.org/search/publ/api?q=" + encodeURIComponent(query) + "&format=json&h=100";
      const reply = await request(url);
      const json = parseJSON(reply.body, reply.contentType, "DBLP");
      if (!json?.result?.hits) throw Error("DBLP response is missing the search result");
      return fromDBLP(json, title, firstAuthor);
    });
    // The official RDF query API is separate from the browser-facing search
    // service. It also resolves the title indexed for an arXiv ID. Do not
    // send another request to DBLP when it explicitly rate-limits us.
    if (!candidates.length && !checks.some(c => c.source === "DBLP" && /\b429\b/.test(c.detail || ""))) {
      await attempt("DBLP SPARQL", async () => {
        const reply = await request(dblpGraphURL(title, arxivId));
        return fromDBLPGraph(parseJSON(reply.body, reply.contentType, "DBLP SPARQL"), title, firstAuthor);
      });
    }
    if (!candidates.length) await attempt("Crossref", async () => {
      const url = "https://api.crossref.org/works?query.title=" + encodeURIComponent(title) + "&rows=10";
      const reply = await request(url);
      return fromCrossref(parseJSON(reply.body, reply.contentType, "Crossref"), title, firstAuthor);
    });
    // Aggregators may expose only "ICML" as the venue. Follow an official
    // PMLR link to obtain the full edition, proceedings, pages, and date.
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const volume = /^https:\/\/proceedings\.mlr\.press\/v(\d+)\/[^/?#]+\.html$/.exec(candidate.url)?.[1];
      if (candidate.source === "PMLR" || !volume) continue;
      try {
        const page = await request(candidate.url);
        const full = fromPMLR(page.body, candidate.url, volume, title, firstAuthor);
        if (!full) throw Error("PMLR paper metadata is incomplete or does not match the title and first author");
        candidates[i] = full;
        checks.push({ source: "PMLR", outcome: "found" });
      } catch (error) {
        checks.push({ source: "PMLR", outcome: "error", detail: String(error.message).slice(0, 200) });
      }
    }
    // An arXiv comments field is optional. If aggregators cannot find the
    // paper, search the official ICML volumes around its submission year.
    // The ID only narrows search order; title + first author + publisher
    // metadata, not the ID or estimated year, establish the publication.
    const submittedYear = /^\d{4}\.\d{4,5}$/.test(arxivId || "") ? 2000 + Number(arxivId.slice(0, 2)) : 0;
    if (!candidates.length && submittedYear && (!acceptance || /\bICML\b/i.test(acceptance.conferenceName))) {
      try {
        const volumes = (await getDirectory()).filter(v =>
          +v.year >= submittedYear - 1 && +v.year <= Math.min(currentYear, submittedYear + 3));
        // Same year first, following years next, previous year last (some
        // authors upload to arXiv only after proceedings publication).
        volumes.sort((a, b) => ((+a.year < submittedYear ? 100 : 0) + +a.year) -
          ((+b.year < submittedYear ? 100 : 0) + +b.year));
        for (const volume of volumes.slice(0, 5)) {
          await checkVolume(volume);
          if (candidates.length) break;
        }
      } catch (error) {
        checks.push({ source: "PMLR", outcome: "error", detail: String(error.message).slice(0, 200) });
      }
    }
    if (!candidates.length && acceptance) {
      candidates.push(acceptance);
      checks.push({ source: "arXiv acceptance note", outcome: "accepted" });
      return { status: "accepted", candidates, checks };
    }
    return { status: candidates.length ? "found" : checks.some(c => c.outcome === "error") ? "partial_failure" : "not_found", candidates, checks };
  }
  return { arxivID, sameTitle, parseJSON, arxivComment, icmlYear, acceptedProceedings, pmlrVolume, pmlrVolumes, pmlrLink, fromPMLR, fromDBLP, fromCrossref, dblpGraphURL, fromDBLPGraph, discover };
})();
