import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/motion.dart';
import 'package:pishkan_app/core/theme.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/category_card.dart';

/// Why does the home page show a blank band where «دسته‌بندی خدمات» should be?
///
/// The reported screenshot has ~348 px (≈178 dp) of untouched page background
/// between the last popular-service tile and «پشتیبانی و دستیار». That is
/// almost exactly what the category rail occupies (a title plus four 88 dp
/// rows), so the rows are being laid out and painting nothing.
///
/// `CategoryCard` on its own renders correctly — `category_card_test` proves
/// that. The variable the page adds is `ScrollDrivenReveal`, which wraps each
/// section and, until recently, multiplied the whole subtree's opacity. These
/// tests pin down what that wrapper may and may not do to a painted card.
void main() {
  ServiceCategory category(String slug, String title) => ServiceCategory.fromJson({
        'slug': slug,
        'title': title,
        'color': '#15803d',
      });

  /// Everything between the card and the root that could dim or hide it.
  List<String> obscurersAbove(WidgetTester tester, Finder of) {
    final found = <String>[];
    for (final element in find.ancestor(of: of, matching: find.byWidgetPredicate((_) => true)).evaluate()) {
      final widget = element.widget;
      if (widget is Opacity && widget.opacity < 1.0) found.add('Opacity(${widget.opacity})');
      if (widget is ShaderMask) found.add('ShaderMask');
      if (widget is ColorFiltered) found.add('ColorFiltered');
      if (widget is BackdropFilter) found.add('BackdropFilter');
      if (widget is Visibility && !widget.visible) found.add('Visibility(false)');
      if (widget is Offstage && widget.offstage) found.add('Offstage');
      if (widget is FadeTransition && widget.opacity.value < 1.0) {
        found.add('FadeTransition(${widget.opacity.value})');
      }
    }
    return found;
  }

  testWidgets('a card inside a scroll-driven reveal is fully opaque', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: buildPishkanTheme(),
      home: Scaffold(
        body: ListView(
          children: [
            // Push the card below the fold so the reveal's trigger cannot fire.
            const SizedBox(height: 1600),
            ScrollDrivenReveal(
              child: SizedBox(
                height: 88,
                child: Row(children: [
                  Expanded(child: CategoryCard(category: category('housing-land', 'املاک و زمین'), onTap: () {})),
                  const SizedBox(width: 9),
                  Expanded(child: CategoryCard(category: category('tax-services', 'مالیات'), onTap: () {})),
                ]),
              ),
            ),
          ],
        ),
      ),
    ));
    await tester.pump();

    expect(find.byType(CategoryCard), findsNWidgets(2));
    // The whole point: nothing between the card and the page may dim it. A
    // section that is present-but-faint is the bug the customer is reporting.
    expect(obscurersAbove(tester, find.byType(CategoryCard).first), isEmpty,
        reason: 'an unrevealed section must not be dimmed by anything');
  });

  testWidgets('the category rail keeps its geometry under the reveal', (tester) async {
    // The rail's real numbers, taken from `home.dart`: four rows of 88 dp with
    // `sizes.gap` between them.
    const rowHeight = 88.0;
    const gap = 11.0;

    final categories = [
      ['insurance-health', 'بیمه، سلامت و تأمین اجتماعی'],
      ['companies-institutions', 'شرکت‌ها و مؤسسات'],
      ['vehicle-services', 'خودرو و پلاک'],
      ['tax-services', 'مالیات'],
      ['judicial-services', 'خدمات قضایی'],
      ['exams-employment', 'آزمون و استخدام'],
      ['housing-land', 'املاک و زمین'],
      ['banking-services', 'خدمات بانکی'],
    ];

    await tester.pumpWidget(MaterialApp(
      theme: buildPishkanTheme(),
      home: Scaffold(
        body: ListView(children: [
          const SizedBox(height: 1200),
          ScrollDrivenReveal(
            child: Column(children: [
              for (var i = 0; i < categories.length; i += 2) ...[
                if (i > 0) const SizedBox(height: gap),
                SizedBox(
                  height: rowHeight,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(child: CategoryCard(category: category(categories[i][0], categories[i][1]), onTap: () {})),
                      const SizedBox(width: gap),
                      Expanded(child: CategoryCard(category: category(categories[i + 1][0], categories[i + 1][1]), onTap: () {})),
                    ],
                  ),
                ),
              ],
            ]),
          ),
        ]),
      ),
    ));
    await tester.pump();

    // Eight tiles, four rows, and the last row really is four rows down — a
    // collapsed rail would report a total height of one row.
    expect(find.byType(CategoryCard), findsNWidgets(8));
    final cards = find.byType(CategoryCard);
    final firstTop = tester.getRect(cards.at(0)).top;
    final lastTop = tester.getRect(cards.at(6)).top;
    expect(lastTop - firstTop, greaterThan(rowHeight * 3));
    expect(tester.takeException(), isNull);
  });
}
