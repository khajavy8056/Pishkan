#!/usr/bin/env python3
"""Render the 24 bundled customer avatars.

The first attempt at this shipped 24 recolours of one drawing: same face, same
pigtails, same smile, only the shirt and the halo moved. The picker looked
broken because it *was* broken -- there was nothing to choose between.

This draws each face from independent features, so no two presets share more
than a couple of traits:

    hair style     long / pigtails / bun / short / curly / tied / bald
    hair colour    black / dark brown / brown / chestnut / auburn / grey
    skin tone      six steps, independent of hair and clothing
    eyes           almond or round, with or without glasses
    extra          beard, moustache, headscarf, freckles, none
    shirt colour   keyed to the preset, not to the features

Presets 1-12 are the feminine set and 13-24 the masculine set, because the
picker filters on gender; the split is by face shape and hair, not skin tone.

Output is 192x192 WebP with a transparent background, so the disc tint in the
app still shows through around the head.

Rendering goes through ImageMagick's MVG primitives rather than SVG: the
sandbox has no rsvg-convert, no libcairo and no apt access, and MVG takes the
same path syntax without any of that.

Run:  python3 tools/avatars/generate.py
"""

import os
import subprocess
import sys
import tempfile

SIZE = 192

SKIN = ['#F7D9C4', '#EFC4A8', '#DFA57F', '#C88B62', '#A96B44', '#7E4F32']

HAIR = ['#1C1A19', '#2E2119', '#4A3020', '#6B3F24', '#8C4A2F', '#9A9A9A']

SHIRT = ['#6D5BD0', '#3F7FBF', '#2E9E83', '#C4693F', '#B44C7A', '#4C5FA8',
         '#7A8B3F', '#A85C2E', '#556677', '#8E5AA8', '#3D8C6E', '#B0703C']

BACKDROP = ['#E8F0FF', '#EAF6EC', '#FDEEE4', '#F1ECFB', '#E5F4F7', '#FBF0DC']


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def hexof(c):
    return '#%02X%02X%02X' % c


def mix(fg, bg, amount):
    """Blend `fg` into the background by `amount` -- a premultiplied tint."""
    a, b = rgb(fg), rgb(bg)
    return tuple(int(a[i] * amount + b[i] * (1 - amount)) for i in range(3))


def shade(c, factor):
    return tuple(max(0, min(255, int(v * factor))) for v in c)


