import 'dart:async';

import 'package:flutter/material.dart';

import '../models/models.dart' show asMap;
import '../services/services.dart';
import 'sizes.dart';
import 'theme.dart';

/// Guided tour and contextual tips, on the phone.
///
/// The *words* come from the server (`/api/tours`), so the office edits one
/// catalogue for web and Android together, and a wording fix lands without a
/// release. What is decided here is only ever **geometry**: which registered
/// widget to frame, where the card fits on this screen, and how to follow it
/// while the page scrolls or the keyboard opens.
///
/// Two rules make this a guide instead of a popup:
///
///  * a step is drawn only while its anchor is on screen — an unregistered
///    anchor means the step is skipped, and the whole tour is not offered at all
///    on a screen where nothing of it exists;
///  * a tip is *requested*, never decided locally: [TourController.fireHint]
///    asks the server, which counts occurrences across every device and answers
///    whether this person has now made the same mistake often enough to be worth
///    interrupting. That is the difference between noticing and nagging, and it
///    has to live in one place for both clients.
class TourStepData {
  const TourStepData({
    required this.id,
    required this.targets,
    required this.title,
    required this.body,
    required this.interactive,
  });

  final String id;
  /// Anchor names, in preference order; the first one on screen wins.
  final List<String> targets;
  final String title;
  final String body;
  final bool interactive;

  static TourStepData fromMap(Map<String, dynamic> map) => TourStepData(
        id: (map['id'] ?? '').toString(),
        targets: [
          if ((map['target'] ?? '').toString().isNotEmpty) (map['target'] as String).replaceFirst('tour:', ''),
          for (final alt in (map['altTargets'] as List? ?? const [])) alt.toString().replaceFirst('tour:', ''),
        ],
        title: (map['title'] ?? '').toString(),
        body: (map['body'] ?? '').toString(),
        interactive: map['interactive'] == true,
      );
}

class TourData {
  const TourData({
    required this.code,
    required this.label,
    required this.anchor,
    required this.steps,
  });

  final String code;
  final String label;
  /// Which screen the tour belongs to. A replay asked for from anywhere else is
  /// parked until that screen appears, so a guide never starts in a place where
  /// it has nothing to point at.
  final String anchor;
  final List<TourStepData> steps;

  static TourData? fromMap(Map<String, dynamic> map) {
    final code = (map['code'] ?? '').toString();
    if (code.isEmpty) return null;
    final steps = (map['steps'] as List? ?? const [])
        .map((item) => TourStepData.fromMap(Map<String, dynamic>.from(item as Map)))
        .where((step) => step.title.isNotEmpty)
        .toList();
    if (steps.isEmpty) return null;
    return TourData(
      code: code,
      label: (map['label'] ?? 'راهنما').toString(),
      anchor: (map['anchor'] ?? '').toString(),
      steps: steps,
    );
  }
}

class TourTipData {
  const TourTipData({required this.key, required this.targets, required this.title, required this.body});

  final String key;
  final List<String> targets;
  final String title;
  final String body;

  static TourTipData? fromMap(Map<String, dynamic> map) {
    final key = (map['key'] ?? '').toString();
    if (key.isEmpty) return null;
    return TourTipData(
      key: key,
      targets: [
        if ((map['target'] ?? '').toString().isNotEmpty) (map['target'] as String).replaceFirst('tour:', ''),
        for (final alt in (map['altTargets'] as List? ?? const [])) alt.toString().replaceFirst('tour:', ''),
      ],
      title: (map['title'] ?? '').toString(),
      body: (map['body'] ?? '').toString(),
    );
  }
}

/// The live state of the tour layer, shared by every screen.
///
/// A single change notifier rather than per-screen state: a tour that starts on
/// the service page has to survive the push into the request wizard, and a tip
/// raised by the wizard must be dismissed by a tap anywhere. Two objects with
/// the same truth is how a guide ends up on screen twice.
class TourController extends ChangeNotifier {
  TourController._();
  static final TourController instance = TourController._();

  bool _loaded = false;
  bool _enabled = false;
  bool _autoStart = false;
  List<TourData> _tours = const [];

