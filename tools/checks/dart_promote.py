#!/usr/bin/env python3
"""Flag `x!`/`x?.`-promoted fields that are dereferenced bare inside a closure.

Dart promotes a *local* variable to non-null after `x != null` or `x!`, but
that promotion does **not** carry into a closure, and it never applies to a
field of the enclosing object (`this.artwork`) at all. The analyzer then
reports "The property 'y' can't be unconditionally accessed because the
receiver can be 'null'" — one hard error per use, which is enough to fail
`flutter analyze`.

The fix is always the same: bind the value to a local (`final art = artwork!;`)
and use that inside the closure.

Usage: python3 tools/checks/dart_promote.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# `x!` or `x != null` establishes promotion for local `x`.
PROMOTED = re.compile(r'\b([a-z][A-Za-z0-9_]*)\s*!|'
                      r'\b([a-z][A-Za-z0-9_]*)\s*!=\s*null')
# A closure body: `( ... ) {` or `=>` after a parameter list.
CLOSURE = re.compile(r'\([^()]*\)\s*(?:async\s*)?(?:\{|=>)')


def strip_noise(src: str) -> str:
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif c in ('"', "'"):
            triple = src[i:i + 3] in ('"""', "'''")
            quote = src[i:i + 3] if triple else c
            j = i + len(quote)
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j:j + len(quote)] == quote:
                    j += len(quote)
                    break
                if src[j] == '\n' and not triple:
                    break
                j += 1
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in src[i:j]))
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def check(path: Path):
    code = strip_noise(path.read_text(encoding='utf-8'))
    hits = []
    for m in PROMOTED.finditer(code):
        name = m.group(1) or m.group(2)
        # Only fields are interesting: `this.name` or a declaration of
        # `final T? name;` in this file means field, and a field can never be
        # promoted at all. Locals are safe.
        is_field = re.search(r'\b(?:this\.)' + name + r'\b', code) or \
            re.search(r'^\s{2}(?:final|late|const)\s+[\w<>?, ]+\?\s+' + name + r'\s*;', code, re.M)
        if not is_field:
            continue
        # Look inside every closure that follows, for a bare use of `name`
        # without `!` or `?` after it.
        for cl in CLOSURE.finditer(code, m.end()):
            # Stop at the end of the enclosing method body (next top-level `}`).
            body = code[cl.end():cl.end() + 2000]
            for use in re.finditer(r'(?<![\w.!?])' + re.escape(name) + r'(?![\w!?])', body):
                line = code[:cl.end() + use.start()].count('\n') + 1
                hits.append((line, name))
                break
            break
    return hits


def main(argv):
    root = Path(argv[1] if len(argv) > 1 else 'apps/mobile/lib')
    files = [root] if root.is_file() else sorted(root.rglob('*.dart'))
    total = 0
    for path in files:
        for line, name in check(path):
            print(f'{path}:{line}: `{name}` promoted outside but used bare in a closure')
            total += 1
    print(f'--- {total} closure promotion(s)')
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
