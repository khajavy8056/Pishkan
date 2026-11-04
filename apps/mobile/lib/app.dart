import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/theme.dart';
import 'screens/splash.dart';

/// Shared navigator so notification taps can deep-link from anywhere.
final appNavigatorKey = GlobalKey<NavigatorState>();

class PishkanApp extends StatelessWidget {
  const PishkanApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'پیشخوان',
      debugShowCheckedModeBanner: false,
      navigatorKey: appNavigatorKey,
      theme: buildPishkanTheme(),
      locale: const Locale('fa', 'IR'),
      supportedLocales: const [Locale('fa', 'IR')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const SplashScreen(),
    );
  }
}
