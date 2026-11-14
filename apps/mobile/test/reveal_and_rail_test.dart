import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/motion.dart';
import 'package:pishkan_app/core/theme.dart';

/// Two regressions that both showed up as "there is a blank hole in the home
/// page", and both had the same shape: a section that takes up space without
/// showing anything.
void main() {
  testWidgets('a reveal that has not fired is fully visible, not a faint block', (tester) async {
    // `ScrollDrivenReveal` has produced the "blank hole in the home page" twice.
    // First at `Opacity(0)`: a section built below the fold occupied its full
    // height and drew nothing. Then at a 55% floor, which on the dark navy page
    // is still indistinguishable from the page — the customer saw a ~340 dp
    // blank band between the service tiles and the support card.
    //
    // The reveal is now a travel-and-settle with no opacity at all, so this
    // test asserts the strong property rather than a floor: an untriggered
    // section must be painted at exactly 1.0, or not wrapped in an Opacity at
    // all. Anything less is a section the customer cannot read.
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
    final opacities = find.descendant(
      of: find.byType(ScrollDrivenReveal),
      matching: find.byType(Opacity),
    );
    for (final element in opacities.evaluate()) {
      expect(
        (element.widget as Opacity).opacity,
        1.0,
        reason: 'an untriggered section must never be dimmed into the background',
      );
    }

    // And the content is really laid out, not merely present.
    final target = find.byKey(const Key('target'));
    expect(tester.getSize(target).height, 80);

    // The reveal arms a one-shot fallback timer so it can never sit offset
    // forever; tear the tree down and let it run out, or the test ends with a
    // pending timer and fails for a reason unrelated to what it asserts.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
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

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
  });
}
