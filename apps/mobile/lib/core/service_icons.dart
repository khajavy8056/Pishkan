import 'package:flutter/material.dart';

import '../models/models.dart';

/// Native vector pictogram and an optional bundled editorial photograph.
/// Server-supplied image icons remain authoritative; Unicode emoji from older
/// catalogs are deliberately not rendered as keyboard glyphs.
class ServiceArtwork {
  const ServiceArtwork(this.icon, this.color, {this.imageUrl = '', this.assetPath = ''});
  final IconData icon;
  final Color color;
  final String imageUrl;
  final String assetPath;
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

ServiceArtwork artworkFor({String explicitIcon = '', String title = '', String slug = '', String categoryTitle = '', String categorySlug = ''}) {
  final haystack = '$title $slug $categoryTitle $categorySlug'.toLowerCase();
  IconData icon = Icons.description_rounded;
  Color color = const Color(0xFF2563EB);
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

/// Honour a category's configured icon and colour without trusting malformed hex.
ServiceArtwork artworkForCategory(ServiceCategory category) {
  final base = artworkFor(explicitIcon: category.icon, title: category.title, slug: category.slug);
  final hex = category.color.trim().replaceFirst('#', '');
  final parsed = RegExp(r'^[0-9a-fA-F]{6}$').hasMatch(hex) ? int.tryParse(hex, radix: 16) : null;
  return ServiceArtwork(base.icon, parsed == null ? base.color : Color(0xFF000000 | parsed), imageUrl: base.imageUrl, assetPath: base.assetPath);
}

ServiceArtwork artworkForService(CatalogService service) => artworkFor(
  explicitIcon: service.icon,
  title: service.title,
  slug: service.slug,
  categoryTitle: service.categoryTitle,
  categorySlug: service.categorySlug,
);

/// The previous bundled catalogue used these exact generated category PNGs.
/// User-uploaded or otherwise customised server banners must always win.
bool isLegacyDefaultServiceImage(String url) => RegExp(r'^/images/services/(banking|companies|consulting|exams|housing|insurance|judicial|licenses|other|police|school|subsidy|tax|university|vehicle)\.png$').hasMatch(url);
