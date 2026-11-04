import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'documents.dart';
import 'notifications.dart';
import 'offers.dart';
import 'payments.dart';
import 'request_detail.dart';
import 'service_detail.dart';
import 'story_viewer.dart';
import 'wallet.dart';

/// Customer dashboard: story rail, shortcuts, categories, featured services
/// and the customer's latest requests — all live backend data, no blog.
class HomeTab extends StatefulWidget {
  const HomeTab({super.key, required this.onOpenTab});

  final ValueChanged<int> onOpenTab;

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> with WidgetsBindingObserver {
  AppConfig? _config;
  List<StoryGroup> _stories = const [];
  List<ServiceCategory> _categories = const [];
  List<CatalogService> _services = const [];
  List<ServiceRequestSummary> _requests = const [];
  int _unread = 0;
  num _walletBalance = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load(showSpinner: false);
  }

  Future<void> _load({bool showSpinner = true}) async {
    if (showSpinner && mounted) setState(() => _loading = true);
    try {
      final config = await fetchAppConfig();
      final stories = config?.storiesEnabled == false ? const <StoryGroup>[] : await fetchStories();
      final categories = await fetchCategories();
      final services = await fetchServices();
      int unread = 0;
      num balance = 0;
      List<ServiceRequestSummary> requests = const [];
      try {
        final notifs = await fetchNotifications();
        unread = asNum(notifs['unreadCount']).toInt();
      } catch (_) {}
      try {
        requests = (await fetchMyRequests()).items.take(5).toList();
      } catch (_) {}
      try {
        balance = asNum((await fetchWallet())['balance']);
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _config = config;
        _stories = stories;
        _categories = categories;
        _services = services;
        _requests = requests;
        _unread = unread;
        _walletBalance = balance;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = session.user ?? const {};
    final name = asStr(user['fullName']).isEmpty ? 'کاربر پیشخوان' : asStr(user['fullName']);
    final config = _config;
    final welcome = (config?.welcomeTitle.isNotEmpty == true ? config!.welcomeTitle : 'چه خدمتی امروز برایتان انجام دهیم؟');

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () => _load(showSpinner: false),
        child: ListView(children: [
          _header(name, welcome),
          if (_loading)
            const Padding(padding: EdgeInsets.all(40), child: LoadingView())
          else if (_error != null && _services.isEmpty)
            Padding(padding: const EdgeInsets.all(16), child: ErrorView(message: _error!, onRetry: _load))
          else ...[
            if (config?.announcement.isNotEmpty == true) _announcement(config!.announcement),
            if (_stories.isNotEmpty) _storyRail(),
            _shortcuts(),
            if (_categories.isNotEmpty) _categoryRow(),
            _featuredServices(),
            if (_requests.isNotEmpty) _latestRequests(),
            const SizedBox(height: 24),
          ],
        ]),
      ),
    );
  }

