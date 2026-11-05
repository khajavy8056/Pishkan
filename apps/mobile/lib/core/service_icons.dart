import 'package:flutter/material.dart';

import '../models/models.dart';

/// Friendly per-service artwork. Admins can set an emoji icon per service in
/// the web panel; when that is generic or empty, this matcher still renders a
/// fitting colorful medallion (car for plate services, ID card for identity
/// services, shield for insurance…) so the storefront always looks curated,
/// like the approved design.
class ServiceArtwork {
  const ServiceArtwork(this.emoji, this.color);
  final String emoji;
  final Color color;
}

const _fallbackPalette = <Color>[
  Color(0xFF2563EB), // blue
  Color(0xFF7C3AED), // violet
  Color(0xFF059669), // green
  Color(0xFFD97706), // amber
  Color(0xFFDB2777), // pink
  Color(0xFF0891B2), // cyan
  Color(0xFF4F46E5), // indigo
  Color(0xFFEA580C), // orange
];

/// (keywords, emoji, color) — first match in title/slug/category wins.
/// Specific "card" rules come before the generic car rule: slugs like
/// `fuel-card` / `national-card` contain the substring `car` and must not
/// be mistaken for vehicle services.
const _rules = <(List<String>, String, Color)>[
  (['کارت سوخت', 'سوخت', 'بنزین', 'fuel'], '⛽', Color(0xFFEA580C)),
  (['کارت ملی', 'شناسنامه', 'هوشمند', 'احوال', 'identity', 'melli'], '🪪', Color(0xFF4F46E5)),
  (['پلاک', 'خودرو', 'ماشین', 'نقل و انتقال وسیله', 'plate', 'car', 'vehicle'], '🚗', Color(0xFF2563EB)),
  (['فک رهن', 'رهن'], '🔓', Color(0xFF0891B2)),
  (['گذرنامه', 'پاسپورت', 'passport'], '🛂', Color(0xFF0F766E)),
  (['وام ازدواج', 'ازدواج', 'marriage'], '💍', Color(0xFFDB2777)),
  (['وام', 'تسهیلات', 'بانک', 'حساب', 'مالی', 'loan', 'bank'], '🏦', Color(0xFF1D4ED8)),
  (['یارانه', 'حمایتی', 'کالابرگ', 'subsidy'], '👨‍👩‍👧‍👦', Color(0xFF059669)),
  (['بیمه', 'ثالث', 'تأمین اجتماعی', 'تامین اجتماعی', 'insurance'], '🛡️', Color(0xFF16A34A)),
  (['مالیات', 'اظهارنامه', 'tax'], '🧾', Color(0xFF7C3AED)),
  (['پروانه کسب', 'کسب‌وکار', 'کسب و کار', 'جواز', 'مجوز', 'license', 'business'], '🏪', Color(0xFFD97706)),
  (['عدم سوء', 'سوء پیشینه', 'پیشینه', 'گواهی', 'certificate'], '📜', Color(0xFF059669)),
  (['ثبت شرکت', 'شرکت', 'تجاری', 'company'], '🏢', Color(0xFF334155)),
  (['ملک', 'سند', 'زمین', 'آپارتمان', 'ثبت اسناد', 'property'], '🏠', Color(0xFFB45309)),
  (['دانشگاه', 'تحصیل', 'دانشجو', 'آموزش', 'education'], '🎓', Color(0xFF6D28D9)),
  (['سلامت', 'درمان', 'پزشک', 'دفترچه', 'health'], '🩺', Color(0xFFDC2626)),
  (['حقوقی', 'دادگستری', 'وکالت', 'قضایی', 'legal'], '⚖️', Color(0xFF475569)),
  (['پست', 'مرسوله', 'post'], '📮', Color(0xFF0284C7)),
  (['گواهینامه', 'رانندگی', 'driving'], '🚦', Color(0xFFCA8A04)),
  (['بازنشستگی', 'مستمری', 'حقوق', 'pension'], '🧓', Color(0xFF0E7490)),
];

/// Resolve artwork for one service/category. An explicit admin-set emoji is
/// honoured first; keyword matching fills the gaps; anything left still gets
/// a stable color from the palette (hash of the slug/title).
ServiceArtwork artworkFor({String explicitIcon = '', String title = '', String slug = '', String categoryTitle = ''}) {
  final haystack = '$title $slug $categoryTitle'.toLowerCase();
  Color? matchedColor;
  String? matchedEmoji;
  for (final (keywords, emoji, color) in _rules) {
    if (keywords.any((word) => haystack.contains(word.toLowerCase()))) {
      matchedEmoji = emoji;
      matchedColor = color;
      break;
    }
  }
  final explicit = explicitIcon.trim();
  // Web catalog stores Lucide names (e.g. file-warning), not emoji. Never
  // render those names as large text in the native UI.
  final validExplicit = explicit.runes.any((r) => r >= 0x1F000 || (r >= 0x2600 && r <= 0x27BF));
  final color = matchedColor ?? _fallbackPalette[_stableHash(slug.isEmpty ? title : slug) % _fallbackPalette.length];
  return ServiceArtwork(validExplicit ? explicit : (matchedEmoji ?? '🧩'), color);
}

int _stableHash(String value) {
  var hash = 0;
  for (final unit in value.codeUnits) {
    hash = (hash * 31 + unit) & 0x7fffffff;
  }
  return hash;
}

/// Artwork for one catalog service (admin emoji first, keyword fallback).
ServiceArtwork artworkForService(CatalogService service) => artworkFor(
      explicitIcon: service.icon,
      title: service.title,
      slug: service.slug,
      categoryTitle: service.categoryTitle,
    );
