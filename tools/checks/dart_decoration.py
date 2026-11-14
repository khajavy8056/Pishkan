#!/usr/bin/env python3
"""Catch a `BoxDecoration` that sets both `color:` and `gradient:`.

`BoxDecoration`'s constructor asserts `!(color != null && gradient != null)`.
That is a debug assertion, so the failure mode is nasty in two directions:

  * in debug the card throws on its first build;
  * in release the assertion is compiled out and the gradient silently wins,
    so the panel looks wrong rather than crashing — and nobody sees it until
    someone compares against the mock.

A ternary pair (`gradient: mine ? g : null, color: mine ? null : c`) is the
legal way to express "one or the other", so this only reports the case where
both are unconditional.

Usage: python3 tools/checks/dart_decoration.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def _own_fields(body: str) -> str:
    """Blank out nested argument lists, keeping the decoration's own keys.

    `boxShadow: [...]` and `border: Border.all(color: ...)` both contain a
    `color:` that is not the decoration's. Everything inside balanced brackets
    is removed, so only top-level `key: value` pairs remain.
    """
    out = []
    depth = 0
    for ch in body:
        if ch in '([{':
            depth += 1
            out.append(' ')
        elif ch in ')]}':
            depth -= 1
            out.append(' ')
        else:
            out.append(ch if depth == 0 else ' ')
    return ''.join(out)


def _span(src: str, open_paren: int) -> int:
    """Index just past the `)` that closes the `(` at [open_paren]."""
    depth = 0
    i = open_paren
    while i < len(src):
        if src[i] == '(':
            depth += 1
        elif src[i] == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(src)


def conflicts(src: str):
    for m in re.finditer(r'BoxDecoration\(', src):
        end = _span(src, m.end() - 1)
        flat = _own_fields(src[m.end():end])
        colour = re.search(r'(?<![A-Za-z])color:\s*([^\n,]+)', flat)
        gradient = re.search(r'(?<![A-Za-z])gradient:\s*([^\n,]+)', flat)
        if not (colour and gradient):
            continue
        if '?' in colour.group(1) or '?' in gradient.group(1):
            continue  # legal either/or
        yield m.start()


def main(argv):
    root = Path(argv[0]) if argv else Path('apps/mobile/lib')
    files = sorted(root.rglob('*.dart')) if root.is_dir() else [root]
    total = 0
    for path in files:
        src = path.read_text(encoding='utf-8')
        for offset in conflicts(src):
            line = src[:offset].count('\n') + 1
            print(f'{path}:{line}: BoxDecoration sets both color and gradient')
            total += 1
    print(f'--- {total} decoration conflict(s)')
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
