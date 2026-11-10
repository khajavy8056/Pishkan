import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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

  /// Whether the OS asks for reduced motion (Android "Remove animations").
  ///
  /// Every animation in the app has to consult this, not just the splash.
  /// People who turn it on do so because motion makes them unwell, and a card
  /// that slides in is enough to cause it — the effect is not the point, the
  /// content is. When it is on, things still change state, they just do it
  /// without travelling.
  static bool reduced(BuildContext context) =>
      MediaQuery.maybeDisableAnimationsOf(context) ?? false;

  /// A duration that collapses to zero under reduced motion.
  static Duration scaled(BuildContext context, Duration duration) =>
      reduced(context) ? Duration.zero : duration;
}

/// The light that spreads from the finger during a press.
///
/// One `CustomPaint` and one controller: cheap enough to sit inside every
/// tappable card on a mid-range phone, and it stops itself when the class is
/// unmounted mid-press. It fades out on its own rather than being removed
/// instantly, so lifting the finger early does not leave a hard edge.
class _RippleBloom extends StatefulWidget {
  const _RippleBloom({super.key, required this.origin});

  final Offset origin;

  @override
  State<_RippleBloom> createState() => _RippleBloomState();
}

class _RippleBloomState extends State<_RippleBloom> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 520),
  )..forward();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tint = Theme.of(context).colorScheme.primary;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => CustomPaint(
        painter: _RipplePainter(progress: _controller.value, origin: widget.origin, tint: tint),
      ),
    );
  }
}

class _RipplePainter extends CustomPainter {
  _RipplePainter({required this.progress, required this.origin, required this.tint});

  final double progress;
  final Offset origin;
  final Color tint;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    // The radius that actually clears the widget: the distance from the touch
    // to the farthest corner, not the shorter side. Using the side leaves the
    // opposite corner untouched when the tap lands off-centre.
    final corners = <Offset>[
      Offset.zero,
      Offset(size.width, 0),
      Offset(0, size.height),
      Offset(size.width, size.height),
    ];
    final maxRadius = corners
        .map((c) => (c - origin).distance)
        .reduce((a, b) => a > b ? a : b)
        .clamp(1.0, double.infinity);
    final radius = maxRadius * Curves.easeOutCubic.transform(progress);
    // Bright at the start, gone by the end, and never above 16% — a ripple you
    // can see through the artwork rather than one that hides it.
    final alpha = (1 - progress) * 0.16;
    if (alpha <= 0.001) return;
    canvas.drawCircle(
      origin,
      radius,
      Paint()..shader = RadialGradient(
        colors: [tint.withOpacity(alpha), tint.withOpacity(alpha * 0.35), tint.withOpacity(0)],
        stops: const [0, 0.55, 1],
      ).createShader(Rect.fromCircle(center: origin, radius: radius)),
    );
  }

  @override
  bool shouldRepaint(covariant _RipplePainter old) =>
      old.progress != progress || old.origin != origin || old.tint != tint;
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
    transitionsBuilder: (context, animation, secondary, child) {
      final curved = CurvedAnimation(parent: animation, curve: PishkanMotion.enter, reverseCurve: PishkanMotion.exit);
      if (PishkanMotion.reduced(context)) {
        // State still changes; nothing travels.
        return FadeTransition(opacity: curved, child: child);
      }
      // The incoming page rises, fades, and grows from 98.5% to full size.
      // The earlier version slid 3.5% and faded, which is a correct transition
      // and a forgettable one; the small scale is what makes the surface feel
      // like it is opening *towards* the customer instead of being switched in.
      //
      // Note this is the incoming route only: a `transitionsBuilder` cannot
      // reach the page underneath, so there is deliberately no "outgoing page
      // recedes" effect here — writing one by animating `secondary` against
      // `child` would dim the page that is arriving, not the one leaving.
      return SlideTransition(
        position: Tween<Offset>(begin: const Offset(0, 0.045), end: Offset.zero).animate(curved),
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.985, end: 1).animate(curved),
          child: FadeTransition(opacity: curved, child: child),
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
    this.enabled = true,
  });

  final Widget child;
  final Duration delay;

  /// Set false to render at rest immediately.
  ///
  /// A lazily built list re-creates its rows as they scroll into view, so an
  /// always-on reveal would fade each new row in from nothing — a blank frame
  /// on every scroll. Stagger only what is on screen at first paint.
  final bool enabled;
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
    // `enabled: false` is also how reduced-motion callers opt out: the widget
    // renders at rest immediately instead of fading in from nothing.
    if (!widget.enabled) {
      _controller.value = 1;
    } else if (widget.delay == Duration.zero) {
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
    // Reduced motion keeps the state change and the haptic, and drops the
    // travel. A press still *feels* like a press; it just does not move.
    final animate = !PishkanMotion.reduced(context);
    return GestureDetector(
      onTapDown: (_) {
        setState(() => _down = true);
        Haptics.press();
      },
      onTapUp: (_) => setState(() => _down = false),
      onTapCancel: () => setState(() => _down = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _down && animate ? widget.scale : 1,
        duration: animate ? PishkanMotion.quick : Duration.zero,
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

/// Staggers a group of children so they arrive one after another instead of
/// all at once.
///
/// `RevealOnMount` alone only helps when each section is wrapped by hand, which
/// is how the home page ended up with two animated blocks and six static ones.
/// Wrapping the whole column in this makes every section participate, with a
/// single number controlling the rhythm.
///
/// Each child is offset by [step]; after [maxStagger] the offsets stop growing,
/// because a fourteen-section page would otherwise leave the last block waiting
/// two seconds, which reads as broken rather than elegant.
class StaggeredReveal extends StatelessWidget {
  const StaggeredReveal({
    super.key,
    required this.children,
    this.step = const Duration(milliseconds: 55),
    this.maxStagger = const Duration(milliseconds: 340),
    this.enabled = true,
  });

  final List<Widget> children;
  final Duration step;
  final Duration maxStagger;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++)
          RevealOnMount(
            enabled: enabled,
            delay: Duration(
              milliseconds: (step.inMilliseconds * i)
                  .clamp(0, maxStagger.inMilliseconds),
            ),
            child: children[i],
          ),
      ],
    );
  }
}

