import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// How the app decides between the light and dark palette.
///
/// Deliberately a three-way choice rather than a boolean: «خودکار» follows the
/// phone (including Android's sunset schedule and battery saver), which is what
/// most customers leave it on; the explicit modes exist for anyone who wants
/// the app to stay put.
enum AppThemeMode {
  system('هماهنگ با گوشی', Icons.brightness_auto_rounded),
  light('روشن', Icons.light_mode_rounded),
  dark('تاریک', Icons.dark_mode_rounded);

  const AppThemeMode(this.label, this.icon);
  final String label;
  final IconData icon;

  ThemeMode get material => switch (this) {
        AppThemeMode.system => ThemeMode.system,
        AppThemeMode.light => ThemeMode.light,
        AppThemeMode.dark => ThemeMode.dark,
      };

  static AppThemeMode parse(String? raw) => AppThemeMode.values.firstWhere(
        (mode) => mode.name == raw,
        orElse: () => AppThemeMode.system,
      );
}

const _themeKey = 'pishkan.pref.themeMode';

/// A single notifier the whole app listens to, so switching the theme in the
/// profile rebuilds MaterialApp immediately without a restart.
class ThemeController extends ChangeNotifier {
  ThemeController._();
  static final ThemeController instance = ThemeController._();

  AppThemeMode _mode = AppThemeMode.system;
  AppThemeMode get mode => _mode;
  ThemeMode get material => _mode.material;

  /// Loaded before the first frame is built (main.dart) so a dark-mode user
  /// never sees a white flash on a cold start.
  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _mode = AppThemeMode.parse(prefs.getString(_themeKey));
    } catch (_) {
      _mode = AppThemeMode.system;
    }
    notifyListeners();
  }

  Future<void> set(AppThemeMode mode) async {
    if (_mode == mode) return;
    _mode = mode;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_themeKey, mode.name);
    } catch (_) {
      // Losing the preference only means the next launch starts on auto.
    }
  }
}
