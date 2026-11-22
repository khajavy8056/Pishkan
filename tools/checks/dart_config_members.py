#!/usr/bin/env python3
"""Catch a renamed model field that a test still reads under the old name.

`dart_members.py` checks `<var>.<member>` for a hand-listed set of model
variables, but only inside `lib/`, and only for variables it can type. It does
not look at `test/` at all — which is exactly where this went wrong: renaming
`AppConfig.storiesEnabled` to `bannersEnabled` left
`expect(config.storiesEnabled, isTrue)` in `models_test.dart`, and the analyzer
called it `undefined_getter`. That one line failed six release builds, and
because `flutter analyze` and `flutter test` both compile the test files, it
took the whole pipeline down while every check here reported clean.

The rule this enforces: a member used on a variable whose type is a class this
project declares must exist on *that* class. It runs over `lib/` and `test/`.

Usage: python3 tools/checks/dart_config_members.py apps/mobile
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

CLASS = re.compile(r'^[a-zA-Z ]*class\s+(\w+)', re.M)
# `final AppConfig config = ...` / `AppConfig config = ...` / `var config = AppConfig.fromJson`
DECL_TYPED = re.compile(r'\b([A-Z]\w*)\s+([a-z_]\w*)\s*=[^;]*;')
DECL_INFERRED = re.compile(r'\b(?:final|var|late\s+final)\s+([a-z_]\w*)\s*=\s*([A-Z]\w*)\.')

# Members every object has, plus collection API that model classes delegate to.
BUILTIN = set('''
length isEmpty isNotEmpty first last single add addAll remove clear contains keys
values toString runtimeType hashCode noSuchMethod map where toList
'''.split())


def strip_noise(src: str) -> str:
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                out[i] = ' '
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            out[i] = out[i + 1] = ' '
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                if src[i] != '\n':
                    out[i] = ' '
                i += 1
            for _ in range(2):
                if i < n:
                    out[i] = ' '
                    i += 1
        elif c in '\'"':
            q = c
            out[i] = ' '
            i += 1
            while i < n:
                if src[i] == '\\':
                    out[i] = ' '
                    i += 1
                    if i < n:
                        out[i] = ' '
                        i += 1
                    continue
                if src[i] == q:
                    out[i] = ' '
                    i += 1
                    break
                if src[i] != '\n':
                    out[i] = ' '
                i += 1
        else:
            i += 1
    return ''.join(out)


def class_members(root: Path) -> dict[str, set[str]]:
    members: dict[str, set[str]] = {}
    for path in root.rglob('*.dart'):
        src = strip_noise(path.read_text(encoding='utf-8'))
        marks = [(m.group(1), m.start()) for m in CLASS.finditer(src)]
        for idx, (name, start) in enumerate(marks):
            end = marks[idx + 1][1] if idx + 1 < len(marks) else len(src)
            body = src[start:end]
            found: set[str] = set()
            for m in re.finditer(r'\bget\s+(\w+)', body):
                found.add(m.group(1))
            for m in re.finditer(r'^  [\w<>?,\s\[\]]*?\b(\w+)\s*(?:;|=|\{)', body, re.M):
                found.add(m.group(1))
            for m in re.finditer(r'this\.(\w+)', body):
                found.add(m.group(1))
            # methods: `Future<X> name(` / `void name(` / `X name(` at member indent
            for m in re.finditer(r'^  (?:static\s+)?[\w<>?,\s\[\]]*?\b(\w+)\s*\(', body, re.M):
                found.add(m.group(1))
            # named constructors of this class
            for m in re.finditer(r'\b' + re.escape(name) + r'\.(\w+)\s*\(', body):
                found.add(m.group(1))
            members.setdefault(name, set()).update(found)
    return members


def main(argv: list[str]) -> int:
    base = Path(argv[0]) if argv else Path('apps/mobile')
    lib = base / 'lib'
    members = class_members(lib)

    problems = 0
    for folder in (lib, base / 'test'):
        for path in sorted(folder.rglob('*.dart')):
            raw = path.read_text(encoding='utf-8')
            src = strip_noise(raw)
            # Every declaration, in source order. A file can reuse a name
            # (`service` is a CatalogService in one test and an AppBanner in
            # the next), so each access resolves to the nearest one *above* it
            # rather than to whichever came last in the file.
            decls: list[tuple[int, str, str]] = []
            for m in DECL_TYPED.finditer(src):
                decls.append((m.start(), m.group(2), m.group(1)))
            for m in DECL_INFERRED.finditer(src):
                decls.append((m.start(), m.group(1), m.group(2)))
            decls.sort()

            for m in re.finditer(r'(?<![\w.])([a-z_]\w*)\.(\w+)', src):
                var, member = m.group(1), m.group(2)
                cls = next((c for pos, v, c in reversed(decls)
                            if v == var and pos < m.start()), None)
                if cls is None or cls not in members:
                    continue
                if member in BUILTIN or member in members[cls]:
                    continue
                line = src[:m.start()].count('\n') + 1
                print(f'{path}:{line}: {var}.{member} — {cls} declares no `{member}`')
                problems += 1
    print(f'--- {problems} member(s) missing from the type they are read on')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