  String? _open;
  int _stepIndex = 0;
  /// Where this person left off, per tour — the server's answer, not a local
  /// guess, so the same account on the web and on the phone sees one progress.
  Map<String, Map<String, dynamic>> _progress = const {};
  TourTipData? _tip;
  Timer? _tipTimer;
  /// A tour the person asked for by name, waiting for a screen that can show it.
  String? _pending;
  Timer? _pendingTimer;
  /// Tours already offered in this session, so a rebuild cannot reopen one.
  final Set<String> _started = <String>{};

  /// Anchors currently mounted. A name may be held by more than one widget —
  /// a requirement row repeated per document, for instance — so the value is a
  /// list and the first one that is actually drawn wins.
  final Map<String, List<_RenderAnchorBox>> _registry = <String, List<_RenderAnchorBox>>{};
  /// Last frame each anchor reported for itself, captured during paint (see
  /// [_RenderAnchorBox.paint]). Geometry read at paint time is the geometry the
  /// user is seeing; read at build time it would be one frame old during a
  /// scroll, which is what makes a spotlight drift away from its target.
  final Map<_RenderAnchorBox, Rect> _frames = <_RenderAnchorBox, Rect>{};
  bool _remeasureScheduled = false;

  bool get isActive => _open != null || _tip != null;

  /// Which step of the open tour is showing. Exposed for the overlay; the page
  /// never drives it directly.
  int get stepIndex => _stepIndex;
  TourData? get current {
    for (final tour in _tours) {
      if (tour.code == _open) return tour;
    }
    return null;
  }

  TourStepData? get currentStep {
    final tour = current;
    if (tour == null || tour.steps.isEmpty) return null;
    return tour.steps[_stepIndex.clamp(0, tour.steps.length - 1)];
  }

  TourTipData? get tip => _tip;

  /// The guides this person can still be shown. The profile screen lists them,
  /// because a tour that was skipped has to be recoverable from somewhere —
  /// nothing in the app ever reopens one on its own.
  List<TourData> get offerings => List<TourData>.unmodifiable(_tours);

  /// Loads the catalogue once per sign-in; a failure leaves the app untouched.
  ///
  /// Deliberately silent: a tour is the least important thing on this screen,
  /// and an error dialog about it would be worse than no tour.
  Future<void> load() async {
    if (_loaded) return;
    try {
      final payload = await fetchTours();
      _enabled = payload['enabled'] == true;
      _autoStart = payload['autoStart'] == true;
      _tours = (payload['tours'] as List? ?? const [])
          .map((item) => TourData.fromMap(Map<String, dynamic>.from(item as Map)))
          .whereType<TourData>()
          .toList();
      _progress = {
        for (final entry in asMap(payload['state']).entries)
          entry.key: asMap(entry.value),
      };
      _loaded = true;
    } catch (_) {
      _loaded = true;
      _enabled = false;
      _tours = const [];
    }
    notifyListeners();
  }

  /// Called by the shell after login/logout: the tour state is per person.
  void resetForNewSession() {
    _loaded = false;
    _started.clear();
    _open = null;
    _stepIndex = 0;
    _tip = null;
    _tipTimer?.cancel();
    _frames.clear();
    // Whoever signs in next brings their own progress with them.
    unawaited(load());
  }

  /// A screen registering an anchor asks whether it should start a tour.
  ///
  /// The host screen calls nothing; the *anchor* does. A tour therefore begins
  /// exactly when the thing it explains appears, which is the only moment the
  /// person can connect the words to the button.
  void considerAutoStart(List<String> anchorNames) {
    final pending = _pending;
    if (pending != null) {
      // A replay asked for on another screen: this one is the first that can
      // actually show it, so the request lands here and nowhere else.
      if (_tryStart(pending, anchorNames)) {
        _pending = null;
        _pendingTimer?.cancel();
      }
      return;
    }
    if (!_enabled || !_autoStart || _open != null) return;
    for (final tour in _tours) {
      if (_started.contains(tour.code)) continue;
      // Finished once, never again on its own. The server already filters such
      // tours out of the payload; this guard covers the payload that arrived
      // from the cache of the very same session.
      if (_progress[tour.code]?['completed'] == true) continue;
      _tryStart(tour.code, anchorNames);
      return;
    }
  }

