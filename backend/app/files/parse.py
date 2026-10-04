"""Parse uploaded csv, xlsx and txt into plain text with locators (cells, lines) for quote verification."""
from __future__ import annotations

import csv
import io

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter

ALLOWED = {".csv", ".xlsx", ".txt", ".md"}
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
        raise UnsupportedFile(f"{filename}: only csv, xlsx and txt files are accepted here")
    if e in (".txt", ".md"):
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        return "\n".join(f"[line {i}] {ln}" for i, ln in enumerate(lines, start=1) if ln.strip())[:MAX_CHARS]
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
