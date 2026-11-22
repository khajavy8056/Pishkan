#!/usr/bin/env python3
"""Find `.member` accesses that the variable's own class does not declare.

This is the check that would have caught `service.updatedAt`, the error that
failed the 1.4.0 build. It was subtle in a specific way: `AppBanner` and
`ServiceRequestSummary` both *do* have an `updatedAt`, so a project-wide search
for the name comes back clean. Only `CatalogService` lacks it — and only a
type-aware check sees that.

How it works, and what it is not:

  * every class in `lib/` gets its own set of declared members;
  * a variable's class is inferred from its declaration in the same file
    (`final CatalogService service`, a constructor param `CatalogService
    service`, or `? Service? service`);
  * each `variable.member` is then checked against *that* class;
  * unknowns inherited from other files are out of scope, so a field defined in
    the same class must be found there.

It is not a type checker: it does not follow inheritance, generics or
inference, and if it cannot see a variable's type it says nothing. That makes
it quiet by design — a checker that reports things it cannot prove is one that
gets deleted.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Members every Dart object has, plus the collection API that appears on lists.
BUILTIN = {
    'runtimeType', 'hashCode', 'toString', 'noSuchMethod', 'length', 'isEmpty',
    'isNotEmpty', 'first', 'last', 'single', 'map', 'where', 'toList', 'add',
    'addAll', 'contains', 'forEach', 'join', 'any', 'every', 'fold', 'reduce',
    'then', 'catchError', 'split', 'trim', 'replaceAll', 'replaceFirst',
    'substring', 'startsWith', 'endsWith', 'toUpperCase', 'toLowerCase',
    'toInt', 'toDouble', 'round', 'floor', 'ceil', 'abs', 'clamp', 'value',
    'key', 'dispose', 'build', 'call', 'indexOf', 'remove', 'removeAt',
    'insert', 'sort', 'reversed', 'difference', 'expand', 'take', 'skip',
    'whereType', 'firstWhere', 'lastWhere', 'singleWhere', 'asMap', 'cast',
    'elementAt', 'containsKey', 'keys', 'values', 'putIfAbsent', 'now',
    'isDark', 'surface', 'ink', 'brand', 'inkMuted', 'hairline', 'sizes',
}


def strip_noise(src: str) -> str:
    """Blank out comments and string literals, preserving offsets and lines."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                out.append(' ')
                i += 1
            continue
        if c in "'\"":
            quote = c
            out.append(' ')
            i += 1
            while i < n and src[i] != quote:
                if src[i] == '\\':
                    out.append(' ')
                    i += 1
                    if i < n:
                        out.append(' ')
                        i += 1
                    continue
                out.append('\n' if src[i] == '\n' else ' ')
                i += 1
            if i < n:
                out.append(' ')
                i += 1
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def class_bodies(src: str) -> dict[str, str]:
    """Map class name -> body text, using top-level `class` boundaries."""
    bodies: dict[str, str] = {}
    marks = [(m.group(1), m.start()) for m in
             re.finditer(r'\n(?:abstract\s+|final\s+|sealed\s+)?class\s+(\w+)', src)]
    for idx, (name, start) in enumerate(marks):
        end = marks[idx + 1][1] if idx + 1 < len(marks) else len(src)
        bodies[name] = src[start:end]
    return bodies


def members_of(body: str) -> set[str]:
    names: set[str] = set()
    names |= set(re.findall(r'\bfinal\s+[\w<>?,\[\]\s]+?\s(\w+)\s*;', body))
    names |= set(re.findall(r'\b(?:required\s+)?this\.(\w+)', body))
    names |= set(re.findall(r'\b(?:get|set)\s+(\w+)', body))
    # Methods: `Type name(` or `name(` at member indentation.
    names |= set(re.findall(
        r'^\s{2,}(?:static\s+)?[\w<>?,\[\]\s]*?\b(\w+)\s*\(', body, re.M))
    # enum values
    names |= set(re.findall(r'^\s*(\w+),?$', body, re.M))
    return names


def main(argv: list[str]) -> int:
    root = Path(argv[0]) if argv else Path('apps/mobile/lib')
    files = sorted(root.rglob('*.dart')) if root.is_dir() else [root]

    per_class: dict[str, set[str]] = {}
    sources: dict[Path, str] = {}
    for path in files:
        raw = path.read_text(encoding='utf-8')
        clean = strip_noise(raw)
        sources[path] = clean
        for name, body in class_bodies(clean).items():
            per_class.setdefault(name, set()).update(members_of(body))

    problems = 0
    for path, src in sources.items():
        for index, (cls, body) in enumerate(class_bodies(src).items()):
            allowed = per_class.get(cls, set())
            # Variables of this class, declared in this body:
            #   final CatalogService service
            #   CatalogService service,
            #   required this.service  (handled via type in the ctor)
            # Only variables whose declared type is a class we know. The
            # declaration has to be an explicit `Type name =` / `Type name,`
            # in this body — no guessing from `this.x`.
            typed: dict[str, str] = {}
            for known in per_class:
                for vm in re.finditer(
                    rf'\b{re.escape(known)}\??\s+(\w+)\s*(?:=[^=]|,|;|\))', body
                ):
                    typed[vm.group(1)] = known
            for var, vcls in typed.items():
                # `X.instance.serverUrl` is a singleton whose members live on
                # X — not a variable of type X. Skip the whole idiom.
                if var in ('instance', 'self', 'this'):
                    continue
                v_allowed = per_class.get(vcls, set())
                for m in re.finditer(rf'\b{re.escape(var)}\.(\w+)', body):
                    member = m.group(1)
                    if member in v_allowed or member in BUILTIN:
                        continue
                    line = src[:src.find(body) + m.start()].count('\n') + 1
                    print(
                        f'{path.relative_to(root.parent)}:{line}: '
                        f'`{var}.{member}` — {cls} has no `{member}`'
                    )
                    problems += 1

    print(f'--- {problems} unknown member access(es)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
