import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

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
                if (_banners.isNotEmpty && (_config == null || _config!.bannersEnabled)) ...[
                  // Banners replaced the story ring. A wide card can say one
                  // thing and open the service it is about, which is the whole
                  // reason the ring was retired: a story needed two taps and a
                  // slideshow before the customer reached anything useful.
                  BannerCarousel(
                    banners: _banners,
                    onOpenBanner: _openBanner,
                  ),
                  SizedBox(height: sizes.s(10)),
                ],
                _hero(),
                SizedBox(height: sizes.s(20)),
                _sectionTitle('دسترسی سریع'),
                SizedBox(height: sizes.s(8)),
                _quickAccess(),
                if (_recent.isNotEmpty) ...[
                  // The rail sits before the catalogue: what is already in
                  // progress is more urgent than what could be started, and it
                  // is the one block on the page with a different shape — which
                  // is what breaks the stack of full-width rows.
                  SizedBox(height: sizes.s(22)),
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
                  SizedBox(height: sizes.s(20)),
                  _sectionTitle('دسته‌بندی خدمات', action: 'مشاهده همه', onAction: () => widget.onOpenTab(1)),
                  SizedBox(height: sizes.s(8)),
                  _categoryRail(),
                ],
                SizedBox(height: sizes.s(20)),
                _sectionTitle('خدمات محبوب', action: 'مشاهده همه', onAction: () => widget.onOpenTab(1)),
                SizedBox(height: sizes.s(10)),
                _popularServices(),
                if (_achievements.isNotEmpty && _achievements['show'] != false && '${_achievements['show']}' != 'false' && asMap(_achievements['stats']).isNotEmpty) ...[
                  SizedBox(height: sizes.s(20)),
                  _sectionTitle('پیشخوان در یک نگاه'),
                  SizedBox(height: sizes.s(8)),
                  _achievementCard(),
                ],
                if (_recent.isNotEmpty) ...[
                  SizedBox(height: sizes.s(20)),
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

  /// The welcome panel.
  ///
  /// Two stacked layers, not one flat gradient. Behind the card sits a soft
  /// "light wash" — a pair of large, blurred, low-opacity orbs that drift
  /// almost imperceptibly. On top of it sits a real glass card, so the panel
  /// has depth: the orbs are *behind* the surface and visible through it,
  /// which is what separates a glass panel from a gradient rectangle.
  ///
  /// The drift is a 9-second alternating tween on two offsets — cheap enough
  /// to run on a weak phone, slow enough not to pull the eye away from the
  /// button.
  Widget _hero() {
    final sizes = context.sizes;
    // The hero is its own widget now (see `_LiveHero`): it owns an ambient
    // controller, and a stateful panel inside a stateless page rebuilds nothing
    // else when that controller ticks.
    return _LiveHero(onOpen: () => widget.onOpenTab(1));
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

  Widget _achievementCard() {
    final stats = asMap(_achievements['stats']);
    final customCustomers = asStr(_achievements['customersText']).trim();
    final customerLabel = asStr(_achievements['customersLabel']).trim();
    final hours = asStr(_achievements['hours']).trim();
    Widget item(IconData icon, String value, String label) => Expanded(child: Column(children: [
      Icon(icon, color: PishkanColors.primary, size: 21),
      const SizedBox(height: 6),
      Text(value, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: context.ink)),
      const SizedBox(height: 2),
      Text(label, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 10, color: context.inkMuted)),
    ]));
    return SoftCard(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      item(Icons.verified_user_outlined, 'امن و قابل اعتماد', 'با استانداردهای روز'),
      item(Icons.grid_view_rounded, '${faDigits('${asNum(stats['services']).toInt()}')}+', 'خدمت متنوع'),
      item(Icons.people_outline_rounded, customCustomers.isNotEmpty ? customCustomers : '${faDigits('${asNum(stats['customers']).toInt()}')}+', customerLabel.isNotEmpty ? customerLabel : 'مشتری همراه'),
      item(Icons.support_agent_rounded, 'پشتیبانی', hours.isNotEmpty ? hours : 'در تمام روزهای هفته'),
    ]));
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

