#!/usr/bin/env python3
"""Keep the shipped app version, the server's update baseline and the tag in step.

`app.latest_version` is what the update banner compares against. It defaulted
to 1.0.0 while the app shipped 1.4.0, so every customer on the new build was
told a newer one existed — on a fresh install, before the office had configured
anything. That is a *silent* failure: nothing crashes, the app just nags.

This compares the version in the app's pubspec against the server's default and
reports a mismatch. It cannot see the git tag (CI does), so it checks the pair
it can.

Usage: python3 tools/checks/version_consistency.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    pubspec = ROOT / 'apps/mobile/pubspec.yaml'
    settings = ROOT / 'apps/api/src/modules/settings/definitions.ts'

    m = re.search(r'^version:\s*([0-9]+\.[0-9]+\.[0-9]+)', pubspec.read_text(), re.M)
    if not m:
        print('could not read the app version from pubspec.yaml')
        return 1
    app = m.group(1)

    m = re.search(
        r"key:\s*'app\.latest_version'.*?default:\s*'([0-9]+\.[0-9]+\.[0-9]+)'",
        settings.read_text(), re.S)
    if not m:
        print('could not read app.latest_version from settings/definitions.ts')
        return 1
    server = m.group(1)

    if app != server:
        print(f'app is {app} but app.latest_version is {server} — every'
              f' customer on {app} will be told a newer version exists')
        return 1

    print(f'--- app and update baseline agree on {app}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
