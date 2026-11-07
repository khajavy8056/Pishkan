import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
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
    // The remaining/new categories receive a relevant vector, never a random
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
class CategoryCard extends StatelessWidget {
  const CategoryCard({super.key, required this.category, required this.onTap});
  final ServiceCategory category;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = artworkForCategory(category).color;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final textColor = dark ? Colors.white : PishkanColors.navy;
    return Semantics(
      button: true, label: category.title,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              gradient: LinearGradient(colors: dark
                ? [const Color(0xFF142B4D), const Color(0xFF263C62)]
                : [const Color(0xFFF6FAFF), Color.alphaBlend(color.withOpacity(.12), const Color(0xFFEAF2FF))]),
              border: Border.all(color: dark ? Colors.white24 : Colors.white, width: 1.4),
              boxShadow: [BoxShadow(color: color.withOpacity(dark ? .12 : .16), blurRadius: 14, offset: const Offset(0, 5))],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(19),
              child: LayoutBuilder(builder: (context, constraints) => Stack(children: [
                Positioned(left: 0, top: 0, bottom: 0, width: constraints.maxWidth * .60,
                  child: CategoryArtImage(category: category)),
                Positioned(left: constraints.maxWidth * .40, top: 0, bottom: 0, width: constraints.maxWidth * .20,
                  child: DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(colors: [
                    Colors.transparent, dark ? const Color(0xFF263C62) : Color.alphaBlend(color.withOpacity(.12), const Color(0xFFEAF2FF)),
                  ])))),
                Positioned(right: 9, top: 5, bottom: 5, width: constraints.maxWidth * .43,
                  child: Align(alignment: Alignment.centerRight, child: Text(category.title,
                    textDirection: TextDirection.rtl, textAlign: TextAlign.right,
                    maxLines: 3, overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: textColor, fontSize: 11.5, fontWeight: FontWeight.w800, height: 1.35)))),
                Positioned(left: 6, bottom: 8, child: Container(
                  width: 25, height: 25,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withOpacity(.92),
                    boxShadow: [BoxShadow(color: color.withOpacity(.17), blurRadius: 5, offset: const Offset(0, 2))]),
                  child: Icon(Icons.chevron_right_rounded, color: color, size: 20),
                )),
              ])),
            ),
          ),
        ),
      ),
    );
  }
}
