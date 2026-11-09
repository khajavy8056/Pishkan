import 'dart:async';

import 'package:flutter/material.dart';

import '../core/motion.dart';
import '../core/sizes.dart';
import '../core/theme.dart';
import '../core/home_navigation.dart';
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
    homeNavigationRequests.addListener(_returnHome);
    homeTabRequests.addListener(_onTabRequest);
    NotifierService.onTapLink = _openLink;
    // Ask for the notification permission once the customer is inside the
    // app (never on the splash, where it could stall first paint).
    unawaited(_askNotificationsPermission());
    // Opened by tapping a tray notification while the app was closed?
    final pending = NotifierService.takePendingLaunchPayload();
    if (pending != null && pending.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _openLink(pending));
    }
    // Warm the sound preference so the first tap does not await the disk.
    AppPrefs.soundsEnabled().ignore();
    _refreshUnread();
    // First check shortly after entering, then every 30s while visible.
    Future<void>.delayed(const Duration(seconds: 4), _poll);
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) => _poll());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    session.removeListener(_sessionChanged);
    homeNavigationRequests.removeListener(_returnHome);
    homeTabRequests.removeListener(_onTabRequest);
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

  void _onTabRequest() {
    final index = homeTabRequests.value;
    if (index == null || !mounted) return;
    homeTabRequests.value = null;
    selectTab(index);
  }

  void _returnHome() {
    if (mounted && _index != 0) selectTab(0);
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
    // HeroMode is not optional here. IndexedStack keeps every tab alive, and
    // Flutter collects Hero widgets from the whole subtree -- so the same
    // service shown by both the home tab and the catalog would register one
    // tag twice and throw during a page transition. Disabling heroes on the
    // hidden tabs keeps exactly one live copy, the visible one.
    final pages = <Widget>[
      HeroMode(enabled: _index == 0, child: HomeTab(onOpenTab: selectTab, unreadCount: _unread, onNotificationsChanged: _refreshUnread)),
      HeroMode(enabled: _index == 1, child: const ServicesCatalogTab()),
      HeroMode(enabled: _index == 2, child: const RequestsTab()),
      HeroMode(enabled: _index == 3, child: const ProfileTab()),
    ];
    return PopScope(
      canPop: _index == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _index != 0) selectTab(0);
      },
      child: Scaffold(
        body: PageWash(child: Stack(children: [
          // The tabs cross-fade rather than snapping. KeyedSubtree gives the
          // switcher a distinct child per tab, which is what makes it animate
          // at all -- an IndexedStack alone looks identical frame to frame.
          SoftSwitcher(
            duration: PishkanMotion.quick,
            child: KeyedSubtree(key: ValueKey(_index), child: IndexedStack(index: _index, children: pages)),
          ),
          _banner(),
        ])),
        // A floating white pill that sits above the content instead of a bar
        // welded to the bottom edge. The reference has it detached with the
        // page visible underneath, which is what makes the layout feel like one
        // surface rather than a stack of chrome.
        extendBody: true,
        bottomNavigationBar: _navPill(),
      ),
    );
  }

  Widget _navPill() {
    final sizes = context.sizes;
    return Padding(
      padding: EdgeInsets.fromLTRB(sizes.s(14), 0, sizes.s(14), sizes.s(10)),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(sizes.s(26)),
          boxShadow: [
            BoxShadow(
              color: context.isDark ? const Color(0x99000000) : const Color(0x1F0B1F3A),
              blurRadius: sizes.s(22),
              offset: Offset(0, sizes.s(8)),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(sizes.s(26)),
          child: Container(
            decoration: BoxDecoration(
              color: context.isDark ? PishkanColors.darkSurface : Colors.white,
              border: Border.all(color: context.hairline),
              borderRadius: BorderRadius.circular(sizes.s(26)),
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: sizes.s(6), vertical: sizes.s(6)),
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
      ),
    );
  }

  Widget _tabItem(int index, IconData activeIcon, IconData icon, String label) {
    final sizes = context.sizes;
    final active = _index == index;
    return Expanded(
      child: Semantics(
        button: true,
        selected: active,
        label: label,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          // No sound here. A tick on every tab press is the one piece of
          // feedback people actively dislike: it fires dozens of times a
          // session and cannot be turned off without muting notifications too.
          onTap: () => selectTab(index),
          child: AnimatedContainer(
            duration: PishkanMotion.standard,
            curve: PishkanMotion.enter,
            margin: EdgeInsets.symmetric(horizontal: sizes.s(2)),
            padding: EdgeInsets.symmetric(vertical: sizes.s(8)),
            decoration: BoxDecoration(
              // The selected tab is a filled pill, as in the reference. The old
              // 10%-tint background was almost invisible against white and the
              // only cue left was the label weight.
              color: active ? context.brand.withOpacity(0.12) : Colors.transparent,
              borderRadius: BorderRadius.circular(sizes.s(18)),
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              AnimatedScale(
                scale: active ? 1.06 : 1,
                duration: PishkanMotion.quick,
                curve: PishkanMotion.spring,
                child: Icon(active ? activeIcon : icon,
                    color: active ? context.brand : context.inkMuted, size: sizes.s(23)),
              ),
              SizedBox(height: sizes.s(2)),
              AnimatedDefaultTextStyle(
                duration: PishkanMotion.quick,
                curve: PishkanMotion.enter,
                style: TextStyle(
                  fontFamily: 'Vazirmatn',
                  fontSize: sizes.s(10.5),
                  fontWeight: active ? FontWeight.w800 : FontWeight.w500,
                  color: active ? context.brand : context.inkMuted,
                ),
                child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ]),
          ),
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
      // Fade as well as slide. Without this the card is fully opaque while it
      // is still above the screen edge, so it appears to pop rather than
      // arrive, and the reversed animation looks like a glitch.
      child: AnimatedOpacity(
        opacity: event == null ? 0 : 1,
        duration: PishkanMotion.standard,
        curve: PishkanMotion.enter,
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
                  color: context.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: context.hairline),
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
                        Text(event.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: context.ink)),
                        if (event.body.isNotEmpty) Text(event.body, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, color: context.inkMuted, height: 1.6)),
                      ]),
                    ),
                    IconButton(icon: Icon(Icons.close_rounded, size: 18, color: context.inkMuted), onPressed: _dismissBanner),
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
      ),
    );
  }
}