/// The opaque base of the welcome panel.
///
/// Kept as its own widget so the panel's height comes from the *content*, which
/// is what lets the light orbs and the rim be `Positioned.fill` layers around
/// it instead of guessing a height.
class _Plate extends StatelessWidget {
  const _Plate({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        gradient: const LinearGradient(
          begin: AlignmentDirectional.topStart,
          end: AlignmentDirectional.bottomEnd,
          colors: [Color(0xE61F6FEE), Color(0xE60B3E8F)],
        ),
        boxShadow: [
          BoxShadow(
            color: PishkanColors.primary.withOpacity(context.isDark ? 0.22 : 0.30),
            blurRadius: 22,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(26),
        child: child,
      ),
    );
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


/// The home hero: a live, breathing panel rather than a poster.
///
/// The previous version was three lines of static text on a glass card. It said
/// the right thing and did nothing — nothing moved, nothing responded, and the
/// only interactive element was a button at the bottom. The brief was explicit
/// that this panel is where the page should feel alive, so it is rebuilt as a
/// composed scene:
///
///  * a slow-drifting gradient field, so the surface is never twice the same;
///  * three translucent discs orbiting behind the copy at different speeds,
///    which gives the panel parallax of its own;
///  * a hairline arc that draws itself and fades, like a rule being written;
///  * the headline arriving in two staged pieces, then holding.
///
/// None of it scrolls the page, blocks input or changes size: it is decoration
/// painted behind fixed content, so it costs one controller and no layout.
class _LiveHero extends StatefulWidget {
  const _LiveHero({required this.onOpen});

  final VoidCallback onOpen;

  @override
  State<_LiveHero> createState() => _LiveHeroState();
}

class _LiveHeroState extends State<_LiveHero> with SingleTickerProviderStateMixin {
  late final AnimationController _ambient = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 12),
  )..repeat();

  @override
  void dispose() {
    _ambient.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final reduceMotion = PishkanMotion.reduced(context);
    return Parallax(
      factor: 0.07,
      maxShift: 16,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: Stack(children: [
          // ---- the field -------------------------------------------------
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(gradient: PishkanColors.brandGradient),
            ),
          ),
          if (!reduceMotion)
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedBuilder(
                  animation: _ambient,
                  builder: (context, _) => CustomPaint(
                    painter: _HeroAura(t: _ambient.value),
                  ),
                ),
              ),
            ),
          // A dark foot, so white copy at the bottom never sits on a light
          // patch of the moving field.
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Color.alphaBlend(Colors.black.withOpacity(0.06), Colors.transparent),
                      Colors.transparent,
                      Colors.black.withOpacity(0.26),
                    ],
                    stops: const [0, 0.45, 1],
                  ),
                ),
              ),
            ),
          ),
          // ---- the content ----------------------------------------------
          Padding(
            padding: EdgeInsets.all(sizes.s(18)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                _HeroPill(label: 'همهٔ خدمات، یک‌جا'),
                const Spacer(),
                // A living status dot: it is the cheapest possible signal that
                // the app is running rather than a screenshot.
                _LiveDot(animate: !reduceMotion),
              ]),
              SizedBox(height: sizes.s(14)),
              Text(
                'خدمات دولتی،',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: sizes.s(21),
                  fontWeight: FontWeight.w900,
                  height: 1.45,
                  letterSpacing: -0.2,
                ),
              ),
              Text(
                'بدون صف و انتظار',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: sizes.s(21),
                  fontWeight: FontWeight.w900,
                  height: 1.45,
                  letterSpacing: -0.2,
                ),
              ),
              SizedBox(height: sizes.s(7)),
              Text(
                'همهٔ امور اداری شما در یک جا، با پیگیری لحظه‌ای',
                style: TextStyle(color: Colors.white.withOpacity(0.88), fontSize: sizes.s(12.5), height: 1.7),
              ),
              SizedBox(height: sizes.s(16)),
              Row(children: [
                TactileTap(
                  scale: 0.965,
                  hold: const Duration(milliseconds: 120),
                  sink: 2,
                  onTap: () async => widget.onOpen(),
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: sizes.s(18), vertical: sizes.s(11)),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(999),
                      boxShadow: [
                        // Two shadows on purpose: a neutral contact shadow that
                        // anchors the button, and a brand-coloured glow that
                        // makes it look lit from the panel behind it.
                        BoxShadow(color: Colors.black.withOpacity(0.20), blurRadius: 10, offset: const Offset(0, 4)),
                        BoxShadow(color: PishkanColors.primary.withOpacity(0.34), blurRadius: 22, offset: const Offset(0, 9)),
                      ],
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('ثبت درخواست جدید',
                          style: TextStyle(color: PishkanColors.primary, fontWeight: FontWeight.w900, fontSize: sizes.s(13))),
                      SizedBox(width: sizes.s(5)),
                      Icon(Icons.arrow_back_rounded, size: sizes.s(16), color: PishkanColors.primary),
                    ]),
                  ),
                ),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// The slow-moving light behind the hero copy.