  /// Opens [code] at the first step whose anchor is on this screen.
  ///
  /// Returns false — and leaves the tour alone — when nothing of it is visible
  /// here. That single rule is what keeps a wrong pointer from ever appearing:
  /// the alternative is a card floating in the middle of an unrelated page.
  bool _tryStart(String code, List<String> anchorNames) {
    if (_open != null) return false;
    TourData? tour;
    for (final item in _tours) {
      if (item.code == code) tour = item;
    }
    final visible = tour == null ? null : _firstVisibleStep(tour, anchorNames);
    if (tour == null || visible == null) return false;
    _started.add(code);
    _open = code;
    _stepIndex = visible;
    notifyListeners();
    unawaited(recordTourProgress(tour.code, 'start', step: visible));
    return true;
  }

  /// The first step whose anchor is on this screen (skipping absent ones).
  int? _firstVisibleStep(TourData tour, List<String> anchorNames) {
    for (var index = 0; index < tour.steps.length; index += 1) {
      if (tour.steps[index].targets.any(anchorNames.contains)) return index;
    }
    return null;
  }

  Future<void> begin(String code, {int step = 0}) async {
    _started.add(code);
    _open = code;
    _stepIndex = step;
    notifyListeners();
    await recordTourProgress(code, step == 0 ? 'start' : 'step', step: step);
  }

  /// «راهنمای این صفحه» — the only way back after a skip or a finish.
  ///
  /// Starting with an explicit request is what lets the office turn auto-start
  /// off entirely without the guide becoming unreachable.
  Future<void> replay(String code) async {
    _started.remove(code);
    _pending = code;
    _pendingTimer?.cancel();
    // Parked, not dropped: the screen a tour belongs to may be a tap away. It
    // is forgotten after a while so a request made in one mood cannot fire
    // minutes later in another.
    _pendingTimer = Timer(const Duration(seconds: 20), () => _pending = null);
    considerAutoStart(anchorNames);
    await recordTourProgress(code, 'replay');
  }

  void next() {
    final tour = current;
    if (tour == null) return;
    if (_stepIndex >= tour.steps.length - 1) {
      complete();
      return;
    }
    _stepIndex += 1;
    notifyListeners();
    unawaited(recordTourProgress(tour.code, 'step', step: _stepIndex));
  }

  void previous() {
    if (_open == null || _stepIndex == 0) return;
    _stepIndex -= 1;
    notifyListeners();
  }

  void complete() {
    final code = _open;
    _open = null;
    _stepIndex = 0;
    notifyListeners();
    if (code != null) {
      unawaited(recordTourProgress(code, 'complete'));
      // Local mirror of what the server now knows, so a rebuild in this session
      // cannot reopen it while the write is still in flight.
      _progress[code] = {...?_progress[code], 'completed': true};
    }
  }

  /// Skipped on purpose: never forced again on this device, and the server may
  /// offer it once more after the office's retry gap.
  void dismiss() {
    final code = _open;
    _open = null;
    _stepIndex = 0;
    notifyListeners();
    if (code != null) {
      unawaited(recordTourProgress(code, 'dismiss'));
      // A dismissal is a pause, not an ending: the server offers the tour again
      // once the office's retry gap has passed. Locally we only stop asking for
      // the rest of this session, which is what «رد کردن» promises.
      _progress[code] = {...?_progress[code], 'dismissed': true};
    }
  }

  /// The wrong-action report. Answer comes back from the server.
  Future<void> fireHint(String key) async {
    if (!_enabled) return;
    try {
      final result = await postTourHint(key);
      if (result['show'] != true) return;
      final hint = TourTipData.fromMap(Map<String, dynamic>.from(result['hint'] as Map));
      if (hint == null) return;
      _tipTimer?.cancel();
      _tip = hint;
      notifyListeners();
      // Readable in one glance, then gone by itself: a tip that waits for a
      // button is a second dialog.
      _tipTimer = Timer(const Duration(seconds: 9), () {
        _tip = null;
        notifyListeners();
      });
    } catch (_) {}
  }

