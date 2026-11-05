import 'dart:async';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../services/notifier.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'home.dart';
import 'login.dart';
import 'notification_route.dart';
import 'profile.dart';
import 'requests.dart';
import 'services_catalog.dart';

/// Main customer shell (approved design): four bottom tabs — خانه، خدمات،
/// پیگیری‌ها، پروفایل. A gentle foreground poll turns server notifications
/// into floating in-app banners (the background twin raises tray
/// notifications), and notification taps deep-link into the right place.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _index = 0;
  Timer? _pollTimer;
  Timer? _bannerTimer;
  final List<AppNotificationEvent> _bannerQueue = [];
  AppNotificationEvent? _visibleBanner;
  int _unread = 0;

  /// Tabs are addressed by the home shortcuts too (ثبت درخواست → خدمات…).
  void selectTab(int index) => setState(() => _index = index);

  Future<void> _askNotificationsPermission() async {
    try {
      await NotifierService.requestPermission();
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    session.addListener(_sessionChanged);
    NotifierService.onTapLink = _openLink;
    // Ask for the notification permission once the customer is inside the
    // app (never on the splash, where it could stall first paint).
    unawaited(_askNotificationsPermission());
    // Opened by tapping a tray notification while the app was closed?
    final pending = NotifierService.takePendingLaunchPayload();
    if (pending != null && pending.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _openLink(pending));
    }
    _refreshUnread();
    // First check shortly after entering, then every 30s while visible.
    Future<void>.delayed(const Duration(seconds: 4), _poll);
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) => _poll());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    session.removeListener(_sessionChanged);
    _pollTimer?.cancel();
    _bannerTimer?.cancel();
    if (NotifierService.onTapLink == _openLink) NotifierService.onTapLink = null;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _poll();
      _refreshUnread();
    }
  }

  void _sessionChanged() {
    if (!session.isSignedIn && mounted) {
      Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    }
  }

  Future<void> _refreshUnread() async {
    try {
      final feed = await fetchNotifications(limit: 5);
      if (mounted) setState(() => _unread = (feed['unreadCount'] as num?)?.toInt() ?? 0);
    } catch (_) {}
  }

  Future<void> _poll() async {
    if (!mounted || !session.isSignedIn) return;
    _refreshUnread();
    final events = await NotifierService.checkForUpdates(systemNotifications: false);
    if (!mounted || events.isEmpty) return;
    setState(() => _bannerQueue.addAll(events));
    _showNextBanner();
  }

  void _showNextBanner() {
    if (_visibleBanner != null || _bannerQueue.isEmpty || !mounted) return;
    setState(() => _visibleBanner = _bannerQueue.removeAt(0));
    _bannerTimer?.cancel();
    _bannerTimer = Timer(const Duration(seconds: 6), _dismissBanner);
  }

  void _dismissBanner() {
    if (!mounted) return;
    setState(() => _visibleBanner = null);
    Future<void>.delayed(const Duration(milliseconds: 350), _showNextBanner);
  }

  void _openLink(String link) {
    if (mounted) openCustomerNotification(context, link);
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      HomeTab(onOpenTab: selectTab, unreadCount: _unread, onNotificationsChanged: _refreshUnread),
      const ServicesCatalogTab(),
      const RequestsTab(),
      const ProfileTab(),
    ];
    return PopScope(
      canPop: _index == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _index != 0) selectTab(0);
      },
      child: Scaffold(
        body: Stack(children: [
          IndexedStack(index: _index, children: pages),
          _banner(),
        ]),
        bottomNavigationBar: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [BoxShadow(color: Color(0x140B1F3A), blurRadius: 20, offset: Offset(0, -4))],
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
              child: Row(children: [
                _tabItem(0, Icons.home_rounded, Icons.home_outlined, 'خانه'),
                _tabItem(1, Icons.grid_view_rounded, Icons.grid_view_outlined, 'خدمات'),
                _tabItem(2, Icons.fact_check_rounded, Icons.fact_check_outlined, 'پیگیری‌ها'),
                _tabItem(3, Icons.person_rounded, Icons.person_outline_rounded, 'پروفایل'),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  Widget _tabItem(int index, IconData activeIcon, IconData icon, String label) {
    final active = _index == index;
    return Expanded(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => selectTab(index),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(vertical: 7),
          decoration: BoxDecoration(
            color: active ? PishkanColors.primary.withOpacity(0.10) : Colors.transparent,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(active ? activeIcon : icon, color: active ? PishkanColors.primary : PishkanColors.mutedText, size: 24),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 11, fontWeight: active ? FontWeight.w800 : FontWeight.w500, color: active ? PishkanColors.primary : PishkanColors.mutedText)),
          ]),
        ),
      ),
    );
  }

  /// Floating fresh-notification card (ride-hailing style), with a stage
  /// progress bar when it is about a case.
  Widget _banner() {
    final event = _visibleBanner;
    return AnimatedPositioned(
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
      top: event == null ? -160 : MediaQuery.of(context).padding.top + 10,
      left: 14,
      right: 14,
      child: event == null
          ? const SizedBox.shrink()
          : GestureDetector(
              onTap: () {
                final link = event.link;
                _dismissBanner();
                _openLink(link);
              },
              onVerticalDragEnd: (_) => _dismissBanner(),
              child: Container(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFE3ECF9)),
                  boxShadow: const [BoxShadow(color: Color(0x2A0B1F3A), blurRadius: 24, offset: Offset(0, 10))],
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(children: [
                    Container(
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(color: event.color.withOpacity(0.13), shape: BoxShape.circle),
                      child: Icon(event.icon, color: event.color, size: 20),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(event.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: PishkanColors.navy)),
                        if (event.body.isNotEmpty) Text(event.body, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.6)),
                      ]),
                    ),
                    IconButton(icon: const Icon(Icons.close_rounded, size: 18, color: PishkanColors.mutedText), onPressed: _dismissBanner),
                  ]),
                  if (event.progress != null) ...[
                    const SizedBox(height: 9),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: TrackProgressIndicator(event.progress!, event.color, 6),
                    ),
                    const SizedBox(height: 5),
                    Text('مرحلهٔ فعلی: ${event.stageLabel}', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: event.color)),
                  ],
                ]),
              ),
            ),
    );
  }
}
