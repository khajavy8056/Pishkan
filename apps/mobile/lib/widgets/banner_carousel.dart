import 'dart:async';

import 'package:flutter/material.dart';

import '../core/motion.dart';
import '../core/theme.dart';
import '../models/models.dart';
import 'widgets.dart';

/// The home banner rail.
///
/// This is not the old story row. A story was a circle you tapped to enter a
/// vertical slideshow; a banner is a wide card that carries its own message
/// and, in most cases, its own destination — tapping the «تعویض پلاک» card
/// opens that service, not a gallery. That difference is the whole point of
/// the replacement: fewer taps between the customer and the thing being
/// advertised.
///
/// Layout notes that matter in practice:
///  * The rail is a horizontal list with snapping and a 94% viewport, so the
///    next card peeks in and the row reads as scrollable without an arrow.
///  * Auto-advance pauses while a finger is down and while the user is
///    mid-drag; being yanked away from a card you were reading is the failure
///    mode of every self-advancing carousel.
///  * The timer is stopped when the widget leaves the tree and restarted only
///    when the count changes, so a rebuild from a theme switch never resets
///    the customer's position.
class BannerCarousel extends StatefulWidget {
  const BannerCarousel({
    super.key,
    required this.banners,
    required this.onOpenBanner,
    this.interval = const Duration(seconds: 7),
    this.height = 176,
  });

  final List<AppBanner> banners;
  final void Function(AppBanner banner) onOpenBanner;
  final Duration interval;
  final double height;

  @override
  State<BannerCarousel> createState() => _BannerCarouselState();
}

/// The built-in banner, as an [AppBanner] the rail can render.
///
/// Built here rather than fetched because it is not content: it is the app
/// introducing itself, it never changes between builds, and the first run of a
/// fresh install has no network yet. A server that has published its own
/// banners replaces it entirely — this is what fills the rail when there would
/// otherwise be nothing.
AppBanner builtInBanner() => AppBanner.fromJson(<String, dynamic>{
      'id': '__built_in',
      'kind': 'general',
      'title': defaultBanners['title'],
      'subtitle': defaultBanners['subtitle'],
      'actionLabel': defaultBanners['action'],
      // «شروع کنید» opens the catalogue, not one particular service: it is the
      // first thing a new customer taps, and it should lead to the full list
      // rather than guessing which service they came for. `banner_route.dart`
      // maps this path to the catalogue tab, so the tap stays in the app.
      'destinationKind': 'url',
      'destinationUrl': '/app/services',
    });

class _BannerCarouselState extends State<BannerCarousel> {
  final _controller = PageController(viewportFraction: 0.93);
  Timer? _timer;
  int _page = 0;
  bool _dragging = false;

  /// What the rail actually shows.
  ///
  /// The office's banners when there are any, otherwise the built-in one. This
  /// is a getter rather than a change to the caller so every use of the rail
  /// gets the behaviour, including the notification previews that mount it
  /// directly.
  List<AppBanner> get _items => widget.banners.isEmpty ? [builtInBanner()] : widget.banners;

  int get _count => _items.length;

  @override
  void initState() {
    super.initState();
    _restartTimer();
  }

  @override
  void didUpdateWidget(covariant BannerCarousel old) {
    super.didUpdateWidget(old);
    // Only a different number of banners needs the timer reset. Identity of
    // the list changes on every parent rebuild, which happens on every theme
    // or notification refresh; resetting then would pin the rail to page 0.
    if (old.banners.length != widget.banners.length) {
      if (_page >= _count) _page = 0;
      _restartTimer();
    }
  }

