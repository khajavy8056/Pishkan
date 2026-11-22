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
    # Catches the "undefined class" errors that `flutter analyze` reports as
    # hard failures but nothing here could see: a class used in a file that no
    # import brings in. This is the one that found the missing
    # `models/models.dart` in service_art_overlay.dart.
    ('class imports', ['tools/checks/dart_class_imports.py']),
    # `BoxDecoration` asserts if a colour and a gradient are both set, and the
    # release build silently drops the colour instead of failing. This caught
    # exactly that in `GlassCard`, which would have thrown on first build.
    ('decoration conflicts', ['tools/checks/dart_decoration.py']),
    # `Positioned(start: ..)` instead of `PositionedDirectional`. The analyzer
    # calls it undefined_named_parameter and it is a hard error; it broke two
    # release builds before this row existed.
    ('widget arguments', ['tools/checks/dart_params.py']),
    # `service.updatedAt` on a class that never declares it. This is the error
    # that failed the 1.4.0 build twice: everything around it was valid, and
    # the member name exists on *other* classes, so nothing else saw it.
    ('member access', ['tools/checks/dart_members.py']),
    ('out-of-scope context', ['tools/checks/dart_context.py']),
    ('renamed model fields', ['tools/checks/dart_config_members.py']),
    ('version consistency', ['tools/checks/version_consistency.py']),
    # This one takes files, not a directory — it checks a known list of
    # cross-module symbols, so it only needs the Dart sources.
    ('symbol imports', ['tools/checks/dart_symbol_imports.py', *DART_FILES]),
    ('scope shadowing', ['tools/checks/dart_scope.py', 'apps/mobile/lib']),
]

# The deployment checks are a bash script, not a dart-tooling step, but they
# belong in the same gate: an update that drops a column, or a config key that
# nothing reads, is exactly as fatal as a Dart syntax error — and it is only
# discovered on a customer's server otherwise.
DEPLOY_CHECK = ROOT / 'tools' / 'check_deploy.sh'


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

    if DEPLOY_CHECK.exists():
        result = subprocess.run(
            ['bash', str(DEPLOY_CHECK)], cwd=ROOT, capture_output=True, text=True,
        )
        output = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            failures.append(('deployment logic', output))
            print('  FAIL deployment logic')
            for line in output.splitlines():
                if 'FAIL' in line or 'check_deploy:' in line or 'failed:' in line:
                    print(f'       {line}')
        elif not quiet:
            tail = output.splitlines()[-1] if output else 'ok'
            print(f'  ok   deployment logic — {tail}')
        total_steps = len(STEPS) + 1
    else:
        total_steps = len(STEPS)

    print()
    if failures:
        print(f'check_mobile: {len(failures)} check(s) failed.')
        return 1
    print(f'check_mobile: all {total_steps} check(s) clean.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