  /// Half a pixel is the smallest movement worth repainting for; below it the
  /// difference is sub-pixel layout rounding and the eye cannot see the target
  /// move anyway.
  static bool _moved(Rect a, Rect b) =>
      (a.left - b.left).abs() > 0.5 ||
      (a.top - b.top).abs() > 0.5 ||
      (a.width - b.width).abs() > 0.5 ||
      (a.height - b.height).abs() > 0.5;

  void dismissTip() {
    _tipTimer?.cancel();
    _tip = null;
    notifyListeners();
  }

  /* ------------------------------- registry ------------------------------- */

  void register(String name, _RenderAnchorBox box) {
    final list = _registry[name] ??= <_RenderAnchorBox>[];
    // A render object can be detached and re-attached (a subtree moved, not
    // rebuilt); the anchor is the same one, so it must not occupy two places.
    if (!list.any((item) => identical(item, box))) list.add(box);
  }

  void unregister(String name, _RenderAnchorBox box) {
    final list = _registry[name];
    if (list == null) return;
    list.removeWhere((item) => identical(item, box));
    if (list.isEmpty) _registry.remove(name);
    _frames.remove(box);
  }

  /// Called by an anchor on every frame it paints.
  ///
  /// The overlay above it is told to re-measure only when something actually
  /// moved, so a tour that is open on a still screen costs nothing per frame,
  /// and a screen that scrolls carries the spotlight with it.
  void reportPainted(_RenderAnchorBox box, Rect rect) {
    final previous = _frames[box];
    _frames[box] = rect;
    if (previous != null && !_moved(previous, rect)) return;
    if (!isActive || _remeasureScheduled) return;
    _remeasureScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _remeasureScheduled = false;
      if (_open != null || _tip != null) notifyListeners();
    });
  }

  /// The frame of the first present anchor, in screen coordinates.
  Rect? rectFor(List<String> names) {
    for (final name in names) {
      final boxes = _registry[name];
      if (boxes == null) continue;
      for (final box in boxes) {
        final rect = _frames[box] ?? box.measuredRect;
        if (rect == null) continue;
        if (rect.width < 2 || rect.height < 2) continue;
        if (!rect.isFinite) continue;
        return rect;
      }
    }
    return null;
  }

  /// Anchors whose target is on this screen — the eligibility question a tour
  /// asks before it offers itself at all.
  bool hasAnyAnchor(List<String> names) => rectFor(names) != null;

  List<String> get anchorNames => _registry.keys.toList();
}

/// Marks a widget as the thing a tour step points at.
///
/// A plain [Builder] is enough to own an [Element], and the element is what the
/// controller measures — no overlay, no RepaintBoundary, no extra layout, so
/// adding an anchor to a screen cannot change how that screen looks.
class TourAnchor extends StatefulWidget {
  const TourAnchor({super.key, required this.name, required this.child, this.autostart = false});

  final String name;
  final Widget child;
  /// True on the widget that opens a screen: it is the one that asks whether a
  /// tour should begin, so the question is asked once per visit and not once per
  /// anchored element.
  final bool autostart;

  @override
  State<TourAnchor> createState() => _TourAnchorState();
}

class _TourAnchorState extends State<TourAnchor> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _announce());
  }

  @override
  void didUpdateWidget(TourAnchor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.name != widget.name) WidgetsBinding.instance.addPostFrameCallback((_) => _announce());
  }

  void _announce() {
    if (!mounted) return;
    // A tour begins when the control it explains appears — not on a timer that
    // may fire before the first frame and point at nothing.
    if (widget.autostart) TourController.instance.considerAutoStart(TourController.instance.anchorNames);
  }

  @override
  Widget build(BuildContext context) {
    // Keyed by the name, so a renamed anchor (rare, but a conditional step can
    // do it) is torn down and re-registered instead of quietly keeping the old
    // target alive in the controller's registry.
    return _AnchorBox(key: ValueKey<String>('tour-anchor:${widget.name}'), name: widget.name, child: widget.child);
  }
}

/// The pass-through box an anchor needs in order to have a geometry of its own:
/// [RenderProxyBox] takes the size and position of its child exactly, so adding
/// an anchor around a control cannot change how the screen is laid out.
class _AnchorBox extends SingleChildRenderObjectWidget {
  const _AnchorBox({required this.name, required super.child});