class Face:
    def __init__(self, preset, feminine, skin, hair_col, style, eyes, extra,
                 shirt, backdrop):
        self.preset = preset
        self.feminine = feminine
        self.skin = hexof(rgb(skin))
        self.skin_dark = hexof(shade(rgb(skin), 0.88))
        self.hair = hexof(rgb(hair_col))
        self.hair_dark = hexof(shade(rgb(hair_col), 0.82))
        self.style = style
        self.eyes = eyes
        self.extra = extra
        self.shirt = hexof(rgb(shirt))
        self.shirt_dark = hexof(shade(rgb(shirt), 0.82))
        self.backdrop = backdrop
        self.ops = []

    # MVG primitives ------------------------------------------------------
    #
    # Paint state must be set on its own line: this ImageMagick build ignores
    # `fill X` written after the primitive on the same line and silently paints
    # black, which is how the first render lost every shirt.
    def draw(self, *lines):
        self.ops.extend(lines)

    def _fill(self, fill, opacity=None):
        if fill == 'none':
            return ['fill none', 'stroke none']
        return [f'fill {fill}', 'stroke none']

    def circle(self, cx, cy, r, fill, opacity=None):
        self.draw(*self._fill(fill, opacity)
                  + [f'circle {cx},{cy} {cx},{cy - r}'])

    def ellipse(self, cx, cy, rx, ry, fill, opacity=None):
        self.draw(*self._fill(fill, opacity)
                  + [f'ellipse {cx},{cy} {rx},{ry} 0,360'])

    def path(self, d, fill='none', opacity=None, stroke=None, sw=0, cap='round'):
        if stroke:
            paint = [f'fill none', f'stroke {stroke}', f'stroke-width {sw}',
                     f'stroke-linecap {cap}']
        else:
            paint = self._fill(fill, opacity)
        self.draw(*paint + [f"path '{d}'"])

    def roundrect(self, x0, y0, x1, y1, rx, ry, stroke=None, sw=0):
        self.draw('fill none', f'stroke {stroke}', f'stroke-width {sw}',
                  f'roundrectangle {x0},{y0} {x1},{y1} {rx},{ry}')

    # -- the face ---------------------------------------------------------
    #
    # Geometry is derived from one head box so a change to the head size
    # carries through the ears, eyes, hair and shoulders instead of leaving
    # them where they were.
    HX, HY, HRX, HRY = 96, 86, 46, 52          # head: x 50..142, y 34..138

    def compose(self):
        cy = self.HY + 2                        # eye line
        ex = (self.HX - 18, self.HX + 18)       # eye centres

        # shoulders: a sliver, not a slab. The app clips this to a circle, so
        # the shirt only needs to reach the bottom edge and stop.
        self.path(f'M 0,192 C 6,158 42,148 {self.HX},148 '
                  f'C 150,148 186,158 192,192 Z', self.shirt)
        self.path(f'M 76,150 C 82,162 110,162 116,150 '
                  f'L 110,148 L 82,148 Z', self.shirt_dark)

        # neck, short enough that the head sits on the shoulders
        self.path(f'M 82,124 L 110,124 L 112,152 '
                  f'C 106,158 86,158 80,152 Z', self.skin_dark)

        st = self.style

        # hair volume *behind* the head comes first, so the face overlaps it
        if st in ('long', 'pigtails'):
            self.path(f'M 46,88 C 42,38 70,22 {self.HX},22 '
                      f'C 122,22 150,38 146,88 '
                      f'L 150,164 C 138,158 132,146 130,128 L 62,128 '
                      f'C 60,146 54,158 42,164 Z', self.hair)
        if st == 'pigtails':
            self.ellipse(44, 112, 16, 32, self.hair)
            self.ellipse(148, 112, 16, 32, self.hair)
        if st == 'tied':
            self.path(f'M 138,66 C 158,70 164,92 158,112 '
                      f'C 154,124 146,128 140,124 '
                      f'C 148,110 148,92 138,82 Z', self.hair)
        if st == 'bun':
            self.circle(self.HX, 26, 20, self.hair)

        # head + ears. The masculine set gets a wider jaw and a flatter crown;
        # a plain ellipse reads feminine at every size.
        if self.feminine:
            self.ellipse(self.HX, self.HY, self.HRX, self.HRY, self.skin)
        else:
            self.path(f'M {self.HX - self.HRX},84 '
                      f'C {self.HX - self.HRX},40 {self.HX - 30},30 {self.HX},30 '
                      f'C {self.HX + 30},30 {self.HX + self.HRX},40 '
                      f'{self.HX + self.HRX},84 '
                      f'C {self.HX + self.HRX},120 {self.HX + 30},140 '
                      f'{self.HX},140 '
                      f'C {self.HX - 30},140 {self.HX - self.HRX},120 '
                      f'{self.HX - self.HRX},84 Z', self.skin)
        self.ellipse(self.HX - self.HRX + 1, self.HY + 6, 8, 11, self.skin)
        self.ellipse(self.HX + self.HRX - 1, self.HY + 6, 8, 11, self.skin)

        # headscarf covers the hair entirely, so it outranks the style
        if self.extra == 'scarf':
            self.path(f'M 48,90 C 44,34 70,16 {self.HX},16 '
                      f'C 122,16 148,34 144,90 '
                      f'C 144,110 150,124 156,140 L 138,146 '
                      f'C 130,126 132,108 130,90 L 62,90 '
                      f'C 60,108 62,126 54,146 L 36,140 '
                      f'C 42,124 48,110 48,90 Z', '#4E7FB8')
            self.path(f'M 62,92 C 66,58 82,44 {self.HX},44 '
                      f'C 110,44 126,58 130,92 '
                      f'C 120,74 110,66 {self.HX},66 '
                      f'C 82,66 72,74 62,92 Z', '#3E6A9C')

        # fringe / top hair, drawn over the skull
        if st == 'bald':
            pass
        elif st == 'curly':
            for cx, cyy, r in ((60, 52, 19), (78, 34, 21), (100, 28, 22),
                               (122, 36, 20), (138, 56, 17), (50, 74, 15),
                               (142, 78, 15), (66, 30, 16), (112, 24, 17),
                               (86, 24, 16)):
                self.circle(cx, cyy, r, self.hair)
        elif st == 'bun':
            self.path(f'M 50,84 C 46,46 68,30 {self.HX},30 '
                      f'C 124,30 146,46 142,84 '
                      f'C 134,58 118,50 {self.HX},50 '
                      f'C 74,50 58,58 50,84 Z', self.hair)
        elif st in ('short', 'tied'):
            self.path(f'M 50,84 C 46,44 68,28 {self.HX},28 '
                      f'C 124,28 146,44 142,84 '
                      f'C 136,56 120,46 {self.HX},46 '
                      f'C 72,46 56,56 50,84 Z', self.hair)
        elif st in ('long', 'pigtails'):
            self.path(f'M 50,88 C 46,44 68,28 {self.HX},28 '
                      f'C 124,28 146,44 142,88 '
                      f'C 132,62 118,52 {self.HX},52 '
                      f'C 74,52 60,62 50,88 Z', self.hair)
            # side strands framing the cheeks
            self.path('M 50,84 L 54,136 L 66,134 L 62,82 Z', self.hair)
            self.path('M 142,84 L 138,136 L 126,134 L 130,82 Z', self.hair)

        # eyes
        iris = '#40301F' if self.feminine else '#3A2B22'
        if self.eyes == 'round':
            for x in ex:
                self.ellipse(x, cy, 8.5, 8.5, '#FFFFFF')
                self.circle(x, cy + 0.5, 4.8, iris)
                self.circle(x - 1.3, cy - 1.8, 1.7, '#FFFFFF')
        else:
            for x in ex:
                self.path(f'M {x - 10},{cy} C {x - 7},{cy - 8} '
                          f'{x + 7},{cy - 8} {x + 10},{cy} '
                          f'C {x + 7},{cy + 6} {x - 7},{cy + 6} '
                          f'{x - 10},{cy} Z', '#FFFFFF')
                self.circle(x, cy, 4.6, iris)
                self.circle(x - 1.2, cy - 1.7, 1.6, '#FFFFFF')

        # brows: heavy and flat for the masculine set, arched for the feminine
        brow = hexof(shade(rgb(self.hair), 0.9))
        for x in ex:
            if self.feminine:
                self.path(f'M {x - 11},{cy - 15} Q {x},{cy - 22} '
                          f'{x + 11},{cy - 15}', stroke=brow, sw=3.6)
            else:
                self.path(f'M {x - 12},{cy - 14} Q {x},{cy - 21} '
                          f'{x + 12},{cy - 14}', stroke=brow, sw=5)

        # glasses
        if self.extra == 'glasses':
            for x in ex:
                self.roundrect(x - 15, cy - 13, x + 15, cy + 13, 10, 10,
                               '#2B2B33', 3.2)
            self.path(f'M {ex[0] + 15},{cy - 2} L {ex[1] - 15},{cy - 2}',
                      stroke='#2B2B33', sw=3.2)

        # nose
        self.path(f'M {self.HX},{cy + 10} L {self.HX - 4},{cy + 21} '
                  f'Q {self.HX},{cy + 25} {self.HX + 4},{cy + 21}',
                  stroke=self.skin_dark, sw=3.4)

        # mouth and facial hair
        if self.extra in ('beard', 'moustache'):
            # a filled shape, not strokes: two stacked lines read as a smirk
            self.path(f'M {self.HX - 20},{cy + 30} '
                      f'C {self.HX - 12},{cy + 24} {self.HX - 4},{cy + 26} '
                      f'{self.HX},{cy + 30} '
                      f'C {self.HX + 4},{cy + 26} {self.HX + 12},{cy + 24} '
                      f'{self.HX + 20},{cy + 30} '
                      f'C {self.HX + 12},{cy + 40} {self.HX - 12},{cy + 40} '
                      f'{self.HX - 20},{cy + 30} Z', '#6B4030')
            if self.extra == 'beard':
                self.path(f'M 54,{cy + 2} C 56,{cy + 42} 72,{cy + 60} '
                          f'{self.HX},{cy + 60} '
                          f'C 120,{cy + 60} 136,{cy + 42} 138,{cy + 2} '
                          f'C 130,{cy + 24} 114,{cy + 34} {self.HX},{cy + 34} '
                          f'C 78,{cy + 34} 62,{cy + 24} 54,{cy + 2} Z',
                          self.hair_dark)
        else:
            lip = '#C4615B' if self.feminine else '#8C4A3E'
            self.path(f'M 84,{cy + 34} Q {self.HX},{cy + 44} 108,{cy + 34}',
                      stroke=lip, sw=4.4)
            if self.feminine:
                self.path(f'M 87,{cy + 34} Q {self.HX},{cy + 37} 105,{cy + 34}',
                          stroke=lip, sw=2.6)

        # cheeks, and freckles when the preset has them
        blush = hexof(mix('#E8968C', self.skin, 0.30))
        self.ellipse(self.HX - 28, cy + 18, 9, 6, blush)
        self.ellipse(self.HX + 28, cy + 18, 9, 6, blush)
        if self.extra == 'freckles':
            spot = hexof(mix('#A9705A', self.skin, 0.6))
            for x, y in ((self.HX - 30, cy + 6), (self.HX - 24, cy + 11),
                         (self.HX - 32, cy + 13), (self.HX + 30, cy + 6),
                         (self.HX + 24, cy + 11), (self.HX + 32, cy + 13)):
                self.circle(x, y, 1.6, spot)
        return self.ops


