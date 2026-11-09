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
              // Everything below the header arrives in one wave. The two
              // hand-placed RevealOnMounts that used to sit here covered only
              // the hero and the quick-access row, so eight of the ten sections
              // just appeared, which is what made the page read as static.
              StaggeredReveal(step: const Duration(milliseconds: 55), children: [
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
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AssistantScreen())),
        ),
        SizedBox(width: sizes.s(7)),
        FloatingIconButton(
          icon: Icons.notifications_none_rounded,
          label: 'اعلان‌ها',
          badge: unread,
          onTap: () async {
            await Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()));
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
        child: Material(
          color: context.surface,
          borderRadius: BorderRadius.circular(PishkanMetrics.radiusPill),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => Navigator.push(context, fadeThroughRoute(const ServiceSearchScreen())),
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: sizes.s(16), vertical: sizes.s(12)),
              child: Row(children: [
                Icon(Icons.search_rounded, color: context.inkMuted, size: sizes.s(21)),
                SizedBox(width: sizes.s(8)),
                Text('جستجوی خدمات…', style: TextStyle(color: context.inkMuted, fontSize: sizes.body)),
              ]),
            ),
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
          PressableScale(
            onTap: onAction,
            scale: 0.94,
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
    final dark = context.isDark;
    return _LightWash(
      // The wash is brighter in dark mode, where a light panel on a near-black
      // background needs the extra glow to read as glass rather than as a hole.
      intensity: dark ? 1.0 : 0.75,
      child: GlassCard(
        radius: 26,
        strong: true,
        tint: Colors.white,
        padding: EdgeInsets.fromLTRB(sizes.s(18), sizes.s(20), sizes.s(18), sizes.s(20)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              padding: EdgeInsets.symmetric(horizontal: sizes.s(9), vertical: sizes.s(4)),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.22),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: Colors.white.withOpacity(0.34)),
              ),
              child: Text(
                'همهٔ خدمات، یک‌جا',
                style: TextStyle(color: Colors.white, fontSize: sizes.s(10), fontWeight: FontWeight.w700),
              ),
            ),
          ]),
          SizedBox(height: sizes.s(12)),
          Text(
            'خدمات دولتی،',
            style: TextStyle(color: Colors.white, fontSize: sizes.s(19), fontWeight: FontWeight.w800, height: 1.5),
          ),
          Text(
            'بدون صف و انتظار',
            style: TextStyle(color: Colors.white, fontSize: sizes.s(19), fontWeight: FontWeight.w800, height: 1.5),
          ),
          SizedBox(height: sizes.s(6)),
          Text(
            'انجام همهٔ امور اداری شما در یک جا',
            style: TextStyle(color: Colors.white.withOpacity(0.90), fontSize: sizes.s(12.5), height: 1.7),
          ),
          SizedBox(height: sizes.s(16)),
          // The one solid element on the panel: the action. Everything else is
          // translucent, so the eye lands here.
          PressableScale(
            scale: 0.97,
            onTap: () => widget.onOpenTab(1),
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: sizes.s(20), vertical: sizes.s(11)),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(999),
                boxShadow: [
                  BoxShadow(color: const Color(0x33000000), blurRadius: 14, offset: const Offset(0, 6)),
                ],
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Text(
                  'ثبت درخواست جدید',
                  style: TextStyle(color: PishkanColors.primary, fontWeight: FontWeight.w800, fontSize: sizes.s(13)),
                ),
                SizedBox(width: sizes.s(4)),
                Icon(Icons.arrow_back_rounded, size: sizes.s(16), color: PishkanColors.primary),
              ]),
            ),
          ),
        ]),
      ),
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
      return PressableScale(
        onTap: onTap,
        scale: 0.95,
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
    return PressableScale(
      scale: 0.94,
      onTap: () => Navigator.push(context, fadeThroughRoute(ServiceDetailScreen(service: service))),
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

/// The soft light behind the welcome panel.
///
/// Two large blurred orbs in the brand's blue and teal, drifting on a slow
/// alternating tween. They exist to give the glass card above something to be
/// translucent *about*: a glass surface on a flat background is just a
/// slightly tinted rectangle, and that is exactly how it reads.
///
/// Performance notes, because this runs on the home screen of every device:
///  * The orbs are `Container`s with radial gradients, not images — no decode,
///    no memory, no asset weight.
///  * [ImageFiltered] blurs are applied once to a static subtree; the drift
///    moves the parent, so the blur is not recomputed per pixel per frame.
///  * The animation is stopped when the widget is disposed, and it is a single
///    controller driving two `Transform`s.
class _LightWash extends StatefulWidget {
  const _LightWash({required this.child, this.intensity = 1});

  final Widget child;
  /// 0..1 — how strongly the orbs show. Dark mode passes more.
  final double intensity;

  @override
  State<_LightWash> createState() => _LightWashState();
}

class _LightWashState extends State<_LightWash> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 9),
  )..repeat(reverse: true);

  late final Animation<double> _drift = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeInOut,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final brand = context.brand;
    // The plate is laid out first and gives the stack its intrinsic height, so
    // the `Positioned.fill` layers around it always have a box to fill and the
    // orbs can bleed past the card's edges.
    return Stack(
      clipBehavior: Clip.none,
      children: [
        _Plate(child: widget.child),
        // The orbs sit above the plate but below the glass, so they show
        // through the translucency rather than washing over the content.
        Positioned.fill(
          child: IgnorePointer(
            child: AnimatedBuilder(
              animation: _drift,
              builder: (context, _) {
                final t = _drift.value;
                // `PositionedDirectional`, not `Positioned`: the app is RTL,
                // and only the directional form takes `start`/`end`. The two
                // orbs sit on opposite corners and mirror with the language
                // rather than pinning themselves to the physical sides.
                return Stack(clipBehavior: Clip.none, children: [
                  PositionedDirectional(
                    top: -sizes.s(28) + t * sizes.s(10),
                    end: -sizes.s(30) - t * sizes.s(8),
                    child: _orb(
                      size: sizes.s(150),
                      color: brand.withOpacity(0.55 * widget.intensity),
                    ),
                  ),
                  PositionedDirectional(
                    bottom: -sizes.s(40) - t * sizes.s(8),
                    start: -sizes.s(24) + t * sizes.s(10),
                    child: _orb(
                      size: sizes.s(120),
                      color: const Color(0xFF22D3EE).withOpacity(0.42 * widget.intensity),
                    ),
                  ),
                ]);
              },
            ),
          ),
        ),
        // A thin light rim along the top edge, over the glass: the cue that
        // sells the material.
        Positioned.fill(
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(26),
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.white.withOpacity(0.22), Colors.white.withOpacity(0)],
                  stops: const [0, 0.45],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _orb({required double size, required Color color}) {
    return ImageFiltered(
      imageFilter: ImageFilter.blur(sigmaX: 28, sigmaY: 28),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: [color, color.withOpacity(0)]),
        ),
      ),
    );
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
