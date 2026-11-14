import 'dart:async';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/session.dart';
import 'notifier.dart';
import 'services.dart';

/// Native push delivery (FCM) — the half that works when the app is closed.
///
/// ## Why this exists next to [NotifierService]
///
/// [NotifierService] polls the notification feed. That is the only option that
/// works on a LAN-only install with no internet at all, and it is kept as the
/// fallback. But polling is at the mercy of Android: Doze, vendor battery
/// managers and the "restricted" app state stretch a 15-minute job into hours,
/// or stop it. A push message is delivered by the system over a connection the
/// app does not own, so it arrives while the app is closed, killed, or has never
/// been opened since boot.
///
/// The two are combined, not swapped: the native channel is used when the
/// server has it configured, and polling silently covers the rest. A customer
/// never has to know which one produced their notification.
///
/// ## What the app must do and cannot avoid
///
///  1. Register the FCM token with the server whenever it changes. A reinstall
///     or an app-data clear issues a new token; the old one dies silently, and
///     that is the single most common "notifications stopped working" cause.
///  2. Re-register on every sign-in, because the token is bound to the *user*
///     on the server (two accounts, one phone).
///  3. Hand the tapped deep link to the navigation stack, including from a cold
///     start where the app was not running when the notification arrived.
class PushService {
  static const _channel = MethodChannel('ir.pishkan.app/push');
  static const _tokenPref = 'pishkan.push.token';
  static const _registeredFor = 'pishkan.push.registeredFor';

  static bool _available = false;
  static String? _token;

  /// Set by the shell so a tap can navigate.
  static void Function(String link)? onLink;

  /// True when the platform side reports a working Firebase configuration.
  /// False on a build with blank firebase.xml — the app then relies on polling,
  /// and the profile screen says so instead of showing a switch that does
  /// nothing.
  static bool get available => _available;
  static String? get token => _token;

  /// First thing in `main()`, before the first frame: a tap that cold-started
  /// the app is waiting in the platform channel and must not be lost.
  static Future<void> init({bool ui = true}) async {
    if (!Platform.isAndroid) return;
    _channel.setMethodCallHandler((call) async {
      switch (call.method) {
        case 'onPushLink':
          final link = (call.arguments as String?) ?? '';
          if (link.isNotEmpty) {
            final handler = onLink;
            if (handler != null) {
              handler(link);
            } else {
              // The shell is not mounted yet; keep it for the first build.
              _pendingLaunchLink = link;
            }
          }
          break;
        case 'registerToken':
          final token = (call.arguments as String?) ?? '';
          if (token.isNotEmpty) {
            _token = token;
            // The app may not be signed in yet (notification arrived before
            // sign-in, or the token rotated in the background). Persist it and
            // upload at the next sign-in.
            await _remember(token);
            unawaited(registerWithServer());
          }
          break;
        case 'synchronise':
          // A message arrived while the app was closed: refresh the feed so the
          // in-app list matches the tray.
          unawaited(_syncFeed());
          break;
      }
      return null;
    });
    try {
      _available = true;
      // Tell the platform side which isolate this is before asking for a
      // pending link. The headless entrypoint calls init(ui: false): it must
      // never be handed a tap, because it has no navigator to act on it, and
      // taking one would silently swallow the tap that opened the app.
      if (ui) await _channel.invokeMethod<void>('ready');
      final initial = await _channel.invokeMethod<String>('takeInitialLink');
      if ((initial ?? '').isNotEmpty) _pendingLaunchLink = initial;
    } catch (_) {
      // No platform implementation (iOS, tests, a build without the plugin):
      // polling remains the only channel and that is a supported mode.
      _available = false;
    }
  }

  static String? _pendingLaunchLink;

  /// The link that launched the app from a notification, once.
  static String? takePendingLaunchLink() {
    final link = _pendingLaunchLink;
    _pendingLaunchLink = null;
    return link;
  }

  static Future<void> _remember(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenPref, token);
  }

  static Future<String?> _rememberedToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenPref);
  }

  /// Upload the token for the signed-in account.
  ///
  /// Idempotent and safe to call repeatedly: the server keys the row by token
  /// and reassigns the owner, so calling it on every app start is the cheapest
  /// way to survive reinstalls, account switches and server-side pruning.
  static Future<bool> registerWithServer({bool force = false}) async {
    if (!Platform.isAndroid) return false;
    if (!session.isSignedIn) return false;
    final token = _token ?? await _rememberedToken();
    if (token == null || token.isEmpty) return false;
    // Skip a redundant call when nothing changed since the last success — but
    // always retry when the server rejected it or the account changed.
    final prefs = await SharedPreferences.getInstance();
    final marker = '${session.serverUrl}|${session.userId}|$token';
    if (!force && prefs.getString(_registeredFor) == marker) return true;

    String appVersion = '';
    String deviceName = '';
    String maker = '';
    try {
      final info = await PackageInfo.fromPlatform();
      appVersion = info.version;
    } catch (_) {}
    try {
      final android = await DeviceInfoPlugin().androidInfo;
      deviceName = '${android.brand} ${android.model}'.trim();
      maker = android.manufacturer;
    } catch (_) {}

    try {
      await registerPushDevice(
        token: token,
        appVersion: appVersion,
        deviceName: deviceName,
        deviceMaker: maker,
      );
      await prefs.setString(_registeredFor, marker);
      return true;
    } catch (_) {
      // Offline or the token is not yet valid server-side; the next app start
      // retries. Deliberately not surfaced: the customer cannot act on it.
      return false;
    }
  }

  /// Ask the platform for the current token.
  ///
  /// The native side fetches it from Firebase and, when it is fresh, also fires
  /// `onNewToken`. Called after sign-in so the very first registration does not
  /// wait for the next restart.
  static Future<void> refreshToken() async {
    if (!Platform.isAndroid) return;
    try {
      final token = await _channel.invokeMethod<String>('getToken');
      if (token != null && token.isNotEmpty) {
        _token = token;
        await _remember(token);
        await registerWithServer(force: true);
      }
    } catch (_) {}
  }

  /// Retire this device before signing out, so a shared phone does not keep
  /// receiving the previous customer's case updates.
  static Future<void> unregisterFromServer() async {
    final token = _token ?? await _rememberedToken();
    if (token == null || token.isEmpty) return;
    try {
      await unregisterPushDevice(token);
    } catch (_) {}
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_registeredFor);
  }

  static Future<void> _syncFeed() async {
    try {
      await NotifierService.checkForUpdates(systemNotifications: false);
    } catch (_) {}
  }
}
