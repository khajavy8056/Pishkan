// Temporary: names the failing case instead of counting it.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/category_card.dart';

void main() {
  testWidgets('probe: card at 160x95 with a tap', (tester) async {
    var taps = 0;
    final category = ServiceCategory.fromJson({'slug': 'housing-land', 'title': 'مسکن و زمین', 'color': '#15803d'});
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Center(child: SizedBox(
      width: 160, height: 95, child: CategoryCard(category: category, onTap: () => taps++),
    )))));
    await tester.pumpAndSettle();
    debugPrint('::error::PROBE_1_mount exc=${tester.takeException() ?? "none"}');
    await tester.tap(find.byType(CategoryCard));
    debugPrint('::error::PROBE_2_tapped taps=$taps');
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump();
    debugPrint('::error::PROBE_3_after_hold taps=$taps exc=${tester.takeException() ?? "none"}');
  });

  testWidgets('probe: card at 132x88 scale 1.3', (tester) async {
    final category = ServiceCategory.fromJson({'slug': 'housing-land', 'title': 'مسکن و زمین و املاک'});
    await tester.pumpWidget(MaterialApp(home: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
      child: Scaffold(body: Center(child: SizedBox(
        width: 132, height: 88, child: CategoryCard(category: category, onTap: () {}),
      ))),
    )));
    await tester.pumpAndSettle();
    debugPrint('::error::PROBE_4_narrow exc=${tester.takeException() ?? "none"}');
  });
}
