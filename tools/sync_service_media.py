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

import json
import shutil
import subprocess
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

# The same pictures also have to reach the SERVER, because a service created
# from the admin panel after a release has no bundled asset and must still show
# its own picture. The web build's public folder is what the API serves at
# /images/..., and `default-artwork.ts` maps a slug to that path, so copying
# here is what makes the server the source of truth without a second pipeline.
SERVER_ART = ROOT / 'apps' / 'web' / 'public' / 'images' / 'services'
SERVER_TARGETS = {
    'icons': SERVER_ART / 'individual',
    'backdrops': SERVER_ART / 'backdrops',
}

# Backdrops are shared. A service page is a full-width canvas and the picture
# behind it is large, so drawing 193 of them was both slow and pointless: the
# services that sit in the same subject group look identical anyway. Each
# backdrop is named after its group (`backdrop_groups.json` maps a slug to its
# group) and is copied under THAT service's name, so the app keeps its simple
# one-picture-per-slug lookup and nothing in Dart has to know about groups.
GROUP_FILE = MEDIA / 'backdrop_groups.json'


def backdrop_groups() -> dict[str, str]:
    """service slug -> backdrop group name."""
    if not GROUP_FILE.exists():
        return {}
    mapping: dict[str, str] = {}
    for group, members in json.loads(GROUP_FILE.read_text(encoding='utf-8')).items():
        for slug in members:
            mapping[slug] = group
    return mapping


def known_slugs() -> set[str]:
    """Every service the app knows about.

    Taken from the manifest, not from the bundled art. Deriving it from
    assets/service_art/*.webp looked tidy but tied the list to the very files
    being replaced: delete a placeholder to regenerate it and its service
    stopped being recognised, so the new picture was rejected as "not a
    service".
    """
    manifest = MEDIA / 'manifest.json'
    if not manifest.exists():
        return set()
    return {row['slug'] for row in json.loads(manifest.read_text(encoding='utf-8'))}


def mirror_to_server() -> None:
    """Copy the *compressed* WebP into the folder the API serves.

    Done after compression, not during the copy loop: the source files are
    1024px masters and several hundred kilobytes each, and shipping those to
    the web bundle put 108 MB of art in a build that only ever loads 30 KB
    per service.
    """
    plan = [
        (ASSETS / 'service_art', SERVER_TARGETS['icons']),
        (ASSETS / 'service_art' / 'large', SERVER_TARGETS['backdrops']),
    ]
    written = 0
    for source_dir, target_dir in plan:
        if not source_dir.is_dir():
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        # Sweep any master that an earlier run copied here. A PNG in this
        # folder is always a mistake: it is the 1-2 MB source, not the WebP the
        # app loads, and it was 108 MB of the web bundle before this existed.
        for stale in target_dir.glob('*.png'):
            stale.unlink()
        for webp in sorted(source_dir.glob('*.webp')):
            destination = target_dir / webp.name
            if destination.exists() and destination.stat().st_mtime >= webp.stat().st_mtime:
                continue
            shutil.copyfile(webp, destination)
            written += 1
    print(f'\nmirrored {written} compressed image(s) to the server bundle.')


def main(argv: list[str]) -> int:
    check_only = '--check' in argv
    slugs = known_slugs()
    if not slugs:
        print('no bundled service art found; aborting')
        return 1

    copied = 0
    unknown: list[str] = []
    wrong_type: list[str] = []
    groups = backdrop_groups()
    undescribed: list[str] = []

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
            if folder == 'backdrops':
                # One picture per group, copied once under the group's own name.
                # Copying it under each member's slug would put 24 byte-identical
                # 30 KB files in the APK for one picture; the app resolves the
                # group from `backdrop_groups.dart` instead.
                if path.stem not in set(groups.values()):
                    unknown.append(str(path.relative_to(ROOT)))
                    continue
                destination = target / f'{path.stem}{suffix}'
                if check_only:
                    print(f'would copy  {path.relative_to(ROOT)}  ->  {destination.relative_to(ROOT)}')
                else:
                    target.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, destination)
                    # The server is fed after compression, from the app's own
                    # WebP -- see _mirror_to_server below. Copying the master
                    # here put 193 one-megabyte PNGs in the web bundle.
                    print(f'copied      {path.relative_to(ROOT)}  ->  {destination.relative_to(ROOT)}')
                copied += 1
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

    if not check_only and copied:
        # The copies are full-size masters; the app needs them small. Doing this
        # here means the workflow is one command, and it is impossible to forget
        # the step that keeps ~650 MB out of the APK.
        print('\nCompressing for the app:')
        subprocess.run([sys.executable, str(ROOT / 'tools' / 'compress_service_media.py')], check=True)
        mirror_to_server()

    return 1 if (unknown or wrong_type) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
