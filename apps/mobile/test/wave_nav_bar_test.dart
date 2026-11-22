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

  testWidgets('destinations run left to right in index order', (tester) async {
    // The layout the app has always had on device: «خانه» (destination 0) on
    // the left, «پروفایل» (3) on the right — one cell apart, in index order.
    // The Persian text inside each cell still runs RTL; it is the *cells*, not
    // the glyphs, that this asserts.
    //
    // This was the crux of four broken releases: the cells were in index order
    // while the dome was mirrored, so the blue curve sat under the destination
    // on the opposite side every time.
    await tester.pumpWidget(host(index: 0, onSelect: (_) {}));
    await tester.pumpAndSettle();

    final bar = tester.getRect(find.byType(WaveNavBar));
    final home = tester.getCenter(find.text('خانه')).dx;
    final profile = tester.getCenter(find.text('پروفایل')).dx;

    expect(home, lessThan(profile), reason: 'destination 0 is the left-most cell');
    expect(home, lessThan(bar.center.dx));
    expect(profile, greaterThan(bar.center.dx));

    // Evenly spread, one quarter of the bar apart, symmetric about the middle.
    final services = tester.getCenter(find.text('خدمات')).dx;
    final follow = tester.getCenter(find.text('پیگیری‌ها')).dx;
    expect(home, lessThan(services));
    expect(services, lessThan(follow));
    expect(follow, lessThan(profile));
    expect(services - home, moreOrLessEquals(follow - services, epsilon: 1.0));
    expect(follow - services, moreOrLessEquals(profile - follow, epsilon: 1.0));
  });

  testWidgets('the dome follows the selection, measured on the curve itself', (tester) async {
    // The dome is painted, so it cannot be found in the widget tree — but the
    // painter's own geometry function can be exercised directly, and it is the
    // same function the cells are positioned with. Asserting on it is what
    // closes the gap between "the four cells look right" and "the blue curve is
    // on top of the one you picked".
    for (final width in [320.0, 390.0, 720.0]) {
      const count = 4;
      for (var index = 0; index < count; index++) {
        final cellLeft = navCellLeft(index, count, width);
        final dome = navDomeCentre(index.toDouble(), count, width);
        // The apex must land inside the cell it belongs to...
        expect(
          dome,
          inInclusiveRange(cellLeft, cellLeft + width / count),
          reason: 'width $width, index $index: dome $dome outside cell $cellLeft',
        );
        // ...exactly on that cell's middle. This is the assertion that matters:
        // three releases shipped with the dome under the wrong icon because
        // nothing checked it, and "it looks right in a mock" is not a check.
        expect(dome, moreOrLessEquals(cellLeft + width / count / 2, epsilon: 0.01));
      }
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
