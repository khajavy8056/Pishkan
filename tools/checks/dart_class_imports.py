#!/usr/bin/env python3
"""Find classes used in a Dart file that no import can possibly provide.

`flutter analyze` catches this as a hard error ("undefined class"), but there is
no Dart toolchain in this environment — so a missing import ships, CI fails
eleven minutes later, and the failure text is not even reachable from here.
This is the check that closes that loop.

It is deliberately conservative and only speaks about **declared class, enum and
mixin names** — tokens it can see defined somewhere in `lib/`. It does not try
to understand generics, extensions or inference, and it stays quiet when the
symbol could come from a package it cannot read. That means false negatives,
never false alarms; a checker that cries wolf gets switched off.

Usage:
    python3 tools/check_symbol_imports.py [lib_dir]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Names that belong to another package or to the SDK. A file using one of these
# without a matching import is a real error too, but resolving it needs the
# package sources, so they are out of scope here.
SKIP_PREFIXES = ('_',)

DECL = re.compile(r'^(?:abstract\s+|final\s+|sealed\s+)?(?:class|enum|mixin)\s+(\w+)', re.M)
IMPORT = re.compile(r"^import\s+'([^']+)'", re.M)
EXPORT = re.compile(r"^export\s+'([^']+)'", re.M)


def resolve(from_file: Path, spec: str, lib: Path) -> Path | None:
    if spec.startswith('package:pishkan_app/'):
        return (lib / spec[len('package:pishkan_app/'):]).resolve()
    if spec.startswith(('dart:', 'package:')):
        return None
    return (from_file.parent / spec).resolve()


def strip_comments(src: str) -> str:
    """Blank out comments and string literals, keeping every line where it was.

    A doc comment that says «see [WaveNavBar.height]» is not a use of that class,
    and neither is a word inside a Persian label. Without this the check cries
    wolf on prose — and a check that cries wolf is a check that gets switched
    off, which is how a missing import reached a release build once already.
    """
    out: list[str] = []
    i, n = 0, len(src)
    block = 0
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if block:
            if c == '/' and nxt == '*':
                block += 1
                out.append('  ')
                i += 2
                continue
            if c == '*' and nxt == '/':
                block -= 1
                out.append('  ')
                i += 2
                continue
            out.append('\n' if c == '\n' else ' ')
            i += 1
            continue
        if c == '/' and nxt == '/':
            while i < n and src[i] != '\n':
                out.append(' ')
                i += 1
            continue
        if c == '/' and nxt == '*':
            block += 1
            out.append('  ')
            i += 2
            continue
        if c in ('"', "'"):
            quote = c
            out.append(' ')
            i += 1
            while i < n:
                ch = src[i]
                if ch == '\\':
                    out.append('  ')
                    i += 2
                    continue
                if ch == '\n':  # a string never spans lines here; stop and re-sync
                    break
                out.append(' ')
                i += 1
                if ch == quote:
                    break
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def declared_in(path: Path) -> set[str]:
    try:
        return set(DECL.findall(path.read_text(encoding='utf-8')))
    except OSError:
        return set()


def main(argv: list[str]) -> int:
    lib = Path(argv[0]).resolve() if argv else (ROOT / 'apps' / 'mobile' / 'lib')

    # `flutter analyze` analyzes `test/` too, which is exactly where the
    # release build died: a widget test importing the deleted story viewer.
    # Both trees are scanned, and test files may import from either.
    files = sorted(lib.rglob('*.dart'))
    test_dir = lib.parent / 'test'
    if test_dir.is_dir():
        files += sorted(test_dir.rglob('*.dart'))
    # Which file declares which class?
    owners: dict[str, set[Path]] = {}
    for path in files:
        for name in declared_in(path):
            owners.setdefault(name, set()).add(path.resolve())

    problems: list[str] = []
    for path in files:
        raw = path.read_text(encoding='utf-8')
        # Imports are read from the raw text; *uses* from the comment-free text.
        src = strip_comments(raw)
        own = declared_in(path)

        # A non-existent import is a hard error in `flutter analyze` and the
        # single most likely thing to rot: delete a screen, forget a test.
        # This is what the deleted story viewer left behind in the widget test.
        for spec in IMPORT.findall(raw):
            if spec.startswith('dart:'):
                continue
            if spec.startswith('package:') and not spec.startswith('package:pishkan_app/'):
                continue
            target = resolve(path, spec, lib)
            if target is None or not target.exists():
                problems.append(
                    f'{path.relative_to(lib.parent)}: imports `{spec}`, which does not exist'
                )

        # Everything this file can name: direct imports, plus one level of
        # re-export, which is how a barrel file legitimately exposes a class.
        reachable: set[str] = set(own)
        for spec in IMPORT.findall(raw):
            target = resolve(path, spec, lib)
            if target is None or not target.exists():
                continue
            reachable |= declared_in(target)
            for re_export in EXPORT.findall(target.read_text(encoding='utf-8')):
                deeper = resolve(target, re_export, lib)
                if deeper is not None and deeper.exists():
                    reachable |= declared_in(deeper)

        for name, where in owners.items():
            if name in reachable or name.startswith(SKIP_PREFIXES):
                continue
            if not re.search(rf'\b{re.escape(name)}\b', src):
                continue
            wanted = ', '.join(sorted(p.name for p in where))
            problems.append(
                f'{path.relative_to(lib.parent)}: uses `{name}` (declared in {wanted}) '
                f'but no import brings it in'
            )

    for problem in problems:
        print(f'  {problem}')
    print(f'--- {len(problems)} missing symbol import(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
