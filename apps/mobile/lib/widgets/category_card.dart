import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/motion.dart';
import '../core/service_icons.dart';
import '../core/theme.dart';
import '../models/models.dart';

/// Generated assets are bundled so the catalogue keeps its identity offline.
/// A manager's raster image is always preferred over the bundled fallback.
const categoryArtAssets = <String, String>{
  'insurance-health': 'assets/category_art/insurance-health.webp',
  'companies-institutions': 'assets/category_art/companies-institutions.webp',
  'subsidy-welfare': 'assets/category_art/subsidy-welfare.webp',
  'vehicle-services': 'assets/category_art/vehicle-services.webp',
  'tax-services': 'assets/category_art/tax-services.webp',
  'judicial-services': 'assets/category_art/judicial-services.webp',
  'exams-employment': 'assets/category_art/exams-employment.webp',
  'housing-land': 'assets/category_art/housing-land.webp',
  'banking-services': 'assets/category_art/banking-services.webp',
  'police-services': 'assets/category_art/police-services.webp',
  'university-students': 'assets/category_art/university-students.webp',
  'business-licenses': 'assets/category_art/business-licenses.webp',
  'school-services': 'assets/category_art/school-services.webp',
  'consulting': 'assets/category_art/consulting.webp',
  'other-services': 'assets/category_art/other-services.webp',
};

String categoryRemoteImage(ServiceCategory category) {
  // Flutter's raster image decoder cannot render the old server SVG defaults.
  // The vector fallback stays visible for unsupported SVGs, including new ones.
  final image = category.image.trim();
  if (image.isNotEmpty && !image.toLowerCase().split('?').first.endsWith('.svg')) return image;
  return artworkForCategory(category).imageUrl;
}

class CategoryArtImage extends StatelessWidget {
  const CategoryArtImage({super.key, required this.category});
  final ServiceCategory category;

  @override
  Widget build(BuildContext context) {
    final art = artworkForCategory(category);
    final asset = categoryArtAssets[category.slug];
    Widget fallback() {
      if (asset != null) {
        return Image.asset(asset, fit: BoxFit.cover, errorBuilder: (_, _, _) => _icon(art));
      }
      return _icon(art);
    }
    final url = categoryRemoteImage(category);
    if (url.isEmpty) return fallback();
    return CachedNetworkImage(
      imageUrl: ApiClient.instance.absolute(url), httpHeaders: ApiClient.instance.authHeaders(url), fit: BoxFit.cover,
      placeholder: (_, _) => fallback(), errorWidget: (_, _, _) => fallback(),
    );
  }

  Widget _icon(ServiceArtwork art) {
    // New or unavailable categories receive a relevant vector, never a random
    // photo from an unrelated category.
    final icon = switch (category.slug) {
      'university-students' => Icons.school_rounded,
      'school-services' => Icons.backpack_rounded,
      'business-licenses' => Icons.storefront_rounded,
      'consulting' => Icons.forum_rounded,
      'other-services' => Icons.folder_special_rounded,
      _ => art.icon,
    };
    return Container(
      color: art.color.withOpacity(.08),
      alignment: Alignment.center,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withOpacity(.8),
          boxShadow: [BoxShadow(color: art.color.withOpacity(.14), blurRadius: 14, offset: const Offset(0, 5))]),
        child: Icon(icon, color: art.color, size: 28),
      ),
    );
  }
}

/// Landscape, raised card inspired by the supplied reference. Text is real RTL
/// Flutter text rather than baked into an image, so admin edits remain live.
///
/// Shape notes, because this card is the one the customer sees six times per
/// screen and it was the flattest thing in the app:
///
///  * the artwork is *inset* rather than bleeding to the card's edge. Full-bleed
///    art on a rounded card leaves the picture describing its own rectangle,
///    and the card stops reading as one object;
///  * the pictures all sit on a pale studio floor, so they are given a matching
///    tinted well instead of being pasted onto the card's gradient, which was
///    producing a visible seam down the middle of every tile;
///  * elevation is three shadows — contact, mid, ambient — not one blur, which
///    is what makes a surface look lifted rather than smudged.
class CategoryCard extends StatelessWidget {
  const CategoryCard({super.key, required this.category, required this.onTap});
  final ServiceCategory category;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final art = artworkForCategory(category);
    final color = art.color;
    final dark = context.isDark;
    final textColor = dark ? const Color(0xFFEAF1FF) : PishkanColors.navy;

    // The card body is a near-white (light) or lifted-navy (dark) surface; the
    // accent only tints it. Letting the accent drive the fill made six adjacent
    // tiles six different colours at full strength, which read as a palette
    // test rather than a menu.
    // Dark mode: the card has to sit *above* the page, not melt into it.
    //
    // The page background is near-black and the previous card fill (#16294A)
    // was close enough in lightness that the two read as one flat field — the
    // tiles looked like text floating on the background, with no object between
    // the eye and the label. These are lighter, and they carry more of the
    // category's own colour, so two adjacent tiles are distinguishable at a
    // glance without turning into a palette test.
    // Dark: lift the base, then tint it.
    //
    // These used to blend the accent into #1B3055 -> #122240, which are 1.5x
    // and 1.0x the page's own #12213A. The bottom of every tile therefore
    // landed within 1.02-1.11:1 of the background it sits on — a measured
    // 1.02:1 for the navy categories and 1.11:1 at best for the rest. A tile
    // whose lower half is the same colour as the page is not a low-contrast
    // tile, it is half a tile, and a grid of them reads as a blank block with
    // some artwork floating at the top.
    //
    // The bases are now #22375E -> #1A2C4C (1.6x and 1.2x the page), and the
    // accent rides on top of that rather than replacing it. Worst case across
    // all fifteen seeded categories is 1.13:1 instead of 1.02:1, and the
    // median is ~1.25:1. Still restrained — the reference cards are tinted
    // panels, not swatches — but the silhouette survives.
    final tintTop = dark
        ? Color.alphaBlend(color.withOpacity(0.22), const Color(0xFF22375E))
        : const Color(0xFFFFFFFF);
    final tintBottom = dark
        ? Color.alphaBlend(color.withOpacity(0.13), const Color(0xFF1A2C4C))
        : Color.alphaBlend(color.withOpacity(0.06), const Color(0xFFF7FAFF));

