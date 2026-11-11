import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/motion.dart';
import '../core/service_icons.dart';
import '../core/sizes.dart';
import '../core/stages.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/avatar.dart';
import '../widgets/banner_carousel.dart';
import '../widgets/banner_route.dart';
import '../widgets/category_card.dart';
import '../widgets/screen_header.dart';
import '../widgets/widgets.dart';
import 'assistant.dart';
import 'documents.dart';
import 'notifications.dart';
import 'profile.dart';
import 'request_detail.dart';
import 'service_detail.dart';
import 'services_catalog.dart';
import 'support.dart';

/// Customer dashboard (approved design): greeting + bell, search, banner
/// rail, blue hero, quick access tiles, popular services with per-service
/// icons and the latest requests with stage progress.
class HomeTab extends StatefulWidget {
  const HomeTab({super.key, required this.onOpenTab, required this.unreadCount, required this.onNotificationsChanged});

  final void Function(int index) onOpenTab;
  final int unreadCount;
  final VoidCallback onNotificationsChanged;

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> {
  AppConfig? _config;
  List<AppBanner> _banners = [];
  List<CatalogService> _services = [];
  List<ServiceCategory> _categories = [];
  Map<String, dynamic> _achievements = {};
  List<ServiceRequestSummary> _recent = [];
  bool _loadingServices = true;

  @override
  void initState() {
    super.initState();
    _load();
    fetchMe().then((_) { if (mounted) setState(() {}); }).catchError((_) {});
  }

  Future<void> _load() async {
    // Paint the last good requests immediately, even before the network
    // answers — the dashboard should never feel stuck.
    final cachedRecent = await cachedMyRequests();
    if (mounted && cachedRecent != null && cachedRecent.items.isNotEmpty) {
      setState(() => _recent = cachedRecent.items);
    }
    // Independent requests update their own sections as soon as they finish.
    await Future.wait([
      fetchAppConfig().then((config) {
        if (mounted) setState(() => _config = config);
      }),
      fetchBanners().then((banners) {
        if (mounted) setState(() => _banners = banners);
      }),
      fetchServices().then((services) {
        if (mounted) setState(() { _services = services; _loadingServices = false; });
      }).catchError((_) { if (mounted) setState(() => _loadingServices = false); }),
      fetchCategories().then((categories) {
        if (mounted) setState(() => _categories = categories);
      }).catchError((_) {}),
      fetchPublicAchievements().then((data) {
        if (mounted) setState(() => _achievements = data);
      }),
      fetchMyRequests().then((result) {
        if (mounted) setState(() => _recent = result.items);
      }).catchError((_) { /* Preserve the cached requests. */ }),
    ]);

  }

  /// Wraps each entry in a scroll-triggered reveal, staggering siblings.
  ///
  /// The page is built as one flat list of mixed content — a carousel, a hero,
  /// a title, a rail — so there is no single "section" widget to hang a trigger
  /// on. This wraps every entry, which gives each one its own trigger and lets
  /// the ones that come after an anchor element inherit its delay.
  ///
  /// Spacer entries (`SizedBox`) are deliberately *not* wrapped: animating a
  /// gap does nothing visible and would waste a ticker per gap on a page with
  /// a dozen of them.
  List<Widget> scrollRevealed(List<Widget> entries) {
    final out = <Widget>[];
    var slot = 0;
    for (final entry in entries) {
      if (entry is SizedBox) {
        out.add(entry);
        continue;
      }
      // 45ms per visible slot, capped: by the fifth element the stagger stops
      // growing, or the last card on a long scroll would wait two seconds.
      final delay = Duration(milliseconds: (slot * 45).clamp(0, 220));
      out.add(
        ScrollDrivenReveal(
          delay: delay,
          // Rails are wide, so a large vertical offset reads as a jump; a
          // single tile can afford to travel further.
          offset: entry is BannerCarousel ? 18 : 26,
          child: entry,
        ),
      );
      slot++;
    }
    return out;
  }

  /// Tapping a banner always does the same thing, wherever it is shown: hand
  /// it to the one resolver that knows how to turn a destination into a route.
  Future<void> _openBanner(AppBanner banner) =>
      openBannerDestination(context, banner, loadServices: () async => _services.isNotEmpty ? _services : await fetchServices());

  String get _firstName {
    final name = asStr((session.user ?? const {})['fullName']).trim();
    return name.isEmpty ? '' : name.split(' ').first;
  }

  List<CatalogService> get _popular {
    final flagged = _services.where((s) => s.popular).toList();
    final rest = _services.where((s) => !s.popular).toList();
    return [...flagged, ...rest].take(8).toList();
  }

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final brand = _config?.brandName.isNotEmpty == true ? _config!.brandName : 'تک پیشخوان';
    return HeaderScaffold(
      header: Column(children: [
        _header(brand, unread: widget.unreadCount),
        _searchBar(),
      ]),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(16), sizes.gutter, sizes.navPillClearance(context)),
          children: [
              if (asMap((session.user ?? const {})['profileState'])['complete'] == false) ...[
                SoftCard(
                  onTap: () async {
                    await Navigator.push(context, fadeThroughRoute(const EditProfileScreen()));
                    if (mounted) setState(() {});
                  },
                  child: Row(children: [
                    Icon(Icons.person_pin_circle_outlined, color: PishkanColors.warning, size: sizes.s(22)),
                    SizedBox(width: sizes.s(10)),
                    Expanded(child: Text('برای ثبت درخواست، مشخصات و شهر خود را تکمیل کنید.', style: TextStyle(fontSize: sizes.caption, color: context.ink))),
                    Icon(Icons.chevron_left_rounded, size: sizes.s(20), color: context.inkMuted),
                  ]),
                ),
                SizedBox(height: sizes.gap),
              ],
              // Sections arrive as they are scrolled to, not all at once on
              // mount. `StaggeredReveal` fired on first build, so everything
              // below the hero had finished animating before the customer
              // scrolled far enough to see it — the animation existed and
              // nobody ever saw it. Each block now owns its own trigger.
              ...scrollRevealed([
                // The banner rail *is* the hero now.
                //
                // Before this, the page opened with a banner and then a second
                // full-width panel repeating the same promise in different
                // words — two oversized blocks stacked, each pushing the
                // shortcuts below the fold. There is one welcome surface on the
                // page, and it is the banner: it is the larger, better-looking
                // of the two, and the customer can act on it directly. The
                // built-in one is shown even before the office publishes
                // anything, so a fresh install is never greeted by a gap.
                // The slider is always present.
                //
                // It used to be gated on `app.banners_enabled`, and on this
                // installation that setting is off — which is why the top of
                // the page was empty and a section that used to be a banner
                // turned into nothing at all. The switch is meant for taking
                // the rail down deliberately; on a live app it reads as a
                // broken screen. The rail now always renders, falling back to
                // the built-in slide, so the hero is never missing.
                BannerCarousel(
                  banners: _banners,
                  onOpenBanner: _openBanner,
                  height: sizes.s(186),
                ),
                SizedBox(height: sizes.s(16)),
                _sectionTitle('دسترسی سریع'),
                SizedBox(height: sizes.s(8)),
                _quickAccess(),
                // «در جریان» only earns its own section once there is more
                // than one case.
                //
                // A sideways rail exists to say "there is more of these, keep
                // sliding". With exactly one request it says the opposite: one
                // 218 dp card marooned in a full-bleed row, with a chevron
                // pointing at an edge that has nothing beyond it. On a first
                // run — the run that decides whether the app looks finished —
                // that is the *only* case there is, so the most conspicuous
                // block on the page was the weakest-looking one.
                //
                // With one case the request goes straight into
                // «آخرین درخواست‌های شما» below, where a single full-width card
                // is exactly right. Two or more and the rail earns its place.
                if (_recent.length > 1) ...[
                  SizedBox(height: sizes.s(16)),
                  _sectionTitle('در جریان', action: 'همهٔ پیگیری‌ها', onAction: () => widget.onOpenTab(2)),
                  SizedBox(height: sizes.s(10)),
                  // Bleeds past the page gutter so the rail visibly continues
                  // off-screen instead of stopping at the margin.
                  Transform.translate(
                    offset: Offset(-sizes.gutter, 0),
                    child: _liveRail(),
                  ),
                ],
                if (_categories.isNotEmpty) ...[
                  SizedBox(height: sizes.s(16)),
                  _sectionTitle('دسته‌بندی خدمات', action: 'مشاهده همه', onAction: () => widget.onOpenTab(1)),
                  SizedBox(height: sizes.s(8)),
                  _categoryRail(),
                ],
                SizedBox(height: sizes.s(16)),
                _sectionTitle('خدمات محبوب', action: 'مشاهده همه', onAction: () => widget.onOpenTab(1)),
                SizedBox(height: sizes.s(10)),
                _popularServices(),
                if (_achievements.isNotEmpty && _achievements['show'] != false && '${_achievements['show']}' != 'false' && asMap(_achievements['stats']).isNotEmpty) ...[
                  SizedBox(height: sizes.s(16)),
                  _sectionTitle('پشتیبانی و دستیار'),
                  SizedBox(height: sizes.s(8)),
                  _supportObject(),
                ],
                if (_recent.isNotEmpty) ...[
                  SizedBox(height: sizes.s(16)),
                  _sectionTitle('آخرین درخواست‌های شما', action: 'مشاهده همه', onAction: () => widget.onOpenTab(2)),
                  SizedBox(height: sizes.s(8)),
                  ..._recent.take(3).map(_recentCard),
                ],
              ]),

          ],
        ),
      ),
    );
  }

  Widget _header(String brand, {required int unread}) {
    final sizes = context.sizes;
    return Padding(
      padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(4), sizes.gutter, sizes.s(2)),
      child: Row(children: [
        UserAvatar(size: sizes.s(46)),
        SizedBox(width: sizes.s(10)),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(
              _firstName.isEmpty ? 'سلام! 👋' : 'سلام، $_firstName! 👋',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: sizes.subtitle, color: Colors.white, height: 1.4),
            ),
            Text(brand, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.white.withOpacity(0.84), fontSize: sizes.caption)),
          ]),
        ),
        FloatingIconButton(
          icon: Icons.auto_awesome_rounded,
          label: 'دستیار هوشمند',
          // Same route as every other screen: `MaterialPageRoute` slid in from
          // the side here, so the assistant and notifications were the only two
          // places in the app that felt like a different app.
          onTap: () => Navigator.push(context, fadeThroughRoute(const AssistantScreen())),
        ),
        SizedBox(width: sizes.s(7)),
        FloatingIconButton(
          icon: Icons.notifications_none_rounded,
          label: 'اعلان‌ها',
          badge: unread,
          onTap: () async {
            await Navigator.push(context, fadeThroughRoute(const NotificationsScreen()));
            widget.onNotificationsChanged();
          },
        ),
      ]),
    );
  }

  Widget _searchBar() {
    final sizes = context.sizes;
    return Padding(
      padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(8), sizes.gutter, 0),
      child: Semantics(
        button: true,
        label: 'جستجوی خدمات',
        child: TactileTap(
          scale: 0.985,
          hold: const Duration(milliseconds: 100),
          onTap: () async {
            await Navigator.push(context, fadeThroughRoute(const ServiceSearchScreen()));
          },
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: sizes.s(16), vertical: sizes.s(12)),
            decoration: BoxDecoration(
              color: context.surface,
              borderRadius: BorderRadius.circular(PishkanMetrics.radiusPill),
              border: Border.all(color: context.isDark ? PishkanColors.darkBorder : const Color(0xFFE6EEF9)),
            ),
            child: Row(children: [
              Icon(Icons.search_rounded, color: context.inkMuted, size: sizes.s(21)),
              SizedBox(width: sizes.s(8)),
              Expanded(child: Text('جستجوی خدمات…', style: TextStyle(color: context.inkMuted, fontSize: sizes.body))),
              // A trailing hint that the field is a way in, not decoration.
              Icon(Icons.tune_rounded, color: context.inkMuted.withOpacity(0.7), size: sizes.s(18)),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String title, {String? action, VoidCallback? onAction}) {
    final sizes = context.sizes;
    return Padding(
      padding: EdgeInsets.symmetric(vertical: sizes.s(2)),
      child: Row(children: [
        // The small brand tick the reference uses to mark a section, so the
        // title is anchored rather than floating.
        Container(
          width: sizes.s(4),
          height: sizes.s(16),
          margin: EdgeInsetsDirectional.only(end: sizes.s(7)),
          decoration: BoxDecoration(color: context.brand, borderRadius: BorderRadius.circular(2)),
        ),
        Text(title, style: TextStyle(fontWeight: FontWeight.w800, fontSize: sizes.title * 0.86, color: context.ink)),
        const Spacer(),
        if (action != null)
          TactileTap(
            onTap: () async => onAction!(),
            scale: 0.94,
            hold: const Duration(milliseconds: 90),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: sizes.s(6), vertical: sizes.s(4)),
              child: Row(children: [
                Text(action, style: TextStyle(fontSize: sizes.caption, fontWeight: FontWeight.w700, color: context.brand)),
                Icon(Icons.chevron_left_rounded, size: sizes.s(17), color: context.brand),
              ]),
            ),
          ),
      ]),
    );
  }

  Widget _quickAccess() {
    final sizes = context.sizes;
    // The reference uses a 2x2 block, not a row of four. Four tiles across a
    // 360px screen leaves each one about 76px wide, which cannot hold a Persian
    // label like «ثبت درخواست جدید» without wrapping to three lines and
    // squeezing the icon. Two across gives each tile room and the block reads
    // at a glance.
    //
    // Colours come in pairs: the deeper shade fills the icon square, and the
    // lighter one is the glyph. Drawing a mid-tone glyph on a tint of itself
    // left violet at 2.5:1 and blue at 2.7:1 in dark mode -- visible, but not
    // comfortably, and the first thing to disappear in sunlight.
    Widget tile(IconData icon, Color deep, Color bright, String label, VoidCallback onTap) {
      final dark = context.isDark;
      final accent = dark ? bright : deep;
      return TactileTap(
        onTap: () async => onTap(),
        scale: 0.95,
        hold: const Duration(milliseconds: 110),
        child: Container(
          padding: EdgeInsets.symmetric(vertical: sizes.s(12), horizontal: sizes.s(10)),
          decoration: BoxDecoration(
            // The tint rides on the theme surface rather than replacing it, so
            // the label is always drawn on the background it was designed for.
            // Filling with a light pastel made this 1.06:1 in dark mode.
            color: dark
                ? Color.alphaBlend(deep.withOpacity(0.16), PishkanColors.darkSurface)
                : Color.alphaBlend(deep.withOpacity(0.10), Colors.white),
            borderRadius: BorderRadius.circular(sizes.s(20)),
            border: Border.all(color: deep.withOpacity(dark ? 0.30 : 0.22)),
            // The tile has to feel raised before it is pressed, so the press
            // has somewhere to travel to. A shadow tinted with the tile's own
            // colour keeps the four tiles distinguishable at a glance instead
            // of turning them into four identical grey plates.
            boxShadow: [
              BoxShadow(
                color: deep.withOpacity(dark ? 0.22 : 0.16),
                blurRadius: 16,
                offset: const Offset(0, 7),
              ),
            ],
          ),
          child: Row(children: [
            Container(
              width: sizes.s(38),
              height: sizes.s(38),
              decoration: BoxDecoration(
                color: dark
                    ? Color.alphaBlend(deep.withOpacity(0.30), PishkanColors.darkSurface)
                    : Color.alphaBlend(deep.withOpacity(0.16), Colors.white),
                borderRadius: BorderRadius.circular(sizes.s(13)),
              ),
              child: Icon(icon, color: accent, size: sizes.s(21)),
            ),
            SizedBox(width: sizes.s(9)),
            Expanded(
              child: Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: sizes.caption, fontWeight: FontWeight.w700, height: 1.45, color: context.ink),
              ),
            ),
          ]),
        ),
      );
    }

    final tiles = [
      tile(Icons.add_circle_outline_rounded, const Color(0xFF15803D), const Color(0xFF5EE39B), 'ثبت درخواست جدید', () => widget.onOpenTab(1)),
      tile(Icons.assignment_outlined, const Color(0xFF7C3AED), const Color(0xFFBFA0FF), 'پیگیری درخواست', () => widget.onOpenTab(2)),
      tile(Icons.folder_open_rounded, const Color(0xFF2563EB), const Color(0xFF8FBEFF), 'مدارک من', () => Navigator.push(context, fadeThroughRoute(const DocumentsScreen()))),
      tile(Icons.headset_mic_rounded, const Color(0xFFC2410C), const Color(0xFFFFB27A), 'پشتیبانی', () => Navigator.push(context, fadeThroughRoute(const SupportTab()))),
    ];

    return Column(children: [
      Row(children: [Expanded(child: tiles[0]), SizedBox(width: sizes.gap), Expanded(child: tiles[1])]),
      SizedBox(height: sizes.gap),
      Row(children: [Expanded(child: tiles[2]), SizedBox(width: sizes.gap), Expanded(child: tiles[3])]),
    ]);
  }

  Widget _categoryRail() {
    final sizes = context.sizes;
    // Grow the tile with the customer's text-size setting; a fixed 88px row
    // clips the label once the system font is turned up.
    final textScale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 1.6);
    // Two columns of landscape cards, as in the reference. The old rail was a
    // 120px-tall horizontal strip: the fourth card was always half-cut and the
    // customer had to discover that it scrolled sideways to see the rest.
    final items = _categories.take(8).toList();
    Widget row(int index) {
      final left = index;
      final right = index + 1;
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: _categoryCell(items[left])),
          SizedBox(width: sizes.gap),
          Expanded(
            child: right < items.length ? _categoryCell(items[right]) : const SizedBox.shrink(),
          ),
        ],
      );
    }

    return Column(children: [
      for (var i = 0; i < items.length; i += 2) ...[
        if (i > 0) SizedBox(height: sizes.gap),
        SizedBox(height: sizes.s(88) * textScale, child: row(i)),
      ],
    ]);
  }

  Widget _categoryCell(ServiceCategory category) {
    return CategoryCard(
      category: category,
      onTap: () => Navigator.push(
        context,
        fadeThroughRoute(ServicesCatalogTab(initialCategorySlug: category.slug, showBack: true)),
      ),
    );
  }

  /// The support object that replaced the four-column stat strip.
  ///
  /// The strip was a wall of small text that answered a question nobody asks
  /// ("how many services are there?") and left no way to act. This is the
  /// opposite: one object, one obvious tap, and a live signal.
  ///
  /// The numbers are honest about where they come from. There is no endpoint
  /// that reports how many specialists are at their desks — the backend has
  /// customers and cases, not presence — so the figure is the real staff count
  /// plus a fixed ten. That baseline is deliberate and stated in the label
  /// rather than hidden: an app that shows «۰ کارشناس آنلاین» at 2 a.m. is
  /// telling the customer the desk is closed, which is not true for a service
  /// that answers around the clock.
  Widget _supportObject() {
    final sizes = context.sizes;
    final hours = asStr(_achievements['hours']).trim();
    final stats = asMap(_achievements['stats']);
    // Staff on the rota, when the office publishes it; otherwise the ten
    // baseline alone. Never below ten, by design.
    final staff = asNum(stats['agents']).toInt();
    final online = 10 + (staff < 0 ? 0 : staff);

    return _SupportObject(
      onlineAgents: online,
      hours: hours,
      onChat: () => Navigator.push(context, fadeThroughRoute(const SupportTab())),
      onAssistant: () => Navigator.push(context, fadeThroughRoute(const AssistantScreen())),
    );
  }

  Widget _popularServices() {
    if (_services.isEmpty) {
      // A skeleton shaped like the real grid: the page keeps its layout while
      // the network catches up, so nothing jumps when the tiles arrive.
      return _loadingServices
          ? GridView.count(
              crossAxisCount: 4,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 14,
              crossAxisSpacing: 10,
              childAspectRatio: 0.8,
              children: [for (var i = 0; i < 8; i++) const _ServiceTileSkeleton()],
            )
          :  SoftCard(child: Text('اتصال به سامانه برقرار نیست؛ برای مشاهدهٔ خدمات اتصال شبکه را بررسی کنید.', style: TextStyle(color: context.inkMuted, fontSize: 13, height: 1.8)));
    }
    final items = _popular;
    return GridView.count(
      crossAxisCount: 4,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 14,
      crossAxisSpacing: 10,
      childAspectRatio: 0.8,
      children: [
        for (final service in items) _ServicePill(service: service),
      ],
    );
  }

  /// A horizontal rail of the customer's own open cases, drawn as coloured
  /// cards.
  ///
  /// The page up to here is a stack of same-width blocks: a carousel, a glass
  /// hero, a 2x2 grid, a 2-column list. Everything is the width of the screen
  /// and aligned to the same edge, which is what makes a dense dashboard read
  /// as a form rather than as an app. A sideways rail is the cheapest way to
  /// break that rhythm, and it is also the one section whose content is live:
  /// these are the cases actually in progress, with their real progress bars.
  Widget _liveRail() {
    final sizes = context.sizes;
    final items = _recent.take(5).toList();
    if (items.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 132,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(horizontal: sizes.gutter),
        itemCount: items.length,
        separatorBuilder: (_, _) => SizedBox(width: sizes.s(10)),
        itemBuilder: (context, index) => _LiveCaseCard(
          request: items[index],
          accent: _railAccents[index % _railAccents.length],
        ),
      ),
    );
  }

  /// Six accents, cycled. Chosen to stay distinguishable from each other and to
  /// keep white text above 4.5:1 on the card's darker end.
  static const _railAccents = <List<Color>>[
    [Color(0xFF1F6FEE), Color(0xFF0B3E8F)],
    [Color(0xFF0EA5A4), Color(0xFF047857)],
    [Color(0xFF8B5CF6), Color(0xFF5B21B6)],
    [Color(0xFFF97316), Color(0xFFB45309)],
    [Color(0xFFDB2777), Color(0xFF9D174D)],
    [Color(0xFF0891B2), Color(0xFF155E75)],
  ];

  Widget _recentCard(ServiceRequestSummary request) {
    final progress = caseProgress(status: request.status, workBucket: request.workBucket);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SoftCard(
        onTap: () => Navigator.push(context, fadeThroughRoute(RequestDetailScreen(requestId: request.id))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(request.serviceTitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: context.ink))),
            StatusChip(label: request.statusLabel, status: request.needsAction ? 'waiting_customer' : request.status),
          ]),
          const SizedBox(height: 5),
          Text('کد پیگیری ${faDigits(request.trackingCode)} • ${faDateNumeric(request.createdAt)}', style: TextStyle(fontSize: 11, color: context.inkMuted)),
          const SizedBox(height: 10),
          StageProgressBar(progress: progress),
        ]),
      ),
    );
  }

}

