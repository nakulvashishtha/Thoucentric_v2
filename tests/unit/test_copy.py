"""Simple checks over frontend/src/copy.ts (section 12.6). They catch drift, not tone."""
from __future__ import annotations

import re
from pathlib import Path

COPY = Path(__file__).resolve().parents[2] / "frontend" / "src" / "copy.ts"
SRC = COPY.read_text(encoding="utf-8")

BANNED = ["rule engine", "llm", "language model", "schema", "fixture", "spans?", "derivation", "sanitis", "sanitiz",
          "orchestrat", "pipeline", "leverag", "utilis", "utiliz", "initiat", "proceed", "execut", "seamless",
          "robust", "delve", "unlock", "powerful", "insights", "journey"]
VERBS = {"start", "try", "import", "open", "delete", "continue", "cancel", "confirm", "lock", "mark", "run", "reset",
         "remove", "restore", "add", "save", "copy", "download", "edit", "stop", "review", "view", "move", "accept",
         "use", "reject", "fill", "draft", "skip", "test", "stress-test", "write", "print", "export", "check"}
EXEMPT_BUTTONS = {"Matches", "Doesn't match", "Copied",   # answers to a check and a short confirmation
                  "Use this as the new target"}          # wording chosen by the user after their test
NEXT_STEP = re.compile(r"\b(try|check|add|refresh|use|choose|download|open|press|switch|select)\b", re.I)


def _strings(text: str) -> list[str]:
    """Every double-quoted and template string literal (template placeholders removed)."""
    out = [m.group(1) for m in re.finditer(r'"((?:[^"\\\n]|\\.)*)"', text)]
    out += [re.sub(r"\$\{[^}]*\}", "X", m.group(1)) for m in re.finditer(r"`((?:[^`\\]|\\.)*)`", text)]
    return out


def _block(name: str) -> str:
    m = re.search(rf"export const {name}\b[^=]*=\s*\{{", SRC)
    assert m, name
    depth, i = 0, m.end() - 1
    while True:
        depth += {"{": 1, "}": -1}.get(SRC[i], 0)
        if depth == 0:
            return SRC[m.end():i]
        i += 1


def _values(block: str, key: str | None = None) -> list[str]:
    pat = rf'\b{key}:\s*"((?:[^"\\]|\\.)*)"' if key else r'\b\w+:\s*"((?:[^"\\]|\\.)*)"'
    return re.findall(pat, block)


def test_no_banned_words_or_exclamation_marks():
    for s in _strings(SRC):
        low = s.lower()
        assert "!" not in s, s
        for w in BANNED:
            assert not re.search(rf"\b{w}", low), f"'{w}' in: {s}"


def test_instructions_are_short():
    instructions = _values(_block("steps"), "instruction")
    assert len(instructions) == 12
    for s in instructions:
        assert len(s.split()) <= 45, s


def test_buttons_are_short_verbs():
    labels = _values(_block("buttons")) + _values(_block("steps"), "primary")
    assert len(labels) > 40
    for b in labels:
        if b in EXEMPT_BUTTONS:
            continue
        assert len(b.split()) <= 4, b
        assert b.split()[0].lower() in VERBS, f"button should start with a verb: {b}"


def test_tooltips_are_short():
    for s in _values(_block("tips")):
        assert len(s.split()) <= 30, s


def test_errors_name_a_next_step():
    errs = _values(_block("errors"))
    assert errs
    for s in errs:
        assert NEXT_STEP.search(s), f"error should say what to do next: {s}"


def test_components_hold_no_literal_text():
    """Components take their words from copy.ts: no JSX text nodes made of letters."""
    root = COPY.parent
    for f in list(root.rglob("*.tsx")):
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"(?<![=\-])>\s*([A-Za-z][A-Za-z ,.'’]{2,})\s*(?:</|\{)", text):
            raise AssertionError(f"{f.name}: literal text '{m.group(1)}' should come from copy.ts")
