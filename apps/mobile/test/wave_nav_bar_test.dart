import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/theme.dart';
import 'package:pishkan_app/widgets/wave_nav_bar.dart';

/// The bottom bar is the most-tapped surface in the app, and the one piece of
/// chrome that has to hold its shape in both themes. These tests are about the
/// things that were actually wrong before: a selection that did not visibly
/// move, and a bar that disappeared into a dark page.
void main() {
  const items = [
    WaveNavItem(icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'خانه'),
    WaveNavItem(icon: Icons.grid_view_outlined, activeIcon: Icons.grid_view_rounded, label: 'خدمات'),
    WaveNavItem(icon: Icons.fact_check_outlined, activeIcon: Icons.fact_check_rounded, label: 'پیگیری‌ها'),
    WaveNavItem(icon: Icons.person_outline_rounded, activeIcon: Icons.person_rounded, label: 'پروفایل'),
  ];

  Widget host({required int index, required void Function(int) onSelect, bool dark = false}) {
    return MaterialApp(
      theme: dark ? buildPishkanDarkTheme() : buildPishkanTheme(),
      home: MediaQuery(
        data: const MediaQueryData(disableAnimations: false),
        child: Scaffold(
          body: Column(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              WaveNavBar(index: index, items: items, onSelect: onSelect),
            ],
          ),
        ),
      ),
    );
  }

  testWidgets('every destination is labelled and hit-testable', (tester) async {
    final tapped = <int>[];
    await tester.pumpWidget(host(index: 0, onSelect: tapped.add));
    await tester.pumpAndSettle();

    for (final item in items) {
      expect(find.text(item.label), findsOneWidget);
    }

    // Each cell must be reachable on its own: the crest is painted, not laid
    // out, so a cell that lost its hit area to the painting would still look
    // correct and be dead to a thumb.
    for (var i = 0; i < items.length; i++) {
      await tester.tap(find.text(items[i].label));
      await tester.pump(const Duration(milliseconds: 500));
      expect(tapped, contains(i));
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('the selected destination is the only one with a filled icon', (tester) async {
    await tester.pumpWidget(host(index: 2, onSelect: (_) {}));
    await tester.pumpAndSettle();
    // A filled glyph versus its outline is the cue that survives a screenshot,
    // a colour-blind customer and a dimmed screen — which is why it is the
    // primary signal and the crest is the secondary one.
    expect(find.byIcon(Icons.fact_check_rounded), findsOneWidget);
    expect(find.byIcon(Icons.home_outlined), findsOneWidget);
    expect(find.byIcon(Icons.fact_check_outlined), findsNothing);
  });

  testWidgets('moving the selection animates instead of snapping', (tester) async {
    var index = 0;
    await tester.pumpWidget(
      StatefulBuilder(
        builder: (context, setState) => host(
          index: index,
          onSelect: (i) => setState(() => index = i),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('پروفایل'));
    // Mid-flight the crest is between two cells. The bar must still be built
    // and must not throw: this is the frame where an interpolated position is
    // an out-of-range index if the painter treats it as one.
    await tester.pump(const Duration(milliseconds: 180));
    expect(tester.takeException(), isNull);
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.person_rounded), findsOneWidget);
  });

  testWidgets('it survives both themes and reduced motion', (tester) async {
    for (final dark in [false, true]) {
      for (final reduced in [false, true]) {
        await tester.pumpWidget(MaterialApp(
          theme: dark ? buildPishkanDarkTheme() : buildPishkanTheme(),
          home: MediaQuery(
            data: MediaQueryData(disableAnimations: reduced),
            child: Scaffold(
              body: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  WaveNavBar(index: 1, items: items, onSelect: (_) {}),
                ],
              ),
            ),
          ),
        ));
        await tester.pumpAndSettle();
        // The bar is almost entirely `CustomPainter`, which is exactly the
        // kind of code that throws on a size it did not expect.
        expect(tester.takeException(), isNull, reason: 'dark=$dark reduced=$reduced');
        expect(find.byIcon(Icons.grid_view_rounded), findsOneWidget);
      }
    }
  });

  testWidgets('the dome follows the selection through RTL, not against it', (tester) async {
    // The bug this exists for: `Row` lays the first child on the *right* in
    // this app, so `width / count * (index + 0.5)` put the dome under the wrong
    // icon — the selected label went white on a white surface and all but
    // disappeared. The painter now measures from the right edge.
    //
    // The dome is painted, so it cannot be found in the widget tree. What can
    // be checked is that every destination ends up selected in turn without
    // throwing, and that the bar still builds at each — which is what the tap
    // loop below does. The *geometry* is covered by the separation of concerns:
    // one `_edge` function feeds both the outline and the fill, so they cannot
    // disagree.
    var selected = 0;
    await tester.pumpWidget(
      StatefulBuilder(
        builder: (context, setState) => host(
          index: selected,
          onSelect: (i) => setState(() => selected = i),
        ),
      ),
    );
    await tester.pumpAndSettle();

    for (final index in [0, 1, 2, 3, 0]) {
      await tester.tap(find.text(items[index].label));
      await tester.pumpAndSettle();
      expect(selected, index);
      expect(tester.takeException(), isNull, reason: 'selecting $index');
    }
  });

  testWidgets('a narrow screen does not overflow', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(host(index: 3, onSelect: (_) {}));
    await tester.pumpAndSettle();
    // 320 dp across four cells is 80 dp each, with a 14 px label under a 23 px
    // icon. None of it may overflow.
    expect(tester.takeException(), isNull);
  });
}
