import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/motion.dart';

/// These lock in the two behaviours the round-3 feedback was about:
/// a tap must *show* something before it navigates, and every tappable surface
/// must behave the same way.
void main() {
  Widget host(Widget child) => MaterialApp(
        theme: ThemeData(colorSchemeSeed: const Color(0xFF1F6FEE)),
        home: Scaffold(body: Center(child: SizedBox(width: 220, height: 96, child: child))),
      );

  testWidgets('the press is shown before onTap runs', (tester) async {
    var fired = 0;
    await tester.pumpWidget(host(TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));

    await tester.tap(find.byType(TactileTap));
    // On the frame the finger lifted, the press has been shown and the action
    // has *not* run yet. This is the contract the whole change exists for.
    await tester.pump();
    expect(fired, 0);

    // Pumping past the 120 ms hold *fires* the timer; the `await` inside
    // `_handle` then resumes on a microtask, which needs one more frame to be
    // observed. Asserting straight after the first pump is what fails here, not
    // the implementation.
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump();
    expect(fired, 1);

    await tester.pump(const Duration(milliseconds: 600)); // let the ripple finish
  });

  testWidgets('a second tap while the first is holding opens nothing twice', (tester) async {
    var fired = 0;
    await tester.pumpWidget(host(TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));

    await tester.tap(find.byType(TactileTap));
    await tester.tap(find.byType(TactileTap));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    expect(fired, 1);
    await tester.pump(const Duration(milliseconds: 600));
  });

  testWidgets('the ripple paints from the finger and clears itself', (tester) async {
    await tester.pumpWidget(host(TactileTap(onTap: () async {}, child: const ColoredBox(color: Colors.blue))));

    await tester.press(find.byType(TactileTap));
    await tester.pump(const Duration(milliseconds: 80));
    // Something is drawing over the child while the finger is down.
    expect(find.byType(CustomPaint), findsWidgets);
    expect(tester.takeException(), isNull);

    // Release, then drain everything this press started: the hold timer (a bare
    // timer, so `pumpAndSettle` ignores it) and the ripple's own 520 ms
    // controller. A timer still pending at the end of a test is a failure in
    // `flutter_test`, so this is not optional.
    await tester.pump(const Duration(milliseconds: 200));   // past the 130 ms hold
    await tester.pump(const Duration(milliseconds: 600));   // past the ripple
    expect(tester.takeException(), isNull);
  });

  testWidgets('reduced motion drops the hold but still runs the action', (tester) async {
    var fired = 0;
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: Scaffold(body: Center(child: SizedBox(width: 220, height: 96, child: TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))))),
      ),
    ));

    await tester.tap(find.byType(TactileTap));
    // No artificial wait for someone who asked for no animation. One pump runs
    // the (zero-length) hold's microtask; one more lets the callback's own
    // `await` complete.
    await tester.pump();
    await tester.pump();
    expect(fired, 1);
    // ...and no ripple layer either.
    await tester.pump(const Duration(milliseconds: 300));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a disabled tap does nothing', (tester) async {
    var fired = 0;
    await tester.pumpWidget(host(TactileTap(enabled: false, onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));
    await tester.tap(find.byType(TactileTap));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    expect(fired, 0);
  });
}
