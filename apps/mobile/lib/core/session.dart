import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'env.dart';

/// Session token and cached user details live in Android's encrypted storage;
/// the server address and non-sensitive device identifier are preferences.
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
  Future<void>? _loadFuture;
  int _generation = 0;

  String? get token => _token;
  bool get isSignedIn => _token != null && _token!.isNotEmpty;
  Map<String, dynamic>? get user => _user;
  String get userId => (_user?['id'] ?? '').toString();
  String get serverUrl => _serverUrl.isNotEmpty ? _serverUrl : normalizeBaseUrl(Env.defaultApiBaseUrl);
  bool get hasServer => serverUrl.isNotEmpty;
  String? get deviceId => _deviceId;

  /// Multiple callers (startup, splash, background isolate) share one load.
  /// A slow load is never allowed to overwrite a newer login or server change.
  Future<void> load() => _loadFuture ??= _load();

  Future<void> _load() async {
    final generation = _generation;
    final prefs = await SharedPreferences.getInstance();
    final server = (prefs.getString(_serverKey) ?? '').trim();
    String? token;
    try { token = await _secure.read(key: _tokenKey); } catch (_) { token = null; }
    String? userJson;
    try { userJson = await _secure.read(key: _userKey); } catch (_) {}
    // One-time migration from old versions which kept the profile in regular
    // preferences. Only delete the old copy after secure storage succeeds.
    final legacy = prefs.getString(_userKey);
    if (legacy != null && generation == _generation) {
      try {
        if (userJson == null) {
          await _secure.write(key: _userKey, value: legacy);
          userJson = legacy;
        }
        if (generation == _generation) await prefs.remove(_userKey);
      } catch (_) {}
    }
    Map<String, dynamic>? user;
    if (token != null && token.isNotEmpty && userJson != null && userJson.isNotEmpty) {
      try { user = Map<String, dynamic>.from(jsonDecode(userJson) as Map); } catch (_) {}
    }
    var deviceId = prefs.getString(_deviceKey);
    if (deviceId == null || deviceId.isEmpty) {
      deviceId = 'android-${DateTime.now().microsecondsSinceEpoch.toRadixString(16)}';
      await prefs.setString(_deviceKey, deviceId);
    }
    if (generation != _generation) return;
    _serverUrl = server;
    _token = token;
    _user = user;
    _deviceId = deviceId;
    notifyListeners();
  }

  Future<void> setServerUrl(String url) async {
    _generation++;
    _serverUrl = normalizeBaseUrl(url);
    // The HTTP client remembers the base URL it was built for; drop it so no
    // in-flight or cached request can still go to the previous server.
    ApiClient.instance.forgetServer();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverKey, _serverUrl);
    notifyListeners();
  }

  Future<void> signIn({required String token, required Map<String, dynamic> user}) async {
    _generation++;
    try {
      await _secure.write(key: _tokenKey, value: token);
      await _secure.write(key: _userKey, value: jsonEncode(user));
    } catch (_) {
      _token = null;
      _user = null;
      try { await _secure.delete(key: _tokenKey); } catch (_) {}
      try { await _secure.delete(key: _userKey); } catch (_) {}
      notifyListeners();
      rethrow;
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userKey);
    _token = token;
    _user = user;
    notifyListeners();
  }

  Future<void> updateUser(Map<String, dynamic> user) async {
    if (!isSignedIn) return;
    final generation = _generation;
    await _secure.write(key: _userKey, value: jsonEncode(user));
    if (generation != _generation || !isSignedIn) return;
    _user = user;
    notifyListeners();
  }

  Future<void> signOut() async {
    _generation++;
    _token = null;
    _user = null;
    notifyListeners();
    await _secure.delete(key: _tokenKey);
    await _secure.delete(key: _userKey);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userKey);
    await prefs.remove('pishkan.pref.biometric');
  }
}