  final String name;

  @override
  _RenderAnchorBox createRenderObject(BuildContext context) => _RenderAnchorBox(name);

  // No `updateRenderObject`: the name is fixed for the life of the box, and
  // `_TourAnchorState` re-keys this widget if it ever changes, so a render
  // object is never reused under a name its registration does not match.
}

class _RenderAnchorBox extends RenderProxyBox {
  _RenderAnchorBox(this.name);

  /// The name a tour step refers to. Final and per-render-object: registration
  /// follows the render object's own lifetime, so a screen that is torn down
  /// cannot leave a stale anchor behind for the next one to point at.
  final String name;

  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    TourController.instance.register(name, this);
  }

  @override
  void detach() {
    TourController.instance.unregister(name, this);
    super.detach();
  }

  /// This box's frame in screen coordinates, taken whenever something needs it
  /// and no paint report has arrived yet for this frame.
  Rect? get measuredRect {
    if (!hasSize || !attached) return null;
    try {
      return localToGlobal(Offset.zero) & size;
    } catch (_) {
      return null;
    }
  }

  @override
  void paint(PaintingContext context, Offset offset) {
    super.paint(context, offset);
    if (size.isEmpty) return;
    // Reported from inside paint, which is the one moment the ancestor
    // transforms of this frame are all in place.
    TourController.instance.reportPainted(this, localToGlobal(Offset.zero) & size);
  }
}

/// The scrim, the spotlight and the card. Mounted above the router.
class TourOverlay extends StatefulWidget {
  const TourOverlay({super.key});

  @override
  State<TourOverlay> createState() => _TourOverlayState();
}

class _TourOverlayState extends State<TourOverlay> {
  @override
  void initState() {
    super.initState();
    TourController.instance.addListener(_onTourChanged);
  }

  @override
  void dispose() {
    TourController.instance.removeListener(_onTourChanged);
    super.dispose();
  }

  void _onTourChanged() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final controller = TourController.instance;
    final step = controller.currentStep;
    final tip = controller.tip;
    if (step == null && tip == null) return const SizedBox.shrink();

    // Read from what the anchor reported while painting, which is this frame's
    // geometry — a spotlight measured at build time would trail the page by one
    // frame during a scroll and look detached from its target.
    final target = controller.rectFor(step?.targets ?? tip!.targets);
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return TweenAnimationBuilder<Rect>(
      duration: reduceMotion ? Duration.zero : const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      tween: RectTween(begin: target ?? Rect.zero, end: target ?? Rect.zero),
      builder: (context, hole, __) => Stack(children: [
        Positioned.fill(
          child: _Spotlight(
            // No cutout when the anchor is not on this screen: the card drops to
            // the bottom of the page without a pointer, so the person can still
            // read it, continue, or get out — a guide that cannot find its
            // target must never become a wall.
            hole: target == null ? null : hole,
            // On a "do this" step the page stays usable: the instruction and the
            // action are one gesture, and using the control advances the tour.
            blocking: step != null && !step.interactive,
          ),
        ),
        if (step != null)
          _TourCard(key: ValueKey('tour-${step.id}'), step: step, target: target, controller: controller, bottomInset: bottomInset)
        else
          _TourTipCard(key: ValueKey('tip-${tip.key}'), tip: tip!, target: target, controller: controller, bottomInset: bottomInset),
      ]),
    );
  }
}

class _Spotlight extends StatelessWidget {
  const _Spotlight({required this.hole, required this.blocking});

  /// The control to frame, or null for a tip — a tip dims the page but keeps
  /// the whole screen usable, because it interrupts without demanding anything.
  final Rect? hole;
  final bool blocking;

  @override
  Widget build(BuildContext context) {
    // An opaque tap-eater rather than a ModalBarrier: a tour step that says
    // "tap this" must let the tap through to the real control, while a step that
    // only explains must not let a stray press start a payment.
    return IgnorePointer(
      ignoring: !blocking,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {},
        child: CustomPaint(painter: _ScrimPainter(hole: hole), size: Size.infinite),
      ),
    );
  }
}

