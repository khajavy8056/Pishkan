import 'dart:io';

import 'package:flutter/services.dart';

import '../core/session.dart';
import 'notifier.dart';
import 'services.dart';

/// The app's own instant channel: a live connection to *our* server, held by a
/// foreground service, that puts notices in the notification shade without
/// Google, without a purchased push provider, and without waiting for a poll.
///
/// ## Where it sits among the other paths
///
/// FCM is still the only thing that wakes a phone whose app process was killed,
/// and the WorkManager check is still the only thing that runs with no Firebase
/// project *and* no live process. This is the third case, the one those two
/// leave open: the app is in a pocket, the process is alive, and a case update
/// saved right now should be on the screen right now. `docs/PUSH-NOTIFICATIONS-FA.md`
/// (بخش ۰.۵) keeps the three straight.
///
/// ## Why it is off until asked for
///
/// Turning it on puts a permanent, silent line in the customer's notification
/// shade for as long as the app runs — that is what makes the connection legal
/// under Android's background rules, and it is not something to do to somebody's
/// phone behind their back. It also has a policy shape (a `specialUse` service
/// type) that suits an app distributed by the office itself more than one sold
/// through a store. So the switch is in «اعلان‌ها» on the profile screen, with
/// the trade-off written next to it, and the app suggests it when it can see the
/// other instant path is not working (no Firebase on the server).
///
/// ## What is *not* here
///
/// No token is persisted. The session lives in encrypted storage and this class
/// hands the platform side a copy for the lifetime of the process only; the
/// service re-arms at the next app start, which is also the only moment a fresh
/// token is guaranteed.
class KeepAlive {
  static const _channel = MethodChannel('ir.pishkan.app/keepalive');

  static bool _supportsPlatform = Platform.isAndroid;

  /// Arm or disarm from what the user chose and what the session allows.
  ///
  /// Safe to call on every sign-in, server change and toggle: the service treats
  /// a repeated start as "reconnect", so the worst case is the server replaying
  /// notices it already owes this device.
  static Future<void> sync() async {
    if (!_supportsPlatform) return;
    try {
      final enabled = await AppPrefs.keepAliveEnabled();
      final token = session.token;
      if (!enabled || !session.isSignedIn || (token ?? '').isEmpty) {
        await _channel.invokeMethod<void>('stop');
        return;
      }
      await _channel.invokeMethod<void>('start', <String, dynamic>{
        'baseUrl': session.serverUrl,
        'token': token,
      });
    } catch (_) {
      // Missing plugin (tests, a build without the native side) or a dead
      // channel: the polling paths are unaffected, which is the whole point of
      // keeping this one additive.
      _supportsPlatform = false;
    }
  }

  /// Stop it outright — sign-out, or the switch being turned off.
  static Future<void> stop() async {
    if (!_supportsPlatform) return;
    try {
      await _channel.invokeMethod<void>('stop');
    } catch (_) {}
  }

  /// Tell the service whether the app's own UI is the one announcing notices.
  ///
  /// `quiet = true` while the shell is resumed (its 30-second poll raises in-app
  /// banners, and a tray item as well would be the same notice twice);
  /// `quiet = false` when the app leaves the screen, which also reconnects the
  /// socket so the server replays anything that arrived in between.
  static Future<void> setQuiet(bool quiet) async {
    if (!_supportsPlatform) return;
    try {
      final token = session.token;
      await _channel.invokeMethod<void>('setQuiet', <String, dynamic>{
        'quiet': quiet,
        if (!quiet && (token ?? '').isNotEmpty) 'baseUrl': session.serverUrl,
        if (!quiet && (token ?? '').isNotEmpty) 'token': token,
      });
    } catch (_) {}
  }

  /// Whether the office has a reason to want this: no working instant push on
  /// the server. Drives the suggestion in the profile sheet, nothing else — the
  /// choice stays the customer's.
  static Future<bool> serverHasNoInstantPush() async {
    try {
      final status = await fetchDeliveryStatus();
      // `fcmEnabled` is the server's own answer (the flag *and* a usable
      // credential), which is why this does not guess from the app side.
      return status['fcmEnabled'] == false;
    } catch (_) {
      return false;
    }
  }
}