/// Haptics, in one vocabulary.
///
/// The app had none at all, which is why every press felt flat no matter how
/// much depth the button drew: the hand is half of tactile feedback and it was
/// being ignored. Three weights are enough — anything more becomes noise.
///
/// All of them are fire-and-forget. `HapticFeedback` returns a Future that
/// resolves when the platform channel replies, and awaiting it on the tap path
/// would put a frame of latency between the finger and the animation.
abstract final class Haptics {
  /// A selection changed: a chip, a segment, a tab.
  static void select() => HapticFeedback.selectionClick();

  /// A control was pressed. The default for buttons and cards.
  static void press() => HapticFeedback.lightImpact();

  /// Something completed or failed: submit, payment, error.
  static void settle() => HapticFeedback.mediumImpact();
}

/// Reveals its child when it actually scrolls into view — once.
///
/// `StaggeredReveal` fires on mount, which is right for a short page but wrong
/// for the home page: a section eight screens down has already finished its
/// animation by the time anyone gets there, so it just pops into existence.
/// This watches the scrollable it sits in and starts the reveal only when the
/// child crosses [_trigger] of the viewport.
///
/// Deliberately outside-in, not a global scroll listener: each section owns its
/// own trigger, so sections do not need to know how many are above them, and a
/// section that is already visible at first paint (the hero) animates
/// immediately instead of waiting for a scroll that may never come.
///
/// It does not touch the scroll position in any way — no hijacking, no locking,
/// no jump. The only thing it reads is whether it has been seen.
class ScrollDrivenReveal extends StatefulWidget {
  const ScrollDrivenReveal({
    super.key,
    required this.child,
    this.offset = 26,
    this.delay = Duration.zero,
    this.scaleFrom = 1,
    this.horizontal = false,
  });

  final Widget child;

  /// How far the child travels, in logical pixels.
  final double offset;

  /// Stagger, for siblings that share a trigger.
  final Duration delay;

