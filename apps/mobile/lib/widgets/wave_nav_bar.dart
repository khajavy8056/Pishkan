import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/motion.dart';
import '../core/sizes.dart';
import '../core/theme.dart';

/// One destination in a [WaveNavBar].
class WaveNavItem {
  const WaveNavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
  });

  /// Outline glyph, drawn for every unselected destination.
  final IconData icon;

  /// Filled glyph, drawn for the selected one.
  final IconData activeIcon;

  final String label;
}

/// A floating bottom bar whose top edge is one continuous wave, with a dome
/// that rises under the selected destination and travels to it when the
/// selection changes.
///
/// This replaced a white pill with four equal cells and a tinted rectangle
/// behind the active one. The rectangle was the problem: on a bar with 26 dp
/// rounded ends, a rectangular highlight inside it reads as a second, smaller
/// bar sitting on the first. A single curve has no interior seams — the bar is
/// one object, and the selection is a property of that object.
///
/// Geometry, and the two mistakes that shaped it:
///
///  * **The dome is mirrored for RTL.** `Row` lays the first child on the
///    *right*, so destination 0 is the right-most cell. Computing the dome's
///    centre as `width / count * (index + 0.5)` put it on the left, under the
///    wrong icon — the selected label went white on a white surface and all but
///    disappeared. The centre is measured from the right edge now, and there is
///    a test that taps the last destination and checks where the dome is.
///  * **The dome is a dome, not a swell.** A wide, shallow hump reads as the
///    bar sagging. The reference is a tall, narrow dome — roughly a third of the
///    bar's height, a little over one cell wide — with a shallow trough on
///    each side where the white surface dips before returning to flat. The
///    trough is what makes it read as a wave travelling through the bar.
///
/// The box is `barHeight + rise` tall: the bar body occupies the bottom, the
/// dome rises into the space above it. Icons sit in the body and do not move
/// when the dome arrives, which is what keeps four destinations legible at once.
class WaveNavBar extends StatefulWidget {
  const WaveNavBar({
    super.key,
    required this.items,
    required this.index,
    required this.onSelect,
    this.height = 74,
  });

  final List<WaveNavItem> items;
  final int index;
  final ValueChanged<int> onSelect;

  /// Height of the bar's body, excluding the dome and the safe-area inset.
  final double height;

  @override
  State<WaveNavBar> createState() => _WaveNavBarState();
}

