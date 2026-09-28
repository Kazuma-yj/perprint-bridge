"""Extract rankings from CCF's seventh-edition (March 2026) directory.

Usage: python scripts/extract_ccf.py path/to/ccf-2026.pdf
Requires pdfplumber for regeneration. The source PDF is not redistributed.
"""
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]


def cell_text(page, cell):
    """Assign each glyph to the cell containing its center.

    A few PDF glyph boxes extend past row borders. Cropping cuts and duplicates
    those glyphs in adjacent rows; requiring full containment drops the last
    line. Center assignment keeps each glyph once, with its original geometry.
    """
    if not cell:
        return ""
    left, top, right, bottom = cell
    chars = [c for c in page.chars
             if left <= (c["x0"] + c["x1"]) / 2 < right
             and top <= (c["top"] + c["bottom"]) / 2 < bottom]
    return pdfplumber.utils.extract_text(chars, x_tolerance=2, y_tolerance=2) or ""
# Page spans refer to the 72-page CCF directory (2026), counting the cover.
SECTIONS = [
    (2, 4, "journal", "计算机体系结构/并行与分布计算/存储系统"),
    (5, 9, "conference", "计算机体系结构/并行与分布计算/存储系统"),
    (10, 12, "journal", "计算机网络"),
    (13, 16, "conference", "计算机网络"),
    (17, 19, "journal", "网络与信息安全"),
    (20, 23, "conference", "网络与信息安全"),
    (24, 26, "journal", "软件工程/系统软件/程序设计语言"),
    (27, 31, "conference", "软件工程/系统软件/程序设计语言"),
    (32, 34, "journal", "数据库/数据挖掘/内容检索"),
    (35, 37, "conference", "数据库/数据挖掘/内容检索"),
    (38, 40, "journal", "计算机科学理论"),
    (41, 43, "conference", "计算机科学理论"),
    (44, 46, "journal", "计算机图形学与多媒体"),
    (47, 50, "conference", "计算机图形学与多媒体"),
    (51, 56, "journal", "人工智能"),
    (57, 60, "conference", "人工智能"),
    (61, 63, "journal", "人机交互与普适计算"),
    (64, 66, "conference", "人机交互与普适计算"),
    (67, 69, "journal", "交叉/综合/新兴"),
    (70, 72, "conference", "交叉/综合/新兴"),
]


def main(pdf_path):
    entries = []
    with pdfplumber.open(pdf_path) as document:
        if len(document.pages) != 72:
            raise ValueError("Expected the supplied 72-page 2026 directory")
        for first, last, kind, area in SECTIONS:
            grade = None
            for number in range(first, last + 1):
                page = document.pages[number - 1]
                text = page.extract_text() or ""
                match = re.search(r"[一二三]、\s*([ABC])\s*类", text)
                if match:
                    grade = match[1]
                elif number == first:
                    # The PDF text stream for page 10 is corrupted; its A-class
                    # heading is visible when rendering that page.
                    if number != 10:
                        raise ValueError(f"Missing section heading on page {number}")
                    grade = "A"
                if grade is None:
                    raise ValueError(f"Missing classification on page {number}")
                for table in page.find_tables():
                    for row in table.rows:
                        if len(row.cells) < 5:
                            continue
                        cells = [cell_text(page, cell) for cell in row.cells]
                        if not re.fullmatch(r"\d{1,3}", cells[0].strip()):
                            continue
                        acronym = " ".join(cells[1].split())
                        title = " ".join(cells[2].split())
                        # Skip broken cells and entries without a distinct acronym;
                        # abstain rather than assigning an unreliable ranking.
                        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9+./&-]{1,19}", acronym):
                            continue
                        if len(title) < 6 or not re.search(r"[A-Za-z]{4}", title):
                            continue
                        entries.append({"acronym": acronym, "title": title,
                                        "grade": grade, "kind": kind,
                                        "area": area, "page": number})
    if not any(x["acronym"] == "ICML" and x["grade"] == "A" and x["page"] == 57
               for x in entries):
        raise ValueError("ICML classification failed to extract")
    # Publication names often appear in multiple areas; the runtime checks
    # ambiguity and never guesses when distinct grades match.
    entries.sort(key=lambda x: (x["kind"], x["acronym"].casefold(), x["page"]))
    out = ROOT / "content" / "ccf-data.js"
    out.write_text("/* CCF seventh edition (March 2026). Source and extraction notes: DATA_SOURCES.md. */\n"
                   "var PreprintBridgeCCFEntries = "
                   + json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
                   + ";\n", encoding="utf-8")
    print(f"{len(entries)} parsed table rows -> {out}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/extract_ccf.py path/to/ccf-2026.pdf")
    main(sys.argv[1])