  Widget _header(String name, String welcome) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 22),
      decoration: const BoxDecoration(
        gradient: PishkanColors.brandGradient,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.all(2),
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: Colors.white24)),
              child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Image.asset('assets/icon.png', width: 38, height: 38)),
            ),
            const SizedBox(width: 10),
            Text(_config?.brandName ?? 'پیشخوان', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 17)),
            const Spacer(),
            IconButton(
              onPressed: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()));
                _load(showSpinner: false);
              },
              icon: Badge(
                isLabelVisible: _unread > 0,
                label: Text(faDigits(_unread)),
                child: const Icon(Icons.notifications_none_rounded, color: Colors.white),
              ),
            ),
          ]),
          const SizedBox(height: 14),
          Text('سلام $name 👋', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(welcome, style: const TextStyle(color: Color(0xFFCFE0FF), fontSize: 12.5)),
          const SizedBox(height: 14),
          InkWell(
            onTap: () => widget.onOpenTab(1),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              decoration: BoxDecoration(color: Colors.white.withOpacity(0.14), borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.white24)),
              child: Row(children: [
                const Icon(Icons.search_rounded, color: Colors.white70, size: 20),
                const SizedBox(width: 8),
                const Text('دنبال چه خدمتی هستید؟…', style: TextStyle(color: Colors.white70, fontSize: 13)),
                const Spacer(),
                Text('موجودی کیف: ${faMoney(_walletBalance)}', style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w700)),
              ]),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _announcement(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: const Color(0xFFFFF7E6), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFFDE68A))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.campaign_rounded, color: PishkanColors.warning),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 12.5, height: 1.8, color: Color(0xFF92400E)))),
        ]),
      ),
    );
  }

  Widget _storyRail() {
    return SizedBox(
      height: 104,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        itemCount: _stories.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (context, index) {
          final group = _stories[index];
          final cover = group.items.isEmpty ? null : group.items.first;
          return GestureDetector(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => StoryViewerScreen(groups: _stories, initialGroup: index))),
            child: Column(children: [
              Container(
                padding: const EdgeInsets.all(2.5),
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(colors: [Color(0xFFF59E0B), Color(0xFFEC4899), Color(0xFF8B5CF6)]),
                ),
                child: Container(
                  padding: const EdgeInsets.all(2.5),
                  decoration: const BoxDecoration(shape: BoxShape.circle, color: Colors.white),
                  child: ClipOval(
                    child: SizedBox(
                      width: 56,
                      height: 56,
                      child: cover == null
                          ? const Icon(Icons.auto_stories_rounded, color: PishkanColors.primary)
                          : cover.isVideo
                              ? Container(color: PishkanColors.navy, alignment: Alignment.center, child: const Icon(Icons.play_circle_fill_rounded, color: Colors.white, size: 30))
                              : AuthImage(url: cover.effectiveMediaUrl),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 6),
              SizedBox(
                width: 72,
                child: Text(group.title, maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
              ),
            ]),
          );
        },
      ),
    );
  }

  Widget _shortcuts() {
    final items = <(IconData, String, VoidCallback)>[
      (Icons.account_balance_wallet_rounded, 'کیف پول', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const WalletScreen()))),
      (Icons.receipt_long_rounded, 'پرداخت‌ها', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PaymentsScreen()))),
      (Icons.folder_shared_rounded, 'مدارک من', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const DocumentsScreen()))),
      (Icons.local_offer_rounded, 'پیشنهادهای من', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const OffersScreen()))),
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 2),
      child: Row(children: [
        for (final (icon, label, action) in items)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: SoftCard(
                onTap: action,
                padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 4),
                child: Column(children: [
                  Icon(icon, color: PishkanColors.primary, size: 24),
                  const SizedBox(height: 7),
                  Text(label, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                ]),
              ),
            ),
          ),
      ]),
    );
  }

  Widget _categoryRow() {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
        child: SectionTitle(title: 'دسته‌بندی خدمات', trailing: TextButton(onPressed: () => widget.onOpenTab(1), child: const Text('همهٔ خدمات'))),
      ),
      SizedBox(
        height: 96,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: _categories.length,
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (context, index) {
            final category = _categories[index];
            return GestureDetector(
              onTap: () => widget.onOpenTab(1),
              child: SoftCard(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  IconMedallion(icon: category.icon, size: 42),
                  const SizedBox(height: 6),
                  Text(category.title, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                ]),
              ),
            );
          },
        ),
      ),
    ]);
  }

  Widget _featuredServices() {
    final featured = _services.where((s) => s.featured).toList();
    final shown = (featured.isEmpty ? _services : featured).take(8).toList();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SectionTitle(title: featured.isEmpty ? 'خدمات' : 'خدمات منتخب', trailing: TextButton(onPressed: () => widget.onOpenTab(1), child: const Text('مشاهدهٔ همه'))),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: shown.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 0.98),
          itemBuilder: (context, index) {
            final service = shown[index];
            return SoftCard(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ServiceDetailScreen(service: service))),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                IconMedallion(icon: service.icon),
                const SizedBox(height: 10),
                Text(service.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, height: 1.5)),
                const Spacer(),
                Text(service.categoryTitle, style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
                const SizedBox(height: 4),
                Text(faMoney(service.computedTotal), style: const TextStyle(fontWeight: FontWeight.w800, color: PishkanColors.primary, fontSize: 13)),
              ]),
            );
          },
        ),
      ]),
    );
  }

  Widget _latestRequests() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SectionTitle(title: 'آخرین درخواست‌های شما', trailing: TextButton(onPressed: () => widget.onOpenTab(2), child: const Text('همهٔ درخواست‌ها'))),
        for (final request in _requests) ...[
          SoftCard(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: request.id))),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(request.serviceTitle, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  const SizedBox(height: 4),
                  Text('کد پیگیری ${faDigits(request.trackingCode)} · ${faDate(request.createdAt)}', style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
                ]),
              ),
              StatusChip(label: request.statusLabel, status: request.needsAction ? 'waiting_customer' : request.status),
            ]),
          ),
          const SizedBox(height: 10),
        ],
      ]),
    );
  }
}
