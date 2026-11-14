#!/usr/bin/env python3
"""Verify `ClassName.member` against the members that class actually declares.

`dart_members.py` does this for a hand-listed set of *model variables*. This
does it for every `Capitalized.member` access in the tree, which covers the
other shape the same bug takes: static fields, `ClassName.values`, so a rename
on the class (`success` -> `positive`, `catalog` -> `services`) leaves call
sites pointing at a member that no longer exists. The analyzer calls it
`undefined_getter` / `undefined_identifier` — a hard error — and nothing else
in this repo looks at it.

Deliberately one-sided: a member that is *declared* but has one occurrence is
fine, and members inherited from a superclass are missed. So this only reports
accesses where the name exists nowhere in the class *or any class* — the
confident cases. When it is quiet, it has not proved absence; when it speaks,
it is right.

Usage: python3 tools/checks/dart_statics.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

MODS = r'(?:(?:abstract|sealed|base|final|interface)\s+)*'
CLASS_LINE = re.compile(r'^' + MODS + r'class\s+(\w+)', re.M)
EXTENDS = re.compile(r'^' + MODS + r'class\s+(\w+)\s+extends\s+(\w+)', re.M)
MIXIN = re.compile(r'^(?:abstract\s+)?mixin\s+(\w+)', re.M)
MEMBER = re.compile(r'^(?:  |\t)(?:static\s+)?(?:const\s+|final\s+|late\s+)?'
                    r'(?:[\w<>?,\s\.]+?\s+)?([a-zA-Z_]\w*)\s*(?:[=;,({]|=>)', re.M)
ACCESS = re.compile(r'(?<![\w.$])([A-Z]\w*)\.([a-zA-Z_]\w*)')

# Members every Dart class/collection carries, plus Flutter factory
# constructors and the getters they expose. Access to one of these is never
# evidence of a typo.
BUILTIN = set('''
new key hashCode runtimeType toString noSuchMethod
length isEmpty isNotEmpty first last single add addAll remove removeAt insert
clear contains containsKey containsValue forEach map where toList toSet toMap
join skip take expand fold reduce sort reversed keys values entries
now fromMillisecondsSinceEpoch parse tryParse utc toIso8601String
millisecondsSinceEpoch inDays inHours inMinutes inSeconds isNegative
copyWith values byName fromName name index
instance of fromJson toJson encode decode
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


def class_bodies(src: str):
    marks = [(m.group(1), m.start()) for m in CLASS_LINE.finditer(src)]
    for idx, (name, start) in enumerate(marks):
        end = marks[idx + 1][1] if idx + 1 < len(marks) else len(src)
        yield name, src[start:end]


def main(argv: list[str]) -> int:
    root = Path(argv[0]) if argv else Path('apps/mobile/lib')
    files = sorted(root.rglob('*.dart'))

    members: dict[str, set[str]] = {}
    parents: dict[str, str] = {}
    for path in files:
        src = strip_noise(path.read_text(encoding='utf-8'))
        for m in EXTENDS.finditer(src):
            parents[m.group(1)] = m.group(2)
        for name, body in class_bodies(src):
            found = set(MEMBER.findall(body))
            found |= set(re.findall(r'this\.(\w+)', body))
            for m in re.finditer(r'\bget\s+(\w+)', body):
                found.add(m.group(1))
            for m in re.finditer(r'\bset\s+(\w+)', body):
                found.add(m.group(1))
            # named constructors: `ClassName.named(` — the member after the dot.
            for m in re.finditer(r'\b' + re.escape(name) + r'\.(\w+)\s*\(', body):
                found.add(m.group(1))
            # every declared field/static, including ones my MEMBER regex misses
            # (`static void Function(String)? onTapLink;`).
            for m in re.finditer(r'^\s+(?:static\s+)?(?:const\s+|final\s+|late\s+)?'
                                 r'[\w<>?,\s\(\)]+?\s+(\w+)\s*(?:[=;])', body, re.M):
                found.add(m.group(1))
            for m in re.finditer(r'(?<![.\w])(\w+)\s*\(', body):
                found.add(m.group(1))
            members.setdefault(name, set()).update(found)

    known_classes = set(members)

    def declares(cls: str, member: str, seen: frozenset[str] = frozenset()) -> bool:
        """Is `member` declared on `cls` or any ancestor this project defines?"""
        if cls in seen or cls not in members:
            return False
        if member in members[cls]:
            return True
        parent = parents.get(cls)
        return parent is not None and declares(parent, member, seen | {cls})
    problems = 0
    for path in files:
        src = strip_noise(path.read_text(encoding='utf-8'))
        for m in ACCESS.finditer(src):
            cls, member = m.group(1), m.group(2)
            if cls not in known_classes or member in BUILTIN:
                continue
            if declares(cls, member):
                continue
            line = src[:m.start()].count('\n') + 1
            print(f'{path}:{line}: {cls}.{member} — {cls} declares no `{member}`')
            problems += 1

    print(f'--- {problems} unresolved static access(es)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
