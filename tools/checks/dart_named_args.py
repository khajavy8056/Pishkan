#!/usr/bin/env python3
"""Check constructor call sites against the constructor this project declares.

`dart_params.py` hard-codes the handful of Flutter SDK widgets where a
plausible argument name is wrong (`Positioned(end:)`). That table can never
cover *our* widgets — and our widgets are the ones changing fastest. A renamed
field leaves call sites passing a named argument that no longer exists, which
the analyzer reports as `undefined_named_parameter`: a hard error, invisible to
every regex check that does not know the real signature.

So this reads the declarations out of `lib/` and, for each `Widget(...)` call
whose callee is a class defined in this project, flags named arguments that the
constructor does not accept.

Deliberately conservative about what it *cannot* judge: if a constructor has no
parameter list (default constructor) or takes `dynamic`/map-style config, it is
skipped rather than guessed at.

Usage: python3 tools/checks/dart_named_args.py apps/mobile/lib
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

CLASS = re.compile(r'^(?:abstract\s+)?class\s+(\w+)', re.M)


def strip_noise(src: str) -> str:
    """Blank comments and string bodies, preserving offsets exactly."""
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
            while i < n and i < len(src) and src[i] in '*/':
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


def _balanced(src: str, open_idx: int) -> int:
    """Index of the bracket closing the one at `open_idx`."""
    pairs = {'(': ')', '[': ']', '{': '}'}
    openers, closers = pairs.keys(), pairs.values()
    depth = 0
    for i in range(open_idx, len(src)):
        if src[i] in openers:
            depth += 1
        elif src[i] in closers:
            depth -= 1
            if depth == 0:
                return i
    return -1


def _named_params(params: str) -> set[str]:
    """Names a constructor accepts as named arguments."""
    allowed: set[str] = set()
    # the outermost {...} block holds the named parameters
    start = params.find('{')
    if start < 0:
        return allowed
    end = _balanced(params, start)
    if end < 0:
        return allowed
    block = params[start + 1:end]
    depth, part, parts = 0, '', []
    for ch in block:
        if ch in '([{<':
            depth += 1
        elif ch in ')]}>':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(part)
            part = ''
        else:
            part += ch
    parts.append(part)
    for part in parts:
        part = re.sub(r'@\w+(?:\([^)]*\))?', ' ', part).strip()
        if not part:
            continue
        m = re.match(r'(?:required\s+)?(?:this|super)\.(\w+)', part)
        if m:
            allowed.add(m.group(1))
            continue
        m = re.match(r'(?:\w[\w<>?,\s]*?\s+)?(\w+)\s*(?:=|$)', part)
        if m:
            allowed.add(m.group(1))
    return allowed


def collect(root: Path) -> dict[str, set[str]]:
    """class name -> the named parameters its constructor accepts."""
    ctors: dict[str, set[str]] = {}
    for path in sorted(root.rglob('*.dart')):
        src = strip_noise(path.read_text(encoding='utf-8'))
        for cm in CLASS.finditer(src):
            cls = cm.group(1)
            # the constructor declaration: `ClassName(` where the thing after
            # the closing paren is `{`, `;`, `:` or `=>` — i.e. a declaration,
            # not a call site.
            for m in re.finditer(r'(?<![\w.])' + re.escape(cls) + r'\s*\(', src[cm.start():]):
                open_idx = cm.start() + m.end() - 1
                if open_idx < cm.start():
                    continue
                close = _balanced(src, open_idx)
                if close < 0:
                    continue
                after = src[close + 1:close + 200].lstrip()
                if not (after.startswith('{') or after.startswith(';')
                        or after.startswith(':') or after.startswith('=>')):
                    continue
                allowed = _named_params(src[open_idx + 1:close])
                if allowed:
                    ctors[cls] = allowed
                break
    return ctors


def main(argv: list[str]) -> int:
    root = Path(argv[0]) if argv else Path('apps/mobile/lib')
    ctors = collect(root)
    files = sorted(root.rglob('*.dart'))

    problems = 0
    for path in files:
        raw = path.read_text(encoding='utf-8')
        src = strip_noise(raw)
        for cls, allowed in ctors.items():
            if not allowed:
                continue
            for m in re.finditer(r'(?<![\w.])' + re.escape(cls) + r'\s*\(', src):
                # opening paren
                start = m.end() - 1
                depth, j = 0, start
                while j < len(src):
                    if src[j] in '([{':
                        depth += 1
                    elif src[j] in ')]}':
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                call = src[start + 1:j]
                # only the *top level* arguments, not nested calls
                top, d = [], 0
                for ch in call:
                    if ch in '([{':
                        d += 1
                    elif ch in ')]}':
                        d -= 1
                    if ch == ',' and d == 0:
                        top.append('')
                    elif top:
                        top[-1] += ch
                    else:
                        top.append(ch)
                for arg in top:
                    am = re.match(r'\s*([a-zA-Z_]\w*)\s*:\s*\S', arg)
                    if not am:
                        continue
                    name = am.group(1)
                    if name in allowed:
                        continue
                    line = src[:m.start()].count('\n') + 1
                    print(f'{path}:{line}: {cls}(... {name}: ...) — '
                          f'{cls} has no `{name}` parameter')
                    problems += 1
    print(f'--- {problems} unknown named argument(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
