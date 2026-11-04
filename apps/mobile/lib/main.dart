import 'package:flutter/material.dart';

import 'app.dart';
import 'core/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SessionStore.instance.load();
  runApp(const PishkanApp());
}
