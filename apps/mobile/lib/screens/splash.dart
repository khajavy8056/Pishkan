import 'dart:async';

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

class _SplashScreenState extends State<SplashScreen> {
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
  static const _minimumSplash = Duration(seconds: 10);
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

  @override
  Widget build(BuildContext context) {
    // All of the painting lives in [SplashStage]; this screen only decides how
    // long the stage stays up and where it goes next.
    // No `Scaffold` here: `SplashStage` provides its own, and nesting two puts
    // a second `SafeArea` and a second background under the stage.
    return SplashStage(
      brand: _brand,
      tagline: _tagline,
      status: _message,
      progress: _progress,
    );
  }

  /// 0..1 against the splash floor, so the arc is a real clock.
  double get _progress {
    final elapsed = DateTime.now().difference(_bootStarted).inMilliseconds;
    return (elapsed / _minimumSplash.inMilliseconds).clamp(0.0, 1.0);
  }
}

/// Everything the splash *looks like*, with no boot logic at all.
///
/// Split out of [SplashScreen] because that screen owns a ten-second timer and
/// a network boot: any widget test that mounted it would either wait ten
/// seconds or fail outright on a pending timer. This widget owns animation only,
/// so a test can pump it across the whole loop — which matters, because it is
/// almost entirely `CustomPainter` and animation maths, the kind of code that
@visibleForTesting

class SplashStage extends StatefulWidget {
  const SplashStage({
    super.key,
    this.brand = 'تک پیشخوان',
    this.tagline = 'سامانهٔ جامع خدمات دولت',
    this.status = 'در حال آماده‌سازی…',
    this.progress = 0.35,
  });

  final String brand;
  final String tagline;
  final String status;

  /// 0..1 against the splash floor in the app; a fixed value in tests.
  final double progress;

  @override
  State<SplashStage> createState() => _SplashStageState();
}