class _ScrimPainter extends CustomPainter {
  const _ScrimPainter({required this.hole});

  final Rect? hole;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = const Color(0xA8061224);
    if (hole == null) {
      canvas.drawRect(Offset.zero & size, paint);
      return;
    }
    // The dark field with one hole in it, cut with `Path.combine` rather than
    // four rectangles: the edge is exactly the rounded shape of the control, and
    // the ring below can share that one path.
    final framed = hole!.inflate(8);
    canvas.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect(Offset.zero & size),
        Path()..addRRect(RRect.fromRectAndRadius(framed, const Radius.circular(14))),
      ),
      paint,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(framed, const Radius.circular(14)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = Colors.white.withValues(alpha: 0.95),
    );
  }

  @override
  bool shouldRepaint(covariant _ScrimPainter oldDelegate) => oldDelegate.hole != hole;
}

/// Card placement: below the target when there is room, above when there is
/// not, and always inside the viewport *and* clear of the keyboard.
///
/// Deliberately free of `clamp`: a card taller than the space left by an open
/// keyboard inverts the range and `num.clamp` throws on that, which is the kind
/// of crash that only happens on a small phone with the suggest bar up. The band
/// is computed first and the box is fitted into it instead.
Rect cardRectFor({required Rect? target, required Size card, required Size screen, double bottomInset = 0}) {
  const gap = 12.0;
  const margin = 12.0;
  final bandTop = margin;
  final wantedBottom = screen.height - bottomInset - margin;
  final bandBottom = wantedBottom > bandTop + 48 ? wantedBottom : bandTop + 48;
  final maxWidth = screen.width - 2 * margin;
  final width = card.width > maxWidth ? maxWidth : card.width;
  final height = card.height > bandBottom - bandTop ? bandBottom - bandTop : card.height;

  var top = target == null ? bandBottom - height : target.bottom + gap;
  if (target != null && top + height > bandBottom && target.top - gap - height > bandTop) {
    top = target.top - gap - height;
  }
  if (top + height > bandBottom) top = bandBottom - height;
  if (top < bandTop) top = bandTop;

  var left = target == null ? (screen.width - width) / 2 : target.center.dx - width / 2;
  final maxLeft = screen.width - width - margin;
  if (maxLeft < margin || left < margin) {
    left = margin;
  } else if (left > maxLeft) {
    left = maxLeft;
  }
  return Rect.fromLTWH(left, top, width, height);
}

class _TourCard extends StatefulWidget {
  const _TourCard({
    super.key,
    required this.step,
    required this.target,
    required this.controller,
    required this.bottomInset,
  });

  final TourStepData step;
  final Rect? target;
  final TourController controller;
  final double bottomInset;

  @override
  State<_TourCard> createState() => _TourCardState();
}

