"""Build preview/user-journey-demo.html: the real built frontend, inlined, plus the offline preview layer.

Steps (from the repository root):
  cd frontend && npm run build && cd ..                 # the real app's frontend, unchanged
  .venv/bin/python preview/tools/record_states.py       # real states from the real backend (demo data mode)
  .venv/bin/python preview/tools/build_preview.py       # one self-contained HTML file
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "frontend" / "dist"
TOOLS = ROOT / "preview" / "tools"
OUT = ROOT / "preview" / "user-journey-demo.html"


def safe_script(text: str) -> str:
    return text.replace("</script", "<\\/script").replace("<!--", "<\\!--")


def main() -> None:
    html = (DIST / "index.html").read_text(encoding="utf-8")
    # no internet: drop the web-font links; the app's CSS falls back to Segoe UI / Arial and Consolas
    html = re.sub(r'\s*<link rel="(?:preconnect|stylesheet)" href="https://fonts\.[^"]+"[^>]*>', "", html)
    css = re.search(r'<link rel="stylesheet"[^>]*href="(/assets/[^"]+\.css)"[^>]*>', html)
    js = re.search(r'<script type="module"[^>]*src="(/assets/[^"]+\.js)"[^>]*></script>', html)
    assert css and js, "run the frontend build first"
    css_text = (DIST / css.group(1).lstrip("/")).read_text(encoding="utf-8")
    js_text = (DIST / js.group(1).lstrip("/")).read_text(encoding="utf-8")
    data = (TOOLS / "states.json").read_text(encoding="utf-8")
    layer = (TOOLS / "preview.js").read_text(encoding="utf-8")
    html = html.replace(css.group(0), f"<style>\n{css_text}\n</style>")
    html = html.replace(js.group(0), "")
    html = html.replace("<title>Research Workbench</title>", "<title>Research Workbench - user journey preview</title>")
    head_end = (f'<script type="application/json" id="rw-preview-data">{safe_script(data)}</script>\n'
                f"<script>\n{safe_script(layer)}\n</script>\n"
                f'<script type="module">\n{safe_script(js_text)}\n</script>\n</head>')
    html = html.replace("</head>", head_end, 1)
    assert "https://" not in re.sub(r"<script[\s\S]*?</script>", "", html), "the page must not load anything online"
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
