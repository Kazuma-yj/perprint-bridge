# Preprint Bridge for Zotero 10

[简体中文说明](README.zh-CN.md)

Preprint Bridge finds a published record for an **arXiv preprint**, shows the
source and metadata for review, and updates the *same Zotero parent item* only
after confirmation. Its Zotero item ID, existing PDF, annotations, notes, tags,
and collections remain attached. It is an independently written project; it
does not bundle the arXiv Workflow plugin or call Semantic Scholar.

## What works in 0.1.5

- Right-click a single arXiv **preprint parent item** and choose **Check
  publication or acceptance (review first)**. Do not select the PDF attachment.
- ICML papers whose arXiv comments contain `ICML 20xx` are checked against
  PMLR's official volume directory, volume index, and paper metadata.
- Other items are searched using DBLP search, its official SPARQL endpoint,
  and Crossref. If none matches, ICML volumes from one year before through
  three years after arXiv submission (no later than the current year; at most
  five volumes) are checked even when arXiv has no conference comment.
  Main conference volumes are distinguished from affiliated workshops.
  Title and first author must agree; informal / arXiv / CoRR records are excluded.
- If no publisher record is indexed but the arXiv comments explicitly state
  acceptance with a full proceedings name, year, and acronym, you may review
  and save provisional conference metadata. The arXiv URL stays in place, no
  unverified publisher DOI is added, and the item remains eligible for a later
  publisher-record search.
- Every source reports `found`, `no match`, or an explicit error. An HTTP 200
  anti-bot HTML page is diagnosed as an error, not treated as valid JSON or as
  proof of no publication.
- Right-click one arXiv preprint and one existing conference/journal item to
  **copy published metadata to preprint**. This keeps both items, so you can
  inspect them before deleting any duplicate.
- Preprint PDF attachments are kept. The plugin changes bibliographic metadata,
  not PDF bytes; obtain the publisher PDF separately when desired.
- For PMLR items, the recommended citation supplies the full proceedings
  title, series, publication date, volume and pages. A separate command checks
  existing PMLR conference-paper records updated by previous versions.
- CCF 2026 ranks appear in the review dialog and in the item's Extra field
  when the publication matches an unambiguous entry in the supplied directory.
  ICML is A and IMC is B. Conference names include an abbreviation and year,
  for example `(ICML 2025)` or `(IMC 2026)`. Extra holds only the arXiv ID,
  a short CCF label, and provisional status where applicable, preserving user notes.

Automatic discovery requires normalized title and first-author matches.
The publisher-added `Position:` / `Position Paper:` prefix is the only allowed
editorial title difference; there is no fuzzy title matching. If a published paper's title changes, import its official
record with Zotero Connector and use the manual two-item command. Differing
titles trigger a separate confirmation before anything is changed.

## Install

Build `dist/preprint-bridge-0.1.5.xpi` and drag it into **Zotero → Tools → Plugins**. Once this version is published, its download will be available at `https://raw.githubusercontent.com/Kazuma-yj/perprint-bridge/main/dist/preprint-bridge-0.1.5.xpi`.
Zotero 10.0.x is required. Discard older packages and restart Zotero after installing. See [TESTING.md](TESTING.md) for the recorded checks and remaining client limitations.

## Build and test

```sh
npm test
python scripts/build.py
```

The XPI appears under `dist/`. Node 18+ and Python 3 are sufficient; no npm
dependencies are needed. The tests cover discovery and metadata application
with mocked Zotero objects. A live Zotero 10 installation is needed to verify
the context menu, translations, and API behavior before publishing a release.

## How discovery decides

1. Read the arXiv page. If its comments identify an ICML year, search the
   matching PMLR volume; accept a matching official PMLR record.
2. Otherwise query DBLP search and its official SPARQL API, validating
   the response format, publication type, title, and first-author ordinal.
3. Otherwise query Crossref for a matching DOI publication.
4. Search nearby ICML volumes if no aggregator matches. If there is still no
   formal record but the arXiv acceptance note gives a
   complete proceedings citation, offer that provisional status for review.
5. If any source failed and neither a formal nor a provisional record was
   found, report **incomplete search** rather than **unpublished**.

Each HTTP request has a 30-second timeout and a body-size cap. Parsed PMLR
directories are cached for 15 minutes, at most 12 entries. Failed requests and
verification pages are not cached. Disabling cancels pending item updates. A large PMLR
volume index may take longer than a small DBLP query. No automatic retry loop
is used when a service is throttling requests.

## Publishing on your GitHub

The manifest points to `https://raw.githubusercontent.com/Kazuma-yj/perprint-bridge/main/update.json`.
Build generates `update.json` with the XPI's SHA-256 and a download URL for
the versioned XPI committed under `dist/`. Publish both files together, and
keep each published XPI immutable so previously installed versions can verify
their downloads. Keep the add-on ID stable for existing installations. The source PDF is not bundled; the rankings were
extracted from the provided CCF 2026 directory (605 unambiguous table rows).
Run `python scripts/extract_ccf.py path/to/ccf-2026.pdf` with `pdfplumber`
installed to regenerate the data from that 72-page document.

The user confirmed that an earlier version converted one ICML entry in
Zotero 10.0.3. Version 0.1.5 has network integration tests documented in TESTING.md and
still needs a full live Zotero client check.
If installation still reports incompatibility, capture the `addons.xpi` lines
from **Tools → Developer → Error Console** immediately after the attempt and
provide the Zotero debug report ID.
There is no published-PDF downloader, arXiv revision downloader, bulk operation,
or automatic deletion of duplicate entries. The automatic PMLR path currently
covers ICML; other PMLR meetings can be added using the same volume mechanism.

## License

MIT. The plugin is independent source code. External records remain the
property of their respective sources.

The bootstrap exports `shutdown` before startup. Zotero 10.0.3 can also emit
“missing bootstrap method” when no plugin scope was loaded (for example,
during safe-mode transitions). This warning is not claimed to be fully fixed.
The tests additionally cover disabling during initialization and discovery.
