"""The word 'partner' never appears in the app's own text; no example-client name in app code or config."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_DIRS = [ROOT / "frontend" / "src", ROOT / "backend" / "app", ROOT / "backend" / "prompts", ROOT / "backend" / "config"]
EXCLUDE = ("samples", "fixtures", "design", "node_modules", "__pycache__")
EXAMPLE_NAMES = ["Atlas", "Example Client", "Meridian", "Nakuru"]


def _files():
    for d in APP_DIRS:
        if not d.exists():
            continue
        for p in d.rglob("*"):
            if p.is_file() and not any(x in p.parts for x in EXCLUDE) and p.suffix in (
                    ".py", ".ts", ".tsx", ".css", ".html", ".md", ".yaml", ".yml", ".json", ".txt"):
                yield p


def test_no_partner_wording():
    hits = [str(p) for p in _files() if re.search(r"partner", p.read_text(encoding="utf-8"), re.I)]
    assert hits == []


def test_no_example_client_names():
    hits = [(str(p), n) for p in _files() for n in EXAMPLE_NAMES if n.lower() in p.read_text(encoding="utf-8").lower()]
    assert hits == []
