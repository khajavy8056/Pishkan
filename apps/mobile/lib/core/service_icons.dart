import 'package:flutter/material.dart';

import '../models/models.dart';
import 'bundled_art.dart';

/// Native vector pictogram and an optional bundled editorial illustration.
///
/// Three tiers, most specific first:
///   1. an image the office uploaded or the service itself points at
///      (`imageUrl`), which always wins because a human chose it;
///   2. the generated illustration bundled with the app (`assetPath`), which
///      exists for every seeded service and category;
///   3. a vector glyph + tint, used for services created from the admin panel
///      after this build (they have no asset yet) so nothing is ever blank.
///
/// The glyph and tint are also the identity used by the generator in
/// `tools/service-art/build.mjs`, so an admin-created service and its eventual
/// asset look like the same object.
class ServiceArtwork {
  const ServiceArtwork(this.icon, this.color, {this.imageUrl = '', this.assetPath = '', this.largeAssetPath = ''});
  final IconData icon;
  final Color color;
  final String imageUrl;
  final String assetPath;
  final String largeAssetPath;

  bool get hasBundledArt => assetPath.isNotEmpty;

  /// True when the picture is the per-entry illustration rather than a shared
  /// category photo. Used to decide whether a service created after this
  /// build needs the server's unique artwork instead of a sibling's picture.
  bool get isPerServiceArt => largeAssetPath.isNotEmpty;
}

const _categoryPhotos = <String, String>{
  'insurance-health': 'insurance',
  'companies-institutions': 'companies',
  'subsidy-welfare': 'welfare',
  'vehicle-services': 'vehicle',
  'tax-services': 'tax',
  'judicial-services': 'judicial',
  'exams-employment': 'exams',
  'housing-land': 'housing',
  'banking-services': 'banking',
  'police-services': 'police',
  'university-students': 'exams',
  'school-services': 'exams',
  'business-licenses': 'companies',
  'consulting': 'companies',
};

/// Ordered from specific to broad so e.g. fuel-card is never treated as a car
/// just because its slug contains "car". All glyphs are vector Material icons.
const _rules = <(List<String>, IconData, Color)>[
  (['کارت سوخت', 'سوخت', 'بنزین', 'fuel'], Icons.local_gas_station_rounded, Color(0xFFEA580C)),
  (['کارت ملی', 'شناسنامه', 'احوال', 'identity', 'national-card'], Icons.badge_rounded, Color(0xFF4F46E5)),
  (['گذرنامه', 'پاسپورت', 'passport'], Icons.flight_takeoff_rounded, Color(0xFF0F766E)),
  (['ازدواج', 'marriage'], Icons.favorite_rounded, Color(0xFFDB2777)),
  (['فک رهن', 'رهن'], Icons.key_rounded, Color(0xFF0891B2)),
  (['پلاک', 'خودرو', 'ماشین', 'plate', 'vehicle', 'car-'], Icons.directions_car_rounded, Color(0xFF2563EB)),
  (['وام', 'تسهیلات', 'بانک', 'حساب', 'loan', 'bank'], Icons.account_balance_rounded, Color(0xFF1D4ED8)),
  (['یارانه', 'حمایتی', 'کالابرگ', 'subsidy', 'welfare'], Icons.family_restroom_rounded, Color(0xFF059669)),
  (['بیمه', 'ثالث', 'تأمین اجتماعی', 'تامین اجتماعی', 'insurance'], Icons.health_and_safety_rounded, Color(0xFF16A34A)),
  (['مالیات', 'اظهارنامه', 'tax'], Icons.calculate_rounded, Color(0xFF7C3AED)),
  (['پروانه کسب', 'کسب‌وکار', 'کسب و کار', 'جواز', 'مجوز', 'license', 'business'], Icons.storefront_rounded, Color(0xFFD97706)),
  (['سوء پیشینه', 'پیشینه', 'گواهی', 'certificate'], Icons.verified_rounded, Color(0xFF059669)),
  (['شرکت', 'تجاری', 'company'], Icons.business_rounded, Color(0xFF334155)),
  (['ملک', 'سند', 'زمین', 'مسکن', 'housing', 'property'], Icons.home_work_rounded, Color(0xFFB45309)),
  (['دانشگاه', 'تحصیل', 'دانشجو', 'آموزش', 'school', 'exams'], Icons.school_rounded, Color(0xFF6D28D9)),
  (['سلامت', 'درمان', 'پزشک', 'health'], Icons.medical_services_rounded, Color(0xFFDC2626)),
  (['حقوقی', 'دادگستری', 'وکالت', 'قضایی', 'legal', 'judicial'], Icons.gavel_rounded, Color(0xFF475569)),
  (['پست', 'مرسوله', 'post'], Icons.local_post_office_rounded, Color(0xFF0284C7)),
  (['گواهینامه', 'رانندگی', 'driving'], Icons.traffic_rounded, Color(0xFFCA8A04)),
  (['بازنشستگی', 'مستمری', 'pension'], Icons.elderly_rounded, Color(0xFF0E7490)),
];