class _TourCardState extends State<_TourCard> {
  final GlobalKey _cardKey = GlobalKey();
  Size _cardSize = const Size(330, 150);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _measure());
  }

  void _measure() {
    if (!mounted) return;
    final box = _cardKey.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return;
    if ((box.size.width - _cardSize.width).abs() < 0.5 && (box.size.height - _cardSize.height).abs() < 0.5) return;
    setState(() => _cardSize = box.size);
  }

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final tour = widget.controller.current;
    final rect = cardRectFor(target: widget.target, card: _cardSize, screen: screen, bottomInset: widget.bottomInset);
    final stepIndex = widget.controller.stepIndex;
    final last = tour == null || stepIndex >= tour.steps.length - 1;
    final sizes = context.sizes;
    return Positioned.fromRect(
      rect: rect,
      child: Material(
        key: _cardKey,
        color: Colors.transparent,
        child: Container(
          padding: EdgeInsets.fromLTRB(sizes.cardPad, sizes.s(12), sizes.cardPad, sizes.s(10)),
          decoration: BoxDecoration(
            color: const Color(0xF20B1F3A),
            borderRadius: BorderRadius.circular(sizes.cardRadius),
            border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
            boxShadow: const [BoxShadow(color: Color(0x59000000), blurRadius: 26, offset: Offset(0, 8))],
          ),
          // Scrolls rather than clipping when the space left for it is shorter
          // than the copy needs — a tour step nobody can finish reading is a
          // step nobody can follow.
          child: SingleChildScrollView(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (tour != null)
              Row(children: [
                Expanded(
                  child: Text(tour.label, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.62), fontFamily: 'Vazirmatn')),
                ),
                Text('${stepIndex + 1} از ${tour.steps.length}',
                    style: TextStyle(fontSize: 10.5, color: Colors.white.withValues(alpha: 0.62), fontFamily: 'Vazirmatn')),
              ]),
            SizedBox(height: sizes.s(6)),
            Text(widget.step.title,
                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: Colors.white, fontFamily: 'Vazirmatn', height: 1.6)),
            SizedBox(height: sizes.s(5)),
            Text(widget.step.body,
                style: TextStyle(fontSize: 12, color: Colors.white.withValues(alpha: 0.9), fontFamily: 'Vazirmatn', height: 1.9)),
            SizedBox(height: sizes.s(8)),
            Row(children: [
              TextButton(
                onPressed: widget.controller.dismiss,
                child: const Text('رد کردن', style: TextStyle(fontSize: 12, color: Colors.white70, fontFamily: 'Vazirmatn', fontWeight: FontWeight.w700)),
              ),
              const Spacer(),
              if (stepIndex > 0)
                TextButton(
                  onPressed: widget.controller.previous,
                  child: const Text('قبلی', style: TextStyle(fontSize: 12, color: Colors.white70, fontFamily: 'Vazirmatn', fontWeight: FontWeight.w700)),
                ),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: PishkanColors.navy),
                onPressed: widget.controller.next,
                child: Text(widget.step.interactive ? 'انجامش می‌دهم' : (last ? 'فهمیدم' : 'بعدی'),
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, fontFamily: 'Vazirmatn')),
              ),
            ]),
            if (widget.step.interactive)
              Padding(
                padding: EdgeInsets.only(top: sizes.s(2)),
                child: Text('همین حالا روی همان دکمه بزنید؛ راهنما خودش ادامه را می‌گیرد.',
                    style: TextStyle(fontSize: 10.5, color: Colors.white.withValues(alpha: 0.62), fontFamily: 'Vazirmatn', height: 1.7)),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _TourTipCard extends StatelessWidget {
  const _TourTipCard({
    super.key,
    required this.tip,
    required this.target,
    required this.controller,
    required this.bottomInset,
  });

  final TourTipData tip;
  final Rect? target;
  final TourController controller;
  final double bottomInset;

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final sizes = context.sizes;
    // Tips are narrow and self-dismissing: a nudge in the corner of attention,
    // not a dialog that has to be answered before work can continue.
    final width = screen.width - 32;
    final card = Size(width < 330.0 ? width : 330.0, 116);
    final rect = cardRectFor(target: target, card: card, screen: screen, bottomInset: bottomInset);
    return Positioned.fromRect(
      rect: rect,
      child: Material(
        color: Colors.transparent,
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: sizes.s(12), vertical: sizes.s(10)),
          decoration: BoxDecoration(
            color: const Color(0xF20B1F3A),
            borderRadius: BorderRadius.circular(sizes.cardRadius),
            border: Border.all(color: PishkanColors.accent.withValues(alpha: 0.5)),
            boxShadow: const [BoxShadow(color: Color(0x4D000000), blurRadius: 18, offset: Offset(0, 6))],
          ),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(Icons.auto_awesome_rounded, size: 16, color: PishkanColors.accent),
            SizedBox(width: sizes.s(8)),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(tip.title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: Colors.white, fontFamily: 'Vazirmatn')),
                SizedBox(height: sizes.s(3)),
                Flexible(
                  child: Text(tip.body,
                      maxLines: 4,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11.5, color: Colors.white.withValues(alpha: 0.88), fontFamily: 'Vazirmatn', height: 1.75)),
                ),
              ]),
            ),
            IconButton(
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
              onPressed: controller.dismissTip,
              icon: const Icon(Icons.close_rounded, size: 15, color: Colors.white70),
              tooltip: 'بستن',
            ),
          ]),
        ),
      ),
    );
  }
}
