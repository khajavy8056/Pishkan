import 'package:flutter/material.dart';

import '../core/sizes.dart';
import '../core/theme.dart';

/// The blue sweep that sits behind the top of every screen, with its decorative
/// circles.
///
/// The reference design uses one continuous curved surface at the top of the
/// page rather than a flat app bar: the search field sits *on* the blue, the
/// content starts on white below it, and the boundary is a curve so the two
/// halves read as one object. Doing that per-screen with a Container and a
/// hard-coded height is how the header height drifts between pages, so it lives
/// here.
class BrandBackdrop extends StatelessWidget {
  const BrandBackdrop({
    super.key,
    required this.child,
    this.height,
    this.curved = true,
  });

  final Widget child;

  /// Defaults to a share of the screen: the header holds a title row plus a
  /// search field on some pages and only a title on others, so it is measured
  /// in practice -- this is the fallback for pages that do not pass one.
  final double? height;

  /// Pages that put the disclaimer directly under the header turn this off.
  final bool curved;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final h = height ?? sizes.s(196);
    return SizedBox(
      height: h,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(child: CustomPaint(painter: _BackdropPainter(dark: context.isDark))),
          // A large soft glow, off-canvas, gives the blue some depth without a
          // second gradient direction fighting the first.
          Positioned(
            top: -sizes.s(70),
            left: -sizes.s(60),
            child: Container(
              width: sizes.s(220),
              height: sizes.s(220),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withOpacity(context.isDark ? 0.04 : 0.10),
              ),
            ),
          ),
          Positioned(
            top: sizes.s(24),
            right: -sizes.s(40),
            child: Container(
              width: sizes.s(120),
              height: sizes.s(120),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withOpacity(context.isDark ? 0.03 : 0.07),
              ),
            ),
          ),
          Positioned.fill(child: SafeArea(bottom: false, child: child)),
        ],
      ),
    );
  }
}

class _BackdropPainter extends CustomPainter {
  const _BackdropPainter({required this.dark});

  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(0, 0, size.width, size.height);
    // Same brand gradient as the hero card, so the header and any card that
    // sits on it belong to one family.
    final paint = Paint()
      ..shader = (dark ? PishkanColors.deepGradient : PishkanColors.brandGradient)
          .createShader(rect);
    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width, size.height - 26)
      ..quadraticBezierTo(size.width * 0.5, size.height + 30, 0, size.height - 26)
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _BackdropPainter old) => old.dark != dark;
}

/// A screen title row: optional back button, the title, and optional trailing
/// action, all on the blue backdrop.
class ScreenHeading extends StatelessWidget {
  const ScreenHeading({
    super.key,
    required this.title,
    this.onBack,
    this.trailing,
    this.subtitle,
  });

  final String title;
  final VoidCallback? onBack;
  final Widget? trailing;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    return Padding(
      padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(6), sizes.gutter, sizes.s(4)),
      child: Row(
        children: [
          if (onBack != null) ...[
            _GlassButton(icon: Icons.arrow_forward_rounded, onTap: onBack!, label: 'بازگشت'),
            SizedBox(width: sizes.s(10)),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: sizes.display,
                    fontWeight: FontWeight.w800,
                    height: 1.3,
                  ),
                ),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: Colors.white.withOpacity(0.82), fontSize: sizes.caption),
                  ),
              ],
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// Round translucent button used on top of the blue backdrop.
class _GlassButton extends StatelessWidget {
  const _GlassButton({required this.icon, required this.onTap, required this.label});

  final IconData icon;
  final VoidCallback onTap;
  final String label;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: Colors.white.withOpacity(0.18),
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: sizes.iconButton,
            height: sizes.iconButton,
            child: Icon(icon, color: Colors.white, size: sizes.s(20)),
          ),
        ),
      ),
    );
  }
}

/// The white pill that floats over the body and holds the app's icon buttons.
class FloatingIconButton extends StatelessWidget {
  const FloatingIconButton({
    super.key,
    required this.icon,
    required this.label,
    this.onTap,
    this.badge = 0,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: context.surface,
        shape: const CircleBorder(),
        elevation: 0,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: SizedBox(
            width: sizes.iconButton + sizes.s(2),
            height: sizes.iconButton + sizes.s(2),
            child: Stack(alignment: Alignment.center, children: [
              Icon(icon, color: context.ink, size: sizes.s(20)),
              if (badge > 0)
                Positioned(
                  top: sizes.s(7),
                  right: sizes.s(7),
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: sizes.s(4), vertical: sizes.s(1)),
                    constraints: BoxConstraints(minWidth: sizes.s(15)),
                    decoration: BoxDecoration(
                      color: PishkanColors.danger,
                      borderRadius: BorderRadius.circular(99),
                      border: Border.all(color: context.surface, width: 1.5),
                    ),
                    child: Text(
                      badge > 9 ? '۹+' : '$badge',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white, fontSize: sizes.s(8.5), fontWeight: FontWeight.w800, height: 1.3),
                    ),
                  ),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}
