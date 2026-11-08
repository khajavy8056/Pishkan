import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/theme.dart';
import 'core/theme_mode.dart';
import 'core/referral.dart';
import 'screens/splash.dart';

/// Shared navigator so notification taps can deep-link from anywhere.
final appNavigatorKey = GlobalKey<NavigatorState>();

class PishkanApp extends StatefulWidget {
  const PishkanApp({super.key});

  @override
  State<PishkanApp> createState() => _PishkanAppState();
}

class _PishkanAppState extends State<PishkanApp> {
  StreamSubscription<Uri>? _links;
  @override
  void initState() {
    super.initState();
    final links = AppLinks();
    ReferralStore.load().then((_) => links.getInitialLink()).then((uri) { if (uri != null) ReferralStore.acceptUri(uri); }).catchError((_) {});
    _links = links.uriLinkStream.listen((uri) { ReferralStore.acceptUri(uri); }, onError: (_) {});
  }
  @override
  void dispose() { _links?.cancel(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    // Never a blank screen: any unexpected build error shows a calm Persian
    // message instead of the framework's empty error surface.
    ErrorWidget.builder = (details) => const Material(
          color: PishkanColors.background,
          child: SafeArea(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(28),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.cloud_off_rounded, size: 44, color: PishkanColors.primary),
                  SizedBox(height: 14),
                  Text('خطایی رخ داد', style: TextStyle(fontFamily: 'Vazirmatn', fontWeight: FontWeight.w800, fontSize: 16, color: PishkanColors.navy)),
                  SizedBox(height: 6),
                  Text(
                    'لطفاً اپ را ببندید و دوباره باز کنید. اگر مشکل ماند، با دفتر تماس بگیرید.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontFamily: 'Vazirmatn', fontSize: 12.5, color: PishkanColors.mutedText, height: 1.9),
                  ),
                ]),
              ),
            ),
          ),
        );
    return ListenableBuilder(
      listenable: ThemeController.instance,
      builder: (context, _) => MaterialApp(
      title: 'پیشخوان',
      debugShowCheckedModeBanner: false,
      navigatorKey: appNavigatorKey,
      theme: buildPishkanTheme(),
      darkTheme: buildPishkanDarkTheme(),
      themeMode: ThemeController.instance.material,
      locale: const Locale('fa', 'IR'),
      supportedLocales: const [Locale('fa', 'IR')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const SplashScreen(),
      ),
    );
  }
}
