import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/category_card.dart';

void main() {
  test('bundled category art is distinct and manager images take precedence', () {
    expect(categoryArtAssets.length, 15);
    expect(categoryArtAssets.keys.toSet(), {
      'insurance-health', 'companies-institutions', 'subsidy-welfare', 'vehicle-services',
      'tax-services', 'judicial-services', 'exams-employment', 'housing-land', 'banking-services',
      'police-services', 'university-students', 'business-licenses', 'school-services', 'consulting', 'other-services',
    });
    expect(categoryArtAssets.values.toSet().length, categoryArtAssets.length);
    final category = ServiceCategory.fromJson({
      'slug': 'housing-land', 'title': 'مسکن و زمین',
      'image': '/uploads/public/custom.webp', 'icon': '/uploads/public/icon.webp',
    });
    expect(categoryRemoteImage(category), '/uploads/public/custom.webp');
    final oldDefault = ServiceCategory.fromJson({'slug': 'housing-land', 'image': '/images/categories/housing.svg'});
    expect(categoryRemoteImage(oldDefault), isEmpty);
    final iconFallback = ServiceCategory.fromJson({'slug': 'new-category', 'icon': '/uploads/public/icon.webp'});
    expect(categoryRemoteImage(iconFallback), '/uploads/public/icon.webp');
  });

  testWidgets('all default categories bundle different readable image files', (tester) async {
    final distinct = <String>{};
    for (final path in categoryArtAssets.values) {
      final bytes = await rootBundle.load(path);
      expect(bytes.lengthInBytes, greaterThan(100));
      distinct.add(base64Encode(bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes)));
    }
    expect(distinct.length, categoryArtAssets.length);
  });

  testWidgets('category card renders real RTL title and accepts a tap', (tester) async {
    var taps = 0;
    final category = ServiceCategory.fromJson({'slug': 'housing-land', 'title': 'مسکن و زمین', 'color': '#15803d'});
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: SizedBox(
      width: 160, height: 95, child: CategoryCard(category: category, onTap: () => taps++),
    )))));
    await tester.pumpAndSettle();
    expect(find.text('مسکن و زمین'), findsOneWidget);
    expect(find.byType(CategoryArtImage), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byType(CategoryCard));
    // The tap is deliberately *not* instant: `TactileTap` holds the pressed
    // state for ~120 ms before it calls `onTap`, so the customer sees the card
    // dip before the next page covers it. Asserting the callback fires on the
    // same frame would lock in the dead-feeling behaviour this replaced.
    expect(taps, 0);
    await tester.pumpAndSettle();
    expect(taps, 1);
    // 160x95 is the tightest box the home grid can produce (two columns on a
    // small phone). Any RenderFlex overflow at this size is a real bug on a
    // real device, and it is reported as an exception rather than a test
    // failure, so it has to be asserted explicitly.
    expect(tester.takeException(), isNull);
  });

  testWidgets('category card survives a narrow box and a large text scale', (tester) async {
    final category = ServiceCategory.fromJson({'slug': 'housing-land', 'title': 'مسکن و زمین و املاک'});
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
        child: Scaffold(body: Center(child: SizedBox(
          width: 132, height: 88, child: CategoryCard(category: category, onTap: () {}),
        ))),
      ),
    ));
    await tester.pumpAndSettle();
    // A card that only lays out at one width is not a card; the label is
    // allowed to truncate, but nothing may overflow.
    expect(tester.takeException(), isNull);
  });

  testWidgets('new categories use a vector fallback and support dark surfaces', (tester) async {
    final category = ServiceCategory.fromJson({'slug': 'new-identity-category', 'title': 'کارت ملی'});
    await tester.pumpWidget(MaterialApp(theme: ThemeData.dark(), home: Scaffold(body: SizedBox(
      width: 160, height: 110, child: CategoryCard(category: category, onTap: () {}),
    ))));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.badge_rounded), findsOneWidget);
    expect(find.text('کارت ملی'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
