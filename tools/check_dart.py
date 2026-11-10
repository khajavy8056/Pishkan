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


# Flutter types that are *siblings*, not parent/child. Passing one where the
# parameter is declared as the other is a plain compile error, and it is the
# mistake that actually happens when a widget is written for `Alignment` and
# then called with `AlignmentDirectional` (or the reverse) while adding RTL
# support. `check_dart` does not type-check, so this is checked explicitly.
SIBLING_TYPES = {
    'Alignment': {'AlignmentDirectional'},
    'AlignmentDirectional': {'Alignment'},
}


def declared_param_types(source: str) -> dict[str, dict[str, str]]:
    """Map widget class -> {field name: declared type} for its own fields.

    Only `this.x` constructor parameters with a matching `final T x;` field are
    collected, which is enough for the widgets this project writes.
    """
    classes: dict[str, dict[str, str]] = {}
    for match in re.finditer(r'\bclass\s+(\w+)\s+extends\s+\w+', source):
        name = match.group(1)
        # field declarations in the class body
        body_start = source.find('{', match.end())
        if body_start < 0:
            continue
        fields: dict[str, str] = {}
        for field in re.finditer(r'^\s*(?:final|const)\s+(\w+)\??\s+(\w+)\s*;', source[body_start:body_start + 6000], re.M):
            fields[field.group(2)] = field.group(1)
        if fields:
            classes[name] = fields
    return classes


def sibling_type_mismatches(path: Path, source: str, global_fields: dict[str, dict[str, str]]) -> list[str]:
    problems: list[str] = []
    code = strip_code(source)
    for cls, fields in global_fields.items():
        for call in re.finditer(rf'\b{cls}\s*\(', code):
            depth = 0
            i = call.end() - 1
            while i < len(code):
                if code[i] == '(':
                    depth += 1
                elif code[i] == ')':
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            body = code[call.end():i]
            for arg in re.finditer(r'\b(\w+)\s*:\s*(AlignmentDirectional|Alignment)\s*\(', body):
                field, given = arg.group(1), arg.group(2)
                want = fields.get(field)
                if want and given in SIBLING_TYPES.get(want, set()):
                    line = code[:call.start() + arg.start()].count('\n') + 1
                    problems.append(f'line {line}: {cls}.{field} is {want} but is given {given}')
    return problems


def future_void_arrow_mismatches(source: str) -> list[str]:
    """Catch `() async => expr` where the closure must be `Future<void>`.

    `() async => Navigator.push(...)` has the inferred type
    `Future<T?> Function()`, and `Future<T?>` is not assignable to `Future<void>`
    — a compile error that reads like a typo. It only happens on arrow bodies,
    so it is cheap to detect: the arrow returns a value, and the widget's own
    field is declared `Future<void> Function()`.
    """
    code = strip_code(source)
    problems: list[str] = []
    for match in re.finditer(r'on\w+:\s*\(\)\s*async\s*=>\s*', code):
        tail = code[match.end():match.end() + 120]
        # A block body or a void-ish call is fine; a `Navigator.push(`/`show*`
        # returns a future with a value.
        target = re.match(r'([\w.]+)\s*\(', tail)
        if target and target.group(1).endswith(('push', 'showDialog', 'showModalBottomSheet', 'pushNamed')):
            line = code[:match.start()].count('\n') + 1
            problems.append(f'line {line}: `() async => {target.group(1)}(...)` returns a value; use a block body')
    return problems


def nullable_callback_calls(source: str) -> list[str]:
    """Catch `() async => onTap()` when `onTap` is declared `VoidCallback?`.

    A nullable function field cannot be called without `?`/`!`, and the error
    ("The method 'call' can't be unconditionally invoked because the receiver
    can be 'null'") only appears once the field is nullable — so it is exactly
    the kind of thing that survives review.
    """
    code = strip_code(source)
    nullable = set(re.findall(r'\b(?:final\s+)?VoidCallback\?\s+(\w+)\s*;', code))
    problems: list[str] = []
    for name in nullable:
        for match in re.finditer(rf'\b{name}\(\)', code):
            # Ignore the declaration itself and null-safe/property calls.
            before = code[max(0, match.start() - 6):match.start()]
            if before.rstrip().endswith(('?', '!.', '.')):
                continue
            line = code[:match.start()].count('\n') + 1
            problems.append(f'line {line}: {name} is nullable but is called without ?')
    return problems

def directional_shader_mismatches(source: str) -> list[str]:
    """Catch a `createShader` fed by an `AlignmentDirectional` gradient.

    `Gradient.createShader(rect, [textDirection])` cannot resolve directional
    stops without a `textDirection`, and it throws "No TextDirection found" on
    *every paint* — which renders as an error page, not a slow animation. This
    cost four red builds and two wrong diagnoses; the check is cheap because the
    two tokens have to appear inside the same call.
    """
    code = strip_code(source)
    problems: list[str] = []
    for match in re.finditer(r'createShader\s*\(', code):
        # Walk back to the gradient that produces the shader. `shaderCallback:`
        # sits one widget up, so the window has to clear the whole gradient
        # literal — 400 characters was short and the check silently never fired.
        window = code[max(0, match.start() - 1200):match.start()]
        if 'AlignmentDirectional' not in window:
            continue
        # `createShader(rect, textDirection)` is the correct form.
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
        args = code[match.end():i]
        # Count top-level arguments. A nested `,` inside `Rect.fromLTWH(0, 0,
        # w, h)` is not a second argument, and counting characters instead of
        # arguments is what made this check pass the bug it was written for.
        depth = 0
        arg_count = 1
        for ch in args:
            if ch in '([{':
                depth += 1
            elif ch in ')]}':
                depth -= 1
            elif ch == ',' and depth == 0:
                arg_count += 1
        if arg_count < 2:
            line = code[:match.start()].count('\n') + 1
            problems.append(
                f'line {line}: directional gradient used in createShader() without a textDirection arg '
                '(throws "No TextDirection found" on every paint)'
            )
    return problems

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

    # Widget field types, across every file, so a widget declared in one place
    # and called in another is still checked.
    global_fields: dict[str, dict[str, str]] = {}
    for path in files:
        try:
            global_fields.update(declared_param_types(path.read_text(encoding='utf-8')))
        except OSError:
            continue

    total = 0
    for path in files:
        problems = check_file(path)
        source = path.read_text(encoding='utf-8')
        problems.extend(sibling_type_mismatches(path, source, global_fields))
        problems.extend(future_void_arrow_mismatches(source))
        problems.extend(nullable_callback_calls(source))
        problems.extend(directional_shader_mismatches(source))
        if problems:
            total += len(problems)
            print(f'{path.relative_to(ROOT)}')
            for problem in problems:
                print(f'  {problem}')

    print(f'\n{len(files)} file(s) checked, {total} problem(s).')
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
