#!/usr/bin/env python3
"""Find `const` expressions that reference `context` (or any non-const value).

`const Text(..., color: context.ink)` does not compile: `context` is a runtime
value. This happens easily when a palette sweep replaces
`PishkanColors.navy` with `context.ink` inside a widget that was `const`, and
the analyzer reports it as "Invalid constant value" — one of several errors
that blocked the Android build.

Usage: python3 tools/checks/dart_const.py apps/mobile/lib [--write]
`--write` removes the offending `const` keyword in place.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# A const expression cannot contain these, at any nesting depth.
NON_CONST = re.compile(r'\b(context|Theme\.of|Localizations\.of|MediaQuery\.of|ModalRoute\.of)\b')


def strip_strings(src: str) -> str:
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
                j += 1
            out.append(' ' * (j - i))
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


CONST_TOKEN = re.compile(r'\bconst\b')


def offenders(path: Path):
    """Yield (line, const_offset) for each `const` whose expression uses context."""
    raw = path.read_text(encoding='utf-8')
    code = strip_strings(raw)
    results = []
    for match in CONST_TOKEN.finditer(code):
        start = match.end()
        # The const expression ends at the matching close bracket of the first
        # bracket that opens, or at the end of a simple literal.
        i = start
        while i < len(code) and code[i] in ' \n\t':
            i += 1
        head = code[i:i + 40]
        # `const [` / `const {` / `const SomeWidget(`
        bracket_index = None
        depth_stack = []
        for j in range(i, min(len(code), i + 200)):
            ch = code[j]
            if ch in '([{':
                bracket_index = j
                break
            if ch == ';' or ch == ',':
                break
        if bracket_index is None:
            continue
        opener = code[bracket_index]
        closer = {'(': ')', '[': ']', '{': '}'}[opener]
        depth = 0
        end = bracket_index
        while end < len(code):
            ch = code[end]
            if ch in '([{':
                depth += 1
            elif ch in ')]}':
                depth -= 1
                if depth == 0:
                    break
            end += 1
        expression = code[bracket_index:end + 1]
        # Only a direct reference matters: identifiers inside nested strings are
        # already blanked, and a nested closure parameter named `context` would
        # be unusual in a const expression (which cannot contain closures anyway).
        if NON_CONST.search(expression):
            line = code[:match.start()].count('\n') + 1
            results.append((line, match.start(), match.end()))
    return results


def main(argv):
    root = Path(argv[1] if len(argv) > 1 else 'apps/mobile/lib')
    write = '--write' in argv
    total = 0
    for path in sorted(root.rglob('*.dart')):
        found = offenders(path)
        if not found:
            continue
        for line, start, end in found:
            print(f'{path}:{line}: const expression references a runtime value')
            total += 1
        if write:
            raw = path.read_text(encoding='utf-8')
            # remove from the end so offsets stay valid
            for _line, start, end in reversed(found):
                raw = raw[:start] + raw[end:]
            path.write_text(raw, encoding='utf-8')
    print(f'--- {total} offending const expression(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