/// Category base colours, mirrored from the backend catalogue so a service
/// created while offline still lands on the right hue family.
const categoryBaseColors = <String, Color>{
  'insurance-health': Color(0xFF1D4ED8),
  'companies-institutions': Color(0xFF0B1F3A),
  'subsidy-welfare': Color(0xFF0E7490),
  'vehicle-services': Color(0xFFB45309),
  'tax-services': Color(0xFF7C3AED),
  'judicial-services': Color(0xFF334155),
  'exams-employment': Color(0xFF0369A1),
  'housing-land': Color(0xFF15803D),
  'banking-services': Color(0xFF1E40AF),
  'police-services': Color(0xFF0F766E),
  'university-students': Color(0xFFA21CAF),
  'business-licenses': Color(0xFFC2410C),
  'school-services': Color(0xFFDB2777),
  'consulting': Color(0xFF4D7C0F),
  'other-services': Color(0xFF475569),
};

ServiceArtwork artworkFor({String explicitIcon = '', String title = '', String slug = '', String categoryTitle = '', String categorySlug = ''}) {
  final haystack = '$title $slug $categoryTitle $categorySlug'.toLowerCase();
  IconData icon = Icons.description_rounded;
  Color color = categoryBaseColors[categorySlug] ?? categoryBaseColors[categoryTitle] ?? const Color(0xFF2563EB);
  for (final (keywords, candidate, tint) in _rules) {
    if (keywords.any((word) => haystack.contains(word.toLowerCase()))) {
      icon = candidate;
      color = tint;
      break;
    }
  }
  final explicit = explicitIcon.trim();
  final imageUrl = explicit.startsWith('/uploads/public/') || explicit.startsWith('https://') || explicit.startsWith('http://') ? explicit : '';
  final photo = _categoryPhotos[categorySlug] ?? _categoryPhotos[slug];
  return ServiceArtwork(icon, color, imageUrl: imageUrl, assetPath: photo == null ? '' : 'assets/service_art/$photo.webp');
}

/// The server draws a deterministic, per-slug illustration for anything that
/// was not baked into this release. Two offices (or two services) therefore
/// never share a picture, and a service created from the admin panel this
/// morning already has its own art on the phone — no app update needed.
String fallbackArtworkUrl(String slug, {bool category = false}) {
  final clean = slug.trim();
  if (clean.isEmpty) return '';
  final segment = Uri.encodeComponent(clean);
  // WebP, not SVG: Flutter's image pipeline decodes bitmaps only.
  return category ? '/api/catalog/artwork/category/$segment.webp' : '/api/catalog/artwork/$segment.webp';
}

/// Honour a category's configured icon and colour without trusting malformed hex.
ServiceArtwork artworkForCategory(ServiceCategory category) {
  final base = artworkFor(explicitIcon: category.icon, title: category.title, slug: category.slug);
  final hex = category.color.trim().replaceFirst('#', '');
  final parsed = RegExp(r'^[0-9a-fA-F]{6}$').hasMatch(hex) ? int.tryParse(hex, radix: 16) : null;
  return ServiceArtwork(
    base.icon,
    parsed == null ? base.color : Color(0xFF000000 | parsed),
    imageUrl: base.imageUrl,
    assetPath: 'assets/category_art/${category.slug}.webp',
  );
}

ServiceArtwork artworkForService(CatalogService service) {
  final base = artworkFor(
    explicitIcon: service.icon,
    title: service.title,
    slug: service.slug,
    categoryTitle: service.categoryTitle,
    categorySlug: service.categorySlug,
  );
  if (base.imageUrl.isNotEmpty) return base;
  if (!bundledServiceArt.contains(service.slug)) {
    // Unknown to this build (created from the admin panel after the release):
    // ask the server for the slug's own picture instead of borrowing the
    // category photo, which would put two services on the same image.
    return ServiceArtwork(base.icon, base.color, imageUrl: fallbackArtworkUrl(service.slug));
  }
  return ServiceArtwork(
    base.icon, base.color,
    imageUrl: base.imageUrl,
    assetPath: 'assets/service_art/${service.slug}.webp',
    largeAssetPath: 'assets/service_art/large/${service.slug}.webp',
  );
}

/// The previous bundled catalogue used these exact generated category PNGs.
/// User-uploaded or otherwise customised server banners must always win.
bool isLegacyDefaultServiceImage(String url) => RegExp(r'^/images/services/(banking|companies|consulting|exams|housing|insurance|judicial|licenses|other|police|school|subsidy|tax|university|vehicle)\.png$').hasMatch(url);
