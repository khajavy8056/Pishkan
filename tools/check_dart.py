#!/usr/bin/env python3
"""Catch the mistakes that make a Flutter file fail to compile.

There is no Dart toolchain in this environment, so a syntax error only shows up
when CI runs, several minutes later. This is a small scanner that finds the
handful of mistakes a person actually makes when editing these files:

  * unbalanced brackets, ignoring everything inside strings and comments
    (including `${...}` interpolation, which nests)
  * an identifier that needs `package:flutter/material.dart` but the import is
    missing — the classic "context is not defined" after a refactor
  * `const` in front of a widget whose argument list contains a value that is
    not a compile-time constant (a `context.palette` lookup, for example)

It does not type-check. It catches the errors that were actually made.

Usage:
    python3 tools/check_dart.py [files...]     # default: apps/mobile/lib
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Widgets that take a BuildContext, so `context.palette` is meaningful there.
NEEDS_MATERIAL = [
    'Widget', 'BuildContext', 'ThemeData', 'IconData', 'Color', 'Colors',
    'TextStyle', 'EdgeInsets', 'BorderRadius', 'BoxDecoration', 'MediaQuery',
]

# A `const` constructor call is invalid if its argument list contains one of
# these: the value is only known at run time.
NON_CONST_MARKERS = ('context.palette', 'context.sizes', 'Theme.of(', 'MediaQuery.of(')


def strip_code(source: str) -> str:
    """Source with comments and string literals blanked, interpolation kept."""
    out: list[str] = []
    i, n = 0, len(source)
    while i < n:
        c = source[i]
        # line comment
        if source.startswith('//', i):
            while i < n and source[i] != '\n':
                i += 1
            continue
        # block comment
        if source.startswith('/*', i):
            i += 2
            depth = 1
            while i < n and depth:
                if source.startswith('/*', i):
                    depth += 1
                    i += 2
                elif source.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            continue
        # raw / normal string, including ''' forms
        for quote in ("'''", '"""', "'", '"'):
            if source.startswith(quote, i):
                triple = len(quote) == 3
                i += len(quote)
                while i < n:
                    if source[i] == '\\':
                        i += 2
                        continue
                    if source.startswith(quote, i):
                        i += len(quote)
                        break
                    # ${...} is real code: keep it so brackets still balance
                    if source.startswith('${', i):
                        depth = 0
                        j = i + 1
                        while j < n:
                            if source[j] == '{':
                                depth += 1
                            elif source[j] == '}':
                                depth -= 1
                                if depth == 0:
                                    break
                            j += 1
                        out.append(source[i:j + 1])
                        i = j + 1
                        continue
                    if source[i] == '\n' and not triple:
                        break
                    i += 1
                out.append('""')
                break
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def check_file(path: Path) -> list[str]:
    source = path.read_text(encoding='utf-8')
    code = strip_code(source)
    problems: list[str] = []

    for open_c, close_c in (('{', '}'), ('(', ')'), ('[', ']')):
        delta = code.count(open_c) - code.count(close_c)
        if delta:
            problems.append(f'unbalanced {open_c}{close_c}: {delta:+d}')

    # An import is needed if a Flutter type is referenced but not imported.
    if any(re.search(rf'\b{name}\b', code) for name in NEEDS_MATERIAL):
        if 'package:flutter/material.dart' not in source and 'package:flutter/widgets.dart' not in source:
            problems.append('uses Flutter types but does not import material.dart')
    if 'context.palette' in code or 'context.sizes' in code:
        if "core/theme.dart" not in source and 'sizes.dart' not in source:
            problems.append('uses context.palette/context.sizes without the import')

    # `const X(... y: context.palette.ink ...)` cannot compile.
    for match in re.finditer(r'\bconst\s+\w+\s*\(', code):
        start = match.start()
        depth = 0
        i = match.end() - 1
        while i < len(code):
            if code[i] == '(':
                depth += 1
            elif code[i] == ')':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        body = code[start:i + 1]
        for marker in NON_CONST_MARKERS:
            if marker in body:
                line = code[:start].count('\n') + 1
                problems.append(f'line {line}: const constructor contains {marker}')
                break

    return problems


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv] or [ROOT / 'apps' / 'mobile' / 'lib']
    files: list[Path] = []
    for target in targets:
        files.extend(sorted(target.rglob('*.dart')) if target.is_dir() else [target])

    total = 0
    for path in files:
        problems = check_file(path)
        if problems:
            total += len(problems)
            print(f'{path.relative_to(ROOT)}')
            for problem in problems:
                print(f'  {problem}')

    print(f'\n{len(files)} file(s) checked, {total} problem(s).')
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
