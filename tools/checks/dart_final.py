#!/usr/bin/env python3
"""Flag assignments to locals declared `final` or `const`.

`final x = ...;` followed by `x = ...` is a compile error ("Can't assign to
the final variable 'x'"). It is easy to introduce when a value that used to be
read-only starts being updated from a sheet or dialog closure.

Only local declarations are tracked: parameters and fields are skipped,
because those are legal to reassign when they are not final.

Usage: python3 tools/checks/dart_final.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

DECL = re.compile(r'\b(final|const)\s+(?:[\w<>?,\[\]]+\s+)?(\w+)\s*=(?!=)')
ASSIGN = r'(?<![\w.])%s\s*(?:=(?!=)|\+=|-=|\?\?=)'
REDECL = re.compile(r'\b(final|const|var|late)\s*$')


def strip_noise(src: str) -> str:
    """Blank out comments and string literals, keeping line numbers stable."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in src[i:j]))
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
    for decl in DECL.finditer(code):
        name = decl.group(2)
        # Walk to the end of the enclosing function body by brace depth.
        depth = 0
        end = len(code)
        for pos in range(decl.end(), len(code)):
            ch = code[pos]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth < 0:
                    end = pos
                    break
        body = code[decl.end():end]
        for asg in re.finditer(ASSIGN % re.escape(name), body):
            if REDECL.search(body[max(0, asg.start() - 14):asg.start()]):
                continue
            hits.append((code[:decl.end() + asg.start()].count('\n') + 1, name))
    return hits


def main(argv):
    root = Path(argv[1] if len(argv) > 1 else 'apps/mobile/lib')
    files = [root] if root.is_file() else sorted(root.rglob('*.dart'))
    total = 0
    for path in files:
        for line, name in check(path):
            print(f'{path}:{line}: assigns to final local `{name}`')
            total += 1
    print(f'--- {total} assignment(s) to final/const locals')
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
