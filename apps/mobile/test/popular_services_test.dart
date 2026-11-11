import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/theme.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/popular_services.dart';

/// The «خدمات محبوب» grid used to be able to occupy space without drawing in
/// it, which is what an unexplained blank band under it looks like. These tests
/// pin the property that matters: **the section is exactly as tall as what it
/// paints, in every state**.
///
/// `GridView` could not promise that — its row height came from
/// `childAspectRatio`, so the height it reserved and the height its contents
/// needed were two independent numbers that only sometimes agreed.
void main() {
  CatalogService service(int i, {String? title}) => CatalogService.fromJson({
        'id': 'svc-$i',
        'slug': 'svc-$i',
        'title': title ?? 'خدمت شمارهٔ $i',
        'popular': true,
      });

  Widget host(Widget child) => MaterialApp(
        theme: buildPishkanTheme(),
        home: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: child,
          ),
        ),
      );

  testWidgets('eight services lay out in exactly two rows', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(host(PopularServicesSection(
      services: [for (var i = 0; i < 8; i++) service(i)],
      loading: false,
      onOpenService: (_) {},
    )));
    await tester.pump();

    expect(tester.takeException(), isNull);

    final section = tester.getSize(find.byType(PopularServicesSection));
    // Four columns across 328 dp of content => ~75 dp tiles.
    final tiles = find.byType(SizedBox);
    expect(tiles.evaluate().isNotEmpty, isTrue);

    // The decisive property: the last tile ends inside the section, so the
    // section is not taller than what it paints.
    final sectionRect = tester.getRect(find.byType(PopularServicesSection));
    final heroes = find.byType(Hero);
    expect(heroes.evaluate().length, 8);
    final lastBottom = tester.getRect(heroes.at(7)).bottom;
    expect(lastBottom, lessThanOrEqualTo(sectionRect.bottom + 0.5),
        reason: 'a tile must never overflow the section and fake a gap');
    // And it must not fall short either: the section's bottom is the label
    // band's bottom, not a reserved empty strip.
    expect(sectionRect.bottom - lastBottom, lessThan(40),
        reason: 'the section must end just under its last label, not leave slack');
    expect(section.height, greaterThan(0));
  });

  testWidgets('an empty catalogue shows one line, not a grid-shaped hole', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(host(PopularServicesSection(
      services: const [],
      loading: false,
      onOpenService: (_) {},
    )));
    await tester.pump();

    // One message, and a height that is that message — not the 200 dp a grid
    // would have reserved.
    expect(find.textContaining('فهرست خدمات در دسترس نیست'), findsOneWidget);
    expect(tester.getSize(find.byType(PopularServicesSection)).height, lessThan(80),
        reason: 'an empty state must not reserve a grid');
  });

  testWidgets('a long title cannot make a tile taller than its cell', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(host(PopularServicesSection(
      services: [
        service(0, title: 'ثبت شرکت با مسئولیت محدود و اخذ کد اقتصادی و مالیات بر ارزش افزوده'),
        service(1),
        service(2),
        service(3),
      ],
      loading: false,
      onOpenService: (_) {},
    )));
    await tester.pump();

    expect(tester.takeException(), isNull,
        reason: 'an over-long title must be clipped, not overflow the tile');
    // The section's height is the same as it would be for short titles.
    final withLongTitle = tester.getSize(find.byType(PopularServicesSection)).height;
    await tester.pumpWidget(host(PopularServicesSection(
      services: [for (var i = 0; i < 4; i++) service(i)],
      loading: false,
      onOpenService: (_) {},
    )));
    await tester.pump();
    final withShortTitles = tester.getSize(find.byType(PopularServicesSection)).height;
    expect(withLongTitle, closeTo(withShortTitles, 0.5),
        reason: 'label length must not change the height the section claims');
  });

  testWidgets('five services fill two rows, and the section is sized for two', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(host(PopularServicesSection(
      services: [for (var i = 0; i < 5; i++) service(i)],
      loading: false,
      onOpenService: (_) {},
    )));
    await tester.pump();

    final five = tester.getSize(find.byType(PopularServicesSection)).height;
    await tester.pumpWidget(host(PopularServicesSection(
      services: [for (var i = 0; i < 4; i++) service(i)],
      loading: false,
      onOpenService: (_) {},
    )));
    await tester.pump();
    final four = tester.getSize(find.byType(PopularServicesSection)).height;

    expect(five, greaterThan(four),
        reason: 'a fifth tile starts a second row and must be accounted for');
  });

  testWidgets('a skeleton is the same height as the grid it replaces', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(host(PopularServicesSection(
      services: const [],
      loading: true,
      onOpenService: (_) {},
    )));
    await tester.pump(const Duration(milliseconds: 50));
    final skeleton = tester.getSize(find.byType(PopularServicesSection)).height;

    await tester.pumpWidget(host(PopularServicesSection(
      services: [for (var i = 0; i < 8; i++) service(i)],
      loading: false,
      onOpenService: (_) {},
    )));
    await tester.pump();
    final loaded = tester.getSize(find.byType(PopularServicesSection)).height;

    // Yes, similar — the point is that the page does not jump when data lands.
    expect(skeleton, closeTo(loaded, 2),
        reason: 'the loading state must occupy the same space as the content');
  });
}
