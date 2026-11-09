#!/usr/bin/env python3
"""Turn the full-size service pictures into the sizes the app actually draws.

The generated masters are 1024px icons and 1376x768 banners, at 1.4 MB and
2.0 MB each. There are 193 services with two pictures apiece, so shipping the
masters would put roughly 650 MB in the repository and in the APK.

The app draws the icon at 44px and the banner at roughly 380x300 (a 3x screen
means 1320x900 at most, and the banner is only ever shown as a header crop), so
nothing above 256 / 1280 buys any visible sharpness. Resized and encoded as
WebP the pair lands around 30 KB and 90 KB.

This runs *after* tools/sync_service_media.py, on the copies already in
assets/, so the masters in services_media/ stay untouched and a picture can be
re-compressed or replaced at any time.

Usage:
    python3 tools/compress_service_media.py            # compress what is new
    python3 tools/compress_service_media.py --force    # redo everything
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'apps' / 'mobile' / 'assets'

# folder -> (max edge, quality). Quality 82 is where a soft clay render stops
# showing banding on the gentle gradients these pictures are made of.
JOBS = {
    ASSETS / 'service_art': (256, 84),
    ASSETS / 'service_art' / 'large': (1280, 80),
}


def main(argv: list[str]) -> int:
    force = '--force' in argv
    done = skipped = 0
    for folder, (edge, quality) in JOBS.items():
        if not folder.is_dir():
            print(f'missing {folder.relative_to(ROOT)}')
            continue
        for src in sorted(folder.iterdir()):
            if src.suffix.lower() not in {'.png', '.jpg', '.jpeg'}:
                continue
            out = src.with_suffix('.webp')
            if out.exists() and not force:
                skipped += 1
                continue
            subprocess.run(
                ['convert', str(src),
                 '-resize', f'{edge}x{edge}>',      # only shrink, never enlarge
                 '-quality', str(quality),
                 '-define', 'webp:method=6',
                 str(out)],
                check=True, capture_output=True,
            )
            src.unlink()                            # the master lives in services_media/
            done += 1
            print(f'  {src.name} -> {out.name}  ({out.stat().st_size // 1024} KB)')
    print(f'\n{done} compressed, {skipped} already present.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
