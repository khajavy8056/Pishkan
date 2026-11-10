import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/screens/splash.dart';

/// The splash is built almost entirely from `CustomPainter`s and
/// animation-driven geometry: the kind of code that analyzes cleanly and then
/// throws at paint time. Nothing else in the suite renders it, so without this
/// a broken splash ships as a blank first screen.
///
/// These pump [SplashStage] rather than [SplashScreen]: the screen owns a
/// ten-second timer and a network boot, so mounting it would either stall the
/// test or fail it on a pending timer.
void main() {
  testWidgets('paints and stays painted', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SplashStage()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);

    await tester.pump(const Duration(seconds: 2));
    expect(tester.takeException(), isNull);

    // The ambient controller repeats forever, so the tree never settles on its
    // own; unmounting is what stops it, and a live ticker at the end of a test
    // is a failure.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows the brand and the status line', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: SplashStage(brand: 'تک پیشخوان', status: 'در حال اتصال…'),
    ));
    await tester.pump();
    expect(find.text('تک پیشخوان'), findsOneWidget);
    expect(find.text('در حال اتصال…'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('survives reduced motion', (tester) async {
    await tester.pumpWidget(const MediaQuery(
      data: MediaQueryData(disableAnimations: true),
      child: MaterialApp(home: SplashStage()),
    ));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('survives a short viewport', (tester) async {
    // The mark is a fixed 214 px with fixed copy under it; on a short window a
    // plain column overflows and the splash throws before login.
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const MaterialApp(home: SplashStage()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('paints at both ends of the progress arc', (tester) async {
    for (final p in const [0.0, 1.0]) {
      await tester.pumpWidget(MaterialApp(home: SplashStage(progress: p)));
      await tester.pump();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
    }
  });
}
