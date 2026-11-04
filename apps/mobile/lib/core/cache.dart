import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Small JSON cache for public content (catalog, categories, stories) so the
/// app stays browsable on weak connections. Financial/sensitive actions are
/// never served from cache — they always round-trip to the server.
class JsonCache {
  static Future<void> put(String key, Object? value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'pishkan.cache.$key',
      jsonEncode({'at': DateTime.now().toIso8601String(), 'value': value}),
    );
  }

  static Future<void> remove(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('pishkan.cache.$key');
  }

  /// Drop every cached value whose key starts with [prefix] — used on
  /// sign-out so one customer's instant-display cache never leaks to the next.
  static Future<void> removeByPrefix(String prefix) async {
    final prefs = await SharedPreferences.getInstance();
    final full = 'pishkan.cache.$prefix';
    for (final key in prefs.getKeys().where((k) => k.startsWith(full)).toList()) {
      await prefs.remove(key);
    }
  }

  static Future<CachedValue?> get(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('pishkan.cache.$key');
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw) as Map;
      return CachedValue(DateTime.tryParse('${decoded['at']}'), decoded['value']);
    } catch (_) {
      return null;
    }
  }
}

class CachedValue {
  CachedValue(this.at, this.value);
  final DateTime? at;
  final dynamic value;

  bool get isFresh => at != null && DateTime.now().difference(at!) < const Duration(minutes: 15);
}
