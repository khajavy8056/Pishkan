import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/category_card.dart';

/// The home page's category grid renders as a blank region on a real device.
///
/// These tests do not reproduce the report — they narrow it. The grid lays out
/// two columns of fixed-height rows, and if the tile's artwork cannot decode,
/// `CategoryArtImage` falls back to a *glyph*, which must still be visible. A
/// tile that draws nothing at all would leave the row's height allocated and
/// paint the page colour, which is exactly what the screenshot shows: 162 dp
/// of untouched background between the section title and the support card.
void main() {
  ServiceCategory category(String slug, String title) => ServiceCategory.fromJson({
        'slug': slug,
        'title': title,
        'color': '#15803d',
      });

  /// The tile must always paint *something* — a fill, a border and either the
  /// bundled picture or the glyph fallback.
  testWidgets('a category tile never renders as empty space', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(),
      home: MediaQuery(
        data: const MediaQueryData(devicePixelRatio: 2, size: Size(360, 760)),
        child: Scaffold(
          backgroundColor: const Color(0xFF12213A),
          body: Center(
            child: SizedBox(
              width: 160,
              height: 81,
              child: CategoryCard(category: category('housing-land', 'املاک و زمین'), onTap: () {}),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(CategoryCard), findsOneWidget);
    expect(tester.takeException(), isNull);

    // The art slot is always occupied, even if the asset fails to decode here.
    expect(find.byType(CategoryArtImage), findsOneWidget);
    // And the label is always laid out.
    expect(find.text('املاک و زمین'), findsOneWidget);
  });

  /// Reproduces the real geometry: eight categories in a two-column grid of
  /// 81 dp rows, which is four rows and 324 dp of content.
  testWidgets('an eight-tile grid occupies its full height', (tester) async {
    const gap = 9.0;
    const rowHeight = 81.0;
    final slugs = [
      ['insurance-health', 'بیمه، سلامت و تأمین اجتماعی'],
      ['companies-institutions', 'شرکت‌ها و مؤسسات'],
      ['subsidy-welfare', 'یارانه و رفاه'],
      ['vehicle-services', 'خودرو و پلاک'],
      ['tax-services', 'مالیات'],
      ['judicial-services', 'خدمات قضایی'],
      ['exams-employment', 'آزمون و استخدام'],
      ['housing-land', 'املاک و زمین'],
    ];

    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(),
      home: Scaffold(
        backgroundColor: const Color(0xFF12213A),
        body: ListView(
          children: [
            Column(children: [
              for (var i = 0; i < slugs.length; i += 2) ...[
                if (i > 0) const SizedBox(height: gap),
                SizedBox(
                  height: rowHeight,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(child: CategoryCard(category: category(slugs[i][0], slugs[i][1]), onTap: () {})),
                      const SizedBox(width: gap),
                      Expanded(child: CategoryCard(category: category(slugs[i + 1][0], slugs[i + 1][1]), onTap: () {})),
                    ],
                  ),
                ),
              ],
            ]),
          ],
        ),
      ),
    ));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // Eight distinct titles, all laid out — nothing silently dropped.
    for (final entry in slugs) {
      expect(find.text(entry[1]), findsOneWidget, reason: '${entry[0]} must be laid out');
    }
    // Heights add up to the geometry the screenshot shows.
    final last = tester.getRect(find.text(slugs[7][1]));
    expect(last.bottom, greaterThan(gap * 3 + rowHeight * 4 - 40));
  });
}
