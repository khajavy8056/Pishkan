import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/category_card.dart';

/// A category with no usable picture must still look like a tile.
///
/// This is the blank-band bug on the home page. `CategoryArtImage` falls back
/// to `_icon` when the bundled art is missing or the admin's image cannot be
/// fetched — which is the normal case for any category the office adds, since
/// the fifteen bundled pictures are keyed by the fifteen seeded slugs.
///
/// The fallback used to be `Container(color: accent.withOpacity(.08), child:
/// circle with 12 px padding)`. Two defects compounded:
///
///  * 8% of an accent over a navy page is (26,43,71) against a page of
///    (18,33,58) — a difference no one can see;
///  * with no explicit size the box took its size from the 28 px icon plus
///    padding, so most of the picture area stayed page-coloured.
///
/// A whole rail of those reads as an empty band, which is exactly what was
/// reported. These tests pin the fill.
void main() {
  ServiceCategory unknownCategory() => ServiceCategory.fromJson({
        // Deliberately not one of the fifteen bundled slugs.
        'slug': 'office-added-category',
        'title': 'دستهٔ تازه',
        'color': '#15803d',
      });

  testWidgets('the glyph fallback fills the picture area it is given', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(),
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 160,
            height: 60,
            child: CategoryArtImage(category: unknownCategory()),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    // The fallback's outermost box is the tinted well; it must occupy the whole
    // slot, not shrink-wrap the glyph.
    final well = find.descendant(
      of: find.byType(CategoryArtImage),
      matching: find.byType(Container),
    ).first;
    final size = tester.getSize(well);
    expect(size.width, 160, reason: 'the well must span the tile');
    expect(size.height, 60, reason: 'the well must span the tile');

    // And it must actually be a fill, not a transparent box.
    final decoration = tester.widget<Container>(well).decoration;
    expect(decoration, isNull, reason: 'the well uses `color`, checked next');
    expect(tester.widget<Container>(well).color, isNotNull,
        reason: 'the fallback must paint a surface, not leave the page showing');
  });

  testWidgets('the fallback paints a colour that stands out from the page', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: ThemeData.dark(),
      home: Scaffold(
        body: Center(
          child: SizedBox(
            width: 160,
            height: 60,
            child: CategoryArtImage(category: unknownCategory()),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    final well = find.descendant(
      of: find.byType(CategoryArtImage),
      matching: find.byType(Container),
    ).first;
    final fill = tester.widget<Container>(well).color!;

    // The dark page is #12213A. A tile whose well is within a rounding error of
    // the page is the bug; require a real difference in lightness.
    const page = Color(0xFF12213A);
    double luma(Color c) => 0.2126 * ((c.value >> 16) & 0xFF) +
        0.7152 * ((c.value >> 8) & 0xFF) +
        0.0722 * (c.value & 0xFF);
    expect((luma(fill) - luma(page)).abs(), greaterThan(6),
        reason: 'the well was 8% accent before — indistinguishable from the page');
  });
}
