import 'dart:async';

import 'package:flutter/material.dart';

import '../core/home_navigation.dart';
import '../core/motion.dart';
import '../core/sizes.dart';
import '../core/theme.dart';
import '../services/notifier.dart';
import '../services/push.dart';
import '../services/services.dart';
import '../widgets/notification_card.dart';
import '../widgets/wave_nav_bar.dart';
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
    // Native push has its own tap channel: a notification tapped while the app
    // was closed never went through the polling service, so without this the
    // app would open on the home screen instead of the case it was about.
    PushService.onLink = _openLink;
    final pushedLink = PushService.takePendingLaunchLink();
    if (pushedLink != null && pushedLink.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _openLink(pushedLink));
    }
    // Bind this phone to the signed-in account (safe to repeat: the server keys
    // the row by token and reassigns the owner).
    unawaited(PushService.registerWithServer());
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
    if (PushService.onLink == _openLink) PushService.onLink = null;
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
    // The bar owns its own painting, shadows and hill; the shell only says
    // which destination is selected and what the four of them are.
    //
    // Order is left-to-right on screen. The app is RTL, so `Row` lays the
    // first child on the right — which is where «خانه» sits in the reference.
    return WaveNavBar(
      index: _index,
      onSelect: (i) {
        if (i != _index) Haptics.select();
        selectTab(i);
      },
      items: const [
        WaveNavItem(icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'خانه'),
        WaveNavItem(icon: Icons.grid_view_outlined, activeIcon: Icons.grid_view_rounded, label: 'خدمات'),
        WaveNavItem(icon: Icons.fact_check_outlined, activeIcon: Icons.fact_check_rounded, label: 'پیگیری‌ها'),
        WaveNavItem(icon: Icons.person_outline_rounded, activeIcon: Icons.person_rounded, label: 'پروفایل'),
      ],
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
          : PishkanNotificationCard(
              event: event,
              compact: true,
              onTap: () {
                final link = event.link;
                _dismissBanner();
                _openLink(link);
              },
              onDismiss: _dismissBanner,
            ),
      ),
    );
  }
}
