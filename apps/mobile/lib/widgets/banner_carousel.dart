import 'dart:async';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/models.dart';
import 'widgets.dart';

/// The home banner rail: wide, auto-advancing cards that replace the old
/// circular story row.
///
/// Why a rail and not a page view of full-width slides: the approved mockup
/// shows one banner with a page indicator under it, but a page view inside a
/// scrolling list fights the vertical drag and swallows horizontal ones. This
/// is a horizontal list with snapping and a pager clamp — it scrolls under the
/// thumb, advances itself on a timer when nobody is touching it, and stops
/// while a finger is down so it never yanks the card away mid-read.
///
/// A banner carries an optional [destinationSlug]. When it has one, tapping
/// goes straight to that service — a banner advertising «ثبت شرکت» that lands
/// on the generic services list is the usual failure of these rails. Without
/// one, it opens the story viewer as before, so existing notices keep working.
class BannerCarousel extends StatefulWidget {
  const BannerCarousel({
    super.key,
    required this.groups,
    required this.onOpenGroup,
    required this.onOpenService,
    this.seen,
    this.interval = const Duration(seconds: 6),
    this.height = 168,
  });

  final List<StoryGroup> groups;
  final void Function(int groupIndex) onOpenGroup;
  final void Function(String slug) onOpenService;
  /// Fingerprints already read, so the rail can mark the unread ones.
  final Set<String>? seen;
  final Duration interval;
  final double height;

  @override
  State<BannerCarousel> createState() => _BannerCarouselState();
}

class _BannerCarouselState extends State<BannerCarousel> {
  final _controller = PageController(viewportFraction: 0.94);
  Timer? _timer;
  int _page = 0;
  bool _dragging = false;

  int get _count => widget.groups.length;

  @override
  void initState() {
    super.initState();
    _restartTimer();
  }

  @override
  void didUpdateWidget(covariant BannerCarousel old) {
    super.didUpdateWidget(old);
    if (old.groups.length != widget.groups.length) {
      _page = 0;
      _restartTimer();
    }
  }

  void _restartTimer() {
    _timer?.cancel();
    if (_count < 2) return;
    _timer = Timer.periodic(widget.interval, (_) {
      // Never move the rail out from under a finger that is scrolling it.
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

  String _fingerprint(StoryGroup group) =>
      '${group.title}|${group.items.isEmpty ? '' : group.items.last.id}|${group.items.length}';

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
                child: _BannerCard(
                  group: widget.groups[index],
                  unread: widget.seen == null || !widget.seen!.contains(_fingerprint(widget.groups[index])),
                  onTap: () {
                    final slug = _destinationOf(widget.groups[index]);
                    if (slug.isNotEmpty) {
                      widget.onOpenService(slug);
                    } else {
                      widget.onOpenGroup(index);
                    }
                  },
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

  /// A banner that points at a service names it in its link field, which the
  /// story model already carries: `pishkan://service/<slug>` or the plain
  /// in-app path `/services/<slug>`. Anything else is treated as "no
  /// destination" and the ordinary viewer opens.
  String _destinationOf(StoryGroup group) {
    if (group.items.isEmpty) return '';
    final link = group.items.first.linkUrl.trim();
    if (link.isEmpty) return '';
    final match = RegExp(r'(?:pishkan://service/|/services/)([a-z0-9\-]+)').firstMatch(link);
    return match?.group(1) ?? '';
  }
}

class _BannerCard extends StatelessWidget {
  const _BannerCard({required this.group, required this.unread, required this.onTap});

  final StoryGroup group;
  final bool unread;
  final VoidCallback onTap;

  String get _cover {
    for (final item in group.items) {
      if (!item.isVideo && item.effectiveMediaUrl.isNotEmpty) return item.effectiveMediaUrl;
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final dark = context.isDark;
    final first = group.items.isEmpty ? null : group.items.first;
    final title = first == null || first.title.isEmpty ? group.title : first.title;
    final caption = first?.caption ?? '';

    return PressableScale(
      onTap: onTap,
      scale: 0.975,
      radius: BorderRadius.circular(24),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (_cover.isNotEmpty)
              AuthImage(url: _cover)
            else
              const DecoratedBox(decoration: BoxDecoration(gradient: PishkanColors.brandGradient)),
            // A scrim under the text, not a flat overlay: the copy stays
            // readable over any photo, in either theme.
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [Color(0xD90A1B33), Color(0x660A1B33), Color(0x000A1B33)],
                  stops: [0, 0.55, 1],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (unread)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.22),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: Colors.white.withOpacity(0.3)),
                      ),
                      child: const Row(mainAxisSize: MainAxisSize.min, children: [
                        Icon(Icons.fiber_new_rounded, size: 13, color: Colors.white),
                        SizedBox(width: 3),
                        Text('جدید', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700)),
                      ]),
                    ),
                  Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      height: 1.5,
                      shadows: [Shadow(color: Color(0x66000000), blurRadius: 8)],
                    ),
                  ),
                  if (caption.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      caption,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: Colors.white.withOpacity(0.88), fontSize: 11.5, height: 1.7),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(dark ? 0.9 : 0.95),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('مشاهده', style: TextStyle(color: PishkanColors.primary, fontSize: 11, fontWeight: FontWeight.w800)),
                      Icon(Icons.chevron_left_rounded, size: 15, color: PishkanColors.primary),
                    ]),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Three-note pager: the current banner is a wide pill, the rest are dots.
/// A row of identical dots at this size is hard to count; the stretched
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
