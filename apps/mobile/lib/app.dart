import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/theme.dart';
import 'screens/splash.dart';

class PishkanApp extends StatelessWidget {
  const PishkanApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'پیشخوان',
      debugShowCheckedModeBanner: false,
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