  /// Start a little smaller and settle to 1 — used for cards that should feel
  /// like they are arriving rather than sliding.
  final double scaleFrom;

  /// Come in from the side instead of from below.
  final bool horizontal;

  /// How far up from the bottom edge counts as "in view".
  static const double _trigger = 0.90;

  @override
  State<ScrollDrivenReveal> createState() => _ScrollDrivenRevealState();
}

class _ScrollDrivenRevealState extends State<ScrollDrivenReveal> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: PishkanMotion.settled,
  );
  late final Animation<double> _curved = CurvedAnimation(parent: _controller, curve: PishkanMotion.enter);

  ScrollPosition? _position;
  bool _seen = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = Scrollable.maybeOf(context)?.position;
    if (identical(next, _position)) return;
    _position?.removeListener(_onScroll);
    _position = next;
    _position?.addListener(_onScroll);
    // Already on screen at first paint: animate now rather than on a scroll
    // that will never happen.
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  @override
  void dispose() {
    _position?.removeListener(_onScroll);
    _controller.dispose();
    super.dispose();
  }

  void _onScroll() => _check();

  void _check() {
    if (_seen || !mounted) return;
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return;
    final height = MediaQuery.sizeOf(context).height;
    final top = box.localToGlobal(Offset.zero).dy;
    // The child counts as arrived once its top is above the trigger line.
    if (top <= height * ScrollDrivenReveal._trigger) {
      _seen = true;
      if (widget.delay == Duration.zero) {
        _controller.forward();
      } else {
        Future<void>.delayed(widget.delay).then((_) {
          if (mounted) _controller.forward();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Reduced motion, and anything that has already been seen and rebuilt:
    // render at rest, with no controller work.
    if (PishkanMotion.reduced(context)) return widget.child;
    return AnimatedBuilder(
      animation: _curved,
      builder: (_, child) {
        final t = _curved.value;
        final shift = (1 - t) * widget.offset;
        return Opacity(
          opacity: t,
          child: Transform.translate(
            offset: widget.horizontal ? Offset(shift, 0) : Offset(0, shift),
            child: widget.scaleFrom == 1
                ? child
                : Transform.scale(scale: widget.scaleFrom + (1 - widget.scaleFrom) * t, child: child),
          ),
        );
      },
      child: widget.child,
    );
  }
}

/// Shifts its child against the scroll, for depth.
///
/// A small, bounded parallax: the child moves at [factor] of the scroll delta
/// relative to its own position, so content behind drifts slower than content
/// in front. Capped at [maxShift] so nothing can walk off its parent, and
/// disabled entirely under reduced motion.
class Parallax extends StatefulWidget {
  const Parallax({
    super.key,
    required this.child,
    this.factor = 0.18,
    this.maxShift = 28,
  });

  final Widget child;

  /// Fraction of the scroll distance to lag behind by. 0 is pinned, 1 is
  /// stationary in the world.
  final double factor;
  final double maxShift;

  @override
  State<Parallax> createState() => _ParallaxState();
}

class _ParallaxState extends State<Parallax> {
  ScrollPosition? _position;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = Scrollable.maybeOf(context)?.position;
    if (identical(next, _position)) return;
    _position?.removeListener(_tick);
    _position = next;
    _position?.addListener(_tick);
  }

  @override
  void dispose() {
    _position?.removeListener(_tick);
    super.dispose();
  }

  void _tick() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    if (PishkanMotion.reduced(context) || _position == null || !_position!.hasContentDimensions) {
      return widget.child;
    }
    final box = context.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return widget.child;
    // How far this widget's top is from the top of the viewport, normalised so
    // zero means "its top is exactly at the top edge".
    final scrolled = -box.localToGlobal(Offset.zero).dy;
    final shift = (scrolled * widget.factor).clamp(-widget.maxShift, widget.maxShift);
    return Transform.translate(offset: Offset(0, shift), child: widget.child);
  }
}

/// A tap that finishes its feedback *before* the next screen opens.
///
/// The default `onTap` navigates on the same frame the finger lifts, so the
/// press animation is cut off before it can be seen — the card shrinks for a
/// few milliseconds and is then covered by the incoming page. That is why the
/// cards felt like dead buttons even though they had a scale animation.
///
/// This holds the pressed state for [hold] first: the card dips, the ripple
/// spreads, the haptic fires, and only then does navigation start. Total added
/// latency is one sustained press, which reads as responsiveness rather than
/// delay because *something is visibly happening*.
///
/// Under reduced motion the hold collapses to zero — the movement is what is
/// being suppressed, not the tap.
class TactileTap extends StatefulWidget {
  const TactileTap({
    super.key,
    required this.child,
    required this.onTap,
    this.scale = 0.965,
    this.hold = const Duration(milliseconds: 130),
    this.enabled = true,
    this.ripple = true,
    this.rippleRadius = 22,
  });

  final Widget child;

  /// Runs after the press has been shown. May be async; the widget stays
  /// pressed until it completes, so a slow route still feels connected.
  final Future<void> Function() onTap;

  final double scale;
  final Duration hold;
  final bool enabled;

  /// A light spreading from the finger while the press is held.
  ///
  /// The scale alone tells you *that* something happened; the ripple tells you
  /// *where*, which is what makes a large card feel like a touched object
  /// rather than a block that blinked. Keep it off for anything whose own
  /// artwork already contains a light (the banner, whose photo it would wash).
  final bool ripple;

  /// The corner radius the bloom is clipped to.
  ///
  /// The bloom is a layer *over* the child, so without this it paints across
  /// the child's rounded corners and puts a coloured wedge outside the card.
  /// Pass the child's own radius; a pill wants something large (999).
  final double rippleRadius;

  @override
  State<TactileTap> createState() => _TactileTapState();
}

class _TactileTapState extends State<TactileTap> {
  bool _down = false;
  bool _busy = false;

  /// Where the finger landed, in the widget's own coordinates. A ripple that
  /// always blooms from the centre is a decoration; one that blooms from the
  /// thumb is feedback.
  Offset? _origin;
  int _sequence = 0;

  void _captureOrigin(TapDownDetails details) {
    _origin = details.localPosition;
  }

  Future<void> _handle() async {
    // A double tap while the first is still holding would open two pages.
    if (_busy || !widget.enabled) return;
    _busy = true;
    _sequence++;
    setState(() => _down = true);
    Haptics.press();
    // The hold is a plain timer on purpose. A controller would let tests settle
    // without knowing its length, but it also means a ticker running for a
    // 120 ms press on a screen full of cards — and this widget is instantiated
    // dozens of times per page. Tests pump the hold explicitly instead.
    if (!PishkanMotion.reduced(context)) {
      await Future<void>.delayed(widget.hold);
    }
    if (!mounted) {
      _busy = false;
      return;
    }
    try {
      await widget.onTap();
    } finally {
      if (mounted) {
        setState(() => _down = false);
        _busy = false;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final animate = !PishkanMotion.reduced(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: widget.ripple ? _captureOrigin : null,
      onTap: _handle,
      // Guarded: a cancel can arrive while the tree is being torn down (a route
      // push disposes the card mid-gesture), and `setState` after dispose is an
      // exception the customer sees as a red screen in debug and a dead tap in
      // release.
      onTapCancel: () {
        if (mounted) setState(() => _down = false);
      },
      child: AnimatedScale(
        scale: _down && animate ? widget.scale : 1,
        duration: animate ? PishkanMotion.quick : Duration.zero,
        curve: Curves.easeOutCubic,
        child: widget.ripple && animate
            ? Stack(
                // `passthrough`, not the default: the ripple must not steal the
                // hit area from whatever is underneath it.
                fit: StackFit.passthrough,
                children: [
                  widget.child,
                  if (_down && _origin != null)
                    Positioned.fill(
                      child: IgnorePointer(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(widget.rippleRadius),
                          child: _RippleBloom(origin: _origin!, key: ValueKey(_sequence)),
                        ),
                      ),
                    ),
                ],
              )
            : widget.child,
      ),
    );
  }
}
