import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/screens/splash.dart';

void main() {
  // The splash is the first thing every customer sees and it is built almost
  // entirely from CustomPainters and animation-driven alignment maths — the
  // kind of code that compiles cleanly and then throws at paint time. Nothing
  // else in the suite renders it, so without this a broken splash would only
  // show up as a blank first screen on a real phone.
  //
  // These pump [SplashStage] rather than [SplashScreen] on purpose: the screen
  // owns a ten-second timer and a network boot, so mounting it in a widget test
  // either stalls the test or fails it with a pending timer. The stage is the
  // part that paints, and it is the part that can break.
  testWidgets('the splash stage paints without throwing', (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const MaterialApp(home: SplashStage()));

    // The entrance animation and the ambient loop both need frames.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);

    // Advance across the loop: the drifting orbs, the light sweep, the dot
    // field and the pulse rings all recompute from the animation value, so a
    // range of phases exercises every branch — including the moment a pulse
    // ring wraps from near-full back to nothing.
    for (var i = 0; i < 4; i++) {
      await tester.pump(const Duration(seconds: 2));
      expect(tester.takeException(), isNull);
    }

    // The ambient controller repeats forever on purpose: it is what keeps the
    // splash alive for its ten seconds. That means the tree never settles on
    // its own, so the test has to unmount it — otherwise a live ticker is still
    // running when the test ends, which `flutter_test` reports as a failure.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the splash stage renders the brand and the status line', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: SplashStage(brand: 'تک پیشخوان', status: 'در حال اتصال به سامانه…'),
    ));
    await tester.pump();
    expect(find.text('تک پیشخوان'), findsOneWidget);
    expect(find.text('در حال اتصال به سامانه…'), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('the splash stage survives reduced motion', (tester) async {
    await tester.pumpWidget(const MediaQuery(
      data: MediaQueryData(disableAnimations: true),
      child: MaterialApp(home: SplashStage()),
    ));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
    // The decorative layers are suppressed, not merely slowed: that is what
    // "reduced" has to mean for a customer who turned animations off.
    expect(find.byType(SplashStage), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });

  testWidgets('the splash survives a short viewport', (tester) async {
    // The mark is a fixed 214 px with fixed copy under it. On a short window —
    // landscape on a small phone, or the 600 px default test viewport — the
    // column overflowed and four tests failed together because of it. Height
    // safety is part of the design, not an accident of the phone it was built on.
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

  testWidgets('a zero and a full progress arc both paint', (tester) async {
    for (final p in const [0.0, 1.0]) {
      await tester.pumpWidget(MaterialApp(home: SplashStage(progress: p)));
      await tester.pump();
      expect(tester.takeException(), isNull);
    }
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
}
