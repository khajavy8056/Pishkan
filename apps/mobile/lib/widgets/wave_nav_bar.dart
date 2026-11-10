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
                        brand: context.brand,
                      ),
                    ),
                  ),
                  // The destinations sit in the body, below the dome. The
                  // selected one is *not* moved up: in the reference all four
                  // stay on one baseline, and the dome rises behind the chosen
                  // icon rather than carrying it away.
                  Positioned(
                    left: 0,
                    right: 0,
                    top: rise,
                    height: body,
                    child: Row(
                      children: [
                        for (var i = 0; i < widget.items.length; i++)
                          Expanded(
                            child: _NavCell(
                              item: widget.items[i],
                              selected: i == widget.index,
                              dark: dark,
                              onTap: () => widget.onSelect(i),
                            ),
                          ),
                      ],
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
    // Inside the dome the label sits on saturated blue, so it is white. Outside
    // it the label sits on near-white, so it is navy — the two cases cannot
    // share one colour, which is exactly what went wrong when the dome was
    // drawn on the wrong side.
    final activeInk = Colors.white;
    final restInk = dark ? const Color(0xFFA9BCD6) : const Color(0xFF27406B);

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
              scale: selected ? 1.04 : 1,
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
    required this.brand,
  });

  /// Where the dome is, in destination units. Animated, so it can be 2.37.
  final double position;
  final int count;

  /// Height of the bar body, excluding the dome's rise.
  final double bodyHeight;

  final bool dark;
  final Color brand;

  /// How far the dome rises above the flat run, as a fraction of the body
  /// height. 0.34 of 74 dp is 25 dp: tall enough to be a hill, short enough
  /// that the icon inside it is not crowding the rim.
  static const double riseRatio = 0.34;

  /// Half-width of the dome, as a fraction of one cell. The reference dome
  /// covers a little over one cell, so 0.56 each side.
  static const double _domeHalfCells = 0.56;

  /// How much wider the dome's base is than its crest, as a multiple of the
  /// crest's half-width. This flare is what makes the dome look like it is
  /// rising out of the surface rather than a band laid over it.
  static const double _flare = 1.9;

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

    // Measured from the RIGHT edge: the app is RTL and `Row` puts destination 0
    // on the right, so the dome has to be mirrored too. Getting this wrong put
    // the dome under the wrong icon and made the selected label vanish.
    //
    // Clamped so the crest stays fully inside the bar. Without the clamp the
    // first and last destinations put the dome's apex on the rounded end, and
    // the bar's own outline cut the crest in half — the dome appeared to be
    // missing its peak on exactly the two tabs where it matters most.
    final domeX = (w - cell * (position + 0.5)).clamp(domeHalf, w - domeHalf);

    final surface = _surfacePath(w, h, domeX, rise, domeHalf);

    // 1. The shadow that lifts the bar off the page. Two passes: one wide and
    //    pale, one tight and darker. A single blur cannot be both the thing
    //    that separates the bar from the content behind it and the thing that
    //    defines its edge.
    canvas.save();
    canvas.translate(0, 8);
    canvas.drawPath(
      surface,
      Paint()
        ..color = dark ? const Color(0x8A000000) : const Color(0x2E16336B)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 18),
    );
    canvas.restore();
    canvas.drawPath(
      surface,
      Paint()
        ..color = dark ? const Color(0x66000000) : const Color(0x1F16336B)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
    );

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
    //    Two passes inside one layer, because the shape needs two gradients at
    //    once and a fill has one shader:
    //
    //      1. the flared dome path, filled with a *horizontal* alpha ramp —
    //         this is what gives the soft edges where the blue dissolves into
    //         the white surface;
    //      2. the same path again with the *vertical* colour gradient in
    //         `srcATop`, which recolours what pass 1 laid down while keeping
    //         its alpha ramp.
    //
    //    The first version masked a hard-edged band with a `dstIn` gradient,
    //    which zeroed the alpha at the edges instead of fading it and left two
    //    vertical cuts down the dome's sides — a blue rectangle parked on the
    //    bar rather than a dome rising out of it.
    canvas.save();
    canvas.clipPath(surface);
    canvas.saveLayer(Rect.fromLTWH(0, 0, w, h), Paint());

    final (leftHalf, rightHalf) = _halves(w, domeX, domeHalf);
    final crest = _crestPath(w, domeX, rise, domeHalf);
    final flareL = leftHalf * _flare;
    final flareR = rightHalf * _flare;

    // The alpha ramp is spread over the part of the dome that is actually
    // inside the bar. At the two end destinations the dome is flush with the
    // rounded end, so half of the ramp would fall outside the surface and the
    // dome would meet the edge at half strength — a hard vertical cut exactly
    // where the rounded corner is. Clamping the ramp's span keeps the falloff
    // *within* the visible dome on every tab.
    final rampLeft = math.max(0.0, domeX - flareL);
    final rampRight = math.min(w, domeX + flareR);
    // `Path.from` is the copy constructor; `dart:ui`'s `Path` has no
    // `clone()` — that was the compile error the whole 1.11.1 build died on.
    final dome = Path.from(crest)
      ..cubicTo(
        domeX + rightHalf, rise + (h - rise) * 0.45,
        domeX + flareR, rise + (h - rise) * 0.80,
        domeX + flareR, h + 2,
      )
      ..lineTo(domeX - flareL, h + 2)
      ..cubicTo(
        domeX - flareL, rise + (h - rise) * 0.80,
        domeX - leftHalf, rise + (h - rise) * 0.45,
        domeX - leftHalf, rise,
      )
      ..close();

    // Pass 1: the alpha ramp, sideways.
    //
    // A `smoothstep` rather than a straight line: a linear ramp between two
    // alpha values has a visible crease where it meets the opaque middle, which
    // on this shape appears as a jagged tear at the dome's foot. The extra
    // stops approximate the curve closely enough at this size.
    canvas.drawPath(
      dome,
      Paint()
        ..shader = LinearGradient(
          colors: const [
            Color(0x00FFFFFF),
            Color(0x2EFFFFFF),
            Color(0xB8FFFFFF),
            Color(0xFFFFFFFF),
            Color(0xB8FFFFFF),
            Color(0x2EFFFFFF),
            Color(0x00FFFFFF),
          ],
          stops: const [0, 0.18, 0.34, 0.5, 0.66, 0.82, 1],
        ).createShader(Rect.fromLTWH(rampLeft, 0, rampRight - rampLeft, h)),
    );

    // Pass 2: the colour, top to bottom.
    canvas.drawPath(
      dome,
      Paint()
        ..blendMode = BlendMode.srcATop
        // Sampled from the reference: the crest is a bright cyan-blue that
        // deepens through saturated blue to a royal blue at the foot. The
        // earlier palette was mixed toward slate, which made a dark-mode bar
        // that was *less* alive than the light one — the opposite of the
        // intent, and the reason the dark screenshots looked flat.
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: const [0, 0.30, 0.72, 1],
          colors: dark
              ? [
                  const Color(0xFF7DC8FF),
                  const Color(0xFF2C6BE8),
                  const Color(0xFF1B3F9E),
                  const Color(0xFF152C6B),
                ]
              : [
                  const Color(0xFF67CFFC),
                  const Color(0xFF1F6FFD),
                  const Color(0xFF0C55E8),
                  const Color(0xFF0046F2),
                ],
        ).createShader(Rect.fromLTWH(0, 0, w, h)),
    );
    canvas.restore();

    // 4. The gloss. A narrow highlight just inside the dome's crest — the
    //    single cue that makes it read as a raised, lit surface instead of a
    //    blue shape. Painted along the crest so it curves with it, and clipped
    //    to the bar so it cannot spill over the top edge.
    canvas.save();
    canvas.clipPath(surface);
    canvas.drawPath(
      _crestPath(w, domeX, rise - 1.4, domeHalf),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.4
        ..color = Colors.white.withOpacity(dark ? 0.30 : 0.55)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.2),
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
      final x = w - cell * i;
      // Skip the two boundaries that run into the dome.
      if ((x - domeX).abs() < domeHalf * 1.5) continue;
      canvas.drawLine(
        Offset(x, rise + bodyHeight * 0.26),
        Offset(x, rise + bodyHeight * 0.74),
        sepPaint,
      );
    }
    canvas.restore();

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
  /// The outward shoulder stretches to the bar's end for the first and last
  /// destinations. Sliding the apex inward instead — the obvious clamp — moves
  /// the crest off the icon it belongs to, so the dome ends up under the
  /// neighbouring tab. Stretching keeps the apex over its own icon and lets the
  /// outer shoulder reach the rounded end, which is what the reference does.
  double _edge(double x, double w, double domeX, double rise, double domeHalf) {
    final reachesStart = domeX - domeHalf < domeHalf;
    final reachesEnd = w - (domeX + domeHalf) < domeHalf;
    final leftHalf = reachesStart ? domeX : domeHalf;
    final rightHalf = reachesEnd ? w - domeX : domeHalf;
    final half = x < domeX ? leftHalf : rightHalf;
    final d = (x - domeX).abs();
    if (d < half) {
      // Raised cosine: peak `rise` at the centre, zero at the shoulder, with a
      // horizontal tangent at both ends. A `sin` hump would meet the flat run
      // at an angle and look welded on.
      return rise * 0.5 * (1 + math.cos(math.pi * d / half));
    }
    // The trough either side: the surface dips below the flat line, then comes
    // back. This is what makes the silhouette read as a wave passing through
    // the bar rather than a bump pasted onto it.
    final t = (d - half) / (half * 0.85);
    if (t >= 1) return 0;
    return -rise * 0.14 * math.sin(math.pi * t);
  }

  Path _edgePath(double w, double domeX, double rise, double domeHalf) {
    const steps = 180;
    final path = Path();
    for (var i = 0; i <= steps; i++) {
      final x = w * i / steps;
      final y = rise - _edge(x, w, domeX, rise, domeHalf);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path;
  }

  /// Half-width of the crest on each side, which differ at the bar's ends.
  (double, double) _halves(double w, double domeX, double domeHalf) {
    final left = domeX - domeHalf < domeHalf ? domeX : domeHalf;
    final right = w - (domeX + domeHalf) < domeHalf ? w - domeX : domeHalf;
    return (left, right);
  }

  /// Just the crest, for the gloss stroke and the dome's top.
  Path _crestPath(double w, double domeX, double rise, double domeHalf) {
    final (left, right) = _halves(w, domeX, domeHalf);
    final path = Path();
    const steps = 60;
    for (var i = 0; i <= steps; i++) {
      final x = domeX - left + (left + right) * i / steps;
      final y = rise - _edge(x, w, domeX, rise, domeHalf);
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
      old.dark != dark ||
      old.brand != brand;
}
