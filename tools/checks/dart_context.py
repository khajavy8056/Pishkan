#!/usr/bin/env python3
"""Find `context.` used in a method that has no `context` in scope.

`StatelessWidget` has a `context` only inside `build`. Any other method on one
must take a `BuildContext` explicitly, and forgetting it is an
`undefined_identifier` — a hard analyzer error that looks completely correct in
the editor, because the identical expressions compile three methods above.

That is exactly what happened in `StageTimeline._row`: making the timeline
dark-mode aware added `context.isDark`, `context.brand`, `context.surface` and
two `context.ink*` reads to a method with no parameter, and it went unnoticed
for six release builds.

`State` subclasses are skipped on purpose: they carry `context` as a field, so
flagging them produces fifty true-but-useless hits that bury the real finding.

Usage: python3 tools/checks/dart_context.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

CLASS = re.compile(r'^(?:abstract\s+)?class\s+(\w+)\s+extends\s+([\w<>]+)', re.M)
METHOD = re.compile(
    r'^  (?:Future<[^>]*>|void|Widget|String|bool|int|double|Color|List<[^>]*>)'
    r'\s+(\w+)\s*\(([^)]*)\)\s*\{', re.M)

# Widgets whose instances hold a `context` field, so `context.` is legal in any
# method.
CONTEXT_OWNERS = {'State', 'StatefulWidget', 'ChangeNotifier', 'InheritedWidget'}


def body_of(src: str, open_brace: int) -> str:
    depth = 0
    for i in range(open_brace, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                return src[open_brace:i]
    return src[open_brace:]


def main(argv: list[str]) -> int:
    root = Path(argv[0]) if argv else Path('apps/mobile/lib')
    files = sorted(root.rglob('*.dart')) if root.is_dir() else [root]

    problems = 0
    for path in files:
        src = path.read_text(encoding='utf-8')
        marks = [(m.group(1), m.group(2), m.start()) for m in CLASS.finditer(src)]
        for idx, (cls, base, start) in enumerate(marks):
            end = marks[idx + 1][2] if idx + 1 < len(marks) else len(src)
            # `extends State<HomeTab>` — strip the type arguments before
            # comparing, or every `_XxxState` helper reports as a violation.
            if base.split('<')[0] in CONTEXT_OWNERS:
                continue
            for m in METHOD.finditer(src, start, end):
                name, params = m.group(1), m.group(2)
                if 'BuildContext' in params:
                    continue
                text = body_of(src, m.end() - 1)
                if re.search(r'(?<![A-Za-z0-9_.])context\.', text):
                    line = src[:m.start()].count('\n') + 1
                    print(
                        f'{path}:{line}: {cls}.{name}() reads `context` but '
                        f'takes no BuildContext'
                    )
                    problems += 1

    print(f'--- {problems} method(s) with an out-of-scope context')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
