#!/usr/bin/env python3
"""Bracket balance check for the Flutter sources.

The Flutter SDK is not available in every review environment, so this catches
the one class of edit mistake that matters most (a dropped/added brace) before
CI has to. It is not a substitute for `dart analyze`.
"""
import sys, pathlib

def strip_strings_and_comments(src):
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i += 2
        elif c in "'\"":
            q = c
            triple = src[i:i + 3] == q * 3
            if triple:
                i += 3
                while i + 2 < n and src[i:i + 3] != q * 3:
                    i += 2 if src[i] == '\\' else 1
                i += 3
            else:
                i += 1
                while i < n and src[i] != q:
                    i += 2 if src[i] == '\\' else 1
                i += 1
            out.append('S')
        else:
            out.append(c)
            i += 1
    return ''.join(out)

def check(path):
    code = strip_strings_and_comments(pathlib.Path(path).read_text(encoding='utf-8'))
    pairs, stack, line = {')': '(', ']': '[', '}': '{'}, [], 1
    for ch in code:
        if ch == '\n':
            line += 1
        elif ch in '([{':
            stack.append((ch, line))
        elif ch in ')]}':
            if not stack or stack[-1][0] != pairs[ch]:
                return f'{path}:{line}: unmatched {ch!r} (top {stack[-1] if stack else None})'
            stack.pop()
    if stack:
        return f'{path}: unclosed {stack[-1][0]!r} opened at line {stack[-1][1]}'
    return None

if __name__ == '__main__':
    problems = [r for r in (check(p) for p in sys.argv[1:]) if r]
    print('\n'.join(problems) if problems else 'balanced')
    sys.exit(1 if problems else 0)
