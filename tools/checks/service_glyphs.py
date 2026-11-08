#!/usr/bin/env python3
"""Guard the "every service has its own icon" promise.

Two failure modes are possible once the catalogue grows and nobody looks:

  * a new service is added without a glyph, so it silently falls back to the
    keyword rules and can end up sharing a symbol with a neighbour;
  * two services are handed the same glyph, which is exactly the bug this
    replacement was written to remove.

Both are cheap to detect from the source files, so CI can refuse the build
instead of shipping a phone full of duplicate icons.

Usage:  python3 tools/checks/service_glyphs.py
Exit:   0 clean, 1 violations (printed one per line)
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GLYPHS = ROOT / "apps/mobile/lib/core/service_glyphs.dart"
BUNDLED = ROOT / "apps/mobile/lib/core/bundled_art.dart"
TILES = ROOT / "apps/mobile/assets/service_art"


def slugs_in(path: Path, decl: str) -> set[str]:
    """Slugs from the quoted-string set named `decl` (`const x = <String>{...}`)."""
    text = path.read_text(encoding="utf-8")
    start = text.find(decl)
    if start < 0:
        return set()
    block = text[start : text.index("};", start)]
    return set(re.findall(r"'([a-z0-9-]+)'", block))


def main() -> int:
    if not GLYPHS.exists():
        print(f"missing {GLYPHS.relative_to(ROOT)}", file=sys.stderr)
        return 1

    source = GLYPHS.read_text(encoding="utf-8")
    # only the map body, so the resolver's `case '...'` lines cannot be counted
    body = source[: source.index("};")]
    mapping = dict(re.findall(r"'([a-z0-9-]+)':\s*'([a-z0-9_]+)'", body))

    problems: list[str] = []

    # 1. no two services share a glyph
    owners: dict[str, list[str]] = defaultdict(list)
    for slug, glyph in mapping.items():
        owners[glyph].append(slug)
    for glyph, who in sorted(owners.items()):
        if len(who) > 1:
            problems.append(f"shared glyph {glyph!r}: {', '.join(sorted(who))}")

    # 2. every bundled service is covered
    services = slugs_in(BUNDLED, "const bundledServiceArt")
    if services:
        for slug in sorted(services - set(mapping)):
            problems.append(f"no glyph for bundled service {slug!r}")
        for slug in sorted(set(mapping) - services):
            problems.append(f"glyph for unknown service {slug!r}")

    # 3. every glyph resolves to a real `Icons.` const
    for glyph in sorted(owners):
        if f"return Icons.{glyph}_rounded;" not in source:
            problems.append(f"glyph {glyph!r} has no Icons.{glyph}_rounded branch")

    # 4. one picture per service, still true after the icon change
    if TILES.is_dir():
        tiles = {p.stem for p in TILES.glob("*.webp")}
        if services:
            for slug in sorted(services - tiles):
                problems.append(f"bundled service {slug!r} has no tile webp")

    print(
        f"{len(mapping)} services, {len(owners)} unique glyphs, "
        f"{len(services)} bundled"
    )
    for line in problems:
        print(line)
    print(f"--- {len(problems)} glyph problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
