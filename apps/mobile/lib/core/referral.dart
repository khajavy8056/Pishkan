import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'env.dart';
import 'session.dart';

class ReferralStore {
  static final code = ValueNotifier<String>('');
  static String origin = '';
  static final _valid = RegExp(r'^[A-Za-z0-9_-]{16,128}$');
  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('referral.code') ?? '';
    final time = prefs.getInt('referral.time') ?? 0;
    if (code.value.isEmpty && _valid.hasMatch(saved) && DateTime.now().millisecondsSinceEpoch - time < const Duration(days: 30).inMilliseconds) {
      origin = prefs.getString('referral.origin') ?? '';
      code.value = saved;
    }
  }
  static Future<void> acceptUri(Uri uri) async {
    if (uri.scheme != 'pishkan' || uri.host != 'invite') return;
    final value = uri.queryParameters['ref'] ?? '';
    final source = uri.queryParameters['origin'] ?? '';
    final sourceUri = Uri.tryParse(source);
    if (!_valid.hasMatch(value) || sourceUri == null || !['http', 'https'].contains(sourceUri.scheme) || !sourceUri.hasAuthority || sourceUri.userInfo.isNotEmpty || sourceUri.path != '' || sourceUri.hasQuery || sourceUri.hasFragment) return;
    origin = sourceUri.origin;
    code.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('referral.code', value);
    await prefs.setString('referral.origin', origin);
    await prefs.setInt('referral.time', DateTime.now().millisecondsSinceEpoch);
  }
  static bool matchesServer(String value) => value != code.value || origin.isEmpty || sameServerOrigin(SessionStore.instance.serverUrl, origin);
  static Future<void> clear() async {
    origin = '';
    code.value = '';
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('referral.code'); await prefs.remove('referral.origin'); await prefs.remove('referral.time');
  }
}