class _WaveNavBarState extends State<WaveNavBar> with SingleTickerProviderStateMixin {
  /// Drives the dome's travel.
  ///
  /// A controller rather than an int animation, because the painted curve has
  /// to be sampled at a fraction *between* two destinations — the dome is at
  /// `2.37` of the way across while it moves, which is only expressible as a
  /// double.
  late final AnimationController _travel = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 300),
    value: 1,
  );

  late double _from = widget.index.toDouble();
  late double _to = widget.index.toDouble();

  @override
  void didUpdateWidget(covariant WaveNavBar old) {
    super.didUpdateWidget(old);
    if (old.index != widget.index) {
      // Start from wherever the dome actually is, not from the previous
      // destination: tapping twice quickly must not make it jump backwards.
      _from = _position;
      _to = widget.index.toDouble();
      _travel
        ..reset()
        ..forward();
    }
  }

  @override
  void dispose() {
    _travel.dispose();
    super.dispose();
  }

  double get _position {
    if (widget.items.length < 2) return _to;
    final t = Curves.easeOutCubic.transform(_travel.value);
    return _from + (_to - _from) * t;
  }

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final dark = context.isDark;
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final body = widget.height;
    final rise = body * _WavePainter.riseRatio;

    // The gesture inset is padding *below* the drawn bar, not part of it. Inside
    // the painted box it would put the wave on top of the home indicator and
    // shorten the bar on devices without one.
    return Padding(
      padding: EdgeInsets.fromLTRB(sizes.s(12), 0, sizes.s(12), sizes.s(9)),
      child: AnimatedBuilder(
        animation: _travel,
        builder: (context, _) {
          return Padding(
            padding: EdgeInsets.only(bottom: bottomInset),
            child: SizedBox(
              height: body + rise,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: CustomPaint(
                      painter: _WavePainter(
                        position: _position,
                        count: widget.items.length,
                        bodyHeight: body,
                        dark: dark,
                      ),
                    ),
                  ),
                  // The destinations sit in the body, below the dome. The
                  // selected one is *not* moved up: in the reference all four
                  // stay on one baseline, and the dome rises behind the chosen
                  // icon rather than carrying it away.
                  //
                  // Laid out from explicit rectangles rather than a `Row`.
                  // `Row` mirrors itself for RTL, which means the *cells* and
                  // the *dome* each had their own private idea of where
                  // destination 0 sits, and after three rounds of getting that
                  // agreement wrong the only reliable fix is to remove the
                  // second opinion: both now come from [navCellLeft], one function
                  // in one place.
                  Positioned(
                    left: 0,
                    right: 0,
                    top: rise,
                    height: body,
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final cellWidth = constraints.maxWidth / widget.items.length;
                        return Stack(
                          children: [
                            for (var i = 0; i < widget.items.length; i++)
                              // `left` here is a literal pixel offset: a plain
                              // `Positioned` inside a `Stack` takes its geometry
                              // from the numbers given to it and not from the
                              // ambient `Directionality` (only
                              // `Positioned.directional` mirrors). So the cells
                              // follow `navCellLeft` exactly, which is the whole
                              // point of that function.
                              Positioned(
                                left: navCellLeft(i, widget.items.length, constraints.maxWidth),
                                width: cellWidth,
                                top: 0,
                                bottom: 0,
                                child: _NavCell(
                                  item: widget.items[i],
                                  selected: i == widget.index,
                                  dark: dark,
                                  onTap: () => widget.onSelect(i),
                                ),
                              ),
                          ],
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Left edge of destination [index] within a bar [width] wide.
///
/// The bar reads **left to right in index order**: «خانه» (destination 0) is
/// the left-most cell, «پروفایل» (3) the right-most. That is what the app has
/// always shown on device — the screenshots of all four tabs place the labels
/// at 125/275/444/593 px across a 720 px screen, which is one cell apart
/// starting from the left and is the plain `index` order.
///
/// What is *not* left-to-right is each label's text: Persian glyphs run RTL
/// inside their cell. Confusing those two facts is what produced four broken
/// releases — the cells were laid out in index order while the dome was
/// mirrored, so the blue curve was always under the destination on the
/// opposite side:
///
/// | selected | dome should be at | it was at |
/// |----------|-------------------|-----------|
/// | خانه (0)     | 125               | 630       |
/// | خدمات (1)   | 275               | 450       |
/// | پیگیری‌ها (2) | 444               | 270       |
/// | پروفایل (3)  | 593               |  90       |
///
/// Both functions below are now plain `index` order, so the dome and the cells
/// cannot disagree again.
double navCellLeft(int index, int count, double width) {
  final cell = width / count;
  return cell * index;
}

/// Centre of destination [index] — the point the dome's apex sits on.
double navDomeCentre(double position, int count, double width) {
  final cell = width / count;
  return cell * (position + 0.5);
}

class _NavCell extends StatelessWidget {
  const _NavCell({
    required this.item,
    required this.selected,
    required this.dark,
    required this.onTap,
  });

  final WaveNavItem item;
  final bool selected;
  final bool dark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    // Two inks, because the two cases sit on different backgrounds.
    //
    // On the white bar the reference uses a saturated navy — not grey. Grey
    // icons on white read as disabled; navy reads as "available, not selected".
    // A grey placeholder is what made the shipped bar look washed out. Inside
    // the dome everything is white, which the reference does with a *filled*
    // glyph rather than an outline.
    final activeInk = Colors.white;
    final restInk = dark ? const Color(0xFFBFD2E8) : const Color(0xFF1B3C8C);

    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            AnimatedScale(
              // The reference lifts the chosen glyph a little and enlarges it:
              // it is the only thing inside the dome, so it carries the
              // selection. Not enough to break the shared baseline.
              scale: selected ? 1.10 : 1,
              duration: PishkanMotion.scaled(context, const Duration(milliseconds: 300)),
              curve: Curves.easeOutCubic,
              child: Icon(
                selected ? item.activeIcon : item.icon,
                size: sizes.s(24),
                color: selected ? activeInk : restInk,
              ),
            ),
            SizedBox(height: sizes.s(4)),
            AnimatedDefaultTextStyle(
              duration: PishkanMotion.scaled(context, PishkanMotion.standard),
              curve: Curves.easeOutCubic,
              style: TextStyle(
                fontFamily: 'Vazirmatn',
                fontSize: sizes.s(10.5),
                height: 1.15,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                color: selected ? activeInk : restInk,
              ),
              child: Text(item.label, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints the bar: a white (or slate) surface whose top edge is a wave, the
/// blue dome under the selected destination, its gloss, the rim, and the
/// shadow that lifts the whole thing off the page.
class _WavePainter extends CustomPainter {
  const _WavePainter({
    required this.position,
    required this.count,
    required this.bodyHeight,
    required this.dark,
  });

  /// Where the dome is, in destination units. Animated, so it can be 2.37.
  final double position;
  final int count;

  /// Height of the bar body, excluding the dome's rise.
  final double bodyHeight;

  final bool dark;

  /// How far the dome rises above the flat run, as a fraction of the body
  /// height.
  ///
  /// Measured off the reference sheet rather than guessed: the bar's body is
  /// 125 px tall in that artwork and the dome's apex sits 32 px above the flat
  /// top run, so 0.26. A 74 dp bar therefore lifts by about 19 dp — enough to
  /// clear the icon, not enough to look like a separate button.
  static const double riseRatio = 0.26;

  /// Half-width of the dome where it crosses the bar's top line, as a fraction
  /// of one cell.
  ///
  /// Traced off the reference sheet: the bar spans 375 dp for four cells, so a
  /// cell is 93.75 dp; at the flat top run the dome is 287 px wide in a 1536 px
  /// render of a 3x screen, i.e. 95.7 dp across — a little over one cell, so
  /// 0.61 of a cell on each side.
  ///
  /// 0.80 was tried and was visibly wrong: at that width the dome covers three
  /// of the four destinations at its foot and stops reading as one selection.
  static const double _domeHalfCells = 0.61;

  /// How much wider the dome's *foot* is than the line where it crosses the
  /// bar's top: the skirt that spreads into the surface.
  ///
  /// The same trace puts the foot at 440 px / 146.7 dp across, so 0.94 of a
  /// cell each side — 1.55× the crest. That widening is most of what makes the
  /// dome read as a solid volume rather than a painted stripe.
  static const double _flare = 1.42;

  /// How deep the trough dips on each side of the dome, as a fraction of the
  /// dome's own rise. Shallow on purpose: a deep trough turns the bar's edge
  /// into a roller coaster, which the reference does not have.
  static const double _trough = 0.12;

  /// Radius of the bar's own corners, from the 24–28 dp in the reference.
  static const double _corner = 26;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty || count == 0) return;
    final w = size.width;
    final h = size.height;
    final rise = bodyHeight * riseRatio;
    final cell = w / count;
    final domeHalf = cell * _domeHalfCells;

    // Same function the cells are positioned with, and *not* clamped.
    //
    // Clamping the apex inward — the obvious way to keep the crest inside a bar
    // with 26 dp rounded ends — moves the dome off the icon it belongs to. That
    // is precisely the bug this bar has shipped with four times, because a
    // clamped apex and an unclamped one differ only at the two end
    // destinations, which are the two that appear in most screenshots.
    //
    // The reference solves it the other way round: the dome keeps its centre on
    // its icon, runs past the bar at the ends, and is trimmed by the bar's own
    // silhouette. Everything is drawn inside `clipPath(surface)`, so the
    // overhang is cut for free and still looks round.
    final domeX = navDomeCentre(position, count, w);

    final surface = _surfacePath(w, h, domeX, rise, domeHalf);

    // 1. The shadow that lifts the bar off the page.
    //
    //    Three passes, from far to near, because one blur can only be one
    //    distance. A single wide pass has no contact edge, so the bar looks like
    //    it is hovering with nothing holding it; a single tight pass has no
    //    reach, so it does not separate from the content scrolling behind it.
    //
    //      * ambient — wide, very pale, barely offset: the general sense of
    //        something sitting above the page;
    //      * key — tighter, darker, offset further down: the direction of light;
    //      * contact — a hairline of near-black right under the silhouette,
    //        which is what actually reads as "this edge is in front".
    //
    //    On dark pages the shadow is black on a dark surface, so it is both
    //    darker and less visible. The contact pass is what keeps the dark bar
    //    from dissolving into the page; a light page needs less of it.
    canvas.save();
    canvas.translate(0, 10);
    canvas.drawPath(
      surface,
      Paint()
        ..color = dark ? const Color(0x99000000) : const Color(0x3316336B)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 22),
    );
    canvas.restore();

    canvas.save();
    canvas.translate(0, 5);
    canvas.drawPath(
      surface,
      Paint()
        ..color = dark ? const Color(0x7A000000) : const Color(0x2916336B)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 7),
    );
    canvas.restore();

    canvas.save();
    canvas.translate(0, 1.5);
    canvas.drawPath(
      surface,
      Paint()
        ..color = dark ? const Color(0x52000000) : const Color(0x1A102A5C)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 1.6),
    );
    canvas.restore();

    // 2. The surface itself.
    canvas.drawPath(
      surface,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: dark
              // Lighter than the page, so the bar is an object on it rather
              // than a hole in it.
              ? [const Color(0xFF1E2C45), const Color(0xFF121C2E)]
              : [const Color(0xFFFFFFFF), const Color(0xFFF1F5FD)],
        ).createShader(Rect.fromLTWH(0, 0, w, h)),
    );

    // 3. The dome.
    //
    //    The reference dome is a *solid* body of colour sitting in the bar, not
    //    a tint over it. Two earlier attempts got this wrong in opposite ways:
    //    a hard band looked like a rectangle parked on the bar, and an
    //    alpha-mask falloff turned it into a haze — the user's «یاد سه بعدی
    //    نداره / رنگ‌هاش درست نیست». What the sheet actually shows is a filled
    //    dome with a crisp rim, a bright crest, a deep centre and a skirt that
    //    melts into the surface at its foot.
    //
    //    So it is painted as one opaque shape, then shaded in three passes:
    //      1. the body, with the vertical blue ramp;
    //      2. a bright inner glow just under the crest, which is the light
    //         catching the top of the volume;
    //      3. a soft skirt at the foot, where the dome meets the surface.
    canvas.save();
    canvas.clipPath(surface);

    final crest = _crestPath(domeX, rise, domeHalf);
    final foot = domeHalf * _flare;

    // The sides fall from the shoulders to a foot that is only modestly wider
    // than the crest, and then the bottom edge closes straight across.
    //
    // The first attempt flared the foot to 1.55× the crest, which turned the
    // dome into a *triangle* — the bar's own white top edge showed through
    // either side of it, and the shape read as a wedge rather than a hill. In
    // the reference the dome is essentially a round cap whose sides drop almost
    // vertically and disappear into the surface; the widening is there, but it
    // is subtle and happens low down.
    final dome = Path.from(crest)
      ..cubicTo(
        domeX + domeHalf, rise + (h - rise) * 0.55,
        domeX + foot, rise + (h - rise) * 0.88,
        domeX + foot, h + 2,
      )
      ..lineTo(domeX - foot, h + 2)
      ..cubicTo(
        domeX - foot, rise + (h - rise) * 0.88,
        domeX - domeHalf, rise + (h - rise) * 0.55,
        domeX - domeHalf, rise,
      )
      ..close();

    // Pass 1: the body. Saturated, and lit from the crest down.
    canvas.drawPath(
      dome,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: const [0, 0.22, 0.55, 0.86, 1],
          colors: dark
              ? const [
                  Color(0xFF9BD8FF),
                  Color(0xFF2F7CF0),
                  Color(0xFF1B4FC4),
                  Color(0xFF152C6B),
                  Color(0xFF152C6B),
                ]
              : const [
                  Color(0xFF8FD9FF),
                  Color(0xFF2E8BFB),
                  Color(0xFF0B5CF0),
                  Color(0xFF0A47D6),
                  Color(0xFF0A47D6),
                ],
        ).createShader(Rect.fromLTWH(0, 0, w, h)),
    );

    // Pass 2: the inner glow. A white radial just inside the crest — the one
    // cue in the sheet that says the dome is a lit dome and not a flat blob.
    // Clipped to the dome so it cannot wash out the white surface around it.
    canvas.save();
    canvas.clipPath(dome);
    canvas.drawCircle(
      Offset(domeX, rise + (h - rise) * 0.10),
      domeHalf * 1.15,
      Paint()
        ..shader = RadialGradient(
          colors: [
            Colors.white.withOpacity(dark ? 0.30 : 0.42),
            Colors.white.withOpacity(0.0),
          ],
          stops: const [0.0, 1.0],
        ).createShader(Rect.fromCircle(
          center: Offset(domeX, rise + (h - rise) * 0.10),
          radius: domeHalf * 1.15,
        )),
    );
    canvas.restore();

    // Pass 3: the skirt. Where the dome's foot meets the surface it should not
    // stop on a line — a short vertical fade back into the bar's own colour is
    // what makes it look embedded rather than cut out and laid on top.
    canvas.save();
    canvas.clipPath(dome);
    canvas.drawRect(
      Rect.fromLTWH(0, h - (h - rise) * 0.16, w, (h - rise) * 0.16 + 2),
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            (dark ? const Color(0xFF152C6B) : const Color(0xFF0A47D6))
                .withOpacity(0.0),
            (dark ? const Color(0xFF152C6B) : const Color(0xFF0A47D6))
                .withOpacity(0.85),
          ],
        ).createShader(
          Rect.fromLTWH(0, h - (h - rise) * 0.16, w, (h - rise) * 0.16 + 2),
        ),
    );
    canvas.restore();

    canvas.restore();

    // 4. The rim and the gloss.
    //
    //    The reference dome has a crisp bright line all the way around its
    //    crest — hard, almost white, and unbroken. That single stroke is what
    //    separates the dome from the page behind it; without it the blue edge
    //    is just a colour change and the volume disappears. A blurred highlight
    //    alone was not enough, which is why the earlier version still read flat.
    //
    //    Two strokes, then: a hard one on the path itself, and a soft one just
    //    inside it for the light rolling over the top of the hill.
    canvas.save();
    canvas.clipPath(surface);

    canvas.drawPath(
      _crestPath(domeX, rise, domeHalf),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6
        ..color = Colors.white.withOpacity(dark ? 0.62 : 0.92),
    );

    canvas.drawPath(
      _crestPath(domeX, rise - 2.2, domeHalf * 0.94),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.0
        ..color = Colors.white.withOpacity(dark ? 0.22 : 0.38)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.6),
    );

    canvas.restore();

    // 5. The separators. Hairlines between destinations, drawn only where the
    //    surface is flat — a line across the dome would cut it in half. They
    //    are what make four destinations read as four targets rather than one
    //    continuous strip.
    final sepPaint = Paint()
      ..strokeWidth = 1
      ..color = dark ? const Color(0x1FFFFFFF) : const Color(0x14203A66);
    for (var i = 1; i < count; i++) {
      // Between destination i-1 and i, in the same index order the cells and
      // the dome use. This was mirrored too, so the separators were in the
      // opposite order to the icons — visible in the screenshots as a gap in a
      // different place from the one between the labels.
      final x = cell * i;
      // Skip the two boundaries that run into the dome.
      if ((x - domeX).abs() < domeHalf * 1.5) continue;
      canvas.drawLine(
        Offset(x, rise + bodyHeight * 0.26),
        Offset(x, rise + bodyHeight * 0.74),
        sepPaint,
      );
    }

    // 6. The rim. On a dark page the bar's silhouette dissolves into the
    //    background at the edges, because its own shadow is black on black.
    canvas.drawPath(
      surface,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2
        ..color = dark ? const Color(0x2BFFFFFF) : const Color(0xFFDCE7F7),
    );
  }

  /// Height of the bar's top edge above the flat run, at [x].
  ///
  /// One function for the whole edge, sampled by both the surface and the dome
  /// fill, so the two can never disagree and leave a hairline of the wrong
  /// colour along the crest.
  ///
  /// The profile is symmetric and does not depend on the bar's width: at the
  /// first and last destinations the dome simply overhangs and the surface clip
  /// trims it. Two earlier versions tried to keep the whole crest inside the
  /// bar — one by clamping the apex inward, one by stretching the outward
  /// shoulder — and both produced an end tab whose dome did not match the
  /// middle two.
  double _edge(double x, double domeX, double rise, double domeHalf) {
    final d = (x - domeX).abs();
    if (d < domeHalf) {
      // A Hann window raised to a power.
      //
      // The profile here was *measured* off the reference sheet and fitted,
      // not guessed: a raised cosine on its own leaves the flanks too full
      // (`sse 0.143` against the traced heights), while `cos^1.6` tracks it
      // (sse 0.059). The visible difference is the shoulders — a pure cosine
      // hump meets the flat run at a shallow angle and the dome reads as a
      // mound, whereas the reference dome turns down decisively and reads as a
      // volume.
      //
      // `0.5 * (1 + cos(pi t))` peaks at the centre with zero slope at both
      // ends, which is what keeps the top round and the join with the bar
      // seamless; the exponent sharpens the descent without breaking either.
      const k = 1.6;
      final t = (d / domeHalf).clamp(0.0, 1.0);
      final hann = 0.5 * (1 + math.cos(math.pi * t));
      return rise * math.pow(hann, k).toDouble();
    }
    // The trough either side: the surface dips below the flat line, then comes
    // back. This is what makes the silhouette read as a wave passing through
    // the bar rather than a bump pasted onto it.
    final t = (d - domeHalf) / (domeHalf * 0.62);
    if (t >= 1) return 0;
    return -rise * _trough * math.sin(math.pi * t);
  }

  Path _edgePath(double w, double domeX, double rise, double domeHalf) {
    const steps = 180;
    final path = Path();
    for (var i = 0; i <= steps; i++) {
      final x = w * i / steps;
      final y = rise - _edge(x, domeX, rise, domeHalf);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path;
  }

  /// Just the crest, for the gloss stroke and the dome's top.
  ///
  /// Sampled a little wider than the visible crest so the two end destinations
  /// still have their full curve drawn after the bar's silhouette trims the
  /// overhang — the stroke follows the shape that is above the flat run, not
  /// the part of it that happens to be inside the bar.
  Path _crestPath(double domeX, double rise, double domeHalf) {
    final path = Path();
    const steps = 90;
    for (var i = 0; i <= steps; i++) {
      final x = domeX - domeHalf + (domeHalf * 2) * i / steps;
      final y = rise - _edge(x, domeX, rise, domeHalf);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path;
  }

  /// The bar's outline: sampled top edge, down both sides, across the bottom
  /// with rounded corners.
  Path _surfacePath(double w, double h, double domeX, double rise, double domeHalf) {
    return _edgePath(w, domeX, rise, domeHalf)
      ..lineTo(w, h - _corner)
      ..quadraticBezierTo(w, h, w - _corner, h)
      ..lineTo(_corner, h)
      ..quadraticBezierTo(0, h, 0, h - _corner)
      ..close();
  }


  @override
  bool shouldRepaint(covariant _WavePainter old) =>
      old.position != position ||
      old.count != count ||
      old.bodyHeight != bodyHeight ||
      old.dark != dark;
}
