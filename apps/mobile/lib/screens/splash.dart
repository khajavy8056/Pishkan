import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/biometric.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/notifier.dart' show AppPrefs;
import '../services/services.dart';
import 'home_shell.dart';
import 'login.dart';
import 'server_setup.dart';

/// First screen (approved design): brand over the office artwork while the
/// app decides where the customer lands — server setup on first run, login
/// without a session, otherwise the dashboard (behind the optional
/// fingerprint lock). Also enforces the admin-controlled minimum version.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  String _message = 'در حال آماده‌سازی…';
  String _brand = 'تک پیشخوان';
  String _tagline = 'سامانهٔ جامع خدمات دولت';

  @override
  void initState() {
    super.initState();
    _boot();
  }

  /// Wall-clock floor for the splash animation.
  ///
  /// The brief asks for five to seven seconds of intro so the identity is
  /// actually seen, but the work has to happen inside that window, not after
  /// it: [_bootSteps] runs immediately and this only pads the remainder, so a
  /// fast connection still leaves after six seconds and a slow one leaves as
  /// soon as it is ready. Nobody waits 6 s *plus* the network.
  static const _minimumSplash = Duration(seconds: 6);
  final _bootStarted = DateTime.now();

  Future<void> _holdSplash() async {
    final elapsed = DateTime.now().difference(_bootStarted);
    final remaining = _minimumSplash - elapsed;
    if (remaining > Duration.zero) await Future<void>.delayed(remaining);
  }

  Future<void> _boot() async {
    // Short brand beat only — never wait for permissions or a slow network
    // here. Notification permission is asked later, inside the shell.
    try {
      await _bootSteps();
    } catch (_) {
      // Whatever went wrong, the customer must land on a real screen.
      if (mounted) _go(session.hasServer ? const LoginScreen() : const ServerSetupScreen());
    }
  }

  /// Say what is happening, in the customer's words.
  ///
  /// The splash is up for six seconds whether or not the network is fast, and
  /// a bar that never changes its caption for six seconds is what makes a
  /// loading screen feel stuck. These are the real stages of [_bootSteps], not
  /// invented progress: each line is printed immediately before the work it
  /// describes, so the customer can tell "talking to the office" from
  /// "checking your session" — and tell a slow connection from a hung app.
  void _status(String message) {
    if (!mounted || _message == message) return;
    setState(() => _message = message);
  }

  Future<void> _bootSteps() async {
    await Future<void>.delayed(const Duration(milliseconds: 350));
    // main() paints promptly even if secure storage is slow. Give the same
    // in-flight load a little longer before deciding the user has no session.
    _status('در حال خواندن نشست شما…');
    try { await session.load().timeout(const Duration(seconds: 5)); } catch (_) {}
    if (!mounted) return;

    if (!session.hasServer) {
      _go(const ServerSetupScreen());
      return;
    }

    _status('در حال اتصال به سامانه…');
    AppConfig? config;
    try {
      config = await fetchAppConfig().timeout(const Duration(seconds: 6));
    } catch (_) {
      config = null; // Offline on a slow LAN must not gate the login screen.
    }
    if (!mounted) return;
    _status(config == null ? 'سامانه پاسخ نداد؛ ادامهٔ کار به‌صورت آفلاین…' : 'دریافت اطلاعات و تنظیمات…');
    final cfg = config;
    if (cfg != null) {
      setState(() {
        _brand = cfg.brandName.isEmpty ? _brand : cfg.brandName;
        if (cfg.tagline.isNotEmpty) _tagline = cfg.tagline;
      });
    }

    if (cfg != null && cfg.minVersion.isNotEmpty) {
      _status('بررسی نسخهٔ نصب‌شده…');
      final current = await currentAppVersion();
      final outdated = compareVersions(current, cfg.minVersion) < 0;
      final newerExists = cfg.latestVersion.isNotEmpty && compareVersions(current, cfg.latestVersion) < 0;
      if (outdated || (newerExists && cfg.forceUpdate)) {
        final hardBlock = outdated && cfg.forceUpdate;
        await _showUpdateDialog(cfg.updateUrl, forced: hardBlock);
        if (hardBlock && mounted) return;
      }
    }

    if (!session.isSignedIn) {
      _go(const LoginScreen());
      return;
    }

    _status('آماده‌سازی صفحهٔ اصلی…');
    // Optional fingerprint lock before showing any personal data.
    if (await AppPrefs.biometricEnabled()) {
      if (!await BiometricAuth.isAvailable()) {
        if (mounted) _go(const LoginScreen(lockMessage: 'برای ادامه، با رمز عبور وارد شوید.'));
        return;
      }
      final unlocked = await BiometricAuth.authenticate();
      if (!mounted) return;
      if (!unlocked) {
        _go(const LoginScreen(lockMessage: 'برای ادامه، اثر انگشت را تأیید کنید یا با رمز وارد شوید.'));
        return;
      }
    }

    _status('بررسی حساب کاربری…');
    try {
      await fetchMe().timeout(const Duration(seconds: 6));
    } on ApiException {
      if (!session.isSignedIn && mounted) {
        _go(const LoginScreen());
        return;
      }
    } catch (_) {}
    if (!mounted) return;
    unawaited(registerDevice());
    _go(const HomeShell());
  }

  Future<void> _showUpdateDialog(String updateUrl, {required bool forced}) async {
    await showDialog<void>(
      context: context,
      barrierDismissible: !forced,
      builder: (ctx) => AlertDialog(
        title: const Text('نسخهٔ جدید اپلیکیشن'),
        content: Text(
          forced
              ? 'برای ادامهٔ استفاده از اپ، لازم است نسخهٔ جدید را نصب کنید.'
              : 'نسخهٔ جدیدی از اپلیکیشن منتشر شده است. پیشنهاد می‌کنیم همین حالا به‌روز کنید.',
          style: const TextStyle(height: 1.8, fontSize: 14),
        ),
        actions: [
          if (!forced) TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('بعداً')),
          FilledButton(
            onPressed: () async {
              final url = updateUrl.isEmpty ? session.serverUrl : updateUrl;
              final uri = Uri.tryParse(api.absolute(url));
              if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
              if (!forced && ctx.mounted) Navigator.pop(ctx);
            },
            child: const Text('دریافت نسخهٔ جدید'),
          ),
        ],
      ),
    );
  }

  Future<void> _go(Widget page) async {
    await _holdSplash();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => page));
  }

  // Entrance timings. Deliberately short and slightly overlapping, so the
  // identity assembles itself in about a second and then stays *alive* for the
  // remaining five: the brief asks for five to seven seconds of intro, and a
  // five-second hold on a frozen picture is exactly the "freeze" it warns about.
  late final AnimationController _entrance = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..forward();

  /// A slow, seamless loop that keeps the screen breathing for as long as it
  /// is up: the halo behind the mark drifts, the light sweep crosses the
  /// artwork, and the brand line shimmers gently.
  late final AnimationController _ambient = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  )..repeat();

  /// Progress is indeterminate on purpose: the boot steps finish at wildly
  /// different times on an office LAN and over mobile data, and a bar that
  /// jumps 0 → 30 → 100 on one device and creeps on another reads as broken.
  /// A continuous sweep is honest about "working" without inventing numbers.
  late final Animation<double> _logoIn = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0, 0.62, curve: Curves.easeOutBack),
  );
  late final Animation<double> _titleIn = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0.22, 0.78, curve: Curves.easeOutCubic),
  );
  late final Animation<double> _footerIn = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0.42, 1, curve: Curves.easeOutCubic),
  );

  @override
  void dispose() {
    _entrance.dispose();
    _ambient.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    // Respect the system "remove animations" accessibility switch: with it on,
    // nothing loops and the screen is simply the artwork plus the brand.
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    return Scaffold(
      body: Stack(children: [
        // Office artwork (bundled so the very first screen works offline).
        Positioned.fill(
          child: Image.asset(
            'assets/splash-office.jpg',
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => Container(decoration: BoxDecoration(gradient: PishkanColors.brightGradient)),
          ),
        ),
        // A slow light sweep across the artwork. One thin diagonal of white at
        // 6% opacity, moving over six seconds — it gives the still photograph a
        // sense of lit glass without touching the photo itself.
        if (!reduceMotion)
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _ambient,
                builder: (context, _) => FractionalTranslation(
                  translation: Offset(-1.2 + _ambient.value * 2.4, 0),
                  child: Transform.rotate(
                    angle: -0.35,
                    child: Container(
                      width: size.width * 0.42,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [Colors.white.withOpacity(0.10), Colors.white.withOpacity(0)],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.white.withOpacity(0.10), Colors.transparent, const Color(0xFF1452D9).withOpacity(0.88)],
                stops: const [0, 0.42, 0.86],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
        ),
        SafeArea(
          child: Column(children: [
            SizedBox(height: size.height * 0.075),
            // The mark: halo, then the disc, then a hairline ring that expands
            // once as the logo lands — the "arrival" beat.
            FadeTransition(
              opacity: _logoIn,
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.72, end: 1).animate(_logoIn),
                child: AnimatedBuilder(
                  animation: _ambient,
                  builder: (context, child) {
                    final pulse = reduceMotion ? 0.5 : (0.5 + 0.5 * math.sin(_ambient.value * 2 * math.pi));
                    return SizedBox(
                      width: 168,
                      height: 168,
                      child: Stack(alignment: Alignment.center, children: [
                        // The glow: two concentric soft discs, pulsing out of
                        // phase with the ring below.
                        Container(
                          width: 168,
                          height: 168,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: RadialGradient(colors: [
                              Colors.white.withOpacity(0.26 + 0.10 * pulse),
                              Colors.white.withOpacity(0),
                            ]),
                          ),
                        ),
                        Container(
                          width: 128 + 10 * pulse,
                          height: 128 + 10 * pulse,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white.withOpacity(0.22 + 0.10 * (1 - pulse)), width: 1.2),
                          ),
                        ),
                        child!,
                      ]),
                    );
                  },
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(color: const Color(0xFF0B1F3A).withOpacity(0.28), blurRadius: 28, offset: const Offset(0, 12)),
                        BoxShadow(color: Colors.white.withOpacity(0.30), blurRadius: 40, spreadRadius: 2),
                      ],
                    ),
                    child: ClipOval(child: Image.asset('assets/icon.png', width: 78, height: 78)),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 18),
            FadeTransition(
              opacity: _titleIn,
              child: AnimatedBuilder(
                animation: _ambient,
                builder: (context, child) {
                  // The brand line lifts a touch as the sweep passes, which
                  // ties it to the light crossing the photo.
                  final t = reduceMotion ? 0.0 : math.sin(_ambient.value * 2 * math.pi);
                  return Transform.translate(offset: Offset(0, -1.5 * t), child: child);
                },
                child: Text(
                  _brand,
                  style: TextStyle(
                    color: context.ink,
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.2,
                    shadows: [Shadow(color: Colors.white.withOpacity(0.85), blurRadius: 16)],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 5),
            FadeTransition(
              opacity: _titleIn,
              child: Text(_tagline, style: const TextStyle(color: Color(0xFF274B73), fontSize: 13.5, fontWeight: FontWeight.w600)),
            ),
            const Spacer(),
            FadeTransition(
              opacity: _footerIn,
              child: Column(children: [
                const Text('خدمات دولتی، ساده‌تر از همیشه', style: TextStyle(color: Colors.white, fontSize: 16.5, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                const Text('سریع • آسان • مطمئن', style: TextStyle(color: Color(0xFFD8E7FF), fontSize: 13, fontWeight: FontWeight.w600)),
                const SizedBox(height: 22),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 70),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: SizedBox(
                      height: 5,
                      child: Stack(children: [
                        // Track, then a sweep that never stops. Unlike a stock
                        // indeterminate bar, the sweep's speed eases rather
                        // than restarting abruptly, so it reads as breathing.
                        Positioned.fill(child: ColoredBox(color: Colors.white.withOpacity(0.20))),
                        if (!reduceMotion)
                          AnimatedBuilder(
                            animation: _ambient,
                            builder: (context, _) {
                              final t = Curves.easeInOut.transform(((_ambient.value * 2) % 1));
                              return Align(
                                alignment: AlignmentDirectional(-1 + 2 * t, 0),
                                child: FractionallySizedBox(
                                  widthFactor: 0.34,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(colors: [
                                        Colors.white.withOpacity(0.75),
                                        Colors.white,
                                        Colors.white.withOpacity(0.75),
                                      ]),
                                      borderRadius: BorderRadius.circular(999),
                                    ),
                                  ),
                                ),
                              );
                            },
                          )
                        else
                          const Positioned.fill(child: ColoredBox(color: Colors.white54)),
                      ]),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                // The status line is the honest part of this screen: it says
                // what is actually happening while the network is answering.
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 260),
                  child: Text(
                    _message,
                    key: ValueKey(_message),
                    style: const TextStyle(color: Color(0xFFE6EEFF), fontSize: 12),
                  ),
                ),
                const SizedBox(height: 26),
              ]),
            ),
          ]),
        ),
      ]),
    );
  }
}
