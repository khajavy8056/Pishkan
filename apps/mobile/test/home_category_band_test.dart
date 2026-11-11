import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/category_card.dart';

/// Why is there a blank band where «دسته‌بندی خدمات» should be?
///
/// The screenshots give a precise measurement: 348 px of a single flat colour
/// (18,33,58) across the full width, on a 720 px wide capture of a 360 dp
/// screen — 174 dp. That is *exactly two* rows of the rail (88 dp row + 11 dp
/// gap ≈ 187 dp), which is what the rail collapses to when the images fail to
/// decode: `CategoryArtImage` falls back to `Image.asset`, and when that asset
/// is missing too, its `errorBuilder` produces a 12 dp-padded glyph circle with
/// no background fill. On a dark page that is invisible, so two rows of cards
/// render as two rows of nothing.
///
/// `category_card_test` only ever asserts that the *label text* and the
/// `CategoryArtImage` widget exist, and passes under `flutter test`, where
/// `Image.asset` reports an error instead of drawing. Checking the widget tree
/// therefore cannot see this bug. These tests check pixels.
void main() {
  ServiceCategory category(String slug, String title) => ServiceCategory.fromJson({
        'slug': slug,
        'title': title,
        'color': '#15803d',
      });

  /// Rasterises the widget tree and returns how many pixels differ from
  /// [background]. Anything the card paints — fill, border, art, glyph, label —
  /// counts, so this answers "is the tile visible at all?", not "is it pretty".
  Future<int> paintedPixels(WidgetTester tester, Color background) async {
    final element = tester.binding.rootElement!;
    final image = await captureImage(element);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    expect(bytes, isNotNull);
    final data = bytes!.buffer.asUint8List();
    final bg = <int>[background.red, background.green, background.blue];
    var differing = 0;
    for (var i = 0; i + 3 < data.length; i += 4) {
      final dr = (data[i] - bg[0]).abs();
      final dg = (data[i + 1] - bg[1]).abs();
      final db = (data[i + 2] - bg[2]).abs();
      if (dr + dg + db > 24) differing++;
    }
    return differing;
  }

  const page = Color(0xFF12213A);

  testWidgets('a category tile paints something on a dark page', (tester) async {
    // The tightest box the two-column rail produces on a 360 dp phone.
    tester.view.physicalSize = const Size(360, 200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(),
      home: Scaffold(
        backgroundColor: page,
        body: Center(
          child: SizedBox(
            width: 160,
            height: 88,
            child: CategoryCard(category: category('housing-land', 'املاک و زمین'), onTap: () {}),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    final painted = await paintedPixels(tester, page);
    // An 88 dp tall, 160 dp wide tile is 14 080 dp². Even a card that only draws
    // its own fill and rim covers the whole box; the label alone would be a few
    // hundred pixels. A tile that renders as *nothing* — the reported bug —
    // leaves only the glyph fallback, which is a handful of pixels at best.
    expect(painted, greaterThan(4000),
        reason: 'the tile must paint a surface, not just a glyph on the page');
  });

  testWidgets('two full rows of the rail are visibly painted', (tester) async {
    // Reproduces the reported geometry exactly: the rail is what disappears,
    // and 348 captured px is two 88 dp rows plus the gap between them.
    tester.view.physicalSize = const Size(360, 420);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final pairs = [
      ['companies-institutions', 'شرکت‌ها و مؤسسات'],
      ['insurance-health', 'بیمه، سلامت و تأمین اجتماعی'],
      ['vehicle-services', 'خودرو و پلاک'],
      ['housing-land', 'املاک و زمین'],
    ];

    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(),
      home: Scaffold(
        backgroundColor: page,
        body: Column(children: [
          for (var i = 0; i < pairs.length; i += 2) ...[
            if (i > 0) const SizedBox(height: 11),
            SizedBox(
              height: 88,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: CategoryCard(category: category(pairs[i][0], pairs[i][1]), onTap: () {})),
                  const SizedBox(width: 11),
                  Expanded(child: CategoryCard(category: category(pairs[i + 1][0], pairs[i + 1][1]), onTap: () {})),
                ],
              ),
            ),
          ],
        ]),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.byType(CategoryCard), findsNWidgets(4));
    final painted = await paintedPixels(tester, page);
    // Four tiles at 88 dp in a 360 dp wide column: ~4 x 88 x 174 = 61 000 dp².
    // Requiring a third of that tolerates rounded corners, the gap and the
    // glyph fallback, while a page of invisible tiles paints nearly nothing.
    expect(painted, greaterThan(20000),
        reason: 'the rail must be visible, not an empty band');
  });
}
