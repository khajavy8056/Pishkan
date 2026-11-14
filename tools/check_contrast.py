#!/usr/bin/env python3
"""Check that text colours in the app's theme clear WCAG AA.

The palette lives in `apps/mobile/lib/core/theme.dart` as `Color(0xFFRRGGBB)`
constants. Both themes were hand-tuned and both happened to be quiet about one
real problem: white text on the light end of the brand gradient was 3.33:1 —
fine for a large label, not fine for the 13px chat bubble body that actually sat
on it. Nothing catches that, because a colour pair is invisible in review and
there is no Dart toolchain here to render it.

So this parses the constants out of `theme.dart` and checks the pairs the app
actually uses. It is a *table of pairs*, not a proof: it says nothing about a
new widget that picks its own colours. It does stop the palette itself from
drifting below the floor, which is the failure that repeats.

Usage:
    python3 tools/check_contrast.py          # exits 1 on any failure
    python3 tools/check_contrast.py -v       # show every pair, including passes
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THEME = ROOT / 'apps' / 'mobile' / 'lib' / 'core' / 'theme.dart'

# WCAG 2.1: 4.5:1 for normal text, 3:1 for large (>=18.66px bold / >=24px).
AA_TEXT = 4.5
AA_LARGE = 3.0


def channel(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def luminance(hex_colour: str) -> float:
    h = hex_colour.lstrip('#')
    if len(h) == 8:  # ARGB, ignore alpha: contrast is about the opaque colour
        h = h[2:]
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def ratio(fg: str, bg: str) -> float:
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def read_palette() -> dict[str, str]:
    """Every `static const name = Color(0xFFRRGGBB)` in theme.dart.

    Gradients are flattened to their individual stops, named
    `<gradient><index>` — that is what lets the brand gradient be checked
    stop by stop, which is exactly how the too-light end was found.
    """
    text = THEME.read_text(encoding='utf-8')
    palette: dict[str, str] = {}

    for match in re.finditer(
        r'static\s+const\s+(\w+)\s*=\s*Color\(0x([0-9A-Fa-f]{8})\)', text
    ):
        palette[match.group(1)] = match.group(2)[2:]

    # A gradient's own consts, in declaration order.
    for grad in re.finditer(
        r'static\s+const\s+(\w+)\s*=\s*LinearGradient\(([^;]*?)\);', text, re.S
    ):
        name = grad.group(1)
        colours = re.findall(r'Color\(0x([0-9A-Fa-f]{8})\)', grad.group(2))
        for index, colour in enumerate(colours):
            palette[f'{name}[{index}]'] = colour[2:]

    return palette


# (fg, bg, minimum, why)
# Every pair below is one the UI really renders. The comment says where.
PAIRS: list[tuple[str, str, float, str]] = [
    # --- light theme -------------------------------------------------------
    ('navy', 'background', AA_TEXT, 'body text on the page wash'),
    ('navy', 'surface_light', AA_TEXT, 'body text on a white card'),
    ('mutedText', 'background', AA_TEXT, 'secondary text on the page wash'),
    ('mutedText', 'surface_light', AA_TEXT, 'secondary text on a card'),
    ('primary', 'surface_light', AA_TEXT, 'links and inline actions on a card'),
    ('success', 'surface_light', AA_TEXT, 'success chip text'),
    ('warning', 'surface_light', AA_TEXT, 'warning chip text'),
    ('danger', 'surface_light', AA_TEXT, 'error text, destructive labels'),
    # --- dark theme --------------------------------------------------------
    ('darkText', 'darkBackground', AA_TEXT, 'body text on the dark canvas'),
    ('darkText', 'darkSurface', AA_TEXT, 'body text on a dark card'),
    ('darkMutedText', 'darkBackground', AA_TEXT, 'secondary text on the canvas'),
    ('darkMutedText', 'darkSurface', AA_TEXT, 'secondary text on a dark card'),
    ('darkPrimary', 'darkBackground', AA_TEXT, 'links on the dark canvas'),
    ('darkPrimary', 'darkSurface', AA_TEXT, 'links on a dark card'),
    ('darkSuccess', 'darkSurface', AA_TEXT, 'success chip on a dark card'),
    ('darkWarning', 'darkSurface', AA_TEXT, 'warning chip on a dark card'),
    ('darkDanger', 'darkSurface', AA_TEXT, 'error text on a dark card'),
    # --- fills that carry white text --------------------------------------
    # Checked at the *lightest* stop, because a gradient gets no lighter than
    # that and the worst stop is the one that decides legibility.
    ('white', 'brandGradient[0]', AA_TEXT, 'white text on the primary button fill'),
    ('white', 'brandGradient[1]', AA_TEXT, 'white text on the primary button fill'),
    ('white', 'deepGradient[0]', AA_LARGE, 'white headings on the header backdrop'),
    ('white', 'deepGradient[1]', AA_LARGE, 'white headings on the header backdrop'),
]


def main() -> int:
    verbose = '-v' in sys.argv or '--verbose' in sys.argv
    palette = read_palette()
    palette.setdefault('surface_light', 'FFFFFF')
    palette.setdefault('white', 'FFFFFF')

    missing = [p for p in PAIRS if p[0] not in palette or p[1] not in palette]
    if missing:
        for fg, bg, _, _ in missing:
            print(f'  ! unknown colour: {fg} on {bg}')
        print('\ncheck_contrast: could not resolve every colour — theme.dart changed shape?')
        return 1

    failures = 0
    for fg, bg, minimum, why in PAIRS:
        value = ratio(palette[fg], palette[bg])
        ok = value >= minimum
        if not ok:
            failures += 1
        if verbose or not ok:
            mark = 'ok  ' if ok else 'FAIL'
            print(f'  {mark} {value:5.2f} (need {minimum:.1f})  {fg} on {bg} — {why}')

    if failures:
        print(f'\ncheck_contrast: {failures} pair(s) below AA.')
        return 1

    print(f'check_contrast: {len(PAIRS)} pair(s) checked, all clear AA.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
