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
    // threshold was crossed. A section that had been *built* — so it was
    // occupying its full height — but whose trigger the customer had not
    // reached drew nothing at all. That is exactly the ~130 dp hole that
    // appeared between the shortcut grid and the section after it.
    //
    // The widget has to be built for this test to mean anything, so the page is
    // an eager `SingleChildScrollView` rather than a lazy `ListView`: in a lazy
    // list a child below the fold is never constructed, and "not built" is a
    // different (and correct) behaviour.
    await tester.pumpWidget(
      MaterialApp(
        theme: buildPishkanTheme(),
        home: Scaffold(
          body: SingleChildScrollView(
            child: Column(children: const [
              // Pushed well below the fold so the trigger cannot have fired.
              SizedBox(height: 2000),
              ScrollDrivenReveal(child: SizedBox(key: Key('target'), height: 80)),
            ]),
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('target')), findsOneWidget,
        reason: 'the section must still be built and laid out');

    // Scoped to the reveal's own subtree: `Material` puts `Opacity` widgets in
    // the tree for unrelated reasons (ink, elevation), and an unscoped
    // `find.ancestor` would happily find one of those and test nothing.
    final opacity = tester.widget<Opacity>(
      find
          .descendant(of: find.byType(ScrollDrivenReveal), matching: find.byType(Opacity))
          .first,
    );
    expect(
      opacity.opacity,
      greaterThanOrEqualTo(0.5),
      reason: 'content below the fold must not be invisible-but-present',
    );
  });

  testWidgets('reduced motion renders the reveal with no animation wrapper', (tester) async {
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
    expect(find.byKey(const Key('still')), findsOneWidget);
    expect(
      find.descendant(of: find.byType(ScrollDrivenReveal), matching: find.byType(Opacity)),
      findsNothing,
      reason: 'reduced motion must not wrap the child in an opacity animation',
    );
  });
}
