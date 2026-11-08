#!/usr/bin/env python3
"""Flag identifiers used in a file whose declaring library is not imported.

Dart has no transitive visibility: importing `services.dart` does not make
`models.dart`'s `asMap()` visible, even if `services.dart` imports it. The
analyzer calls that "Undefined name" — a hard error that then cascades through
every file that builds on the same screen.

Usage: python3 tools/checks/dart_imports.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Names that are language keywords, Flutter/dart core, or otherwise always
# available and not worth resolving.
IGNORE = set('''
abstract as assert async await base break case catch class const continue
covariant default deferred do dynamic else enum export extends extension
external factory false final finally for Function get hide if implements
implements import in interface is late library mixin new null on operator part
required rethrow return sealed set show static super switch sync this throw
true try type typedef var void when while with yield
int double num bool String List Map Set Iterable Object Future Stream Duration
DateTime RegExp IconData Color Widget BuildContext Text TextStyle EdgeInsets
SizedBox Column Row Container Center Padding Expanded Flexible Align
'''.split())

DECL = [
    (re.compile(r'^(?:abstract\s+|sealed\s+|base\s+|final\s+)*(?:class|mixin|enum|extension|typedef)\s+(\w+)', re.M), None),
    (re.compile(r'^(?:Future<[^>]*>|Stream<[^>]*>|void|bool|int|double|num|String|Widget|dynamic|Object|List<[^>]*>|Map<[^>]*>|Set<[^>]*>|Iterable<[^>]*>)\s+(\w+)\s*[<(]', re.M), None),
    (re.compile(r'^(?:final|const|late)\s+[\w<>?,\s\[\]]+?\s+(\w+)\s*=', re.M), None),
    (re.compile(r'^(?:final|const)\s+(\w+)\s*=', re.M), None),
]


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
            q = src[i:i + 3] if src[i:i + 3] in ('"""', "'''") else c
            j = i + len(q)
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j:j + len(q)] == q:
                    j += len(q)
                    break
                j += 1
            out.append(''.join('\n' if ch == '\n' else ' ' for ch in src[i:j]))
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def main(argv):
    root = Path(argv[1] if len(argv) > 1 else 'apps/mobile/lib')
    files = sorted(root.rglob('*.dart'))
    declared: dict[str, set[str]] = {}
    for path in files:
        code = strip_noise(path.read_text(encoding='utf-8'))
        for pattern, _ in DECL:
            for m in pattern.finditer(code):
                declared.setdefault(m.group(1), set()).add(str(path))

    problems = 0
    for path in files:
        raw = path.read_text(encoding='utf-8')
        code = strip_noise(raw)
        imported: set[str] = set()
        for m in re.finditer(r"""import\s+['"]([^'"]+)['"]""", raw):
            uri = m.group(1)
            if uri.startswith('package:pishkan_app/'):
                target = root / uri[len('package:pishkan_app/'):]
            elif uri.startswith(('package:', 'dart:')):
                continue
            else:
                target = (path.parent / uri).resolve()
            try:
                imported.add(str(target.relative_to(Path.cwd())))
            except ValueError:
                imported.add(str(target))
        imported.add(str(path))

        local = set(re.findall(r'\b(?:final|const|var|late)\s+(?:[\w<>?,\[\]]+\s+)?([a-zA-Z_]\w*)\s*[=;]', code))
        local |= set(re.findall(r'([a-zA-Z_]\w*)\s*:', code))
        local |= set(re.findall(r'\(\s*([a-zA-Z_][\w, ]*)\)', code))
        local_names = set()
        for chunk in local:
            local_names.update(re.split(r'[^\w]+', chunk))

        seen: set[str] = set()
        for m in re.finditer(r'(?<![\w.$])([A-Za-z_]\w*)\s*\(', code):
            name = m.group(1)
            if name in seen or name in IGNORE or name in local_names:
                continue
            seen.add(name)
            owners = declared.get(name)
            if not owners or str(path) in owners:
                continue
            if owners & imported:
                continue
            line = code[:m.start()].count('\n') + 1
            print(f'{path}:{line}: `{name}` is declared in {sorted(owners)} but not imported')
            problems += 1
    print(f'--- {problems} unresolved identifier(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
