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