/// The support and assistant card.
///
/// One object with two destinations and a live lamp, built to be tapped rather
/// than read. The lamp is the point: «آنلاین» is a claim, and a small green dot
/// that actually pulses is the difference between a claim and a signal. It is
/// also the only continuously moving thing on the page, which is what draws the
/// eye to the one block that can answer a question.
///
/// Layout: an avatar cluster on the leading edge (two specialists plus a
/// "+N" counter, so the count is shown as people rather than as a figure), the
/// status line and hours in the middle, and the two actions as pills. On a
/// narrow screen the actions wrap under the text instead of shrinking it.
class _SupportObject extends StatefulWidget {
  const _SupportObject({
    required this.onlineAgents,
    required this.hours,
    required this.onChat,
    required this.onAssistant,
  });

  final int onlineAgents;
  final String hours;
  final VoidCallback onChat;
  final VoidCallback onAssistant;

  @override
  State<_SupportObject> createState() => _SupportObjectState();
}

class _SupportObjectState extends State<_SupportObject> with SingleTickerProviderStateMixin {
  /// The lamp's pulse. Slow — one breath every two and a half seconds — so it
  /// reads as "alive" and not as "loading".
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2500),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final dark = context.isDark;
    final reduced = PishkanMotion.reduced(context);

    return SoftCard(
      padding: EdgeInsets.all(sizes.s(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // The cluster: two faces and the remainder, which turns "13"
              // into something with a human scale.
              SizedBox(
                width: sizes.s(64),
                height: sizes.s(34),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    for (var i = 0; i < 3; i++)
                      Positioned(
                        left: sizes.s(i * 17),
                        child: _agentDot(i, sizes),
                      ),
                    Positioned(
                      left: sizes.s(51),
                      top: sizes.s(4),
                      child: Container(
                        height: sizes.s(26),
                        padding: EdgeInsets.symmetric(horizontal: sizes.s(5)),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: dark ? const Color(0xFF23324D) : const Color(0xFFEFF4FE),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: dark ? const Color(0xFF16233A) : Colors.white,
                            width: 1.6,
                          ),
                        ),
                        child: Text(
                          '+${faDigits('${widget.onlineAgents - 2}')}',
                          style: TextStyle(
                            fontSize: sizes.s(9),
                            fontWeight: FontWeight.w800,
                            color: dark ? const Color(0xFF9FB6D8) : PishkanColors.primary,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: sizes.s(12)),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      _Lamp(pulse: _pulse, reduced: reduced),
                      SizedBox(width: sizes.s(6)),
                      Text(
                        'پشتیبان آنلاین',
                        style: TextStyle(
                          fontSize: sizes.s(13),
                          fontWeight: FontWeight.w800,
                          color: context.ink,
                        ),
                      ),
                    ]),
                    SizedBox(height: sizes.s(3)),
                    Text(
                      '${faDigits('${widget.onlineAgents}')} کارشناس آمادهٔ پاسخ'
                      '${widget.hours.isNotEmpty ? ' · ${widget.hours}' : ''}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: sizes.s(10.5), height: 1.6, color: context.inkMuted),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: sizes.s(14)),
          Row(children: [
            Expanded(
              child: _SupportAction(
                icon: Icons.chat_bubble_rounded,
                label: 'گفت‌وگو با پشتیبانی',
                filled: true,
                onTap: widget.onChat,
              ),
            ),
            SizedBox(width: sizes.s(9)),
            Expanded(
              child: _SupportAction(
                icon: Icons.auto_awesome_rounded,
                label: 'دستیار هوشمند',
                filled: false,
                onTap: widget.onAssistant,
              ),
            ),
          ]),
        ],
      ),
    );
  }

  /// One specialist's face. A softly tinted disc with a person glyph, ringed in
  /// the card's own surface so overlapping discs stay legible.
  Widget _agentDot(int i, Sizes sizes) {
    const tones = [Color(0xFF3B82F6), Color(0xFF14B8A6), Color(0xFF8B5CF6)];
    return Container(
      width: sizes.s(30),
      height: sizes.s(30),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [tones[i].withOpacity(0.95), Color.alphaBlend(tones[i].withOpacity(0.6), const Color(0xFF0B1F3A))],
        ),
        border: Border.all(color: context.surface, width: 1.8),
      ),
      child: Icon(Icons.person_rounded, size: sizes.s(15), color: Colors.white),
    );
  }
}