/// The first screen, rebuilt around *one* idea instead of seven.
///
/// The previous version layered a gradient field, three drifting orbs, a
/// travelling light band, a 46-dot grid, two expanding pulse rings, a shader
/// shimmer, and an arc. Every element was defensible alone and together they
/// read as noise: the mark sat in a busy field, the brand line shimmered while
/// the rings expanded behind it, and nothing could be looked at.
///
/// This is a calmer composition with a deliberate hierarchy:
///
///  1. a deep, slowly breathing gradient — motion you feel, not motion you
///     watch;
///  2. a single halo behind the mark that breathes on a four-second cycle;
///  3. the mark itself, arriving once and then perfectly still — a logo that
///     keeps moving stops reading as a logo;
///  4. the brand line, then the tagline, then a thin progress rail and the
///     status text. One thing at a time, top to bottom.
///
/// The only repeating element is the halo, and it is subtle enough to be
/// ignored. That is the point: a splash is a held breath, not a fireworks show.
class _SplashStageState extends State<SplashStage> with TickerProviderStateMixin {
  /// 12 s, so a slow breath completes only once during a 10 s splash and never
  /// loops visibly.
  late final AnimationController _breath = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 12),
  )..repeat(reverse: true);

  /// The one-time arrival: mark, then line, then rail.
  late final AnimationController _entrance = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..forward();

  late final Animation<double> _markIn = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0, 0.55, curve: Curves.easeOutCubic),
  );
  late final Animation<double> _textIn = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0.30, 0.80, curve: Curves.easeOutCubic),
  );
  late final Animation<double> _footIn = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0.55, 1, curve: Curves.easeOutCubic),
  );

  @override
  void dispose() {
    _breath.dispose();
    _entrance.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final reduceMotion = mq.disableAnimations;
    // The mark scales with the phone rather than being pinned at 214 px: on a
    // small device that number is a third of the screen, and the column around
    // it overflowed. This keeps the composition proportional at any size.
    final markSize = (mq.size.width * 0.42).clamp(140.0, 190.0);

    // Self-sufficient on purpose: a bare `Stack` of `AlignmentDirectional`s
    // needs a `Directionality` above it, and `MaterialApp` supplies one only in
    // the app — not when the stage is previewed or tested directly. It also
    // needs a `Scaffold` for the status bar styling to be predictable.
    return Directionality(
      textDirection: Directionality.maybeOf(context) ?? TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF0B3E8F),
        body: DecoratedBox(
      decoration: const BoxDecoration(gradient: PishkanColors.splashGradient),
      child: Stack(children: [
        // ---- the field ---------------------------------------------------
        // One slowly breathing glow, centred behind the mark. It is the only
        // continuous motion on the screen, and at 12 s per cycle it reads as
        // the surface being lit rather than as an animation.
        if (!reduceMotion)
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _breath,
                builder: (context, _) => CustomPaint(
                  painter: _SplashField(breath: _breath.value, markSize: markSize),
                ),
              ),
            ),
          ),
        // ---- the column --------------------------------------------------
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Spacer(flex: 5),
                FadeTransition(
                  opacity: _markIn,
                  child: ScaleTransition(
                    // Extremely small travel. A logo that pops from 50% reads as
                    // a notification; from 92% it reads as arriving.
                    scale: Tween<double>(begin: 0.92, end: 1).animate(_markIn),
                    child: Container(
                      width: markSize,
                      height: markSize,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white,
                        boxShadow: [
                          // A soft brand glow, not a drop shadow: the disc is
                          // meant to look like it is emitting light.
                          BoxShadow(color: const Color(0xFF9CC8FF).withOpacity(0.45), blurRadius: 60, spreadRadius: 6),
                          BoxShadow(color: Colors.black.withOpacity(0.28), blurRadius: 28, offset: const Offset(0, 14)),
                        ],
                      ),
                      padding: EdgeInsets.all(markSize * 0.14),
                      child: ClipOval(child: Image.asset('assets/icon.png')),
                    ),
                  ),
                ),
                SizedBox(height: markSize * 0.22),
                FadeTransition(
                  opacity: _textIn,
                  child: Column(children: [
                    Text(
                      widget.brand,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 27,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      widget.tagline,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.78),
                        fontSize: 13,
                        height: 1.6,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ]),
                ),
                const Spacer(flex: 6),
                FadeTransition(
                  opacity: _footIn,
                  child: Column(children: [
                    // A thin rail, not a spinning ring. It says "this is
                    // happening" without competing with the mark for attention.
                    SizedBox(
                      width: 150,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          value: widget.progress.clamp(0.0, 1.0),
                          minHeight: 3,
                          backgroundColor: Colors.white.withOpacity(0.16),
                          valueColor: const AlwaysStoppedAnimation(Colors.white),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 300),
                      child: Text(
                        widget.status,
                        key: ValueKey(widget.status),
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.80),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ]),
                ),
                const SizedBox(height: 40),
              ],
            ),
          ),
        ),
      ]),
        ),
      ),
    );
  }
}

/// The breathing light behind the splash mark.
///
/// Two concentric radial gradients whose radii are driven by one slow value.
/// Painted instead of built from widgets because it covers the whole screen and
/// repaints every frame; two `Container`s with gradients would be two extra
/// layers to composite for no visual benefit.
class _SplashField extends CustomPainter {
  _SplashField({required this.breath, required this.markSize});

  /// 0..1, ping-pongs over twelve seconds.
  final double breath;
  final double markSize;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final centre = Offset(size.width / 2, size.height / 2 - size.height * 0.06);

    // The wide, cool halo — the "room light".
    final outer = markSize * (2.6 + 0.35 * breath);
    canvas.drawCircle(
      centre,
      outer,
      Paint()
        ..shader = RadialGradient(
          colors: [const Color(0xFFBFDBFE).withOpacity(0.20 + 0.06 * breath), const Color(0xFFBFDBFE).withOpacity(0)],
          stops: const [0, 1],
        ).createShader(Rect.fromCircle(center: centre, radius: outer)),
    );

    // The tight, warm core — what makes the disc look lit rather than pasted.
    final inner = markSize * (0.95 + 0.10 * breath);
    canvas.drawCircle(
      centre,
      inner,
      Paint()
        ..shader = RadialGradient(
          colors: [const Color(0xFFC7D2FE).withOpacity(0.30 + 0.10 * breath), const Color(0xFFC7D2FE).withOpacity(0)],
        ).createShader(Rect.fromCircle(center: centre, radius: inner)),
    );
  }

  @override
  bool shouldRepaint(covariant _SplashField old) => old.breath != breath || old.markSize != markSize;
}
