import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/motion.dart';
import 'package:pishkan_app/core/theme.dart';

/// Two regressions that both showed up as "there is a blank hole in the home
/// page", and both had the same shape: a section that takes up space without
/// showing anything.
void main() {
  testWidgets('a reveal that has not fired is still visible, not a blank block', (tester) async {
    // `ScrollDrivenReveal` used to render `Opacity(0)` until the scroll
    // threshold was crossed. Any section that never crossed it — because it was
    // built below the fold by a lazy `ListView` and the customer stopped
    // scrolling — laid out at full height and painted nothing. That is exactly
    // the ~130 dp hole that appeared between the shortcut grid and the section
    // after it.
    //
    // The fix is that the child is always drawn. The arrival animation still
    // runs; it just cannot make content disappear.
    await tester.pumpWidget(
      MaterialApp(
        theme: buildPishkanTheme(),
        home: Scaffold(
          // Pushed far below the fold so the trigger can never have fired.
          body: ListView(children: const [
            SizedBox(height: 2000),
            ScrollDrivenReveal(child: SizedBox(key: Key('target'), height: 80)),
          ]),
        ),
      ),
    );
    await tester.pump();

    final opacity = tester.widget<Opacity>(
      find.ancestor(of: find.byKey(const Key('target')), matching: find.byType(Opacity)).first,
    );
    expect(
      opacity.opacity,
      greaterThanOrEqualTo(0.5),
      reason: 'content below the fold must not be invisible-but-present',
    );
  });

  testWidgets('reduced motion renders the reveal at rest', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildPishkanTheme(),
        home: const MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: Scaffold(
            body: ScrollDrivenReveal(child: SizedBox(key: Key('still'), height: 40)),
          ),
        ),
      ),
    );
    await tester.pump();
    // No Opacity wrapper at all under reduced motion.
    expect(find.byKey(const Key('still')), findsOneWidget);
    expect(find.ancestor(of: find.byKey(const Key('still')), matching: find.byType(Opacity)), findsNothing);
  });
}
