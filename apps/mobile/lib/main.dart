import 'dart:async';

import 'package:flutter/material.dart';

import 'app.dart';
import 'core/session.dart';
import 'core/theme_mode.dart';
import 'services/notifier.dart';
import 'services/push.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // The first frame must never wait for storage or platform plugins. Load
  // the session behind a hard cap, put the UI on screen, and only then
  // start the notification plumbing — a slow KeyStore, a restricted vendor
  // ROM or a plugin hiccup must never leave the user on the native splash.
  try {
    await Future.wait([
      SessionStore.instance.load(),
      // Reading one preference is cheap, but it still races the same 3s cap:
      // a cold start must never wait on storage, dark preference or not.
      ThemeController.instance.load(),
    ]).timeout(const Duration(seconds: 3));
  } catch (_) {}
  // Native push must be listening before the first frame: a tap that
  // cold-started the app is already waiting on the platform channel, and a
  // token that rotated while the app was closed is uploaded from here.
  try {
    await PushService.init().timeout(const Duration(seconds: 2));
  } catch (_) {}
  runApp(const PishkanApp());
  unawaited(() async {
    try {
      await NotifierService.init();
    } catch (_) {}
    await ensureBackgroundPolling();
    // Bind this installation to the account if a session already exists; the
    // sign-in path calls this again, which is what handles switching accounts
    // on a shared phone.
    try {
      await PushService.registerWithServer();
    } catch (_) {}
  }());
}

/// Entry point for a *headless* Flutter engine started by the Android service
/// when a push message arrives and no UI exists.
///
/// It does one thing: register the token, or acknowledge the message. It must
/// never call `runApp` — starting a UI from a background service is exactly the
/// behaviour that gets an app flagged, and the notification has already been
/// drawn by the native side by the time this runs.
@pragma('vm:entry-point')
void pushBackgroundMain() {
  WidgetsFlutterBinding.ensureInitialized();
  unawaited(() async {
    try {
      await SessionStore.instance.load().timeout(const Duration(seconds: 3));
      // ui: false — this isolate has no navigator, so it must not consume a
      // pending tap link that belongs to the UI isolate.
      await PushService.init(ui: false).timeout(const Duration(seconds: 3));
      await PushService.registerWithServer();
    } catch (_) {}
  }());
}
