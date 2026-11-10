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

/// A floating bottom bar whose top edge is one continuous curve, with a hill
/// that rises under the selected destination and travels to it when the
/// selection changes.
///
/// This replaced a white pill with four equal cells and a tinted rectangle
/// behind the active one. The rectangle was the problem: on a bar with 48 px
/// rounded ends, a rectangular highlight inside it reads as a second, smaller
/// bar sitting on the first. A single curve has no interior seams — the bar is
/// one object, and the selection is a property of the object rather than a
/// badge placed on top of it.
///
/// How it is built, and why:
///
///  * The shape is painted, not composed from `Container`s. A hill under one
///    of four cells cannot be expressed as a rounded rectangle, and the usual
///    workaround — a circle `Positioned` behind the icon — leaves a visible
///    circular edge crossing the bar's own top edge.
///  * The selected position is a single animated number, so the hill *travels*
///    between destinations instead of jumping. Two adjacent hills at rest are
///    the same drawing offset horizontally; interpolating the index is what
///    makes the move read as the surface flowing.
///  * The curve is floored at the bar's own height and never dips below it, so
///    the icons below keep their full height and nothing is clipped.
///  * Dark mode is not an inversion: the bar is a dark slate that is *lighter*
///    than the page, the rim is a cool hairline, and the hill's fill is a
///    brand gradient with the same soft outer glow the light version has. The
///    earlier tint-only approach made the selected tab the least visible thing
///    on a dark screen.
class WaveNavBar extends StatefulWidget {
  const WaveNavBar({
    super.key,
    required this.items,
    required this.index,
    required this.onSelect,
    this.height = 72,
  });

  final List<WaveNavItem> items;
  final int index;
  final ValueChanged<int> onSelect;

  /// Height of the flat part of the bar, excluding the safe-area inset.
  final double height;

  @override
  State<WaveNavBar> createState() => _WaveNavBarState();
}

