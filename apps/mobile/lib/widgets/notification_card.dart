import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../services/notifier.dart';

/// The floating "something happened on your case" card, and the tray-row
/// equivalent used in the notification centre.
///
/// ## Why a separate widget
///
/// The three places a notification appears — the floating banner, the
/// notification centre list, and the system tray — should look like the same
/// thing happened. The tray is drawn natively (Android), so the two Flutter
/// surfaces share this widget: same icon, same accent colour per category, same
/// stage ring and progress bar. It also makes the layout testable without
/// pumping the whole shell.
///
/// ## The stage case specifically
///
/// "Your case moved to step 3 of 5" is the notification a customer actually
/// cares about, so it gets the richest treatment: a determinate progress bar
/// and the current stage name in the accent colour, the way a ride-hailing app
/// shows how far the driver is. Every other kind stays a plain, compact row —
/// a wall of progress bars would make the real one meaningless.
class PishkanNotificationCard extends StatelessWidget {
  const PishkanNotificationCard({
    super.key,
    required this.event,
    this.onTap,
    this.onDismiss,
    this.compact = false,
    this.timeLabel = '',
  });

  final AppNotificationEvent event;
  final VoidCallback? onTap;
  final VoidCallback? onDismiss;

  /// Banner mode (floating, dismissible) versus list mode (dense, in the
  /// notification centre). Same anatomy, different padding.
  final bool compact;
  final String timeLabel;

  @override
  Widget build(BuildContext context) {
    final color = event.color;
    final progress = event.progress;
    final radius = compact ? 18.0 : 14.0;

    return Semantics(
      button: onTap != null,
      label: '${event.title}. ${event.body}',
      child: GestureDetector(
        onTap: onTap,
        onVerticalDragEnd: onDismiss == null ? null : (_) => onDismiss!(),
        child: Container(
          padding: EdgeInsets.fromLTRB(compact ? 14 : 12, compact ? 12 : 11, compact ? 12 : 12, compact ? 12 : 11),
          decoration: BoxDecoration(
            color: context.surface,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: progress != null ? color.withOpacity(0.28) : context.hairline),
            boxShadow: compact
                ? const [BoxShadow(color: Color(0x2A0B1F3A), blurRadius: 24, offset: Offset(0, 10))]
                : null,
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              // Progress cases get a ring around the icon showing the same
              // fraction as the bar below: one glance, no reading.
              _Leading(event: event, color: color, progress: progress),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(
                      child: Text(
                        event.title,
                        maxLines: compact ? 1 : 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontWeight: FontWeight.w800, fontSize: compact ? 13.5 : 13, color: context.ink, height: 1.5),
                      ),
                    ),
                    if (timeLabel.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: Text(timeLabel, style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
                      ),
                  ]),
                  if (event.body.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      event.body,
                      maxLines: compact ? 2 : 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11.5, color: context.inkMuted, height: 1.65),
                    ),
                  ],
                ]),
              ),
              if (onDismiss != null)
                IconButton(
                  icon: Icon(Icons.close_rounded, size: 18, color: context.inkMuted),
                  onPressed: onDismiss,
                  visualDensity: VisualDensity.compact,
                  tooltip: 'بستن',
                )
              else if (onTap != null)
                Icon(Icons.chevron_left_rounded, color: context.inkMuted, size: 20),
            ]),
            if (progress != null) ...[
              SizedBox(height: compact ? 10 : 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: progress.clamp(0, 1).toDouble(),
                  minHeight: 6,
                  backgroundColor: color.withOpacity(0.14),
                  valueColor: AlwaysStoppedAnimation<Color>(color),
                ),
              ),
              if (event.stageLabel.isNotEmpty) ...[
                const SizedBox(height: 5),
                Row(children: [
                  Icon(Icons.timeline_rounded, size: 13, color: color),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      'مرحلهٔ فعلی: ${event.stageLabel}',
                      style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: color),
                    ),
                  ),
                  Text(
                    '٪${faDigits((progress.clamp(0, 1) * 100).round())}',
                    style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: color),
                  ),
                ]),
              ],
            ],
          ]),
        ),
      ),
    );
  }
}

class _Leading extends StatelessWidget {
  const _Leading({required this.event, required this.color, required this.progress});

  final AppNotificationEvent event;
  final Color color;
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final icon = Container(
      padding: const EdgeInsets.all(9),
      decoration: BoxDecoration(color: color.withOpacity(0.13), shape: BoxShape.circle),
      child: Icon(event.icon, color: color, size: 20),
    );
    if (progress == null) return icon;
    // A ring, not a second bar: the bar below already carries the same number.
    //
    // Painted rather than a CircularProgressIndicator: that widget drives an
    // AnimationController even when determinate, which puts a permanent
    // requestFrameCallback in the banner that floats on top of the home screen.
    // A static ring costs one paint.
    return SizedBox(
      width: 40,
      height: 40,
      child: Stack(alignment: Alignment.center, children: [
        Positioned.fill(
          child: CustomPaint(painter: _RingPainter(fraction: progress!.clamp(0, 1).toDouble(), color: color)),
        ),
        Container(
          padding: const EdgeInsets.all(5),
          decoration: BoxDecoration(color: color.withOpacity(0.13), shape: BoxShape.circle),
          child: Icon(event.icon, color: color, size: 17),
        ),
      ]),
    );
  }
}

/// A quiet "unread" pip, used by list rows.
class UnreadPip extends StatelessWidget {
  const UnreadPip({super.key, this.size = 9});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(color: PishkanColors.danger, shape: BoxShape.circle),
    );
  }
}

/// The determinate ring around a stage icon.
class _RingPainter extends CustomPainter {
  const _RingPainter({required this.fraction, required this.color});

  final double fraction;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 2.4;
    final rect = Offset.zero & size;
    final arc = Rect.fromCircle(center: rect.center, radius: (size.shortestSide - stroke) / 2);
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = color.withOpacity(0.14);
    final fill = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..color = color;
    canvas.drawArc(arc, 0, 6.283185307179586, false, track);
    if (fraction > 0) canvas.drawArc(arc, -1.5707963267948966, 6.283185307179586 * fraction, false, fill);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.fraction != fraction || old.color != color;
}
