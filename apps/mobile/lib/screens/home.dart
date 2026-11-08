import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/format.dart';
import '../core/service_icons.dart';
import '../core/stages.dart';
import '../core/motion.dart';
import '../core/sizes.dart';
import '../widgets/screen_header.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/avatar.dart';
import '../widgets/widgets.dart';
import '../widgets/category_card.dart';
import 'assistant.dart';
import 'documents.dart';
import 'notifications.dart';
import 'profile.dart';
import 'request_detail.dart';
import 'service_detail.dart';
import 'services_catalog.dart';
import 'stories_archive.dart';
import 'story_viewer.dart';
import 'support.dart';

/// Customer dashboard (approved design): greeting + bell, search, story
/// rail, blue hero, quick access tiles, popular services with per-service
/// icons, notices and the latest requests with stage progress.
class HomeTab extends StatefulWidget {
  const HomeTab({super.key, required this.onOpenTab, required this.unreadCount, required this.onNotificationsChanged});

  final void Function(int index) onOpenTab;
  final int unreadCount;
  final VoidCallback onNotificationsChanged;

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> {
  static const _seenStoriesKey = 'pishkan.stories.seenGroups';

  AppConfig? _config;
  List<StoryGroup> _groups = [];
  Set<String> _seenGroups = {};
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

  String _groupFingerprint(StoryGroup group) =>
      '${group.title}|${group.items.isEmpty ? '' : group.items.last.id}|${group.items.length}';

  bool _groupSeen(StoryGroup group) => _seenGroups.contains(_groupFingerprint(group));

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(() => _seenGroups = (prefs.getStringList(_seenStoriesKey) ?? const []).toSet());
    }
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
      fetchStories().then((stories) {
        if (mounted) setState(() => _groups = stories);
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

  Future<void> _markGroupSeen(int fromIndex) async {
    final prefs = await SharedPreferences.getInstance();
    final next = {..._seenGroups, for (final group in _groups.skip(fromIndex)) _groupFingerprint(group)};
    await prefs.setStringList(_seenStoriesKey, next.toList());
    if (mounted) setState(() => _seenGroups = next);
  }

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
    final brand = _config?.brandName.isNotEmpty == true ? _config!.brandName : 'پیشخوان آرنا';
    return Scaffold(
      // The reference puts the greeting and the search field on the blue sweep
      // and lets the content start on a white surface. That is one header over
      // one list, not a coloured bar sitting above a grey page, so the two
      // halves are painted by the same scroll view and move together.
      backgroundColor: context.surface,
      body: Stack(children: [
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: BrandBackdrop(
            height: MediaQuery.paddingOf(context).top + sizes.s(126),
            child: Column(children: [
              _header(brand, unread: widget.unreadCount),
              _searchBar(),
            ]),
          ),
        ),
        RefreshIndicator(
          onRefresh: _load,
          edgeOffset: MediaQuery.paddingOf(context).top + sizes.s(60),
          child: ListView(
            // The header is painted behind the list, so the list starts below
            // it and simply scrolls up over the blue.
            padding: EdgeInsets.fromLTRB(sizes.gutter, MediaQuery.paddingOf(context).top + sizes.s(120), sizes.gutter, sizes.s(24)),
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
                if (_groups.isNotEmpty && (_config == null || _config!.storiesEnabled)) ...[
                  _sectionTitle('استوری‌ها و اطلاعیه‌ها', action: 'مشاهده همه', onAction: () async {
                    await Navigator.push(context, fadeThroughRoute(const StoriesArchiveScreen()));
                    widget.onNotificationsChanged();
                    _load();
                  }),
                  SizedBox(height: sizes.s(8)),
                  _storyRail(),
                  SizedBox(height: sizes.s(18)),
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
                if (_groups.isNotEmpty) ...[
                  SizedBox(height: sizes.s(20)),
                  _sectionTitle('اطلاعیه‌ها'),
                  SizedBox(height: sizes.s(8)),
                  for (var i = 0; i < _groups.length && i < 3; i++)
                    if (_groups[i].items.isNotEmpty) _noticeCard(i, _groups[i]),
                ],
              ]),
            ],
          ),
        ),
      ]),
    );
  }

  Widget _header(String brand, {required int unread}) {
    final sizes = context.sizes;
    final name = asStr((session.user ?? const {})['fullName']);
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

  String _groupCover(StoryGroup group) {
    for (final item in group.items) {
      if (!item.isVideo && item.effectiveMediaUrl.isNotEmpty) return item.effectiveMediaUrl;
    }
    return '';
  }

  Widget _storyRail() {
    return SizedBox(
      height: 102,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _groups.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (_, index) {
          final group = _groups[index];
          final seen = _groupSeen(group);
          final cover = _groupCover(group);
          return GestureDetector(
            onTap: () => _openStories(index),
            child: SizedBox(
              width: 68,
              child: Column(children: [
                Container(
                  padding: const EdgeInsets.all(2.5),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: seen ? null : const SweepGradient(colors: [Color(0xFF7C3AED), Color(0xFF2563EB), Color(0xFF06B6D4), Color(0xFF7C3AED)]),
                    border: seen ? Border.all(color: const Color(0xFFCBD5E1), width: 2) : null,
                  ),
                  child: cover.isNotEmpty
                      ? ClipOval(child: SizedBox(width: 58, height: 58, child: AuthImage(url: cover)))
                      : const CircleAvatar(radius: 29, backgroundColor: Color(0xFFE0EAFA), child: Icon(Icons.campaign_rounded, color: PishkanColors.primary)),
                ),
                const SizedBox(height: 6),
                Text(group.title, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: seen ? FontWeight.w500 : FontWeight.w700, color: context.ink)),
              ]),
            ),
          );
        },
      ),
    );
  }

  Future<void> _openStories(int groupIndex) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => StoryViewerScreen(groups: _groups, initialGroup: groupIndex)));
    await _markGroupSeen(groupIndex);
    widget.onNotificationsChanged();
  }

  Widget _hero() {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 20),
      decoration: BoxDecoration(
        gradient: PishkanColors.brandGradient,
        borderRadius: BorderRadius.circular(26),
        boxShadow: [BoxShadow(color: PishkanColors.primary.withOpacity(0.35), blurRadius: 18, offset: const Offset(0, 10))],
      ),
      child: Stack(children: [
        PositionedDirectional(
          end: -6,
          top: -6,
          child: Icon(Icons.account_balance_rounded, size: 92, color: Colors.white.withOpacity(0.14)),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('خدمات دولتی،', style: TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800)),
          const Text('بدون صف و انتظار', style: TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text('انجام همهٔ امور اداری شما در یک جا', style: TextStyle(color: Color(0xFFD8E7FF), fontSize: 12.5)),
          const SizedBox(height: 14),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: PishkanColors.primary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 11),
            ),
            onPressed: () => widget.onOpenTab(1),
            child: const Text('ثبت درخواست جدید', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
          ),
        ]),
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
        SizedBox(height: sizes.s(88), child: row(i)),
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
        for (final service in items)
          GestureDetector(
            onTap: () => Navigator.push(context, fadeThroughRoute(ServiceDetailScreen(service: service))),
            child: Column(children: [
              // Same tag as the detail banner: the picture the customer tapped
              // is the one that expands, so the two screens are visibly linked.
              Hero(
                tag: 'service-art-${service.slug}',
                child: Container(
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(color: context.surface, shape: BoxShape.circle, boxShadow: const [BoxShadow(color: Color(0x100B1F3A), blurRadius: 10, offset: Offset(0, 4))]),
                  child: IconMedallion(artwork: artworkForService(service), size: 40, glyphBadge: true),
                ),
              ),
              const SizedBox(height: 6),
              Flexible(
                child: Text(service.title, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: context.ink, height: 1.4)),
              ),
            ]),
          ),
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

  Widget _noticeCard(int groupIndex, StoryGroup group) {
    final first = group.items.first;
    final cover = _groupCover(group);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SoftCard(
        onTap: () => _openStories(groupIndex),
        child: Row(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: cover.isNotEmpty ? SizedBox(width: 92, height: 76, child: AuthImage(url: cover)) : _noticePlaceholder(),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(first.title.isEmpty ? group.title : first.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: context.ink, height: 1.6)),
              if (first.caption.isNotEmpty) Text(first.caption, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: context.inkMuted)),
              const SizedBox(height: 4),
              Row(children: [
                Icon(Icons.calendar_month_outlined, size: 14, color: context.inkMuted),
                const SizedBox(width: 4),
                Text(faDateNumeric(first.createdAt), style: TextStyle(fontSize: 11, color: context.inkMuted)),
                const Spacer(),
                const Text('مشاهده', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: PishkanColors.primary)),
                const Icon(Icons.chevron_left_rounded, size: 17, color: PishkanColors.primary),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _noticePlaceholder() => Container(
        width: 92,
        height: 76,
        decoration: const BoxDecoration(gradient: PishkanColors.brandGradient),
        child: const Icon(Icons.campaign_rounded, color: Colors.white, size: 30),
      );
}

/// One cell of the popular-services grid while it loads.
class _ServiceTileSkeleton extends StatelessWidget {
  const _ServiceTileSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      ShimmerBox(width: 54, height: 54, radius: 27),
      const SizedBox(height: 8),
      const ShimmerBox(width: 44, height: 9, radius: 5),
      const SizedBox(height: 4),
      const ShimmerBox(width: 28, height: 9, radius: 5),
    ]);
  }
}
