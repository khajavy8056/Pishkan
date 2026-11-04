import 'dart:async';

import 'package:flutter/material.dart';

import 'app.dart';
import 'core/session.dart';
import 'services/notifier.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // The first frame must never wait for storage or platform plugins. Load
  // the session behind a hard cap, put the UI on screen, and only then
  // start the notification plumbing — a slow KeyStore, a restricted vendor
  // ROM or a plugin hiccup must never leave the user on the native splash.
  try {
    await SessionStore.instance.load().timeout(const Duration(seconds: 3));
  } catch (_) {}
  runApp(const PishkanApp());
  unawaited(() async {
    try {
      await NotifierService.init();
    } catch (_) {}
    await ensureBackgroundPolling();
  }());
}
