# Data sources

## CCF rankings

The bundled data is derived from **中国计算机学会推荐国际学术会议和期刊目录**, seventh edition, March 2026 (72-page final PDF).

- Publisher: China Computer Federation (CCF).
- Official directory: <https://www.ccf.org.cn/Academic_Evaluation/By_category/>.
- Input PDF SHA-256: `271b630b576bf8a4f802e767f5694caded93680e22b3a19bef7902591c45c1d3`.
- Regeneration: `python scripts/extract_ccf.py path/to/directory.pdf` (requires `pdfplumber`).
- The PDF itself is not redistributed. Each extracted record retains its category and source page.

The extractor retains rows with a usable abbreviation and title. Since 1.1.0 it also retains journals whose abbreviation cell is blank, matching them by full journal title without inventing an abbreviation. This is a **partial matching dataset**, not a claim that every directory entry is supported. Malformed rows and conferences without a usable abbreviation are omitted. Ambiguous matches are not assigned a rank automatically.

Version 1.1.0 contains 657 extracted rows, including 46 journals with blank abbreviation cells. For example, Machine Learning is listed in the B-class artificial-intelligence journal table on page 53. Full-title matching preserves the directory's blank abbreviation rather than assigning a made-up one.

Version 1.0.0 assigns PDF glyphs to table cells by their centers to avoid mixing adjacent rows. Names such as ACNS, SACMAT, ASPLOS and CHI were checked against the source layout; the previous crop-based extraction could corrupt their names. CCF ranks are those of the **2026 edition**, including when reviewing older papers. They are reference information, not an assessment of an individual paper. CCF's current official directory takes precedence.

This project is independent of CCF and Zotero. The MIT license covers the plugin's source code; it does not claim ownership of third-party publications, trademarks or documents.

## Publication metadata

| Source | Purpose |
| --- | --- |
| [arXiv](https://arxiv.org/) | Preprint identifiers and explicit author acceptance notes |
| [PMLR](https://proceedings.mlr.press/) | Official conference proceedings and publication metadata |
| [DBLP](https://dblp.org/) / [official SPARQL API](https://sparql.dblp.org/) | Publication type, title, first author, venue, year and links |
| [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | DOI publication metadata |

CCF lookups are local. Publication checks contact the services above only when initiated by the user. See the README for the information sent and the matching limits.

The small test fixtures contain bibliographic metadata only. PMLR fixture URLs are recorded in `tests/fixtures/icml-2024.json`; the DBLP fixtures were captured from its official SPARQL API on 2026-09-28. DBLP publishes its bibliographic metadata under CC0. `tests/fixtures/crossref-publications.json` records three official Crossref DOI endpoint responses captured on 2026-09-28, reduced to citation fields; no abstracts or full texts are included.

Version 1.3.0 also reads publisher-supplied ISSN, ISBN and language, plus PMLR volume descriptions for conference location. It does not infer a publisher location from the conference location. DBLP DOI links are enriched through an exact Crossref DOI lookup, retaining title/first-author/type checks. `tests/fixtures/icml-2025-metadata.json` contains only citation metadata and the volume description for the reported ICML 2025 paper, captured from its official pages on 2026-09-28. A missing DOI in these sources is not proof that no DOI could exist elsewhere.
