#!/usr/bin/env python3
"""Catch arguments passed to a widget that does not declare them.

This exists because of one specific, expensive mistake: `Positioned(top: ..,
end: ..)` instead of `PositionedDirectional`. `Positioned` has `left`/`right`
and no `start`/`end`; the directional variant is the one that takes
`start`/`end`. The analyzer calls it `undefined_named_parameter` and it is a hard
error — it broke two release builds in a row, and no local check could see it,
because the tools here do not know Flutter's API.

So this encodes the small set of SDK widgets where a plausible-looking argument
is actually invalid, and it checks the frameworks' own rules for them. It is a
table, not an analysis, and it says so. When another of these bites, add a row.

Usage: python3 tools/checks/dart_params.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Widget -> (required argument names that do NOT exist on it, the alternative)
# Only *wrong* names are listed, so a correct call is never flagged.
WRONG_PARAMS: dict[str, dict[str, str]] = {
    'Positioned': {
        'start': 'PositionedDirectional',
        'end': 'PositionedDirectional',
    },
    'Positioned.fill': {
        'start': 'PositionedDirectional',
        'end': 'PositionedDirectional',
        'top': 'PositionedDirectional',
    },
    'Padding': {
        'horizontal': 'EdgeInsets.symmetric',
        'vertical': 'EdgeInsets.symmetric',
    },
    'SizedBox': {
        'widthFactor': 'FractionallySizedBox',
    },
    'Container': {
        'size': 'width/height',
    },
}


def _call_args(src: str, open_paren: int) -> str:
    """The text between the parens at [open_paren] and its match."""
    depth = 0
    for i in range(open_paren, len(src)):
        if src[i] == '(':
            depth += 1
        elif src[i] == ')':
            depth -= 1
            if depth == 0:
                return src[open_paren + 1:i]
    return src[open_paren + 1:]


def main(argv: list[str]) -> int:
    root = Path(argv[0]) if argv else Path('apps/mobile/lib')
    files = sorted(root.rglob('*.dart')) if root.is_dir() else [root]

    problems = 0
    for path in files:
        src = path.read_text(encoding='utf-8')
        for widget, wrong in WRONG_PARAMS.items():
            # `Widget(` — not `Widget.foo(` for the plain case, and allow the
            # named constructor form to be written explicitly.
            pattern = re.escape(widget) + r'\('
            if '.' in widget:
                pattern = re.escape(widget) + r'\('
            for m in re.finditer(pattern, src):
                # Skip when the match is the tail of a longer name:
                # `FractionallySizedBox(` also ends in `SizedBox(`.
                before = src[m.start() - 1] if m.start() else ''
                if before.isalnum() or before in '_.$':
                    continue
                # Skip the directional alternative (`PositionedDirectional(`).
                if re.search(r'Directional' + pattern, src[max(0, m.start() - 16):m.end()]):
                    continue
                args = _call_args(src, m.end() - 1)
                # Only the top level counts: a nested `child: Positioned(...)`
                # is handled by its own match.
                top = []
                depth = 0
                for ch in args:
                    if ch in '([{':
                        depth += 1
                    elif ch in ')]}':
                        depth -= 1
                    elif depth == 0:
                        top.append(ch)
                flat = ''.join(top)
                for bad, suggestion in wrong.items():
                    if re.search(rf'(?<![A-Za-z.]){re.escape(bad)}\s*:', flat):
                        line = src[:m.start()].count('\n') + 1
                        print(
                            f'{path}:{line}: `{widget}` has no `{bad}:` — '
                            f'use {suggestion}'
                        )
                        problems += 1

    print(f'--- {problems} invalid argument(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
