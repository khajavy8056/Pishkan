import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Brand palette shared with the web panels: deep navy → vivid blue, on a
/// calm grey background with white soft cards and generous radii.
///
/// The light palette is the historical one and stays the source of truth for
/// charts, generated illustrations and the splash. Dark mode is a *derived*
/// palette (see [PishkanTheme.dark]) rather than a second brand: same hues,
/// same hierarchy, lifted for contrast on a navy-black canvas.
abstract final class PishkanColors {
  static const primary = Color(0xFF1F6FEE);
  static const navy = Color(0xFF0B1F3A);
  static const accent = Color(0xFF06B6D4);
  static const background = Color(0xFFF4F8FF);
  // Status colours are used as *text and icons* on white cards and on the page
  // wash, at 11–13px, so they have to clear 4.5:1 — not just look like a
  // green/amber/red. The stock Tailwind 600 values came in at 3.30 and 3.19,
  // which reads as a pleasant tint and is unreadable as an 11px label. These
  // are the 700-weight variants: same hue, legible.
  static const success = Color(0xFF15803D);
  static const warning = Color(0xFFB45309);
  static const danger = Color(0xFFDC2626);
  /// Secondary text. Nudged darker from #64748B, which was 4.47:1 on the page
  /// wash — a rounding error below AA, and exactly the kind that never gets
  /// noticed because the same colour passes on a white card.
  static const mutedText = Color(0xFF5D6B80);
  /// The brand gradient used wherever **white text sits on top of it**:
  /// primary buttons, the sent-message bubble, the wallet card.
  ///
  /// Its light end was #2E8CFF, which gives white text only 3.33:1 — above the
  /// 3:1 floor for large text, below the 4.5:1 body-text minimum, and the chat
  /// bubble puts 13px text on exactly this fill. Darkening the light end one
  /// step to the brand's own primary (4.60:1) keeps the gradient reading as a
  /// gradient while making every caller legible; a decorative use that wants
  /// the brighter blue should use [brightGradient] instead, which never
  /// carries text.
  static const brandGradient = LinearGradient(
    colors: [Color(0xFF1F6FEE), Color(0xFF1452D9)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  /// The brighter, purely decorative variant — illustrations, splash
  /// fallbacks, empty-state art. Never place text on this one.
  static const brightGradient = LinearGradient(
    colors: [Color(0xFF2E8CFF), Color(0xFF1452D9)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
  static const deepGradient = LinearGradient(
    colors: [Color(0xFF0B1F3A), Color(0xFF2563EB)],
    begin: Alignment.topRight,
    end: Alignment.bottomLeft,
  );
  // Pastel tiles of the «دسترسی سریع» shortcut grid.
  static const pastelGreen = Color(0xFFE4F6EC);
  static const pastelViolet = Color(0xFFF0E9FF);
  static const pastelBlue = Color(0xFFE5F0FF);
  static const pastelOrange = Color(0xFFFFF1E4);

  /* ----------------------------- dark palette ----------------------------- */

  /// Canvas behind scrollable content. Not pure black: pure black on OLED
  /// makes the soft shadows of the 3D cards collapse into the background.
  static const darkBackground = Color(0xFF0A1526);
  /// Cards, sheets, inputs — one step above the canvas.
  static const darkSurface = Color(0xFF12213A);
  /// A second elevation (chips on cards, list rows inside sheets).
  static const darkSurfaceHigh = Color(0xFF182C4B);
  static const darkNavy = Color(0xFF0B1F3A);
  /// Hairlines and card borders; white at 8-12% reads as a soft rule.
  static const darkBorder = Color(0x1FFFFFFF);
  static const darkMutedText = Color(0xFF9DB0CC);
  static const darkText = Color(0xFFEAF1FF);
  /// The brand blue is too dark on a navy canvas; lifts to stay ≥ 4.5:1.
  static const darkPrimary = Color(0xFF5AA0FF);
  static const darkSuccess = Color(0xFF4ADE80);
  static const darkWarning = Color(0xFFFBBF24);
  static const darkDanger = Color(0xFFF87171);
  static const darkGradient = LinearGradient(
    colors: [Color(0xFF0F2440), Color(0xFF1B3A6B)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}

/// Small palette helper so screens never branch on `Theme.of(context)` twice.
extension PishkanPalette on BuildContext {
  bool get isDark => Theme.of(this).brightness == Brightness.dark;
  /// Surface for a card/list on the current canvas.
  Color get surface => isDark ? PishkanColors.darkSurface : Colors.white;
  Color get surfaceHigh => isDark ? PishkanColors.darkSurfaceHigh : Colors.white;
  Color get canvas => isDark ? PishkanColors.darkBackground : PishkanColors.background;
  /// Primary text.
  Color get ink => isDark ? PishkanColors.darkText : PishkanColors.navy;
  /// Secondary text.
  Color get inkMuted => isDark ? PishkanColors.darkMutedText : PishkanColors.mutedText;
  Color get hairline => isDark ? PishkanColors.darkBorder : const Color(0xFFE2E8F0);
  Color get brand => isDark ? PishkanColors.darkPrimary : PishkanColors.primary;
  Color get positive => isDark ? PishkanColors.darkSuccess : PishkanColors.success;
  Color get caution => isDark ? PishkanColors.darkWarning : PishkanColors.warning;
  Color get negative => isDark ? PishkanColors.darkDanger : PishkanColors.danger;

  /// A step *below* [surface]: segmented-control tracks, nested fields, the
  /// well behind a row of chips.
  ///
  /// This is the token whose absence caused the unreadable login selector. A
  /// pale blue was hard-coded as the track while the inactive label uses
  /// [ink], which is near-white in dark mode — light on light. A sunken
  /// surface has to move *away* from the card in both directions, so it cannot
  /// be a single fixed colour.
  Color get surfaceSunken => isDark ? const Color(0xFF0C1A2E) : const Color(0xFFEFF4FC);

  /// Hairline for separators between rows. Lighter than [hairline], which is a
  /// border around a surface: a divider inside a card should almost disappear.
  Color get divider => isDark ? const Color(0x1AFFFFFF) : const Color(0xFFEDF1F7);

  /// The focus ring: a soft brand glow rather than a hard outline.
  Color get focus => brand;

  /// Text, icons and fills for anything unavailable.
  Color get disabled => isDark ? const Color(0xFF56688A) : const Color(0xFF9FB0C9);

  /// Elevation shadow. Warm-navy and translucent in light mode; in dark mode a
  /// black shadow is invisible against a navy canvas, so elevation is carried
  /// by a slightly lighter surface instead and the shadow only deepens edges.
  Color get shadow => isDark ? const Color(0x66000000) : PishkanColors.navy.withOpacity(0.10);

  /// The brand glow used behind primary actions and on press.
  Color get glow => brand.withOpacity(isDark ? 0.42 : 0.30);
}

/// Shared metrics: one radius family and one elevation shadow, so every card
/// in the app is cut from the same cloth.
abstract final class PishkanMetrics {
  static const radiusCard = 22.0;
  static const radiusField = 18.0;
  static const radiusPill = 999.0;

  static List<BoxShadow> softShadow(BuildContext context, {double lift = 1}) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return [
      BoxShadow(
        color: dark ? const Color(0x66000000) : const Color(0x120B1F3A),
        blurRadius: 18 * lift,
        offset: Offset(0, 8 * lift),
      ),
    ];
  }
}

ThemeData buildPishkanTheme() => _build(Brightness.light);

ThemeData buildPishkanDarkTheme() => _build(Brightness.dark);

ThemeData _build(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final canvas = dark ? PishkanColors.darkBackground : PishkanColors.background;
  final surface = dark ? PishkanColors.darkSurface : Colors.white;
  final surfaceHigh = dark ? PishkanColors.darkSurfaceHigh : Colors.white;
  final ink = dark ? PishkanColors.darkText : PishkanColors.navy;
  final muted = dark ? PishkanColors.darkMutedText : PishkanColors.mutedText;
  final hairline = dark ? PishkanColors.darkBorder : const Color(0xFFE2E8F0);
  final brand = dark ? PishkanColors.darkPrimary : PishkanColors.primary;

  final scheme = ColorScheme.fromSeed(
    seedColor: PishkanColors.primary,
    brightness: brightness,
  ).copyWith(
    primary: brand,
    secondary: PishkanColors.accent,
    surface: surface,
    onSurface: ink,
    error: dark ? PishkanColors.darkDanger : PishkanColors.danger,
    outline: hairline,
  );

  const radius = BorderRadius.all(Radius.circular(PishkanMetrics.radiusField));

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: canvas,
    canvasColor: canvas,
    fontFamily: 'Vazirmatn',
    splashFactory: InkSparkle.splashFactory,
    // Sub-screens (documents, payments, support, the detail pages) keep a
    // normal AppBar; the four main tabs paint their own blue sweep. This makes
    // the AppBar a solid slice of that same gradient rather than a flat strip
    // of canvas, so opening a sub-screen does not drop the customer out of the
    // brand. Primary is dark enough for white title and icon text in both
    // modes: 5.2:1 on light, 6.9:1 on the lifted dark brand.
    appBarTheme: AppBarTheme(
      // Not `brand`: in dark mode brand is the lifted #5AA0FF, and white on
      // that is 2.7:1. The deep navy of the gradient's dark end carries white
      // at 14:1 and still belongs to the same header.
      backgroundColor: dark ? PishkanColors.darkGradient.colors.first : brand,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      foregroundColor: Colors.white,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      titleTextStyle: const TextStyle(fontFamily: 'Vazirmatn', fontSize: 17, fontWeight: FontWeight.w700, color: Colors.white),
      iconTheme: const IconThemeData(color: Colors.white),
      actionsIconTheme: const IconThemeData(color: Colors.white),
    ),
    cardTheme: CardThemeData(
      color: surface,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(PishkanMetrics.radiusCard)),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: hairline)),
      enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: hairline)),
      // A 1.6px brand ring alone is easy to miss on a bright page, and the
      // field is the one place a customer's attention has to land. The glow is
      // the ring *plus* a soft halo, which reads as "this is live" without
      // shouting.
      focusedBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: brand, width: 1.6)),
      focusedErrorBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: dark ? PishkanColors.darkDanger : PishkanColors.danger, width: 1.6)),
      errorBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: dark ? PishkanColors.darkDanger : PishkanColors.danger)),
      labelStyle: TextStyle(color: muted),
      // Placeholders in dark mode used to be `mutedText` at 70% opacity, which
      // blends to about 2.3:1 against the field background -- far below the
      // 4.5:1 that body text needs, and the reason field hints looked washed
      // out. The dark palette already carries a proper muted colour at 7.3:1,
      // so use it instead of fading a light-mode grey.
      hintStyle: TextStyle(color: dark ? PishkanColors.darkMutedText : PishkanColors.mutedText),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: brand,
        foregroundColor: dark ? PishkanColors.darkNavy : Colors.white,
        elevation: 0,
        minimumSize: const Size(0, 52),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ink,
        minimumSize: const Size(0, 50),
        side: BorderSide(color: hairline),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: brand,
        textStyle: const TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: brand.withOpacity(dark ? 0.22 : 0.12),
      labelTextStyle: WidgetStateProperty.all(TextStyle(fontFamily: 'Vazirmatn', fontSize: 11.5, fontWeight: FontWeight.w600, color: ink)),
      iconTheme: WidgetStateProperty.resolveWith((states) => IconThemeData(
        color: states.contains(WidgetState.selected) ? brand : muted,
      )),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: surfaceHigh,
      selectedColor: brand.withOpacity(dark ? 0.26 : 0.14),
      side: BorderSide(color: hairline),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(PishkanMetrics.radiusPill)),
      labelStyle: TextStyle(fontFamily: 'Vazirmatn', fontSize: 12.5, color: ink),
      secondaryLabelStyle: TextStyle(fontFamily: 'Vazirmatn', fontSize: 12.5, color: ink),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      titleTextStyle: TextStyle(fontFamily: 'Vazirmatn', fontSize: 16, fontWeight: FontWeight.w700, color: ink),
      contentTextStyle: TextStyle(fontFamily: 'Vazirmatn', fontSize: 13, height: 1.8, color: muted),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: dark ? PishkanColors.darkSurfaceHigh : PishkanColors.navy,
      contentTextStyle: const TextStyle(fontFamily: 'Vazirmatn', fontSize: 13, color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    dividerTheme: DividerThemeData(color: dark ? PishkanColors.darkBorder : const Color(0xFFEDF1F7)),
    listTileTheme: ListTileThemeData(iconColor: brand, textColor: ink),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? Colors.white : (dark ? PishkanColors.darkMutedText : Colors.white)),
      trackColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? brand : (dark ? PishkanColors.darkSurfaceHigh : const Color(0xFFCBD5E1))),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: brand, linearTrackColor: hairline),
    tooltipTheme: TooltipThemeData(textStyle: const TextStyle(fontFamily: 'Vazirmatn', fontSize: 12)),
    textTheme: Typography.material2021(platform: TargetPlatform.android).black.apply(fontFamily: 'Vazirmatn').copyWith(
      bodyMedium: TextStyle(fontSize: 13.5, height: 1.75, color: ink),
      bodySmall: TextStyle(fontSize: 11.5, height: 1.7, color: muted),
      titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: ink),
    ),
  );
}
