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
    return Scaffold(
      body: SplashStage(
        brand: _brand,
        tagline: _tagline,
        status: _message,
        progress: _progress,
      ),
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
/// analyzes clean and then throws at paint time.
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

class _SplashStageState extends State<SplashStage> with TickerProviderStateMixin {
  // Entrance timings. Deliberately short and slightly overlapping, so the
  // identity assembles itself in about a second and then stays *alive* for the
  // rest of the ten seconds: a long hold on a frozen picture is exactly the
  // "freeze" the brief warns against, so the ambient loop never stops.
  late final AnimationController _entrance = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..forward();

  /// A slow, seamless loop that keeps the screen breathing for as long as it
  /// is up: the orbs drift, the light sweep crosses the field, the dot grid
  /// creeps upward and the rings pulse behind the mark.
  late final AnimationController _ambient = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  )..repeat();

  late final Animation<double> _logoIn = CurvedAnimation(
    parent: _entrance,
    curve: const Interval(0, 0.62, curve: Curves.easeOutBack),
  );

  @override
  void dispose() {
    _entrance.dispose();
    _ambient.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ambient,
      builder: (context, _) {
        final size = MediaQuery.of(context).size;
        final reduceMotion = MediaQuery.of(context).disableAnimations;
        // Everything on this screen is a function of one looping value, so
        // they all share phase and nothing drifts out of step.
        final t = _ambient.value;
        final wave = math.sin(t * 2 * math.pi);
        return Stack(children: [
          // ---- the living background -------------------------------------
          // A dark office photograph with a navy scrim used to sit here. It
          // was the first thing a customer ever saw and it read as a
          // shutdown screen: dark, still, and identical on every launch.
          // This is the brand's own light instead — a deep-blue field that
          // shifts hue as it breathes, with two warm orbs crossing it.
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(gradient: PishkanColors.splashGradient),
            ),
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: Stack(children: [
                _DriftOrb(
                  alignment: AlignmentDirectional(-0.55 + 0.25 * wave, -0.62 + 0.18 * wave),
                  size: size.width * 0.78,
                  color: const Color(0xFF22D3EE),
                  opacity: 0.30,
                ),
                _DriftOrb(
                  alignment: AlignmentDirectional(0.62 - 0.22 * wave, 0.34 - 0.16 * wave),
                  size: size.width * 0.62,
                  color: const Color(0xFF3B82F6),
                  opacity: 0.34,
                ),
                _DriftOrb(
                  alignment: AlignmentDirectional(0.10, 0.92 - 0.10 * wave),
                  size: size.width * 0.55,
                  color: const Color(0xFF8B5CF6),
                  opacity: 0.22,
                ),
              ]),
            ),
          ),
          if (!reduceMotion)
            Positioned.fill(
              child: IgnorePointer(
                // Sweeping light: one soft diagonal band travelling right to
                // left across the whole screen. Cheap (one gradient, no
                // filter) and it is what makes the field read as lit glass
                // rather than as a solid fill.
                child: FractionalTranslation(
                  translation: Offset(-1.1 + t * 2.2, 0),
                  child: Transform.rotate(
                    angle: -0.34,
                    child: Container(
                      width: size.width * 0.5,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [Colors.white.withOpacity(0.13), Colors.white.withOpacity(0)],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          // A slow grid of dots, drifting up. Almost invisible individually;
          // together they give the background texture so the eye has
          // something to move over during the wait.
          if (!reduceMotion)
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(painter: _DotField(t: t)),
              ),
            ),

          SafeArea(
            child: Column(children: [
            const Spacer(flex: 3),
            FadeTransition(
              opacity: _logoIn,
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.70, end: 1).animate(_logoIn),
                child: SizedBox(
                  width: 214,
                  height: 214,
                  child: Stack(alignment: Alignment.center, children: [
                    // Halo: breathes in on the beat.
                    Container(
                      width: 214,
                      height: 214,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(colors: [
                          Colors.white.withOpacity(0.20 + 0.09 * (0.5 + 0.5 * wave)),
                          Colors.white.withOpacity(0),
                        ]),
                      ),
                    ),
                    // Two rings expanding outward on a 2.6s cycle, fading as
                    // they grow — a pulse you can actually see, unlike the
                    // old static border.
                    if (!reduceMotion) ...[
                      for (final offsetPhase in const [0.0, 0.5])
                        _PulseRing(
                          progress: (t * 2.6 + offsetPhase) % 1,
                          baseSize: 132,
                          color: Colors.white,
                        ),
                    ],
                    Container(
                      padding: const EdgeInsets.all(13),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(color: const Color(0xFF0B1F3A).withOpacity(0.34), blurRadius: 34, offset: const Offset(0, 14)),
                          BoxShadow(color: const Color(0xFF5AA0FF).withOpacity(0.45), blurRadius: 52, spreadRadius: 4),
                        ],
                      ),
                      child: ClipOval(child: Image.asset('assets/icon.png', width: 86, height: 86)),
                    ),
                  ]),
                ),
              ),
            ),
            const SizedBox(height: 26),
            // The brand line, with a highlight travelling through it.
            ShaderMask(
              // The gradient travels left-to-right as a highlight sweeps the
              // brand line. It is deliberately built from plain `Alignment`
              // and not `AlignmentDirectional`: `createShader(rect)` takes an
              // optional `textDirection`, and a directional gradient without
              // one cannot resolve its stops — it throws "No TextDirection
              // found" on every paint. A horizontal sweep has no leading or
              // trailing side to mirror, so a plain axis is also the correct
              // description of the effect.
              shaderCallback: (rect) => LinearGradient(
                begin: Alignment(-1 + 2 * ((t * 2) % 1), 0),
                end: Alignment(1 + 2 * ((t * 2) % 1), 0),
                colors: [Colors.white, const Color(0xFFBFE3FF), Colors.white],
                stops: const [0.35, 0.5, 0.65],
              ).createShader(rect),
              child: Text(
                widget.brand,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: size.width * 0.078,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.4,
                  shadows: [Shadow(color: const Color(0xFF06203F).withOpacity(0.45), blurRadius: 18, offset: const Offset(0, 6))],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              widget.tagline,
              style: TextStyle(color: Colors.white.withOpacity(0.86), fontSize: 12.5, height: 1.7, fontWeight: FontWeight.w500),
            ),
            const Spacer(flex: 4),
            // ---- progress -------------------------------------------------
            SizedBox(
              width: size.width * 0.62,
              child: Column(children: [
                // A determinate-looking arc driven by real elapsed time
                // against the splash's own floor, not a fake value: by the
                // time the bar is full the screen is genuinely leaving.
                _SplashArc(progress: widget.progress),
                const SizedBox(height: 18),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 320),
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: SlideTransition(
                      position: Tween<Offset>(begin: const Offset(0, 0.25), end: Offset.zero).animate(animation),
                      child: child,
                    ),
                  ),
                  child: Text(
                    widget.status,
                    key: ValueKey(widget.status),
                    style: TextStyle(color: Colors.white.withOpacity(0.92), fontSize: 12.5, fontWeight: FontWeight.w600),
                  ),
                ),
              ]),
            ),
            const SizedBox(height: 34),
            ]),
          ),
        ]);
      },
    );
  }
}

