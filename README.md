# Preprint Bridge

**Find published versions, update publication information and check CCF ratings while keeping your Zotero annotations.**

[简体中文](README.zh-CN.md) · [Download](https://github.com/Kazuma-yj/perprint-bridge/releases/latest) · [Report a problem](https://github.com/Kazuma-yj/perprint-bridge/issues) · [Release notes](releases/1.2.0.md)

Preprint Bridge is a plugin for **Zotero 10.0.x**. It helps you find the conference or journal version of a preprint and refresh existing publication records. Review the metadata, then update your existing item after confirmation. Your item identity, attachments, annotations, notes, tags, and collection membership stay in place.

## Features

- **Find published versions:** look for matching conference papers and journal articles without an API key, then review the result before updating.
- **Complete publication information:** fill in the proceedings or journal title, publication date, DOI, pages and volume when available. Recognized conferences include a full name, abbreviation and year, such as `(ICML 2024)` or `(KDD 2026)`.
- **CCF rankings, including batch updates:** match existing conference or journal names locally and update the 2026 grade in Extra. Journals without abbreviations can match by full name. The bundled dataset covers part of the directory; uncertain matches stay unranked.
- **Acceptance tracking:** explicit arXiv acceptance notes can be saved as provisional metadata and checked again after proceedings are published.
- **Batch review and field differences:** queue several papers, compare before/after values in one window, then update only selected records. Stop, continue or retry unfinished items.
- **Undo within the review window:** restore this session’s publication updates. Later manual edits are protected by default, with an explicit overwrite option after reviewing differences.
- **Return to arXiv:** open the original preprint page after the item's URL has been updated to the published version.
- **One consistent Chinese/English menu** for all paper types, with distinct states for publication records, acceptance notes, unavailable sources and no match.

## Install

1. Download **`preprint-bridge-1.2.0.xpi`** from [Releases](https://github.com/Kazuma-yj/perprint-bridge/releases/latest). Choose the `.xpi` asset, not GitHub's source-code archive.
2. In Zotero, open **Tools → Plugins**, then choose **Install Plugin From File…** from the gear menu and select the XPI.
3. Restart Zotero normally and enable Preprint Bridge if needed.

Existing installations using this repository's update feed can update through Zotero's plugin update check. Very old builds pointing to `example.com` need one manual installation. Zotero must be able to reach GitHub to download updates.

**Compatibility:** Zotero 10.0.x. Zotero 7/8/9 and Zotero 11 are outside the current compatibility range. This release has automated tests and real-service metadata checks; a full desktop UI test on Windows, macOS and Linux has not been completed. See [validation details](TESTING.md).

## Use

Right-click a bibliographic parent item and open **Preprint Bridge**. Its commands keep the same names and order across preprints, accepted papers, conference papers and journal articles. Unsuitable commands are disabled rather than hidden; **How to use** explains the selection requirements.

| Command | Selection |
| --- | --- |
| Review and update publication… | One or more preprints, conference papers or journal articles |
| Update CCF rating… | One or more conference papers or journal articles |
| Advanced → Complete from an imported record… | Fallback: one preprint or pending item plus an imported publication |
| Open arXiv preprint | One item containing an arXiv identifier |
| How to use | Read the command explanations |

### Review a preprint or an existing publication

Choose **Preprint Bridge → Review and update publication…**. Compare each paper’s source and before/after fields, select the records you want to change, then click **Update N selected**. Select the bibliographic item, not its PDF attachment. The same command handles different publication sources automatically.

A title and first author are required. An arXiv identifier such as `2403.06634` in URL, DOI or Extra helps find the published version, but is not required for title-based searches. An existing publication DOI is checked directly; fallback results cannot substitute a different DOI. Multiple papers are checked sequentially; a failed item does not stop the queue. Stopping or closing the window does not undo already saved changes.

The available fields depend on the publication type and source:

| Publication type | Publication fields |
| --- | --- |
| Conference paper | Proceedings title, conference name, date, DOI, pages, volume, and publication link |
| Journal article | Journal title, date, DOI, pages, volume, and publication link |

A conference name can read `41st International Conference on Machine Learning (ICML 2024)`.

Extra stays short, alongside any notes you already wrote:

```text
arXiv: 2403.06634
CCF (2026): A (ICML)
```

An acceptance-only result also includes `Publication status: Accepted; proceedings pending`. It keeps the arXiv link and does not invent a publisher DOI.

### Batch review, overwriting and undo

- Nothing is selected by default. **Select all publications** includes only formal records with field changes; acceptance-only records require individual selection.
- **Publication found** means normalized title and first author matched. **Acceptance note only** means the evidence is the author’s arXiv note, without a publication record. These describe evidence, not confidence scores.
- Successful updates appear inline: “Publication information updated. The author list and PDFs are unchanged.” No warning-style success alert is shown.
- If you edit an item after lookup, choose **Review changes against current data…**, inspect the current/proposed values, then select it again to overwrite. Manual edits are not permanently locked.
- **Undo this window’s updates** restores the state before these saves. Later manual edits are kept by default; **Review later edits and undo…** lets you confirm and overwrite them.
- **Undo history lasts only until this window closes.** It covers publication updates made in this window, not the separate CCF or advanced manual-transfer commands.
- Stop waits for the active request or save to finish, then stops subsequent operations. Continuing/retrying retains completed results.

### When automatic lookup cannot match

This advanced fallback is for unindexed publications or substantive title changes; ordinary automatic lookup does not need it. Import the official publication with Zotero Connector. Select **both** the original preprint and the imported conference paper or journal article, then choose **Preprint Bridge → Advanced → Complete from an imported record…**. Review the result; different titles require an additional confirmation. Both items remain so you can decide whether to remove the duplicate.

### Update CCF ratings for existing papers

Select one or more conference papers or journal articles and choose **Preprint Bridge → Update CCF rating…**. Review the proposed ratings and confirm once. Matching uses the existing conference/journal names and the local CCF directory; no publication search is needed.

Only CCF labels in Extra are updated. Other metadata, user notes and pending-acceptance markers stay in place. Unmatched, ambiguous, read-only or busy items are skipped; the completion message reports the counts. A journal with no directory abbreviation gets a short label such as `CCF (2026): B`.

### Open the original arXiv page

Choose **Preprint Bridge → Open arXiv preprint**. The command also works after conversion to a published record because the arXiv identifier is retained in Extra.

### What changes

The plugin updates publication fields on the original item. Missing pages, volume or DOI in a source do not erase existing values; an arXiv DOI is removed when moving to a publication record. Existing notes in Extra are preserved, while older fields generated by this plugin are compacted.

**The original author list and PDF files remain.** Review them against the final publication, especially if authors changed between versions. The plugin does not download a replacement PDF, move annotations between PDFs, merge items, or delete duplicates.

## How matching works

An automatic match requires the normalized title and first author to agree. The publisher's `Position:` or `Position Paper:` prefix is allowed; other substantive title changes require manual review through the two-item command.

Conference and journal records are searched through DBLP (including its official SPARQL service) and Crossref, with arXiv providing preprint and acceptance information. Coverage depends on what these services index and whether a record passes the matching checks. Sources may be incomplete or temporarily blocked. **No match does not establish that a paper is unpublished.**

The same review command also parses supported publication pages and can search nearby ICML proceedings directly. PMLR currently has a dedicated page parser; other publishers rely on DOI or indexed metadata, so field completeness can vary. Validated examples include conference papers from ICML, ICLR, NeurIPS and NAACL, plus journal articles in Machine Learning and Nature. See [test coverage](TESTING.md) and [data sources](DATA_SOURCES.md).

CCF labels use the **2026 edition even for older papers**. They describe the venue, not the paper. Unlisted or ambiguous venues receive no automatic grade. See [data sources and extraction scope](DATA_SOURCES.md).

## Privacy and network access

Publication checks run when you invoke a command. Depending on the search path, public services receive the item's title, first-author surname, DOI and/or arXiv identifier; matched publication pages are also fetched. Notes, annotations, PDF contents and your whole library are not uploaded by the plugin. There is no telemetry or plugin account.

CCF matching runs locally. Some public directory data is cached temporarily in memory to reduce repeated requests. Zotero checks the GitHub-hosted update feed as part of its plugin update mechanism. Network requests have timeouts; the plugin does not repeatedly retry rate-limited requests.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No Preprint Bridge menu | Enable the plugin, leave Zotero safe mode, and select a bibliographic parent item. |
| A command is greyed out | Check the selection requirements above and whether the item is editable or already being processed. Open How to use for details. |
| First author is missing | Complete the item's author field or use the manual two-item command. |
| Search takes a while | Several sources or larger proceedings indexes may need to be checked. The review window shows queue progress and lets you stop or continue. |
| “Search incomplete” / HTML instead of JSON | A service returned an error or verification page. Try later, or import the official record and use manual transfer. |
| No CCF grade | The venue may be unlisted, missing from the bundled subset, or ambiguous. Check the official directory. |
| Update fails | Check GitHub connectivity; install the latest release XPI manually if necessary. |

For a reproducible problem, [open an issue](https://github.com/Kazuma-yj/perprint-bridge/issues/new/choose) with the arXiv ID, Zotero/plugin versions, expected result and relevant log lines. Remove private information before posting.

## Development and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for local tests, builds and releases, and [TESTING.md](TESTING.md) for release validation and its limits.

Source code is licensed under [MIT](LICENSE). Publication metadata and CCF directory attribution are documented in [DATA_SOURCES.md](DATA_SOURCES.md). This is an independent community project, unaffiliated with Zotero, arXiv or CCF.
