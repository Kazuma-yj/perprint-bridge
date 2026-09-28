# Preprint Bridge for Zotero 10

[简体中文说明](README.zh-CN.md)

Preprint Bridge finds a published record for an **arXiv preprint**, shows the
source and metadata for review, and updates the *same Zotero parent item* only
after confirmation. Its Zotero item ID, existing PDF, annotations, notes, tags,
and collections remain attached. It is an independently written project; it
does not bundle the arXiv Workflow plugin or call Semantic Scholar.

## What works in 0.1.3

- Right-click a single arXiv **preprint parent item** and choose **Find
  published version (review first)**. Do not select the PDF attachment.
- ICML papers whose arXiv comments contain `ICML 20xx` are checked against
  PMLR's official volume directory, volume index, and paper metadata.
- Other items are searched in DBLP and then Crossref. Title and first author
  must agree; arXiv / CoRR records are excluded.
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
  ICML is ranked A as a conference in Artificial Intelligence (PDF page 57).

The automatic discovery deliberately accepts only exact normalized titles and
first-author matches. If a published paper's title changes, import its official
record with Zotero Connector and use the manual two-item command. Differing
titles trigger a separate confirmation before anything is changed.

## Install

Download [preprint-bridge-0.1.3.xpi](https://github.com/Kazuma-yj/perprint-bridge/raw/refs/heads/main/dist/preprint-bridge-0.1.3.xpi) and drag it into **Zotero → Tools → Plugins**.
Zotero 10.0.x is required. Discard the previous 0.1.0–0.1.2 packages. Restart Zotero if the menu does not appear. Because this
is a first release, try it on a copy of a record before using it on your library.

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
2. Otherwise query DBLP and validate both the response format and candidate.
3. Otherwise query Crossref for a matching DOI publication.
4. If any source failed and none matched, report **incomplete search** rather
   than **unpublished**. Failed sources are shown to the user and Zotero debug log.

Each HTTP request has a 30-second timeout and a body-size cap. A large PMLR
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

The user confirmed that 0.1.2 installed and converted one ICML entry in
Zotero 10.0.3. The additional 0.1.3 features still need a live client check.
If installation still reports incompatibility, capture the `addons.xpi` lines
from **Tools → Developer → Error Console** immediately after the attempt and
provide the Zotero debug report ID.
There is no published-PDF downloader, arXiv revision downloader, bulk operation,
or automatic deletion of duplicate entries. The automatic PMLR path currently
covers ICML; other PMLR meetings can be added using the same volume mechanism.

## License

MIT. The plugin is independent source code. External records remain the
property of their respective sources.
