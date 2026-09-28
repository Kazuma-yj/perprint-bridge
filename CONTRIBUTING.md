# Contributing

Bug reports should include a public arXiv identifier, Zotero/plugin versions,
operating system, expected result, actual result and relevant log lines.
Please remove private information. Do not upload your Zotero database.

## Local development

Use Node.js 18+ (CI uses 24) and Python 3. No npm packages are required.
Browser interaction tests additionally use Playwright 1.62.1 and Chromium.

```sh
npm test
python3 scripts/build.py
python3 scripts/verify_package.py
node scripts/publish-release.cjs --dry-run
```

`build.py` creates a deterministic `dist/preprint-bridge-VERSION.xpi` and
updates `update.json`. `verify_package.py` compares every packaged file with
source and checks the version, bootstrap callbacks, update URLs and SHA-256.

Install the XPI in a separate Zotero 10.0.x test profile for UI checks. Test
normal startup, disabling/re-enabling, menu visibility, Chinese/English labels,
confirmation cancellation, a successful update and an unavailable source.
Inspect the item and its attachments before and after writing.

## Tests

Unit tests use Node's test runner and mocked Zotero objects. Real bibliographic
fixtures are in `tests/fixtures/`. They do not replace desktop UI testing.

Run the packaged XHTML review-window interaction tests:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install --with-deps chromium
UI_SCREENSHOT_DIR=ui-results node tests/review-ui.browser.cjs
```

The test serves the actual XHTML, CSS and UI script on localhost with a fixture
controller. It covers selection, success, stop/retry, undo, explicit overwrite,
untrusted title text, both languages and a narrow dark viewport. It does not
emulate Zotero's chrome privileges, menus or item database. CI runs this check
before the release job and uploads its report and screenshots.

The optional integration check contacts public services:

```sh
node scripts/live-smoke.cjs
node scripts/live-smoke.cjs 2403.06634 2106.09685
```

It prints a JSON report to stdout and progress to stderr. `SMOKE_CACHE_DIR` can
point to a local response cache to avoid repeated requests. Identify cached
replays as such in any test report; service availability can change results.
Do not commit downloaded full HTML pages or personal library data.

## CCF dataset

See [DATA_SOURCES.md](DATA_SOURCES.md) for the source edition and input hash.
Regeneration additionally requires `pdfplumber`:

```sh
python3 scripts/extract_ccf.py path/to/ccf-2026.pdf
npm test
```

Inspect changed names against the PDF table layout. The dataset is a partial
mapping; do not turn an ambiguous abbreviation into an automatic grade.

## Maintainer release procedure

1. Update `manifest.json` and `package.json` to a new `x.y.z` version. Keep the
   add-on ID stable for existing installations.
2. Add `releases/VERSION.md`, update the READMEs and record validation in
   `TESTING.md`. Add the new versioned XPI to `.gitignore`'s allowlist.
3. Run the four local commands above. Commit the generated XPI and
   `update.json` alongside the source. Never overwrite an older published XPI.
4. Push to `main`. CI tests and rebuilds the package, then checks that its bytes
   agree with the committed package and update feed.
5. In this repository, the release job creates a **draft** `vVERSION` release,
   uploads the exact XPI and `SHA256SUMS.txt`, verifies both assets, and then
   publishes the release. It uses the repository's `GITHUB_TOKEN`; no personal
   access token is required. A rerun verifies an existing release without
   replacing its assets. Mismatched assets fail the job.

The automatic release job only runs on pushes to this repository's `main`.
Forks can build and test, but need their own add-on ID, update URLs and publishing
configuration before distributing an independently maintained plugin.

Zotero uses the raw GitHub `update.json` feed and versioned XPI. A GitHub Release
provides the public download page; the feed does not depend on release assets.
