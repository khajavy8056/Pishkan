#!/usr/bin/env python3
"""Cut a 3x2 icon sheet into six service icons, anchored on each blue disc.

Six icons come out of one generation as a single 3x2 grid, which is six times
faster than one at a time at the same quality. The grid is scaffolding: the
repository must contain only the six cropped icons, each under its service
slug. The sheet itself is parked outside the repository so it can be re-cropped
if a crop turns out badly framed — an unlinked sheet cannot be recovered.

A naive centre-of-cell crop fails when the model lets an object drift or grow
past its cell: the top or side of the subject gets sliced off. Every icon in
this family stands on a glossy blue disc, and the disc is by far the most
saturated thing in the frame, so it makes a reliable anchor. The crop is
centred on the disc horizontally and the disc's foot is held a little above the
bottom edge, the same framing the single icons were drawn with.

Usage:
    python3 tools/crop_icon_sheet.py <sheet.png> <slug1> ... <slug6>

Names are in the sheet's own order: top row left to right, then bottom row.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / 'services_media' / 'icons'
SCRATCH = Path('/tmp/pishkan_sheets')

COLUMNS, ROWS = 3, 2
# Disc foot sits this far above the crop's bottom edge, as a fraction of the
# crop side. The single-service icons were framed the same way.
FOOT_MARGIN = 0.075


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def image_size(path: Path) -> tuple[int, int]:
    w, h = run('identify', '-format', '%w %h', str(path)).split()
    return int(w), int(h)


def saturated_bbox(path: Path) -> tuple[int, int, int, int]:
    """Bounding box of the strongly coloured pixels — the blue disc."""
    # Pull saturation into its own channel and keep only the vivid pixels.
    r = subprocess.run(
        ['convert', str(path), '-colorspace', 'sRGB', '-modulate', '100,180',
         '-colorspace', 'HSL', '-channel', 'G', '-separate', '+channel',
         '-threshold', '45%', '-trim', '-format', '%w %h %X %Y', 'info:'],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return 0, 0, 0, 0
    w, h, x, y = r.stdout.split()
    return int(w), int(h), int(x.lstrip('+')), int(y.lstrip('+'))


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
    side = cell_h
    max_x = width - side

    ICONS.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    for index, slug in enumerate(slugs):
        row, column = divmod(index, COLUMNS)
        cell_x, cell_y = column * cell_w, row * cell_h

        # Look for the disc inside this cell only, with a small halo so a
        # subject leaning out of its cell still gets found.
        pad = cell_w // 6
        halo_x = max(0, cell_x - pad)
        halo_w = min(width, cell_x + cell_w + pad) - halo_x
        halo = SCRATCH / f'.halo_{index}.png'
        subprocess.run(
            ['convert', str(sheet), '-crop', f'{halo_w}x{cell_h}+{halo_x}+{cell_y}',
             '+repage', str(halo)],
            check=True, capture_output=True,
        )

        disc_w, disc_h, disc_x, disc_y = saturated_bbox(halo)
        if disc_w == 0:
            # No disc found: fall back to the plain centre of the cell.
            crop_x = min(max(0, cell_x + (cell_w - side) // 2), max_x)
            warnings.append(f'{slug}: no disc found, used cell centre')
        else:
            anchor_x = halo_x + disc_x + disc_w // 2
            crop_x = min(max(0, anchor_x - side // 2), max_x)
        crop_y = cell_y

        out = ICONS / f'{slug}.png'
        subprocess.run(
            ['convert', str(sheet), '-crop', f'{side}x{side}+{crop_x}+{crop_y}',
             '+repage', str(out)],
            check=True, capture_output=True,
        )
        halo.unlink(missing_ok=True)
        print(f'  {slug:40s} <- cell {index + 1}')

    # Keep the sheet outside the repo: it is scaffolding, but it is also the
    # only way to re-cut a badly framed icon without regenerating the batch.
    parked = SCRATCH / sheet.name
    shutil.move(str(sheet), str(parked))

    print(f'\n{len(slugs)} icons written to {ICONS.relative_to(ROOT)}')
    print(f'sheet parked at {parked} (outside the repository)')
    for warning in warnings:
        print(f'  ! {warning}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
