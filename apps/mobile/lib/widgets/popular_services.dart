import 'package:flutter/material.dart';

import '../core/motion.dart';
import '../core/service_icons.dart';
import '../core/sizes.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../screens/service_detail.dart';
import 'widgets.dart';

/// The «خدمات محبوب» grid, rebuilt so it cannot leave a hole behind it.
///
/// The old version was a `GridView.count` inside a `ListView`, and it had three
/// properties that all end the same way — an allocated region with no pixels in
/// it, which is what the customer sees as an unexplained blank band:
///
///  1. **Height derived from width.** `childAspectRatio: 0.8` makes each cell's
///     height a fraction of the available width. The cell's *contents* are a
///     fixed medallion plus up to two lines of label. Whenever the width makes
///     that ratio disagree with the contents — another screen size, a text
///     scale, a tablet — the cell overflows while the row still claims the
///     full height.
///  2. **A label with no floor.** The title sat in a `Flexible`, which may be
///     squeezed to zero height while its box keeps the space.
///  3. **`shrinkWrap` inside a lazy list.** The grid had to be measured before
///     the page could size itself, so a single failing tile left the visitor
///     with reserved space and nothing drawn.
///
/// This version removes all three:
///
///  * it lays out a `Wrap` of **explicitly sized** tiles, so the section's
///    height is the sum of its rows — never a pixel more;
///  * the label gets a fixed band it cannot exceed, so a long title is clipped
///    rather than changing the tile's height;
///  * the whole grid is clipped to the height computed for it, so a rounding
///    difference out of `Wrap` cannot bleed into the section below.
///
/// What it deliberately no longer does is reserve space it might not fill: an
/// empty catalogue produces one line of text, not a grid-shaped hole.
class PopularServicesSection extends StatelessWidget {
  const PopularServicesSection({
    super.key,
    required this.services,
    required this.loading,
    required this.onOpenService,
  });

  final List<CatalogService> services;

  /// The catalogue request is still in flight.
  final bool loading;

  final void Function(CatalogService service) onOpenService;

  /// The most tiles a single screen of this section shows: two rows of four.
  ///
  /// Fixed rather than "whatever is in the catalogue", because the section's
  /// job is a shortcut, not a directory — and a bounded grid is a grid whose
  /// height is knowable before it is built.
  static const int maxTiles = 8;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;

    if (services.isEmpty) {
      if (loading) return const _SkeletonGrid();
      // Not an error state: a catalogue that is empty, or a request that has
      // not succeeded yet, means there is nothing to show. Saying so in one
      // line is honest; reserving the grid's height and painting nothing is
      // the bug this widget exists to remove.
      return _Notice(
        icon: Icons.cloud_off_rounded,
        message: 'فهرست خدمات در دسترس نیست. اتصال شبکه را بررسی کنید یا صفحه را دوباره بکشید.',
      );
    }

    final shown = services.take(maxTiles).toList();

    // Bound the width once, at the seam: a section that is handed an unbounded
    // or zero width cannot lay out, and must say so rather than allocate space
    // and paint nothing.
    return LayoutBuilder(builder: (context, constraints) {
      if (!constraints.hasBoundedWidth || constraints.maxWidth <= 0) {
        return const _Notice(
          icon: Icons.grid_view_rounded,
          message: 'نمایش خدمات در این لحظه ممکن نشد.',
        );
      }
      final columns = constraints.maxWidth >= sizes.s(560) ? 5 : 4;
      const spacing = 10.0;
      final tileWidth =
          ((constraints.maxWidth - spacing * (columns - 1)) / columns).clamp(48.0, 108.0);

      // The tile's own height, fixed: medallion plate + a fixed label band.
      // Nothing here depends on how long a label happens to be, which is the
      // property that makes the section's height exact.
      final plate = (tileWidth * 0.56).clamp(32.0, 48.0);
      final plateBox = plate + 2 * (plate * 0.14) + 3; // padding + 1.5 dp rim
      final labelBand = sizes.s(34);
      final tileHeight = plateBox + 7 + labelBand;

      // The height is computed, not negotiated: `Wrap` gets exactly the space
      // its rows need, and is clipped to it, so a rounding difference can never
      // push into the section below or leave slack under the last row.
      return SizedBox(
        height: _rowsHeight(shown.length, columns, tileHeight, 14),
        child: ClipRect(
          child: Wrap(
            spacing: spacing,
            runSpacing: 14,
            children: [
              for (final service in shown)
                SizedBox(
                  width: tileWidth,
                  height: tileHeight,
                  child: _ServiceTile(
                    service: service,
                    medallion: plate,
                    labelBand: labelBand,
                    onTap: () => onOpenService(service),
                  ),
                ),
            ],
          ),
        ),
      );
    });
  }

  /// The exact height of [count] tiles in [columns] columns.
  ///
  /// Used to size the section rather than letting the `Wrap` decide, so the
  /// space a partial last row would have taken is never reserved.
  static double _rowsHeight(int count, int columns, double tileHeight, double runSpacing) {
    if (count <= 0) return 0;
    final rows = (count / columns).ceil();
    return rows * tileHeight + (rows - 1) * runSpacing;
  }
}

