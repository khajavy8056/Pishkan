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
    """Columns/rows where the sheet is pure background, i.e. cell boundaries.

    A gutter is a *run* of near-background samples, not one bright sample: a
    pale object such as a white sheet of paper is bright too, and single-pixel
    peaks from those used to invent boundaries that were not there. Only runs
    at least MIN_GUTTER wide, and clearly brighter than the typical background,
    count as a boundary between cells.
    """
    if not profile:
        return []
    ordered = sorted(profile)
    median = ordered[len(ordered) // 2]
    threshold = median + PEAK_MARGIN
    min_run = max(3, int(len(profile) * MIN_GUTTER))

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
    rows = cell_bounds(gutter_positions(brightness_profile(sheet, 'y', height), height), height)
    cells = len(columns) * len(rows)

    print(f'sheet {width}x{height}: {len(columns)} columns x {len(rows)} rows = {cells} cells')
    if cells != len(slugs):
        print(f'but {len(slugs)} slugs were given; refusing to guess which cell is which')
        print('column cuts:', columns)
        print('row cuts:', rows)
        return 1

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
