import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/screens/splash.dart';

void main() {
  // The splash is the first thing every customer sees and it is built almost
  // entirely from CustomPainters and animation-driven alignment maths — the
  // kind of code that compiles cleanly and then throws at paint time. Nothing
  // else in the suite renders it, so without this a broken splash would reach
  // users and only show up as a blank first screen.
  testWidgets('the splash paints without throwing', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SplashScreen()));
    // The entrance animation and the ambient loop both need frames.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(tester.takeException(), isNull);

    // Advance across the loop; the drifting orbs, the dot field and the pulse
    // rings all recompute from the animation value, so a range of phases
    // exercises every branch.
    await tester.pump(const Duration(seconds: 2));
    expect(tester.takeException(), isNull);
    await tester.pump(const Duration(seconds: 3));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the splash still works with reduced motion on', (tester) async {
    await tester.pumpWidget(const MediaQuery(
      data: MediaQueryData(disableAnimations: true),
      child: MaterialApp(home: SplashScreen()),
    ));
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