# preset, feminine, skin, hair colour, style, eyes, extra, shirt, backdrop
PLAN = [
    (1, True, 0, 1, 'long', 'almond', 'none', 0, 0),
    (2, True, 2, 0, 'pigtails', 'round', 'none', 4, 1),
    (3, True, 4, 2, 'bun', 'almond', 'scarf', 6, 2),
    (4, True, 1, 5, 'short', 'round', 'glasses', 2, 3),
    (5, True, 3, 0, 'curly', 'almond', 'none', 8, 4),
    (6, True, 5, 3, 'long', 'round', 'freckles', 1, 5),
    (7, True, 0, 4, 'tied', 'almond', 'none', 9, 3),
    (8, True, 2, 5, 'bun', 'round', 'none', 5, 0),
    (9, True, 4, 1, 'pigtails', 'almond', 'glasses', 10, 4),
    (10, True, 1, 2, 'long', 'round', 'freckles', 7, 1),
    (11, True, 3, 3, 'curly', 'almond', 'scarf', 11, 2),
    (12, True, 5, 4, 'short', 'round', 'none', 3, 5),
    (13, False, 1, 0, 'short', 'almond', 'none', 8, 0),
    (14, False, 3, 1, 'short', 'round', 'beard', 2, 2),
    (15, False, 5, 2, 'curly', 'almond', 'none', 0, 4),
    (16, False, 0, 3, 'bald', 'round', 'moustache', 6, 1),
    (17, False, 2, 5, 'short', 'almond', 'glasses', 4, 5),
    (18, False, 4, 0, 'curly', 'round', 'beard', 10, 3),
    (19, False, 1, 4, 'bald', 'almond', 'beard', 9, 4),
    (20, False, 3, 2, 'short', 'round', 'none', 11, 0),
    (21, False, 5, 3, 'curly', 'almond', 'glasses', 3, 2),
    (22, False, 0, 1, 'short', 'round', 'beard', 7, 5),
    (23, False, 2, 5, 'bald', 'almond', 'none', 5, 1),
    (24, False, 4, 4, 'short', 'round', 'moustache', 1, 3),
]


def main():
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..',
                                           '..', 'apps', 'mobile', 'assets',
                                           'avatars'))
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='avatars-')

    for row in PLAN:
        n, fem, si, hi, style, eyes, extra, shi, bi = row
        face = Face(n, fem, SKIN[si], HAIR[hi], style, eyes, extra,
                    SHIRT[shi], BACKDROP[bi])
        mvg = '\n'.join(face.compose())
        mvg_path = os.path.join(tmp, f'preset-{n:02d}.mvg')
        with open(mvg_path, 'w', encoding='utf-8') as fh:
            fh.write(f'viewbox 0 0 {SIZE} {SIZE}\n' + mvg + '\n')
        out = os.path.join(out_dir, f'preset-{n:02d}.webp')
        subprocess.run(['convert', '-size', f'{SIZE}x{SIZE}', 'xc:none',
                        '-draw', f'@{mvg_path}',
                        '-quality', '88', out],
                       check=True, capture_output=True)

    print(f'wrote {len(PLAN)} avatars to {out_dir}')


if __name__ == '__main__':
    sys.exit(main())
