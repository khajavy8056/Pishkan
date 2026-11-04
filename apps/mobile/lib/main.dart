import 'package:flutter/material.dart';

import 'app.dart';
import 'core/session.dart';
import 'services/notifier.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SessionStore.instance.load();
  // Notification plumbing is best-effort: the app must open even on devices
  // where a vendor ROM restricts background work.
  await NotifierService.init();
  await ensureBackgroundPolling();
  runApp(const PishkanApp());
}