///
/// Three soft discs on independent orbits plus a drawn arc. Painted in one pass
/// rather than built from widgets: this repaints every frame, and three
/// `Container`s with radial gradients would be three more layers to composite
/// on exactly the screen where scroll performance matters most.
class _HeroAura extends CustomPainter {
  _HeroAura({required this.t});

  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final w = size.width;
    final h = size.height;

    void disc(double cx, double cy, double r, Color color, double alpha) {
      final paint = Paint()
        ..shader = RadialGradient(colors: [color.withOpacity(alpha), color.withOpacity(0)])
            .createShader(Rect.fromCircle(center: Offset(cx, cy), radius: r));
      canvas.drawCircle(Offset(cx, cy), r, paint);
    }

    // Each disc has its own period, so the composition never repeats on a
    // device that stays open for a while.
    disc(
      w * (0.18 + 0.10 * math.sin(t * 2 * math.pi)),
      h * (0.22 + 0.10 * math.cos(t * 2 * math.pi)),
      w * 0.42,
      const Color(0xFF7DD3FC),
      0.30,
    );
    disc(
      w * (0.86 + 0.08 * math.cos(t * 2 * math.pi * 1.5)),
      h * (0.70 + 0.12 * math.sin(t * 2 * math.pi * 1.5)),
      w * 0.38,
      const Color(0xFFA78BFA),
      0.26,
    );
    disc(
      w * (0.60 + 0.12 * math.sin(t * 2 * math.pi * 0.7 + 1.7)),
      h * (0.12 + 0.08 * math.cos(t * 2 * math.pi * 0.7 + 1.7)),
      w * 0.30,
      const Color(0xFF34D399),
      0.16,
    );

    // A hairline arc that sweeps across the upper third. It is the element that
    // makes the panel read as *drawing itself* rather than as a static wash.
    final sweep = (t * 2) % 1;
    final arcRect = Rect.fromCircle(center: Offset(w * 0.78, h * 0.10), radius: w * 0.55);
    final arc = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4
      ..strokeCap = StrokeCap.round
      ..shader = LinearGradient(
        colors: [Colors.white.withOpacity(0), Colors.white.withOpacity(0.34), Colors.white.withOpacity(0)],
      ).createShader(arcRect);
    canvas.drawArc(arcRect, -0.2 + sweep * 0.9, 1.5, false, arc);
  }

  @override
  bool shouldRepaint(covariant _HeroAura old) => old.t != t;
}

/// The small translucent label at the top of the hero.
class _HeroPill extends StatelessWidget {
  const _HeroPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: sizes.s(10), vertical: sizes.s(5)),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.18),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withOpacity(0.30)),
      ),
      child: Text(label, style: TextStyle(color: Colors.white, fontSize: sizes.s(10), fontWeight: FontWeight.w700)),
    );
  }
}

/// A dot with a pulse around it — the smallest honest sign of life.
class _LiveDot extends StatefulWidget {
  const _LiveDot({required this.animate});

  final bool animate;

  @override
  State<_LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<_LiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  );

  @override
  void initState() {
    super.initState();
    if (widget.animate) _c.repeat();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 22,
      height: 22,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) {
          final p = widget.animate ? _c.value : 0.35;
          return Stack(alignment: Alignment.center, children: [
            Container(
              width: 8 + 12 * p,
              height: 8 + 12 * p,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFF6EE7B7).withOpacity(0.34 * (1 - p)),
              ),
            ),
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFF6EE7B7),
                boxShadow: [BoxShadow(color: const Color(0xFF6EE7B7).withOpacity(0.7), blurRadius: 8)],
              ),
            ),
          ]);
        },
      ),
    );
  }
}
