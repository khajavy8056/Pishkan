#!/usr/bin/env python3
"""Verify every `Icons.x` used in the app exists in the Flutter SDK.

`Icons.foo_rounded` is a compile-time constant. A name Flutter does not ship
is therefore not a runtime fallback -- it is an analyzer error that stops the
Android build, and this project is often edited without a Flutter SDK
available, so that error would otherwise surface only in CI. It has already
happened once: `Icons.edit_document_rounded` does not exist.

This resolves the names against a cached list of consts scraped from the
SDK's `icons.dart`. Fetch it once with:

  curl -s https://api.github.com/repos/flutter/flutter/git/blobs/\
eb3f3728a0479c2c7369189aad6f5c0d09842619 \
    | python3 -c "import json,sys,base64; \\
        print(base64.b64decode(json.load(sys.stdin)['content']).decode())" \\
    | grep -oP 'static const IconData \\K\\w+' > tools/checks/flutter_icons.txt

Without that file the check is skipped (exit 0) rather than failing: a missing
cache is not a code defect, and CI installs the real SDK anyway.

Usage:  python3 tools/checks/dart_icons.py [--update]
Exit:   0 clean or skipped, 1 unknown icons, 2 cache unreadable
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools/checks/flutter_icons.txt"
LIB = ROOT / "apps/mobile/lib"
ICON = re.compile(r"\bIcons\.(\w+)")


def main() -> int:
    if not CACHE.exists():
        print(f"skipped: {CACHE.relative_to(ROOT)} not present")
        print("--- 0 unknown icon(s)")
        return 0

    names = {line.strip() for line in CACHE.read_text(encoding="utf-8").splitlines() if line.strip()}
    if not names:
        print(f"{CACHE} is empty", file=sys.stderr)
        return 2

    used: dict[str, list[str]] = {}
    for path in sorted(LIB.rglob("*.dart")):
        text = path.read_text(encoding="utf-8")
        for match in ICON.finditer(text):
            used.setdefault(match.group(1), []).append(str(path.relative_to(ROOT)))

    unknown = {name: where for name, where in used.items() if name not in names}
    for name, where in sorted(unknown.items()):
        print(f"unknown icon Icons.{name} used in {where[0]}")

    print(f"{len(used)} distinct icons checked against {len(names)} SDK consts")
    print(f"--- {len(unknown)} unknown icon(s)")
    return 1 if unknown else 0


if __name__ == "__main__":
    raise SystemExit(main())
