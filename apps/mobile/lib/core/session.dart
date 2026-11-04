import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'env.dart';

/// Everything that must survive an app restart: the chosen server address
/// (office PC on the LAN or the production domain), the session token
/// (stored encrypted) and a cached copy of the signed-in user.
class SessionStore extends ChangeNotifier {
  SessionStore._();
  static final SessionStore instance = SessionStore._();

  static const _secure = FlutterSecureStorage();
  static const _tokenKey = 'pishkan.session.token';
  static const _serverKey = 'pishkan.server.url';
  static const _userKey = 'pishkan.user.json';
  static const _deviceKey = 'pishkan.device.id';

  String? _token;
  String _serverUrl = '';
  Map<String, dynamic>? _user;
  String? _deviceId;

  String? get token => _token;
  bool get isSignedIn => _token != null && _token!.isNotEmpty;
  Map<String, dynamic>? get user => _user;
  String get userId => (_user?['id'] ?? '').toString();

  String get serverUrl {
    if (_serverUrl.isNotEmpty) return _serverUrl;
    return normalizeBaseUrl(Env.defaultApiBaseUrl);
  }

  bool get hasServer => serverUrl.isNotEmpty;
  String? get deviceId => _deviceId;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _serverUrl = (prefs.getString(_serverKey) ?? '').trim();
    try {
      _token = await _secure.read(key: _tokenKey);
    } catch (_) {
      // A corrupt/rotated Android KeyStore can make the first read throw on
      // some devices. Never let that keep the app on the native splash:
      // drop the unreadable entry and start signed-out instead.
      _token = null;
      try {
        await _secure.delete(key: _tokenKey);
      } catch (_) {}
    }
    final userJson = prefs.getString(_userKey);
    if (userJson != null && userJson.isNotEmpty) {
      try {
        _user = Map<String, dynamic>.from(jsonDecode(userJson) as Map);
      } catch (_) {
        _user = null;
      }
    }
    _deviceId = prefs.getString(_deviceKey);
    if (_deviceId == null || _deviceId!.isEmpty) {
      _deviceId = 'android-${DateTime.now().microsecondsSinceEpoch.toRadixString(16)}';
      await prefs.setString(_deviceKey, _deviceId!);
    }
    notifyListeners();
  }

  Future<void> setServerUrl(String url) async {
    _serverUrl = normalizeBaseUrl(url);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverKey, _serverUrl);
    notifyListeners();
  }

  Future<void> signIn({required String token, required Map<String, dynamic> user}) async {
    _token = token;
    _user = user;
    await _secure.write(key: _tokenKey, value: token);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_userKey, jsonEncode(user));
    notifyListeners();
  }

  Future<void> updateUser(Map<String, dynamic> user) async {
    _user = user;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_userKey, jsonEncode(user));
    notifyListeners();
  }

  Future<void> signOut() async {
    _token = null;
    _user = null;
    await _secure.delete(key: _tokenKey);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userKey);
    notifyListeners();
  }
}
