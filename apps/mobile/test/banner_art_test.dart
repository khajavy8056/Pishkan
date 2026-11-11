import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/widgets/banner_carousel.dart';

/// The rail's artwork is chosen in the app, not sent by the server, so the
/// mapping is the whole feature: a slide whose service is not in the map shows
/// the fallback picture, and five slides with one picture is not a slider.
///
/// These assertions exist because that is exactly what shipped. The map was
/// keyed by *category* slug while a banner's `destinationSlug` is always a
/// *service* slug, so every lookup missed and all five slides fell back to the
/// same hero image. Nothing failed — the rail still rendered, it just rendered
/// the same card five times — which is why it needs a test rather than a
/// reviewer.
void main() {
  AppBanner banner({
    String id = 'b1',
    String slug = '',
    String kind = 'none',
    String imageUrl = '',
  }) =>
      AppBanner.fromJson({
        'id': id,
        'kind': 'service',
        'title': 'یک اسلاید',
        'destinationKind': kind,
        'destinationSlug': slug,
        'imageUrl': imageUrl,
      });

  test('every default slide resolves to its own picture', () {
    const slides = {
      'plate-replacement-appointment': 'assets/banners/slide-vehicles.webp',
      'property-deed-inquiry': 'assets/banners/slide-property.webp',
      'register-llc': 'assets/banners/slide-business.webp',
      'health-insurance-renewal': 'assets/banners/slide-health.webp',
      'smart-national-card-registration': 'assets/banners/slide-identity.webp',
    };
    for (final entry in slides.entries) {
      expect(
        bundledBannerArt(banner(slug: entry.key)),
        entry.value,
        reason: '${entry.key} must not fall back to the hero',
      );
    }
    // Five services, five distinct pictures — the property that was broken.
    final resolved = slides.keys.map((slug) => bundledBannerArt(banner(slug: slug))).toSet();
    expect(resolved, hasLength(5));
  });

  test('a server slide path resolves to the bundled copy of the same subject', () {
    // A manager editing `/images/banners/slide-health.webp` should still get a
    // health-shaped stand-in on the first frame, before the network answers.
    expect(
      bundledBannerArt(banner(kind: 'url', imageUrl: '/images/banners/slide-health.webp')),
      'assets/banners/slide-health.webp',
    );
    // A cache token must not defeat the lookup.
    expect(
      bundledBannerArt(banner(kind: 'url', imageUrl: '/images/banners/slide-vehicles.webp?v=2026')),
      'assets/banners/slide-vehicles.webp',
    );
  });

  test('an unknown slide still gets the app\'s own art, never a blank', () {
    final art = bundledBannerArt(banner(kind: 'url', imageUrl: 'https://example.com/x.jpg'));
    expect(art, defaultBanners['asset']);
    expect(art, isNotEmpty);
  });

  testWidgets('the scrim is densest where the copy sits, on the leading edge', (tester) async {
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('fa', 'IR'),
      home: Scaffold(
        body: SizedBox(
          height: 220,
          child: BannerCarousel(
            banners: [banner(id: 'scrim', slug: 'register-llc')],
            onOpenBanner: (_) {},
          ),
        ),
      ),
    ));

    // The card builds its scrim as a DecoratedBox whose decoration is a
    // LinearGradient. Find the one that covers the whole card by looking for a
    // directional gradient that starts at `centerStart`.
    final gradients = tester
        .widgetList<DecoratedBox>(find.byType(DecoratedBox))
        .map((box) => box.decoration)
        .whereType<BoxDecoration>()
        .map((decoration) => decoration.gradient)
        .whereType<LinearGradient>()
        .toList();

    final scrim = gradients.where((g) => g.begin == AlignmentDirectional.centerStart).toList();
    expect(scrim, hasLength(1), reason: 'the copy scrim must begin at the start edge');

    // In RTL the start edge is the right, which is where the text is laid out.
    // The gradient used to begin at `centerEnd` — the left — so the rail spent
    // its darkness on the empty half of the picture and left white text on the
    // bright subject.
    expect(scrim.single.begin, AlignmentDirectional.centerStart);
    expect(scrim.single.end, AlignmentDirectional.centerEnd);
    // Its first stop is the dark one and it fades to nothing at the far edge.
    // The comparison is against `Colors.transparent` rather than an alpha
    // accessor: `Color.a` only exists on newer Flutter versions, and this test
    // must not be the reason a stable-channel build fails.
    expect(scrim.single.stops, isNotNull);
    expect(scrim.single.colors.last, Colors.transparent);
    expect(scrim.single.colors.first, isNot(Colors.transparent));

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('each slide drifts its own way, and stops when the rail does', (tester) async {
    await tester.pumpWidget(MaterialApp(
      locale: const Locale('fa', 'IR'),
      home: Scaffold(
        body: SizedBox(
          height: 220,
          child: BannerCarousel(
            banners: [
              banner(id: 'one', slug: 'plate-replacement-appointment'),
              banner(id: 'two', slug: 'register-llc'),
            ],
            interval: const Duration(seconds: 30),
            onOpenBanner: (_) {},
          ),
        ),
      ),
    ));

    // Partway through the drift, the visible card is scaled above its resting
    // size. A rail of identical zooms stopped reading as separate slides, so
    // the variant is chosen per card and the scale must actually be applied.
    await tester.pump(const Duration(seconds: 2));
    final scaled = tester
        .widgetList<Transform>(find.byType(Transform))
        .where((t) => (t.transform.storage[0]) > 1.0)
        .toList();
    expect(scaled, isNotEmpty, reason: 'the artwork must drift, not sit still');

    // And it is bounded: a forever-repeating drift is a ticker that never
    // stops, which is both a frame-budget bug and a test-teardown failure.
    // Leaving the tree must cancel it cleanly.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 2));
    expect(tester.takeException(), isNull);
  });
}
