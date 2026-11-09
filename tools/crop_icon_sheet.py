#!/usr/bin/env python3
"""Cut a 3x2 icon sheet into six service icons, and throw the sheet away.

Six icons are drawn per generation as one 3x2 grid, which is six times faster
than one at a time and, measured against the singles, the same quality. The
sheet itself is scaffolding: the repository must only ever contain the six
cropped icons, each under its service slug. A sheet left behind would also be
picked up by the sync step and bundled into the APK as a stray asset.

The crop takes a square from the middle of each cell, so the padding built into
the grid becomes the icon's margin and no neighbour bleeds in.

Usage:
    python3 tools/crop_icon_sheet.py <sheet.png> <slug1> <slug2> ... <slug6>

The sheet is deleted once all six crops are written. Names are taken in the
same order the sheet describes them: top row left to right, then bottom row.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / 'services_media' / 'icons'

COLUMNS, ROWS = 3, 2


def image_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(
        ['identify', '-format', '%w %h', str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    return int(out[0]), int(out[1])


def main(argv: list[str]) -> int:
    if len(argv) != 1 + COLUMNS * ROWS:
        print(__doc__)
        return 2

    sheet = Path(argv[0])
    slugs = argv[1:]
    if not sheet.exists():
        print(f'no such sheet: {sheet}')
        return 1
    if len(set(slugs)) != len(slugs):
        print('duplicate slug in the list; refusing to guess which crop wins')
        return 1

    width, height = image_size(sheet)
    cell_w, cell_h = width // COLUMNS, height // ROWS
    # Square side equals the cell height, centred horizontally in the cell.
    side = cell_h
    inset = (cell_w - side) // 2

    ICONS.mkdir(parents=True, exist_ok=True)
    for index, slug in enumerate(slugs):
        row, column = divmod(index, COLUMNS)
        x = column * cell_w + inset
        y = row * cell_h
        out = ICONS / f'{slug}.png'
        subprocess.run(
            ['convert', str(sheet), '-crop', f'{side}x{side}+{x}+{y}',
             '+repage', str(out)],
            check=True, capture_output=True,
        )
        print(f'  {slug:40s} <- cell {index + 1}')

    # The sheet is scaffolding; only the crops belong in the repository.
    sheet.unlink()
    print(f'\n{len(slugs)} icons written to {ICONS.relative_to(ROOT)}; sheet removed.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
