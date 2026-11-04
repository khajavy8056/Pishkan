import 'package:flutter/material.dart';

/// Brand palette shared with the web panels: deep navy → vivid blue, on a
/// calm grey background with white soft cards and generous radii.
abstract final class PishkanColors {
  static const primary = Color(0xFF2563EB);
  static const navy = Color(0xFF0B1F3A);
  static const accent = Color(0xFF06B6D4);
  static const background = Color(0xFFF3F5F9);
  static const success = Color(0xFF16A34A);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
  static const mutedText = Color(0xFF64748B);
  static const brandGradient = LinearGradient(
    colors: [Color(0xFF0B1F3A), Color(0xFF2563EB)],
    begin: Alignment.topRight,
    end: Alignment.bottomLeft,
  );
}

ThemeData buildPishkanTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: PishkanColors.primary,
    brightness: Brightness.light,
  ).copyWith(
    primary: PishkanColors.primary,
    secondary: PishkanColors.accent,
    surface: Colors.white,
  );

  const radius = BorderRadius.all(Radius.circular(18));

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: PishkanColors.background,
    fontFamily: 'Vazirmatn',
    appBarTheme: const AppBarTheme(
      backgroundColor: PishkanColors.background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(fontFamily: 'Vazirmatn', fontSize: 18, fontWeight: FontWeight.w700, color: PishkanColors.navy),
      iconTheme: IconThemeData(color: PishkanColors.navy),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
      enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
      focusedBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: PishkanColors.primary, width: 1.6)),
      errorBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: PishkanColors.danger)),
      labelStyle: const TextStyle(color: PishkanColors.mutedText),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: PishkanColors.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        minimumSize: const Size(0, 52),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: PishkanColors.navy,
        minimumSize: const Size(0, 50),
        side: const BorderSide(color: Color(0xFFCBD5E1)),
        shape: RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: PishkanColors.primary,
        textStyle: const TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: PishkanColors.primary.withOpacity(0.12),
      labelTextStyle: WidgetStateProperty.all(const TextStyle(fontFamily: 'Vazirmatn', fontSize: 11.5, fontWeight: FontWeight.w600)),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: PishkanColors.primary.withOpacity(0.14),
      side: const BorderSide(color: Color(0xFFE2E8F0)),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      labelStyle: const TextStyle(fontFamily: 'Vazirmatn', fontSize: 12.5),
    ),
    dialogTheme: DialogThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      titleTextStyle: const TextStyle(fontFamily: 'Vazirmatn', fontSize: 16, fontWeight: FontWeight.w700, color: PishkanColors.navy),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    ),
    dividerTheme: const DividerThemeData(color: Color(0xFFEDF1F7)),
  );
}
