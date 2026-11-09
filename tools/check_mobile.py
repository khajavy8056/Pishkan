#!/usr/bin/env python3
"""Run every static check for the mobile app in one go.

There is no Dart toolchain in this environment, so the Flutter side would
otherwise only be verified when CI runs `flutter analyze` — several minutes
after the mistake. The checks in `tools/checks/` and the two top-level ones were
each written for a specific failure that had already happened once; running
them one at a time is how one of them gets forgotten.

This runs them all, stops at the first file that reports a problem, and exits
non-zero. It is not a compiler: it catches the mistakes this codebase actually
makes, and it says so rather than pretending to be `flutter analyze`.

Usage:
    python3 tools/check_mobile.py          # everything
    python3 tools/check_mobile.py -q       # only failures
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / 'apps' / 'mobile' / 'lib'
DART_FILES = [str(p.relative_to(ROOT)) for p in sorted(LIB.rglob('*.dart'))]

# (label, command). Order matters only for readability of the output.
STEPS: list[tuple[str, list[str]]] = [
    ('dart syntax + imports', ['tools/check_dart.py']),
    # Takes files, not a directory (like the symbol check below).
    ('bracket balance', ['tools/checks/dart_balance.py', *DART_FILES]),
    ('const contexts', ['tools/checks/dart_const.py', 'apps/mobile/lib']),
    ('final reassignment', ['tools/checks/dart_final.py', 'apps/mobile/lib']),
    ('icon names', ['tools/checks/dart_icons.py', 'apps/mobile/lib']),
    ('import order', ['tools/checks/dart_imports.py', 'apps/mobile/lib']),
    # This one takes files, not a directory — it checks a known list of
    # cross-module symbols, so it only needs the Dart sources.
    ('symbol imports', ['tools/checks/dart_symbol_imports.py', *DART_FILES]),
    ('scope shadowing', ['tools/checks/dart_scope.py', 'apps/mobile/lib']),
]


def main() -> int:
    quiet = '-q' in sys.argv or '--quiet' in sys.argv
    failures: list[tuple[str, str]] = []

    for label, command in STEPS:
        script = ROOT / command[0]
        if not script.exists():
            if not quiet:
                print(f'  -- {label}: skipped ({command[0]} not present)')
            continue
        result = subprocess.run(
            [sys.executable, str(script), *command[1:]],
            cwd=ROOT, capture_output=True, text=True,
        )
        output = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            failures.append((label, output))
            print(f'  FAIL {label}')
            for line in output.splitlines():
                print(f'       {line}')
        elif not quiet:
            # Keep only the summary line: these tools are verbose on success.
            tail = output.splitlines()[-1] if output else 'ok'
            print(f'  ok   {label} — {tail}')

    print()
    if failures:
        print(f'check_mobile: {len(failures)} check(s) failed.')
        return 1
    print(f'check_mobile: all {len(STEPS)} check(s) clean.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
