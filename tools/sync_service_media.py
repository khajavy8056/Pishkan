#!/usr/bin/env python3
"""Move the images the office uploads into the app's asset folders.

`services_media/icons/` and `services_media/backdrops/` are where a person drops
pictures, named after the service slug. The app cannot read from there -- Flutter
only bundles declared directories under `apps/mobile/assets` -- so this copies
each file to where the code actually looks:

    services_media/icons/<slug>.webp      -> assets/service_art/<slug>.webp
    services_media/backdrops/<slug>.webp  -> assets/service_art/large/<slug>.webp

Copying rather than referencing keeps `services_media/` as the place a person
edits: re-running this after replacing a picture is the whole workflow, and
nothing is lost if the asset folder is ever regenerated.

The slug must match an existing service. A file called `my-car.webp` would be
silently bundled and never displayed, so unknown names are reported instead.

Usage:
    python3 tools/sync_service_media.py            # copy
    python3 tools/sync_service_media.py --check    # report only, no writes
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / 'services_media'
ASSETS = ROOT / 'apps' / 'mobile' / 'assets'

# Extensions Flutter can decode. SVG is deliberately absent: the app has no
# flutter_svg dependency, so an SVG would bundle and then render as nothing.
ALLOWED = {'.webp', '.png', '.jpg', '.jpeg'}

# Where a drop folder's contents are copied to.
TARGETS = {
    'icons': ASSETS / 'service_art',
    'backdrops': ASSETS / 'service_art' / 'large',
}


def known_slugs() -> set[str]:
    """Every service the app knows about, taken from the bundled art."""
    return {p.stem for p in (ASSETS / 'service_art').glob('*.webp')}


def main(argv: list[str]) -> int:
    check_only = '--check' in argv
    slugs = known_slugs()
    if not slugs:
        print('no bundled service art found; aborting')
        return 1

    copied = 0
    unknown: list[str] = []
    wrong_type: list[str] = []

    for folder, target in TARGETS.items():
        source = MEDIA / folder
        if not source.is_dir():
            print(f'missing folder: {source.relative_to(ROOT)}')
            continue
        for path in sorted(source.iterdir()):
            if not path.is_file() or path.name.startswith('.'):
                continue
            # The READMEs in these folders are not pictures.
            if path.name.lower().endswith('.txt') or path.name.lower().endswith('.md'):
                continue
            suffix = path.suffix.lower()
            if suffix not in ALLOWED:
                wrong_type.append(f'{path.relative_to(ROOT)}  ({suffix or "no extension"})')
                continue
            if path.stem not in slugs:
                unknown.append(str(path.relative_to(ROOT)))
                continue
            destination = target / f'{path.stem}{suffix}'
            if check_only:
                print(f'would copy  {path.relative_to(ROOT)}  ->  {destination.relative_to(ROOT)}')
            else:
                target.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, destination)
                print(f'copied      {path.relative_to(ROOT)}  ->  {destination.relative_to(ROOT)}')
            copied += 1

    if wrong_type:
        print('\nThese are not a format the app can draw (use webp or png):')
        for row in wrong_type:
            print('  ' + row)

    if unknown:
        print('\nThese file names do not match any service, so nothing would show them:')
        for row in unknown:
            print('  ' + row)
        print('  Rename them to the service slug -- see services_media/README.md.')

    verb = 'ready' if check_only else 'copied'
    print(f'\n{copied} image(s) {verb}.')
    return 1 if (unknown or wrong_type) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
