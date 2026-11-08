import 'package:flutter/material.dart';

/// Motion vocabulary for the whole app.
///
/// One place for durations and curves, so nothing feels improvised: the app
/// should read as a single object that responds, not a set of screens that
/// happen to load. Everything here is deliberately short (110–320 ms) —
/// long animations make a service app feel slow, and a customer checking a
/// case status wants the answer, not a show.
abstract final class PishkanMotion {
  /// Micro-feedback: a press, a tick, a chip selecting.
  static const Duration quick = Duration(milliseconds: 120);
  /// Standard UI transition: sheets, tabs, reveals.
  static const Duration standard = Duration(milliseconds: 220);
  /// Larger surfaces: page bodies, banners.
  static const Duration settled = Duration(milliseconds: 320);

  static const Curve enter = Curves.easeOutCubic;
  static const Curve exit = Curves.easeInCubic;
  static const Curve spring = Curves.easeOutBack;
}

/// A page route that fades and lifts its content instead of sliding in from
/// the side. Material's default horizontal slide reads as "another app screen
/// in a stack"; a short rise feels like a card opening, which matches the
/// rounded, floating surfaces the rest of the design uses.
Route<T> fadeThroughRoute<T>(Widget page, {Duration? duration}) {
  return PageRouteBuilder<T>(
    transitionDuration: duration ?? PishkanMotion.standard,
    reverseTransitionDuration: PishkanMotion.standard,
    pageBuilder: (_, _, _) => page,
    transitionsBuilder: (_, animation, secondary, child) {
      final curved = CurvedAnimation(parent: animation, curve: PishkanMotion.enter, reverseCurve: PishkanMotion.exit);
      // The outgoing page drifts back very slightly, which gives depth without
      // the "two pages fighting for the same space" feel of a full slide.
      final back = Tween<double>(begin: 0, end: -0.012).animate(secondary);
      return FadeTransition(
        opacity: curved,
        child: SlideTransition(
          position: Tween<Offset>(begin: const Offset(0, 0.035), end: Offset.zero).animate(curved),
          child: ScaleTransition(scale: Tween<double>(begin: 1, end: 1).animate(back), child: child),
        ),
      );
    },
  );
}

/// Reveals its child once, on first build — used to stagger lists so content
/// arrives in a wave instead of appearing all at once.
class RevealOnMount extends StatefulWidget {
  const RevealOnMount({
    super.key,
    required this.child,
    this.delay = Duration.zero,
    this.offset = 0.06,
  });

  final Widget child;
  final Duration delay;
  /// Fraction of the child's own height to rise from. Small on purpose.
  final double offset;

  @override
  State<RevealOnMount> createState() => _RevealOnMountState();
}

class _RevealOnMountState extends State<RevealOnMount> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: PishkanMotion.settled);
  late final Animation<double> _curved = CurvedAnimation(parent: _controller, curve: PishkanMotion.enter);

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      _controller.forward();
    } else {
      // A widget can be disposed before its delay elapses (fast tab switching).
      Future<void>.delayed(widget.delay).then((_) {
        if (mounted) _controller.forward();
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _curved,
      builder: (_, child) => Opacity(
        opacity: _curved.value,
        child: Transform.translate(
          offset: Offset(0, (1 - _curved.value) * 18 * (widget.offset / 0.06)),
          child: child,
        ),
      ),
      child: widget.child,
    );
  }
}

/// Cross-fades between children when the key changes — the standard way a
/// loading spinner should become content, or an empty state should become a
/// list, without the layout jumping.
class SoftSwitcher extends StatelessWidget {
  const SoftSwitcher({super.key, required this.child, this.duration});

  final Widget child;
  final Duration? duration;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: duration ?? PishkanMotion.standard,
      switchInCurve: PishkanMotion.enter,
      switchOutCurve: PishkanMotion.exit,
      // Explicit fade: AnimatedSwitcher's default transition is a *scale*, and
      // scaling a whole page reads as a pop. A cross-fade is the calm version.
      transitionBuilder: (child, animation) => FadeTransition(opacity: animation, child: child),
      // The stack must accept the incoming child's own size rather than
      // forcing it to fill: this widget wraps a full-screen tab body in one
      // place and a short tab panel inside a scrolling list in another, so
      // `StackFit.expand` would stretch the panel and shift the page.
      layoutBuilder: (current, previous) => Stack(
        alignment: Alignment.topLeft,
        children: [...previous, if (current != null) current],
      ),
      child: child,
    );
  }
}

/// A number that counts up when it appears, then stays put.
///
/// Used for the dashboard counters and the case-progress percentage: it draws
/// the eye to the one number that changed, once, and never animates again
/// while the screen is open.
class CountUpText extends StatelessWidget {
  const CountUpText(
    this.value, {
    super.key,
    required this.builder,
    this.duration = const Duration(milliseconds: 700),
  });

  final num value;
  /// Receives the *animated* value, so the caller keeps its own formatter
  /// (Persian digits, currency, percent sign) instead of being handed a
  /// pre-baked string.
  final Widget Function(BuildContext, num) builder;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: value.toDouble()),
      duration: duration,
      curve: Curves.easeOutCubic,
      builder: (context, animated, _) => builder(context, animated.round()),
    );
  }
}

/// Scales its child down while pressed — the tactile response every tappable
/// surface should have, in one line at the call site.
class PressableScale extends StatefulWidget {
  const PressableScale({super.key, required this.child, this.onTap, this.scale = 0.965});

  final Widget child;
  final VoidCallback? onTap;
  final double scale;

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) => setState(() => _down = true),
      onTapUp: (_) => setState(() => _down = false),
      onTapCancel: () => setState(() => _down = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _down ? widget.scale : 1,
        duration: PishkanMotion.quick,
        curve: PishkanMotion.enter,
        child: widget.child,
      ),
    );
  }
}

/// Shimmer for a placeholder that is genuinely waiting on the network.
///
/// A plain grey box reads as "broken"; a slow sweep reads as "working". The
/// sweep is 1.4 s and low-contrast, so it never competes with real content.
class ShimmerBox extends StatefulWidget {
  const ShimmerBox({super.key, this.width, this.height = 14, this.radius = 8});

  final double? width;
  final double height;
  final double radius;

  @override
  State<ShimmerBox> createState() => _ShimmerBoxState();
}

class _ShimmerBoxState extends State<ShimmerBox> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = dark ? const Color(0xFF1D3153) : const Color(0xFFE8EEF7);
    final shine = dark ? const Color(0xFF27405F) : const Color(0xFFF4F8FE);
    return AnimatedBuilder(
      animation: _controller,
      builder: (_, _) => Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.radius),
          gradient: LinearGradient(
            begin: Alignment(-1.6 + _controller.value * 3.2, 0),
            end: Alignment(-0.6 + _controller.value * 3.2, 0),
            colors: [base, shine, base],
            stops: const [0.25, 0.5, 0.75],
          ),
        ),
      ),
    );
  }
}