/* ------------------------------- piecework -------------------------------- */

/// A soft coloured light that floats behind the whole screen.
class _DriftOrb extends StatelessWidget {
  const _DriftOrb({required this.alignment, required this.size, required this.color, required this.opacity});

  // `AlignmentGeometry`, not `Alignment`: the orbs are placed with
  // `AlignmentDirectional` so they mirror correctly in RTL, and the two are
  // siblings under `AlignmentGeometry` — not parent and child.
  final AlignmentGeometry alignment;
  final double size;
  final Color color;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: IgnorePointer(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(colors: [color.withOpacity(opacity), color.withOpacity(0)]),
          ),
        ),
      ),
    );
  }
}

/// A ring that expands and fades — the "heartbeat" behind the mark.
///
/// Two of these run half a cycle apart, so there is always one arriving while
/// the other is leaving. A single ring that restarts from nothing reads as a
/// stutter; the pair reads as a pulse.
class _PulseRing extends StatelessWidget {
  const _PulseRing({required this.progress, required this.baseSize, required this.color});

  /// 0..1 through one expansion.
  final double progress;
  final double baseSize;
  final Color color;

  @override
  Widget build(BuildContext context) {
    // Ease-out so the ring leaps away and then settles, which is how a real
    // pulse behaves; linear expansion looks mechanical.
    final eased = Curves.easeOutCubic.transform(progress);
    final size = baseSize + eased * 86;
    final fade = (1 - progress) * 0.34;
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: color.withOpacity(fade), width: 1.4),
        ),
      ),
    );
  }
}

/// The faint field of drifting dots behind the mark.
///
/// Painted rather than built: a hundred `Container`s would be a hundred widgets
/// rebuilding every frame, while this is one paint call.
class _DotField extends CustomPainter {
  _DotField({required this.t});

  /// The shared ambient phase, 0..1.
  final double t;

  static const _count = 46;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint();
    for (var i = 0; i < _count; i++) {
      // Deterministic placement: no Random, so the field is identical on every
      // launch and does not shimmer when the widget rebuilds.
      final fx = ((i * 67) % 100) / 100;
      final baseY = ((i * 37) % 100) / 100;
      // Each dot drifts upward on its own offset, wrapping at the top edge.
      final drift = ((baseY - t * (0.35 + (i % 5) * 0.08)) % 1 + 1) % 1;
      final radius = 0.9 + (i % 3) * 0.55;
      paint.color = Colors.white.withOpacity(0.05 + (i % 4) * 0.022);
      canvas.drawCircle(Offset(fx * size.width, drift * size.height), radius, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _DotField old) => old.t != t;
}

/// A circular progress arc around the status line.
class _SplashArc extends StatelessWidget {
  const _SplashArc({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 46,
      height: 46,
      child: CustomPaint(
        painter: _ArcPainter(progress: progress),
      ),
    );
  }
}

class _ArcPainter extends CustomPainter {
  _ArcPainter({required this.progress});

  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(2, 2, size.width - 4, size.height - 4);
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..color = Colors.white.withOpacity(0.20);
    canvas.drawArc(rect, 0, math.pi * 2, false, track);

    final sweep = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..shader = const SweepGradient(
        colors: [Color(0xFFFFFFFF), Color(0xFF7DD3FC), Color(0xFFFFFFFF)],
      ).createShader(rect);
    // Starts at the top and grows clockwise.
    canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * progress, false, sweep);
  }

  @override
  bool shouldRepaint(covariant _ArcPainter old) => old.progress != progress;
}
