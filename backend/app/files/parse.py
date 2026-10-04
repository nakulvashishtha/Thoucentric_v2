"""Parse uploaded csv, xlsx and txt into plain text with locators (cells, lines) for quote verification."""
from __future__ import annotations

import csv
import io

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

ALLOWED = {".csv", ".xlsx", ".txt", ".md", ".pdf"}
MAX_PDF_PAGES = 200
MAX_CHARS = 200_000


class UnsupportedFile(Exception):
    pass


def ext(filename: str) -> str:
    return ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def parse(filename: str, data: bytes) -> str:
    e = ext(filename)
    if e not in ALLOWED:
        raise UnsupportedFile(f"{filename} isn't a file type we can read. Upload a csv, xlsx, txt or pdf file instead.")
    if e in (".txt", ".md"):
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        return "\n".join(f"[line {i}] {ln}" for i, ln in enumerate(lines, start=1) if ln.strip())[:MAX_CHARS]
    if e == ".pdf":
        return _pdf(data)
    if e == ".csv":
        rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig", errors="replace"))))
        out = []
        for r, row in enumerate(rows, start=1):
            cells = [f"[{get_column_letter(c)}{r}] {_cell(v)}" for c, v in enumerate(row, start=1) if _cell(v)]
            if cells:
                out.append(" | ".join(cells))
        return "\n".join(out)[:MAX_CHARS]
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        out.append(f"## Sheet: {ws.title}")
        for r, row in enumerate(ws.iter_rows(values_only=True), start=1):
            cells = [f"[{ws.title}!{get_column_letter(c)}{r}] {_cell(v)}" for c, v in enumerate(row, start=1)
                     if _cell(v)]
            if cells:
                out.append(" | ".join(cells))
            if sum(len(x) for x in out) > MAX_CHARS:
                break
    wb.close()
    return "\n".join(out)[:MAX_CHARS]


def _pdf(data: bytes) -> str:
    """Text per page with [page N] markers, so a quote can be checked against its page."""
    import pdfplumber
    out = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages[:MAX_PDF_PAGES], start=1):
            text = (page.extract_text() or "").strip()
            if text:
                out.append(f"[page {i}]\n{text}")
            page.flush_cache()
            if sum(len(x) for x in out) > MAX_CHARS:
                break
    if not out:
        raise UnsupportedFile("We couldn't find any text in this PDF. It may be a scan. Upload a text version instead.")
    return "\n\n".join(out)[:MAX_CHARS]