  void _restartTimer() {
    _timer?.cancel();
    if (_count < 2) return;
    _timer = Timer.periodic(widget.interval, (_) {
      if (_dragging || !mounted || !_controller.hasClients) return;
      final next = (_page + 1) % _count;
      _controller.animateToPage(
        next,
        duration: const Duration(milliseconds: 520),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // `_count` is never zero: the built-in banner stands in for an empty list,
    // which is the whole point. The guard is kept for the impossible case so a
    // future change to `_items` cannot silently divide by zero in the timer.
    if (_count == 0) return const SizedBox.shrink();
    return Column(
      children: [
        SizedBox(
          height: widget.height,
          child: NotificationListener<ScrollNotification>(
            onNotification: (n) {
              if (n is ScrollStartNotification) _dragging = true;
              if (n is ScrollEndNotification) _dragging = false;
              return false;
            },
            child: PageView.builder(
              controller: _controller,
              padEnds: false,
              itemCount: _count,
              onPageChanged: (i) => setState(() => _page = i),
              itemBuilder: (context, index) => Padding(
                padding: EdgeInsetsDirectional.only(
                  start: index == 0 ? 0 : 10,
                  end: index == _count - 1 ? 12 : 0,
                ),
                child: BannerCard(
                  banner: _items[index],
                  onTap: () => widget.onOpenBanner(_items[index]),
                ),
              ),
            ),
          ),
        ),
        if (_count > 1) ...[
          const SizedBox(height: 9),
          _Pager(count: _count, index: _page),
        ],
      ],
    );
  }
}

/// Gentle drift for a banner's artwork.
///
/// `dart:ui` cannot play a GIF at this size without shipping thirty megabytes
/// of frames, so the motion here is the kind that costs nothing: the picture
/// creeps outward over about fourteen seconds and rests. That is enough to stop
/// a card reading as a static poster, and it leaves the headline — the thing
/// the customer is meant to read — perfectly still.
///
/// Each slide drifts differently. A single uniform zoom on every card is
/// noticeably mechanical once the rail advances: five pictures doing the same
/// thing stops looking like five slides and starts looking like one slide that
/// changes colour. So the pass is parameterised — how far it travels, from which
/// anchor, and in which direction of the two axes — and the card passes a
/// variant derived from its own identity.
///
/// It is a *bounded* animation on purpose. An earlier version repeated forever,
/// which is a Ticker that never stops: it burns a frame callback for as long as
/// the page is alive, and it makes the widget impossible to test, because a
/// test that ends with the tree still mounted fails on the active ticker. A
/// single pass has none of those problems and looks the same, because nobody
/// watches a banner for fourteen seconds.
///
/// Off under reduced motion, where it would be the only thing moving.
class _KenBurns extends StatefulWidget {
  const _KenBurns({
    required this.child,
    this.seed = 0,
    this.duration = const Duration(milliseconds: 14000),
  });

  final Widget child;

  /// Picks which drift variant this card uses. Stable per card, so the same
  /// slide animates the same way every time it comes back around.
  final int seed;

  final Duration duration;

  @override
  State<_KenBurns> createState() => _KenBurnsState();
}

/// The drift variants, as `(scaleTo, startAlignment)`.
///
/// Every one of them keeps the subject side of the picture — the leading left —
/// inside the frame, and every one is slow enough to read as breathing rather
/// than as movement. The choice is made from the card's seed so the rail never
/// shows the same motion twice in a row.
const _driftVariants = <(double, Alignment)>[
  (1.06, Alignment.center),
  (1.04, Alignment.topLeft),
  (1.07, Alignment.bottomLeft),
  (1.05, Alignment.centerLeft),
];

class _KenBurnsState extends State<_KenBurns> with SingleTickerProviderStateMixin {
  late final AnimationController _drift = AnimationController(
    vsync: this,
    duration: widget.duration,
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (PishkanMotion.reduced(context)) return;
    if (!_drift.isAnimating && _drift.value == 0) {
      // A staggered start so a rail of five cards does not breathe in
      // lockstep, which reads as a rendering fault rather than as life.
      final phase = (widget.seed.abs() % 40) / 100;
      _drift.value = phase.clamp(0.0, 0.35);
      _drift.animateTo(1.0, curve: Curves.easeOutSine);
    }
  }

  @override
  void dispose() {
    // Both, in this order: `dispose` on a controller that is still animating
    // leaves the ticker attached and trips the "Ticker was active when the test
    // ended" failure in any test that tears the tree down mid-drift.
    _drift.stop();
    _drift.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (PishkanMotion.reduced(context)) return widget.child;
    final (scaleTo, start) = _driftVariants[widget.seed.abs() % _driftVariants.length];
    return AnimatedBuilder(
      animation: _drift,
      builder: (_, child) {
        final t = Curves.easeInOut.transform(_drift.value.clamp(0.0, 1.0));
        // Ease from a slightly smaller frame into the variant's own target,
        // anchored away from the copy so the text edge never reveals a seam.
        return Transform.scale(
          scale: 1.0 + (scaleTo - 1.0) * t,
          alignment: start,
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

/// The bundled banner art, keyed by the *service* a banner points at.
///
/// These are drawn as one set — same blue field, same light arch, same floating
/// spheres, and the subject on the leading left so the Persian copy on the
/// right never lands on top of it — so the rail reads as a series of posters
/// for one app rather than as five unrelated images.
///
/// They are also the pictures the server seeds its five default slides with
/// (`/images/banners/slide-*.webp` in the web build), which is what makes the
/// rail instant: the app can paint the right artwork on the very first frame,
/// before the network has answered, and the server's copy then replaces it
/// pixel for pixel. When a manager swaps a slide's picture, the uploaded image
/// wins — see [BannerCard] — so the bundled file never fights the office's
/// choice, it only fills the gap until the real one arrives.
///
/// Keyed by service slug rather than by category: the old map was keyed by
/// category slug, but a banner's `destinationSlug` is always a service
/// (`plate-replacement-appointment`, `register-llc`, …), so every lookup missed
/// and all five slides fell back to the hero. That is why the rail showed the
/// same picture five times.
const bannerArtAssets = <String, String>{
  'plate-replacement-appointment': 'assets/banners/slide-vehicles.webp',
  'vehicle-transfer-tax': 'assets/banners/slide-vehicles.webp',
  'car-insurance-inquiry': 'assets/banners/slide-vehicles.webp',
  'property-deed-inquiry': 'assets/banners/slide-property.webp',
  'register-llc': 'assets/banners/slide-business.webp',
  'business-license-issue': 'assets/banners/slide-business.webp',
  'health-insurance-renewal': 'assets/banners/slide-health.webp',
  'smart-national-card-registration': 'assets/banners/slide-identity.webp',
  'no-criminal-record': 'assets/banners/slide-identity.webp',
};

/// The bundled artwork for a banner, resolved in three steps.
///
/// 1. The service it points at, so a slide about plate replacement always gets
///    the car.
/// 2. The server's own slide path, so a manager who replaced
///    `/images/banners/slide-health.webp` with a new picture still gets *a*
///    bundled stand-in that belongs to the same subject while it loads.
/// 3. The hero, which is the app's own promise rather than somebody else's
///    photograph.
String bundledBannerArt(AppBanner banner) {
  final byService = bannerArtAssets[banner.destinationSlug.trim()];
  if (byService != null) return byService;
  final byPath = banner.imageUrl.split('?').first.split('/').last;
  switch (byPath) {
    case 'slide-vehicles.webp':
      return 'assets/banners/slide-vehicles.webp';
    case 'slide-property.webp':
      return 'assets/banners/slide-property.webp';
    case 'slide-business.webp':
      return 'assets/banners/slide-business.webp';
    case 'slide-health.webp':
      return 'assets/banners/slide-health.webp';
    case 'slide-identity.webp':
      return 'assets/banners/slide-identity.webp';
  }
  return defaultBanners['asset']!;
}

/// The banner shown when the office has not published one.
///
/// The rail used to be empty on a fresh install until an admin uploaded
/// something, which made the top of the home page a blank strip on exactly the
/// first run a customer ever has. This is the app introducing itself.
const defaultBanners = <String, String>{
  'title': 'تک پیشخوان',
  'subtitle': 'همراه شما در دسترسی آسان به خدمات دولتی',
  'action': 'شروع کنید',
  'asset': 'assets/banners/slide-identity.webp',
};

/// A single banner card.
///
/// Public because the admin panel's own preview and the notifications list
/// both reuse it; one widget means one look for "this is a banner".
///
/// The layout follows the reference: the artwork is the full card, the copy
/// sits on the leading (right, in RTL) side over a scrim that is dense enough
/// to carry white 16 px text and then disappears, so the picture is never
/// tinted into a flat navy rectangle. The scrim is the banner's own accent,
/// not a fixed colour — a fixed one made every card look like the same card.
///
/// The picture is the *bundled* art whenever the banner is about a service
/// that has some, and the office's uploaded image only replaces it when one
/// actually arrives. That ordering matters: these illustrations were drawn for
/// this screen at this aspect ratio, while an uploaded one is whatever the
/// manager had, and stretching it under a headline was how the old rail ended
/// up with five cards that each looked accidental.
class BannerCard extends StatelessWidget {
  const BannerCard({super.key, required this.banner, required this.onTap});

  final AppBanner banner;
  final VoidCallback onTap;

  /// The bundled art for this banner, or the hero when there is none.
  String get _asset => bundledBannerArt(banner);

  @override
  Widget build(BuildContext context) {
    final accent = banner.accentColor ?? context.brand;

    return TactileTap(
      onTap: () async => onTap(),
      scale: 0.972,
      hold: const Duration(milliseconds: 120),
      sink: 0.014,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // The artwork, and the drift, as one layer.
            //
            // Two pictures share this box: the bundled illustration, drawn
            // first so the card is never a grey rectangle while the network
            // answers, and the server's picture on top once it has actually
            // decoded. Both live *inside* the drift, which is the part that
            // used to be wrong: the remote image was a sibling of the
            // animation, so the moment the office published a slide the
            // animation was buried under a still photograph and the rail
            // snapped back to being a poster. Stacking them under one
            // transform means whichever picture is visible, it breathes.
            //
            // The drift itself: a still picture filling a 186 dp card is a
            // poster; the same picture easing outward over ~14 s is a
            // *slider*, and it is the cheapest motion this app can have — no
            // frames to ship, no GIF to decode, no battery spent on a video.
            // Deliberately slow and small: anything faster turns a background
            // into a distraction from the copy sitting on top of it. Off under
            // reduced motion, where it would be the one thing moving.
            _KenBurns(
              seed: banner.id.hashCode,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  Image.asset(
                    _asset,
                    fit: BoxFit.cover,
                    filterQuality: FilterQuality.medium,
                    errorBuilder: (_, _, _) => DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: AlignmentDirectional.topStart,
                          end: AlignmentDirectional.bottomEnd,
                          colors: [accent, Color.alphaBlend(accent.withOpacity(0.55), const Color(0xFF22D3EE))],
                        ),
                      ),
                    ),
                  ),
                  // Only once it has actually decoded, so it never covers the
                  // artwork with a blank rectangle.
                  if (banner.hasImage) AuthImageOrNothing(url: banner.imageCacheKey),
                ],
              ),
            ),
            // The scrim. It reaches full strength only under the text block;
            // the artwork keeps its own colour.
            //
            // `begin: centerStart` matters and is easy to get backwards: the
            // copy is laid out at `CrossAxisAlignment.start`, which in Persian
            // is the **right** edge, and `AlignmentDirectional.centerStart` is
            // the right edge in RTL. This gradient used to begin at
            // `centerEnd` — the left — so the rail spent its darkness on the
            // empty half of the picture and left white 19 px text sitting on
            // the bright subject. It looked like a styling mistake because it
            // was one.
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: AlignmentDirectional.centerStart,
                  end: AlignmentDirectional.centerEnd,
                  colors: [
                    Color.alphaBlend(Colors.black.withOpacity(0.50), accent),
                    Color.alphaBlend(Colors.black.withOpacity(0.34), accent),
                    Color.alphaBlend(Colors.black.withOpacity(0.10), accent),
                    Colors.transparent,
                  ],
                  // Fade out *early*.
                  //
                  // The copy only occupies the right ~58% of the card, but the
                  // previous stops ([0, .42, .74, 1]) kept a tinted wash across
                  // the illustration's side too — the health slide's cross came
                  // out ghosted behind a teal film, and the plate slide lost
                  // most of its colour. A banner whose picture is covered is a
                  // coloured rectangle.
                  //
                  // These stops are measured off the copy instead: held to 0.44
                  // (fully under the text), then dropped quickly through 0.70 so
                  // that by three quarters of the way across the gradient is
                  // gone and the artwork is exactly its own colours. The last
                  // quarter is completely clear, which is the part the eye
                  // reads as "the picture".
                  stops: const [0, 0.44, 0.70, 0.84],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    banner.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                      height: 1.42,
                      shadows: [Shadow(color: Color(0x66000000), blurRadius: 12)],
                    ),
                  ),
                  if (banner.subtitle.isNotEmpty) ...[
                    const SizedBox(height: 7),
                    Text(
                      banner.subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.92),
                        fontSize: 12,
                        height: 1.7,
                        shadows: const [Shadow(color: Color(0x59000000), blurRadius: 10)],
                      ),
                    ),
                  ],
                  if (banner.destinationKind != 'none') ...[
                    const SizedBox(height: 14),
                    _BannerAction(accent: accent, label: banner.actionLabel),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The white pill under a banner's subtitle.
///
/// Split out so the card's build stays a readable list of layers, and so the
/// glow can be tuned in one place: the pill sits on a photograph, and a neutral
/// shadow alone leaves it looking pasted on.
class _BannerAction extends StatelessWidget {
  const _BannerAction({required this.accent, required this.label});

  final Color accent;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(999),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.20), blurRadius: 10, offset: const Offset(0, 4)),
          BoxShadow(color: accent.withOpacity(0.34), blurRadius: 18, offset: const Offset(0, 8)),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(color: accent, fontSize: 12, fontWeight: FontWeight.w800),
          ),
          const SizedBox(width: 3),
          Icon(Icons.arrow_back_rounded, size: 15, color: accent),
        ],
      ),
    );
  }
}

/// Pager under the rail: the current banner is a wide pill, the rest are
/// dots. A row of identical dots at this size is hard to count; the stretched
/// current one tells you where you are at a glance.
class _Pager extends StatelessWidget {
  const _Pager({required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < count; i++)
          AnimatedContainer(
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
            margin: const EdgeInsets.symmetric(horizontal: 3),
            width: i == index ? 20 : 7,
            height: 7,
            decoration: BoxDecoration(
              color: i == index ? context.brand : context.inkMuted.withOpacity(0.42),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
      ],
    );
  }
}