class _WaveNavBarState extends State<WaveNavBar> with SingleTickerProviderStateMixin {
  /// Drives the hill's travel *and* its rise.
  ///
  /// It is a controller rather than an `AnimatedBuilder` on an int so the
  /// painted curve can sample a fraction between two destinations: the hill
  /// has to be under `2.37` of the way across while it moves, which is only
  /// expressible as a double.
  late final AnimationController _travel = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 460),
    value: 1,
  );

  /// Where the hill currently is, in destination units.
  late double _from = widget.index.toDouble();
  late double _to = widget.index.toDouble();

  @override
  void didUpdateWidget(covariant WaveNavBar old) {
    super.didUpdateWidget(old);
    if (old.index != widget.index) {
      // Start from wherever the hill actually is, not from the previous
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
    final barHeight = widget.height;

    // The gesture inset is padding *below* the drawn bar, not part of it. If
    // the inset were inside the painted box the wave would sit on top of the
    // home indicator and the bar would get shorter on gestures-off devices,
    // which is the exact opposite of what an inset is for.
    return Padding(
      padding: EdgeInsets.fromLTRB(sizes.s(12), 0, sizes.s(12), sizes.s(9)),
      child: AnimatedBuilder(
        animation: _travel,
        builder: (context, _) {
          final position = _position;
          return Padding(
            padding: EdgeInsets.only(bottom: bottomInset),
            child: SizedBox(
              height: barHeight,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  // The shape and every shadow it needs, in one paint pass.
                  Positioned.fill(
                    child: CustomPaint(
                      painter: _WavePainter(
                        position: position,
                        count: widget.items.length,
                        barHeight: barHeight,
                        dark: dark,
                        brand: context.brand,
                      ),
                    ),
                  ),
                  // The destinations sit in the flat part of the box, so the
                  // crest rises *around* the selected icon rather than moving
                  // it. The whole row is pushed down by half the crest's rise,
                  // which puts an icon's centre on the wave's midline: high
                  // enough to be inside the coloured crest, low enough that the
                  // label below it stays on the bar and not on the page.
                  Positioned.fill(
                    child: Padding(
                      padding: EdgeInsets.only(top: barHeight * _WavePainter._riseRatio * 0.62),
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
    // The selected icon sits inside the hill, so it is the one element that
    // has to be light-on-dark. The rest sit on the bar and take the bar's ink.
    final selectedInk = Colors.white;
    final ink = context.inkMuted;

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
            // The icon lifts a few pixels as the hill arrives under it; the
            // travel and the lift are the same motion seen twice.
            AnimatedSlide(
              offset: selected ? const Offset(0, -0.12) : Offset.zero,
              duration: PishkanMotion.scaled(context, const Duration(milliseconds: 420)),
              curve: Curves.easeOutCubic,
              child: AnimatedScale(
                scale: selected ? 1.06 : 1,
                duration: PishkanMotion.scaled(context, const Duration(milliseconds: 420)),
                curve: Curves.easeOutCubic,
                child: Icon(
                  selected ? item.activeIcon : item.icon,
                  size: sizes.s(23),
                  color: selected ? selectedInk : ink,
                ),
              ),
            ),
            SizedBox(height: sizes.s(3)),
            AnimatedDefaultTextStyle(
              duration: PishkanMotion.scaled(context, PishkanMotion.standard),
              curve: Curves.easeOutCubic,
              style: TextStyle(
                fontFamily: 'Vazirmatn',
                fontSize: sizes.s(10.5),
                height: 1.2,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                color: selected ? selectedInk : ink,
              ),
              child: Text(item.label, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}

/// Paints the bar: one rounded surface whose top edge is a travelling wave,
/// with the crest rising under the selected destination.
///
/// The curve is the one thing that cannot be composed from `Container`s, and
/// it is why the bar reads as a single object: there is no interior seam
/// anywhere along it, so the selection is a property of the surface rather
/// than a badge placed on top of it.
///
/// The edge is sampled from a single function, [_edge], used by both the
/// surface and the wave fill. They cannot disagree about where the crest is,
/// which is what stops a hairline of the wrong colour showing up along the
/// crest on some screen densities.
class _WavePainter extends CustomPainter {
  const _WavePainter({
    required this.position,
    required this.count,
    required this.barHeight,
    required this.dark,
    required this.brand,
  });

  /// Where the crest is, in destination units. Animated, so it can be 2.37 —
  /// which is the entire reason it is a double and not an int.
  final double position;
  final int count;
  final double barHeight;
  final bool dark;
  final Color brand;

  /// Half-width of the crest.
  static const double _crest = 56;

  /// Radius of the bar's own corners, matching the 24–28 dp in the reference.
  static const double _corner = 26;

  /// How far the crest rises above the flat run, as a fraction of the bar's
  /// height. 0.24 of 72 dp is ~17 dp.
  static const double _riseRatio = 0.24;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty || count == 0) return;
    final w = size.width;
    final h = size.height;
    final crestX = (w / count) * (position + 0.5);
    final rise = barHeight * _riseRatio;

    final surface = _surfacePath(w, h, crestX, rise);

    // 1. Contact shadow and glow, before the surface so they spill outward.
    //    Two passes: one wide and low, one tight and darker. A single blur
    //    cannot be both the thing that lifts the bar off the page and the
    //    thing that defines its edge.
    canvas.save();
    canvas.translate(0, 7);
    canvas.drawPath(
      surface,
      Paint()
        ..color = dark ? const Color(0x80000000) : const Color(0x240B1F3A)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 16),
    );
    canvas.restore();
    canvas.drawPath(
      surface,
      Paint()
        ..color = dark ? const Color(0x59000000) : const Color(0x1A0B1F3A)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );

    // 2. The surface.
    canvas.drawPath(
      surface,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: dark
              // Lighter than the page, so the bar is an object on it rather
              // than a hole in it.
              ? [const Color(0xFF1B2942), const Color(0xFF0E1727)]
              : [Colors.white, const Color(0xFFF2F6FE)],
        ).createShader(Rect.fromLTWH(0, 0, w, h)),
    );

    // 3. The wave. Not a fill of the whole bar: a band that flows down from
    //    the crest and fades out, which is what makes the crest read as part of
    //    the surface rather than as a coloured card sitting on it. The
    //    horizontal fade is the reason this needs a layer — a single gradient
    //    runs along one axis, and this shape needs a falloff on two.
    canvas.save();
    canvas.clipPath(surface);
    canvas.saveLayer(Rect.fromLTWH(0, 0, w, h), Paint());
    canvas.drawPath(
      _wavePath(w, h, crestX, rise),
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: const [0, 0.42, 1],
          colors: dark
              ? [
                  Color.alphaBlend(brand.withOpacity(0.95), const Color(0xFF16263F)),
                  Color.alphaBlend(brand.withOpacity(0.72), const Color(0xFF16263F)),
                  Color.alphaBlend(brand.withOpacity(0.0), const Color(0xFF16263F)),
                ]
              : [
                  brand,
                  Color.alphaBlend(brand.withOpacity(0.88), const Color(0xFF0B3E8F)),
                  Color.alphaBlend(brand.withOpacity(0.0), const Color(0xFF0B3E8F)),
                ],
        ).createShader(Rect.fromLTWH(0, 0, w, h)),
    );
    // Mask it horizontally so the band's sides dissolve instead of ending on a
    // straight line, which is the tell that gives a painted "glow" away.
    canvas.drawRect(
      Rect.fromLTWH(0, 0, w, h),
      Paint()
        ..blendMode = BlendMode.dstIn
        ..shader = LinearGradient(
          colors: const [Color(0x00000000), Color(0xFF000000), Color(0x00000000)],
          stops: const [0, 0.5, 1],
        ).createShader(Rect.fromLTWH(crestX - _crest * 2.4, 0, _crest * 4.8, h)),
    );
    canvas.restore();
    // The crest catches light. Without this the gradient reads as a flat fill
    // and the rise disappears on a bright page.
    canvas.drawPath(
      _edgePath(w, crestX, rise).shift(const Offset(0, 1.6)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.8
        ..color = Colors.white.withOpacity(dark ? 0.20 : 0.30)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 1.8),
    );
    canvas.restore();

    // 4. The rim. On a dark page the bar's silhouette dissolves into the
    //    background at the edges, because its shadow is black on black.
    canvas.drawPath(
      surface,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = dark ? const Color(0x26FFFFFF) : const Color(0xFFE4ECF8),
    );
  }

  /// Height of the bar's top edge above the flat run, at [x].
  double _edge(double x, double crestX, double rise) {
    final d = (x - crestX).abs();
    if (d < _crest) {
      // An inverted cosine: horizontal tangents at both shoulders, a rounded
      // crest at the apex. A `sin` hump would meet the flat run at an angle and
      // look like a bump welded on.
      return rise * 0.5 * (1 + math.cos(math.pi * d / _crest));
    }
    // A shallow trough on either side of the crest: this is what makes the
    // silhouette read as a wave travelling through the bar instead of a bump
    // pasted onto it. It decays over another crest-width so the far half of
    // the bar stays flat.
    final t = ((d - _crest) / _crest).clamp(0.0, 1.0);
    return -rise * 0.16 * (1 - t) * (1 - t);
  }

  /// Samples [_edge] across the full width into a path.
  Path _edgePath(double w, double crestX, double rise) {
    const steps = 160;
    final path = Path();
    for (var i = 0; i <= steps; i++) {
      final x = w * i / steps;
      final y = rise - _edge(x, crestX, rise);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path;
  }

  /// The bar's outline: sampled top edge, then down both sides and across the
  /// bottom with rounded corners.
  Path _surfacePath(double w, double h, double crestX, double rise) {
    final path = _edgePath(w, crestX, rise)
      ..lineTo(w, h - _corner)
      ..quadraticBezierTo(w, h, w - _corner, h)
      ..lineTo(_corner, h)
      ..quadraticBezierTo(0, h, 0, h - _corner)
      ..close();
    return path;
  }

  /// The wave's fill: a band under the crest, following the same top edge.
  ///
  /// Wide enough to hold the selected label and no wider. Drawing it across
  /// the whole bar was the first attempt and it turned the bar solid brand
  /// blue in both themes, which made the three unselected destinations the
  /// hardest thing on the screen to read.
  Path _wavePath(double w, double h, double crestX, double rise) {
    const steps = 64;
    final half = _crest * 2.4;
    final left = (crestX - half).clamp(0.0, w);
    final right = (crestX + half).clamp(0.0, w);
    final path = Path();
    for (var i = 0; i <= steps; i++) {
      final x = left + (right - left) * i / steps;
      final y = rise - _edge(x, crestX, rise);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path
      ..lineTo(right, h + 2)
      ..lineTo(left, h + 2)
      ..close();
  }

  @override
  bool shouldRepaint(covariant _WavePainter old) =>
      old.position != position ||
      old.count != count ||
      old.barHeight != barHeight ||
      old.dark != dark ||
      old.brand != brand;
}
