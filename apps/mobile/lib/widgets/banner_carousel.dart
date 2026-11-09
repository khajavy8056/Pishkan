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

class _BannerCarouselState extends State<BannerCarousel> {
  final _controller = PageController(viewportFraction: 0.93);
  Timer? _timer;
  int _page = 0;
  bool _dragging = false;

  int get _count => widget.banners.length;

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
      if (_page >= widget.banners.length) _page = 0;
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
                  banner: widget.banners[index],
                  onTap: () => widget.onOpenBanner(widget.banners[index]),
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

/// A single banner card.
///
/// Public because the admin panel's own preview and the notifications list
/// both reuse it; one widget means one look for "this is a banner".
class BannerCard extends StatelessWidget {
  const BannerCard({super.key, required this.banner, required this.onTap});

  final AppBanner banner;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final accent = banner.accentColor ?? context.brand;
    // A banner with no photo of its own still has to look deliberate, so the
    // fallback is a brand-tinted gradient, not a grey box.
    final fallback = LinearGradient(
      begin: AlignmentDirectional.topStart,
      end: AlignmentDirectional.bottomEnd,
      colors: [accent, Color.lerp(accent, const Color(0xFF0B1F3A), 0.55)!],
    );

    return PressableScale(
      onTap: onTap,
      scale: 0.975,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (banner.hasImage)
              AuthImage(url: banner.imageCacheKey)
            else
              DecoratedBox(decoration: BoxDecoration(gradient: fallback)),
            // The scrim is horizontal rather than uniform: the copy sits on
            // the leading edge, so the picture on the trailing edge keeps its
            // detail instead of being flattened by a full-card overlay.
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [Color(0xE60A1B33), Color(0x990A1B33), Color(0x000A1B33)],
                  stops: [0, 0.58, 1],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.20),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: Colors.white.withOpacity(0.30)),
                    ),
                    child: Text(
                      banner.badge,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    banner.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      height: 1.45,
                      shadows: [Shadow(color: Color(0x80000000), blurRadius: 10)],
                    ),
                  ),
                  if (banner.subtitle.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      banner.subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.90),
                        fontSize: 11.5,
                        height: 1.65,
                      ),
                    ),
                  ],
                  if (banner.destinationKind != 'none') ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.95),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            banner.actionLabel,
                            style: TextStyle(
                              color: accent,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(width: 2),
                          Icon(Icons.chevron_left_rounded, size: 15, color: accent),
                        ],
                      ),
                    ),
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