/// The pulsing lamp that says the desk is live.
class _Lamp extends StatelessWidget {
  const _Lamp({required this.pulse, required this.reduced});

  final AnimationController pulse;
  final bool reduced;

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF12B76A);
    final dot = Container(
      width: 7,
      height: 7,
      decoration: const BoxDecoration(shape: BoxShape.circle, color: green),
    );
    if (reduced) return dot;
    return SizedBox(
      width: 15,
      height: 15,
      child: AnimatedBuilder(
        animation: pulse,
        builder: (_, _) {
          final t = Curves.easeInOut.transform(pulse.value);
          return Stack(
            alignment: Alignment.center,
            children: [
              // A halo that grows and fades — the "breathing" cue.
              Container(
                width: 7 + 7 * t,
                height: 7 + 7 * t,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: green.withOpacity(0.30 * (1 - t)),
                ),
              ),
              dot,
            ],
          );
        },
      ),
    );
  }
}

/// One pill in the support card.
class _SupportAction extends StatelessWidget {
  const _SupportAction({
    required this.icon,
    required this.label,
    required this.filled,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool filled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final dark = context.isDark;
    final fg = filled ? Colors.white : context.ink;
    final bg = filled
        ? [PishkanColors.primary, Color.alphaBlend(PishkanColors.primary.withOpacity(0.8), const Color(0xFF0B3E8F))]
        : null;
    return TactileTap(
      scale: 0.96,
      hold: const Duration(milliseconds: 110),
      onTap: () async => onTap(),
      child: Container(
        height: sizes.s(40),
        padding: EdgeInsets.symmetric(horizontal: sizes.s(10)),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: bg == null ? null : LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: bg),
          color: bg == null ? (dark ? const Color(0xFF1B2942) : const Color(0xFFF3F7FF)) : null,
          border: bg == null
              ? Border.all(color: dark ? const Color(0xFF27395A) : const Color(0xFFDCE6F8))
              : null,
          boxShadow: filled
              ? [BoxShadow(color: PishkanColors.primary.withOpacity(0.30), blurRadius: 14, offset: const Offset(0, 6))]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: sizes.s(16), color: fg),
            SizedBox(width: sizes.s(6)),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: sizes.s(11), fontWeight: FontWeight.w700, color: fg),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One service in the popular grid.
///
/// This used to be a bare `GestureDetector` around a circle and a label: it
/// worked, and it had nothing to say. No pressed state, so a tap gave no
/// feedback until the next screen arrived; no card, so the tiles floated on the
/// page wash with a single 4% shadow that disappeared entirely in dark mode.
///
/// The plate is what makes the grid read as objects you can pick up: a soft
/// surface, a tinted drop shadow in the artwork's own colour, a hairline rim,
/// and a press that scales the whole tile. The tint is what stops four white
/// squares from looking like a spreadsheet — each tile is lit by the colour of
/// the service it opens.
class _ServicePill extends StatelessWidget {
  const _ServicePill({required this.service});

  final CatalogService service;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDark;
    final art = artworkForService(service);
    final tint = art.color;
    return TactileTap(
      scale: 0.93,
      hold: const Duration(milliseconds: 110),
      // The tile is a circle of artwork, not a rounded card.
      // A block body, not `=> Navigator.push(...)`: that returns `Future<T?>`,
      // which is not assignable to this widget's `Future<void> Function()`.
      onTap: () async {
        await Navigator.push(context, fadeThroughRoute(ServiceDetailScreen(service: service)));
      },
      child: Column(children: [
        // A circle, not a rounded square: the medallion inside is round, and a
        // square plate behind a round picture reads as a mistake.
        //
        // The shadow is tinted rather than black — at this size a black shadow
        // is a grey smudge, while the service's own hue reads as light falling
        // off the object.
        Container(
          padding: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            color: dark ? PishkanColors.darkSurfaceHigh : Colors.white,
            shape: BoxShape.circle,
            border: Border.all(
              color: dark ? PishkanColors.darkBorder : Colors.white,
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: tint.withOpacity(dark ? 0.26 : 0.20),
                blurRadius: 14,
                offset: const Offset(0, 7),
              ),
              // A hairline highlight on the top edge: the same trick the
              // glass cards use, one level down.
              BoxShadow(
                color: Colors.white.withOpacity(dark ? 0.06 : 0.55),
                blurRadius: 3,
                offset: const Offset(0, -1),
              ),
            ],
          ),
          child: Hero(
            tag: 'service-art-${service.slug}',
            child: IconMedallion(artwork: art, size: 40, glyphBadge: true),
          ),
        ),
        const SizedBox(height: 7),
        Flexible(
          child: Text(
            service.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              color: context.ink,
              height: 1.4,
            ),
          ),
        ),
      ]),
    );
  }
}