/// One tile: a plate of artwork with the service's name under it.
///
/// Every dimension is handed in rather than inferred, and the label gets a band
/// of fixed height it cannot exceed — so a long title is clipped rather than
/// pushing the tile taller than its cell.
class _ServiceTile extends StatelessWidget {
  const _ServiceTile({
    required this.service,
    required this.medallion,
    required this.labelBand,
    required this.onTap,
  });

  final CatalogService service;
  final double medallion;
  final double labelBand;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDark;
    final art = artworkForService(service);
    final tint = art.color;

    return TactileTap(
      scale: 0.93,
      hold: const Duration(milliseconds: 110),
      onTap: () async => onTap(),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: EdgeInsets.all(medallion * 0.14),
            decoration: BoxDecoration(
              color: dark ? PishkanColors.darkSurfaceHigh : Colors.white,
              shape: BoxShape.circle,
              border: Border.all(
                color: dark ? PishkanColors.darkBorder : Colors.white,
                width: 1.5,
              ),
              boxShadow: [
                BoxShadow(
                  color: tint.withOpacity(dark ? 0.26 : 0.20),
                  blurRadius: 14,
                  offset: const Offset(0, 7),
                ),
                BoxShadow(
                  color: Colors.white.withOpacity(dark ? 0.06 : 0.55),
                  blurRadius: 3,
                  offset: const Offset(0, -1),
                ),
              ],
            ),
            // The picture is clipped to its own box: an illustration that
            // cannot decode draws its glyph instead of changing the layout.
            child: ClipOval(
              child: SizedBox(
                width: medallion,
                height: medallion,
                child: Hero(
                  tag: 'service-art-${service.slug}',
                  child: IconMedallion(artwork: art, size: medallion, glyphBadge: true),
                ),
              ),
            ),
          ),
          const SizedBox(height: 7),
          SizedBox(
            height: labelBand,
            width: double.infinity,
            child: Center(
              child: Text(
                service.title,
                maxLines: 2,
                overflow: TextOverflow.clip,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: context.ink,
                  height: 1.4,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Loading state: a grid-shaped shimmer of the same size as the real grid, so
/// nothing jumps when the tiles arrive.
class _SkeletonGrid extends StatelessWidget {
  const _SkeletonGrid();

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    return LayoutBuilder(builder: (context, constraints) {
      final columns = constraints.maxWidth >= sizes.s(560) ? 5 : 4;
      const spacing = 10.0;
      final tileWidth =
          ((constraints.maxWidth - spacing * (columns - 1)) / columns).clamp(48.0, 108.0);
      final plate = (tileWidth * 0.56).clamp(32.0, 48.0);
      final plateBox = plate + 2 * (plate * 0.14) + 3;
      final labelBand = sizes.s(34);
      final tileHeight = plateBox + 7 + labelBand;
      return SizedBox(
        height: PopularServicesSection._rowsHeight(
            PopularServicesSection.maxTiles, columns, tileHeight, 14),
        child: ClipRect(
          child: Wrap(
            spacing: spacing,
            runSpacing: 14,
            children: [
              for (var i = 0; i < PopularServicesSection.maxTiles; i++)
                SizedBox(
                  width: tileWidth,
                  height: tileHeight,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ShimmerBox(width: plateBox, height: plateBox, radius: 999),
                      const SizedBox(height: 7),
                      ShimmerBox(width: tileWidth * 0.62, height: 9, radius: 5),
                    ],
                  ),
                ),
            ],
          ),
        ),
      );
    });
  }
}

/// One line of text where a section would have been.
class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    return Padding(
      padding: EdgeInsets.symmetric(vertical: sizes.s(6)),
      child: Row(children: [
        Icon(icon, size: sizes.s(18), color: context.inkMuted),
        SizedBox(width: sizes.s(8)),
        Expanded(
          child: Text(
            message,
            style: TextStyle(fontSize: sizes.caption, height: 1.7, color: context.inkMuted),
          ),
        ),
      ]),
    );
  }
}
