import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/motion.dart';
import 'package:pishkan_app/screens/splash.dart';

void main() {
  testWidgets('diag: splash stage', (tester) async {
    final errors = <String>[];
    final prev = FlutterError.onError;
    FlutterError.onError = (d) {
      if (errors.length < 2) {
        final t = d.exceptionAsString().split('\n').take(3).join(' | ');
        errors.add(t.length > 300 ? t.substring(0, 300) : t);
      }
    };
    addTearDown(() => FlutterError.onError = prev);
    await tester.pumpWidget(const MaterialApp(home: SplashStage()));
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    debugPrint('::error::DIAG_SPLASH ${errors.isEmpty ? "OK" : errors.join("  ///  ")}');
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('diag: splash short viewport', (tester) async {
    final prev = FlutterError.onError;
    var msg = 'OK';
    FlutterError.onError = (d) {
      final t = d.exceptionAsString().split('\n').take(3).join(' | ');
      msg = t.length > 300 ? t.substring(0, 300) : t;
    };
    addTearDown(() => FlutterError.onError = prev);
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: SplashStage()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    debugPrint('::error::DIAG_SHORT $msg');
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('diag: tactile all five', (tester) async {
    final prev = FlutterError.onError;
    final errs = <String>[];
    FlutterError.onError = (d) {
      final t = d.exceptionAsString().split('\n').take(2).join(' | ');
      errs.add(t.length > 200 ? t.substring(0, 200) : t);
    };
    addTearDown(() => FlutterError.onError = prev);

    Widget host(Widget child) => MaterialApp(
          home: Scaffold(body: Center(child: SizedBox(width: 220, height: 96, child: child))),
        );
    var fired = 0;
    await tester.pumpWidget(host(TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));
    await tester.tap(find.byType(TactileTap));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    debugPrint('::error::DIAG_TACTILE fired=$fired errs=${errs.isEmpty ? "none" : errs.first}');
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
}
