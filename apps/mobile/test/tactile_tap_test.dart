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

  });

  testWidgets('a second tap while the first is holding opens nothing twice', (tester) async {
    var fired = 0;
    await tester.pumpWidget(host(TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));

    await tester.tap(find.byType(TactileTap));
    await tester.tap(find.byType(TactileTap));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    expect(fired, 1);
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