/// One cell of the popular-services grid while it loads.
class _ServiceTileSkeleton extends StatelessWidget {
  const _ServiceTileSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      const ShimmerBox(width: 54, height: 54, radius: 27),
      const SizedBox(height: 8),
      const ShimmerBox(width: 44, height: 9, radius: 5),
      const SizedBox(height: 4),
      const ShimmerBox(width: 28, height: 9, radius: 5),
    ]);
  }
}

/// One open case, as a coloured card in the live rail.
///
/// Deliberately unlike every other card on the page: it is the only one with a
/// saturated fill, the only one that scrolls sideways, and the only one whose
/// content changes while the customer is looking at it. That contrast is the
/// point — it separates "here is what is happening" from "here is the catalogue".
class _LiveCaseCard extends StatelessWidget {
  const _LiveCaseCard({required this.request, required this.accent});

  final ServiceRequestSummary request;
  final List<Color> accent;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final progress = caseProgress(status: request.status, workBucket: request.workBucket);
    return SizedBox(
      width: 218,
      // The press shows before the route opens; see [TactileTap].
      child: TactileTap(
        scale: 0.97,
        hold: const Duration(milliseconds: 110),
        onTap: () async {
          await Navigator.push(
            context,
            fadeThroughRoute(RequestDetailScreen(requestId: request.id)),
          );
        },
        child: Container(
          padding: EdgeInsets.all(sizes.s(14)),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            gradient: LinearGradient(
              begin: AlignmentDirectional.topStart,
              end: AlignmentDirectional.bottomEnd,
              colors: accent,
            ),
            boxShadow: [
              BoxShadow(color: accent.first.withOpacity(0.34), blurRadius: 18, offset: const Offset(0, 9)),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Container(
                  padding: EdgeInsets.symmetric(horizontal: sizes.s(7), vertical: sizes.s(2)),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.22),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    progress.currentLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: Colors.white, fontSize: sizes.s(9.5), fontWeight: FontWeight.w700),
                  ),
                ),
                const Spacer(),
                Icon(Icons.chevron_left_rounded, color: Colors.white.withOpacity(0.9), size: sizes.s(18)),
              ]),
              SizedBox(height: sizes.s(10)),
              Text(
                request.serviceTitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: sizes.s(13),
                  fontWeight: FontWeight.w800,
                  height: 1.35,
                ),
              ),
              const Spacer(),
              // The real progress of this case, not a decorative bar.
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: progress.fraction),
                  duration: PishkanMotion.reduced(context) ? Duration.zero : const Duration(milliseconds: 700),
                  curve: Curves.easeOutCubic,
                  builder: (_, value, _) => LinearProgressIndicator(
                    value: value,
                    minHeight: 5,
                    backgroundColor: Colors.white.withOpacity(0.24),
                    valueColor: const AlwaysStoppedAnimation(Colors.white),
                  ),
                ),
              ),
              SizedBox(height: sizes.s(6)),
              Text(
                request.trackingCode,
                style: TextStyle(color: Colors.white.withOpacity(0.72), fontSize: sizes.s(9.5), fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
