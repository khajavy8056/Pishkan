#!/usr/bin/env python3
"""Keep every published version number on one value, and on the 1.0.x rule.

Two failures this exists to prevent, both of which actually happened here:

1. `app.latest_version` defaulted to 1.0.0 while the app shipped 1.4.0, so every
   customer on the newest build was told a newer one existed — on a fresh
   install, before the office had configured anything. Nothing crashes; the app
   just nags forever.
2. Different components grew their own counters (system 1.4.0, app 1.21.7 + a
   separate build number 80, installer 1.0.1). Three clocks for one release means
   nobody can tell from a number what is installed where, which is exactly what
   an in-app updater has to be able to answer.

So the scheme is fixed, by the office's rule:

    version = 1.0.<build>            # e.g. 1.0.1217
    <build> is the ONLY counter,     # next release: 1.0.1218
    major/minor never move without an explicit order from the owner,
    and a pre-existing number is folded into <build> by concatenating its parts
    (Android 1.21.7 -> 1217, system 1.4.0 -> 140; the release therefore takes the
    highest, 1217, so every component carries the same value).

This script is the enforcement. It reads each place a version is written and
requires the identical `1.0.<build>` string everywhere, plus the two pubspec
halves (versionName and versionCode) to agree.

Usage: python3 tools/checks/version_consistency.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# (label, path, how to extract the version)
TEXT_SITES = {
    'root package.json': ('package.json', r'"version":\s*"([^"]+)"'),
    'api package.json': ('apps/api/package.json', r'"version":\s*"([^"]+)"'),
    'web package.json': ('apps/web/package.json', r'"version":\s*"([^"]+)"'),
    'API APP_VERSION default': ('apps/api/src/env.ts', r"str\('APP_VERSION',\s*'([^']+)'\)"),
    'admin shell fallback': ('apps/web/src/components/shell.tsx', r"VITE_APP_VERSION \?\? '([^']+)'"),
    'windows appVersion': ('windows/manifest/windows.manifest.json', r'"appVersion":\s*"([^"]+)"'),
    'windows installerVersion': ('windows/manifest/windows.manifest.json', r'"installerVersion":\s*"([^"]+)"'),
    'windows UI fallback': ('windows/lib/ui.ps1', r"return '([0-9][^']*)'"),
    'app.latest_version default': (
        'apps/api/src/modules/settings/definitions.ts',
        r"key: 'app\.latest_version'.*?default: '([0-9][^']*)'",
    ),
}


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')


def main() -> int:
    problems: list[str] = []
    found: dict[str, str] = {}

    # The mobile pubspec carries both halves: `1.0.1217+1217`.
    m = re.search(r'^version:\s*([0-9]+\.[0-9]+\.[0-9]+)\+(\d+)\s*$', read('apps/mobile/pubspec.yaml'), re.M)
    if not m:
        print('pubspec.yaml: expected `version: 1.0.<build>+<build>`')
        return 1
    app_name, app_code = m.group(1), int(m.group(2))
    found['mobile versionName'] = app_name
    if app_code != int(app_name.rsplit('.', 1)[1]):
        problems.append(
            f'pubspec versionCode is {app_code} but versionName says {app_name} — the two '
            'halves must be the same build number, or Android and the update banner disagree '
            'about what is installed')

    for label, (rel, pattern) in TEXT_SITES.items():
        hit = re.search(pattern, read(rel), re.S)
        if not hit:
            problems.append(f'{label}: could not read a version from {rel} (pattern moved? update this check)')
            continue
        found[label] = hit.group(1)

    for label, value in found.items():
        if not re.fullmatch(r'1\.0\.\d+', value):
            problems.append(
                f'{label} is "{value}" — the scheme is 1.0.<build> and only the owner may '
                'change the 1.0 part')

    distinct = set(found.values())
    if len(distinct) > 1:
        listing = '\n'.join(f'    {k}: {v}' for k, v in sorted(found.items()))
        problems.append(f'versions disagree across the system:\n{listing}')

    if problems:
        for line in problems:
            print(line)
        return 1

    version = app_name
    tag = f'android-v{version}'
    print(f'--- one version for the whole system: {version} (build {version.rsplit(".", 1)[1]}), '
          f'{len(found)} sites in agreement; release tag {tag}')
    print('    note: a tag is only correct once it is pushed — see docs/UPDATING-FOR-DEVELOPERS.md')
    return 0


if __name__ == '__main__':
    sys.exit(main())