    return Semantics(
      button: true,
      label: category.title,
      // `TactileTap`, not `PressableScale`: a navigation tap has to show its
      // press before the page changes, otherwise the animation is cut off by
      // the incoming route and the card feels dead.
      child: TactileTap(
        onTap: () async => onTap(),
        scale: 0.96,
        hold: const Duration(milliseconds: 120),
        // 2 px of travel, which on a ~95 px card is the difference between
        // "the picture resized" and "the key went down".
        sink: 0.02,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            // A hairline rim: without it the tile's silhouette disappears
            // against a dark page even when its fill is lighter, because the
            // shadow is black on black.
            border: Border.all(
              color: dark ? Colors.white.withOpacity(0.09) : Colors.white,
              width: 1,
            ),
            gradient: LinearGradient(
              begin: AlignmentDirectional.topStart,
              end: AlignmentDirectional.bottomEnd,
              colors: [tintTop, tintBottom],
            ),
            // A cushion, not a rectangle with a shadow.
            //
            // Four shadows, each doing one job: a 1 px contact edge that glues
            // the card to the page, a tight shadow that gives the lip, a broad
            // tinted one that lifts the whole tile in its own colour, and a
            // soft inner highlight along the top that reads as light landing on
            // a padded surface. One blur cannot do all four — which is why the
            // earlier version looked printed rather than raised.
            boxShadow: [
              BoxShadow(
                color: (dark ? Colors.black : PishkanColors.navy).withOpacity(dark ? 0.45 : 0.10),
                blurRadius: 2,
                offset: const Offset(0, 1),
              ),
              BoxShadow(
                color: (dark ? Colors.black : color).withOpacity(dark ? 0.38 : 0.18),
                blurRadius: 10,
                spreadRadius: -2,
                offset: const Offset(0, 5),
              ),
              BoxShadow(
                color: (dark ? Colors.black : color).withOpacity(dark ? 0.30 : 0.13),
                blurRadius: 24,
                spreadRadius: -6,
                offset: const Offset(0, 15),
              ),
              BoxShadow(
                color: Colors.white.withOpacity(dark ? 0.05 : 0.85),
                blurRadius: 1,
                offset: const Offset(0, -1),
              ),
            ],
          ),
          // Deliberately *no* `InkWell` in here.
          //
          // `InkWell.onTap` fires as the gesture completes, which on this card
          // happened before `TactileTap`'s hold elapsed — so the route opened on
          // the same beat as the finger lifting and the press animation was
          // never seen. That is why the customer reported that the cards had no
          // click effect: there were two tap handlers, and the inner one won.
          // `TactileTap` is the only handler now.
          child: Padding(
                padding: const EdgeInsets.all(6),
                child: Row(
                  // Stretch so the art well takes the card's full height rather
                  // than collapsing to its intrinsic size.
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Artwork first in the row: the app is RTL, so this is the
                    // leading edge, matching the reference screenshots.
                    Flexible(flex: 4, fit: FlexFit.tight, child: _ArtWell(category: category, color: color, dark: dark)),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 6,
                      child: Padding(
                        padding: const EdgeInsetsDirectional.only(end: 4, top: 2, bottom: 2),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              category.title,
                              textDirection: TextDirection.rtl,
                              textAlign: TextAlign.right,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: textColor,
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                                height: 1.35,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Icon(
                              Icons.chevron_left_rounded,
                              color: dark ? color.withOpacity(0.85) : PishkanColors.primary.withOpacity(0.8),
                              size: 15,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ),
    );
  }
}

/// The picture, in its own tinted well.
///
/// Every service illustration was drawn on the same pale studio floor. Placing
/// that floor on a card with a different background is what caused the hard
/// seam through the middle of the old tiles; giving the art its own recess with
/// a matching fill removes the edge entirely, because the picture's background
/// and the well are the same colour.
class _ArtWell extends StatelessWidget {
  const _ArtWell({required this.category, required this.color, required this.dark});

  final ServiceCategory category;
  final Color color;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Container(
      // The well takes a share of the card rather than a fixed width. The card
      // is laid out at whatever width the grid gives it, and a fixed 82px well
      // plus a readable label does not fit on a narrow phone or at a large text
      // scale — the row overflows. A layout that only works at one width is not
      // a layout.
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(15),
        color: dark
            ? Color.alphaBlend(color.withOpacity(0.16), const Color(0xFF0E1D33))
            : Color.alphaBlend(color.withOpacity(0.07), const Color(0xFFF3F8FF)),
        border: Border.all(
          color: dark ? Colors.white.withOpacity(0.07) : Colors.white,
          width: 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: CategoryArtImage(category: category),
    );
  }
}
