import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/format.dart';
import '../core/service_icons.dart';
import '../core/stages.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'documents.dart';
import 'notifications.dart';
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
  List<ServiceRequestSummary> _recent = [];
  bool _loadingServices = true;

  @override
  void initState() {
    super.initState();
    _load();
    fetchMe().catchError((_) => <String, dynamic>{});
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
    final config = await fetchAppConfig();
    final stories = await fetchStories();
    final services = await fetchServices();
    var recent = <ServiceRequestSummary>[];
    try {
      recent = (await fetchMyRequests()).items;
    } catch (_) {
      recent = _recent; // Keep the cached list when offline.
    }
    if (!mounted) return;
    setState(() {
      _config = config;
      _groups = (config == null || config.storiesEnabled) ? stories : const [];
      _services = services;
      _recent = recent;
      _loadingServices = false;
    });
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
    final brand = _config?.brandName.isNotEmpty == true ? _config!.brandName : 'پیشخوان آرنا';
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(padding: const EdgeInsets.fromLTRB(16, 10, 16, 20), children: [
            _header(brand),
            const SizedBox(height: 14),
            _searchBar(),
            if (_groups.isNotEmpty) ...[
              const SizedBox(height: 20),
              _sectionTitle('استوری‌ها و اطلاعیه‌ها', action: 'مشاهده همه', onAction: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => const StoriesArchiveScreen()));
                widget.onNotificationsChanged();
                _load();
              }),
              const SizedBox(height: 10),
              _storyRail(),
            ],
            const SizedBox(height: 20),
            _hero(),
            const SizedBox(height: 20),
            _sectionTitle('دسترسی سریع'),
            const SizedBox(height: 10),
            _quickAccess(),
            const SizedBox(height: 20),
            _sectionTitle('خدمات محبوب', action: 'مشاهده همه', onAction: () => widget.onOpenTab(1)),
            const SizedBox(height: 12),
            _popularServices(),
            if (_recent.isNotEmpty) ...[
              const SizedBox(height: 20),
              _sectionTitle('آخرین درخواست‌های شما', action: 'مشاهده همه', onAction: () => widget.onOpenTab(2)),
              const SizedBox(height: 10),
              for (final request in _recent.take(3)) _recentCard(request),
            ],
            if (_groups.isNotEmpty) ...[
              const SizedBox(height: 20),
              _sectionTitle('اطلاعیه‌ها'),
              const SizedBox(height: 10),
              for (var i = 0; i < _groups.length && i < 3; i++)
                if (_groups[i].items.isNotEmpty) _noticeCard(i, _groups[i]),
            ],
          ]),
        ),
      ),
    );
  }

  Widget _header(String brand) {
    final user = session.user ?? const {};
    final avatarUrl = asStr(user['avatarUrl']).isEmpty ? asStr(user['avatar']) : asStr(user['avatarUrl']);
    final name = asStr(user['fullName']);
    return Row(children: [
      if (avatarUrl.isNotEmpty)
        ClipOval(child: SizedBox(width: 46, height: 46, child: AuthImage(url: avatarUrl)))
      else
        CircleAvatar(
          radius: 23,
          backgroundColor: PishkanColors.primary.withOpacity(0.12),
          child: Text(name.isEmpty ? 'پ' : name.substring(0, 1), style: const TextStyle(color: PishkanColors.primary, fontWeight: FontWeight.w800, fontSize: 19)),
        ),
      const SizedBox(width: 10),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(_firstName.isEmpty ? 'سلام! 👋' : 'سلام، $_firstName! 👋', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15.5, color: PishkanColors.navy)),
          Text(brand, style: const TextStyle(color: PishkanColors.mutedText, fontSize: 11.5)),
        ]),
      ),
      IconButton(
        tooltip: 'اعلان‌ها',
        onPressed: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()));
          widget.onNotificationsChanged();
        },
        icon: Badge(
          isLabelVisible: widget.unreadCount > 0,
          label: Text(faDigits('${widget.unreadCount}')),
          child: const Icon(Icons.notifications_none_rounded, size: 27),
        ),
      ),
    ]);
  }

  Widget _searchBar() {
    return GestureDetector(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ServiceSearchScreen())),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          boxShadow: const [BoxShadow(color: Color(0x120B1F3A), blurRadius: 12, offset: Offset(0, 4))],
        ),
        child: const Row(children: [
          Icon(Icons.search_rounded, color: PishkanColors.mutedText),
          SizedBox(width: 8),
          Text('جستجو در خدمات…', style: TextStyle(color: PishkanColors.mutedText, fontSize: 13)),
        ]),
      ),
    );
  }

  Widget _sectionTitle(String title, {String? action, VoidCallback? onAction}) {
    return Row(children: [
      Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: PishkanColors.navy)),
      const Spacer(),
      if (action != null)
        InkWell(
          onTap: onAction,
          child: Row(children: [
            Text(action, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: PishkanColors.primary)),
            const SizedBox(width: 2),
            const Icon(Icons.chevron_left_rounded, size: 18, color: PishkanColors.primary),
          ]),
        ),
    ]);
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
                Text(group.title, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: seen ? FontWeight.w500 : FontWeight.w700, color: PishkanColors.navy)),
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
    Widget tile(IconData icon, Color bg, Color fg, String label, VoidCallback onTap) {
      return Expanded(
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 4),
            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(22)),
            child: Column(children: [
              Container(padding: const EdgeInsets.all(10), decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle), child: Icon(icon, color: fg, size: 24)),
              const SizedBox(height: 8),
              Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: PishkanColors.navy)),
            ]),
          ),
        ),
      );
    }

    return Row(children: [
      tile(Icons.add_circle_outline_rounded, PishkanColors.pastelGreen, const Color(0xFF16A34A), 'ثبت درخواست جدید', () => widget.onOpenTab(1)),
      const SizedBox(width: 10),
      tile(Icons.assignment_outlined, PishkanColors.pastelViolet, const Color(0xFF7C3AED), 'پیگیری درخواست', () => widget.onOpenTab(2)),
      const SizedBox(width: 10),
      tile(Icons.folder_open_rounded, PishkanColors.pastelBlue, PishkanColors.primary, 'مدارک من', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const DocumentsScreen()))),
      const SizedBox(width: 10),
      tile(Icons.headset_mic_rounded, PishkanColors.pastelOrange, const Color(0xFFF97316), 'پشتیبانی', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SupportTab()))),
    ]);
  }

  Widget _popularServices() {
    if (_services.isEmpty) {
      return _loadingServices
          ? const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
          : const SoftCard(child: Text('اتصال به سامانه برقرار نیست؛ برای مشاهدهٔ خدمات اتصال شبکه را بررسی کنید.', style: TextStyle(color: PishkanColors.mutedText, fontSize: 13, height: 1.8)));
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
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ServiceDetailScreen(service: service))),
            child: Column(children: [
              Container(
                padding: const EdgeInsets.all(13),
                decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle, boxShadow: [BoxShadow(color: Color(0x100B1F3A), blurRadius: 10, offset: Offset(0, 4))]),
                child: Text(artworkForService(service).emoji, style: const TextStyle(fontSize: 24)),
              ),
              const SizedBox(height: 6),
              Flexible(
                child: Text(service.title, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: PishkanColors.navy, height: 1.4)),
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
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: request.id))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            Expanded(child: Text(request.serviceTitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: PishkanColors.navy))),
            StatusChip(label: request.statusLabel, status: request.needsAction ? 'waiting_customer' : request.status),
          ]),
          const SizedBox(height: 5),
          Text('کد پیگیری ${faDigits(request.trackingCode)} • ${faDateNumeric(request.createdAt)}', style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
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
              Text(first.title.isEmpty ? group.title : first.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: PishkanColors.navy, height: 1.6)),
              if (first.caption.isNotEmpty) Text(first.caption, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
              const SizedBox(height: 4),
              Row(children: [
                const Icon(Icons.calendar_month_outlined, size: 14, color: PishkanColors.mutedText),
                const SizedBox(width: 4),
                Text(faDateNumeric(first.createdAt), style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
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
