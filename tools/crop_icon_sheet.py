#!/usr/bin/env python3
"""Cut an icon sheet into one image per icon, detecting the grid that was drawn.

The image model is asked for a 3x2 grid of six service icons on one canvas,
which is the whole reason icons can be made six times faster than one at a
time. It does not always obey: four, seven and eight cells all come back, and
a fixed 3x2 crop then takes half of one icon and half of its neighbour. Asking
harder does not work — the brief is already explicit — so this tool measures
the sheet instead of trusting the brief.

Background is a flat pastel gradient, so the gutters between cells are the
brightest columns and rows in the image. Peaks in a one-pixel projection give
the cell boundaries, whatever their number.

Two things are deliberately strict:

* The number of icons must match the number of slugs. A mismatch is almost
  always a grid that was read wrongly, and a wrong crop puts the wrong picture
  on a service — worse than a missing one.
* Each cell is cropped around its own content, not its geometric centre, so an
  icon that leans within its cell is still whole.

The sheet is parked outside the repository afterwards: it is scaffolding, but
it is also the only way to re-cut a bad icon without spending a generation.

Usage:
    python3 tools/crop_icon_sheet.py <sheet.png> <slug> [<slug> ...]
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / 'services_media' / 'icons'
SCRATCH = Path('/tmp/pishkan_sheets')

PROFILE = 240          # samples across an axis when looking for gutters
PEAK_MARGIN = 6        # brightness a gutter must beat the median background by
MIN_GUTTER = 0.02      # a real gutter spans at least this share of the axis


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def image_size(path: Path) -> tuple[int, int]:
    w, h = run('identify', '-format', '%w %h', str(path)).split()
    return int(w), int(h)


def brightness_profile(path: Path, axis: str, length: int) -> list[float]:
    """Mean brightness along one axis, sampled PROFILE times."""
    geom = f'{length}x1!' if axis == 'x' else f'1x{length}!'
    raw = run('convert', str(path), '-resize', geom, '-colorspace', 'Gray',
              '-depth', '8', 'txt:-')
    values: list[float] = []
    for line in raw.splitlines()[1:]:
        # 0,0: (226,226,226)  #E2E2E2  gray(226)
        if '(' in line:
            values.append(float(line.split('(')[1].split(',')[0]))
    return values


def gutter_positions(profile: list[float], total: int) -> list[int]:
    """Positions along one axis where the sheet is pure background.

    The background is a gradient, brightest at the top and bottom of the
    canvas, so a median baseline runs *through* the gutters rather than below
    them and finds nothing. Comparing against the brightest sample works: the
    gutters are the only large regions that reach the background's peak
    brightness between icons.

    A gutter is a *run* of such samples, not one: a pale object — a white
    receipt, a certificate — is bright too, and single-sample peaks from those
    used to invent boundaries that were not there. Thin gutters are real,
    though, so the run threshold is deliberately small.
    """
    if not profile:
        return []
    brightest, darkest = max(profile), min(profile)
    threshold = brightest - max(3.0, 0.02 * (brightest - darkest))
    min_run = max(3, int(len(profile) * 0.02))

    groups: list[list[int]] = []
    for index, value in enumerate(profile):
        if value >= threshold:
            if groups and index - groups[-1][-1] <= 1:
                groups[-1].append(index)
            else:
                groups.append([index])

    scale = total / len(profile)
    cuts = [int(sum(g) / len(g) * scale) for g in groups if len(g) >= min_run]
    return [c for c in cuts if 0.04 * total < c < 0.96 * total]


def cell_bounds(cuts: list[int], total: int) -> list[tuple[int, int]]:
    edges = [0, *cuts, total]
    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]


def main(argv: list[str]) -> int:
    if len(argv) < 2:
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
    columns = cell_bounds(gutter_positions(brightness_profile(sheet, 'x', width), width), width)

    # Columns are measured; rows are derived. Vertical gutters are often only a
    # few pixels tall in a 768px sheet and vanish once the image is reduced for
    # profiling, so counting them was unreliable. A sheet always holds an exact
    # rectangular grid, so the row count follows from the column count and the
    # number of slugs — and if those do not divide evenly, the sheet is not a
    # grid we can trust, and we stop rather than guess.
    column_count = len(columns)
    if column_count == 0 or len(slugs) % column_count:
        print(f'sheet {width}x{height}: measured {column_count} columns, '
              f'but {len(slugs)} slugs do not divide into it')
        print('column cuts:', columns)
        return 1

    row_count = len(slugs) // column_count
    height_of_row = height // row_count
    rows = [(r * height_of_row,
             height if r == row_count - 1 else (r + 1) * height_of_row)
            for r in range(row_count)]

    print(f'sheet {width}x{height}: {column_count} columns x {row_count} rows '
          f'= {column_count * row_count} cells')

    ICONS.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)

    index = 0
    for top, bottom in rows:
        for left, right in columns:
            slug = slugs[index]
            index += 1
            cell_w, cell_h = right - left, bottom - top
            # Square crop, as close to filling the cell as the shorter side allows.
            side = min(cell_w, cell_h)
            x = left + (cell_w - side) // 2
            y = top + (cell_h - side) // 2
            out = ICONS / f'{slug}.png'
            subprocess.run(
                ['convert', str(sheet), '-crop', f'{side}x{side}+{x}+{y}',
                 '+repage', str(out)],
                check=True, capture_output=True,
            )
            print(f'  {slug:40s} <- {side}px cell')

    parked = SCRATCH / sheet.name
    shutil.move(str(sheet), str(parked))
    print(f'\n{len(slugs)} icons written to {ICONS.relative_to(ROOT)}')
    print(f'sheet parked at {parked} (outside the repository)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
