import 'dart:async';
import 'dart:io';
import 'dart:ui' show ImageFilter;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../core/motion.dart';
import '../core/service_icons.dart';
import '../core/stages.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../screens/document_camera.dart';
import '../services/notifier.dart' show AppPrefs;
import '../services/services.dart';

/// Short, soft tick for in-app interactions (saved, failed, tapped).
///
/// Off unless the customer turns it on: on a service app these fire on almost
/// every press, and hearing a click dozens of times a session is noise, not
/// feedback. The *notification* sound is a different switch and stays on.
Future<void> playAppSound(String kind) async {
  try {
    if (!await AppPrefs.uiSoundsEnabled()) return;
    await const MethodChannel('ir.pishkan.app/sounds').invokeMethod<void>('play', {'kind': kind});
  } catch (_) {
    // Feedback is optional; a missing channel must never surface to the user.
  }
}

/// A confirmation the customer can hear as well as read.
void showSuccess(BuildContext context, String message) {
  unawaited(playAppSound('success'));
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(message, style: TextStyle(fontFamily: 'Vazirmatn')),
    backgroundColor: context.positive,
    behavior: SnackBarBehavior.floating,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
  ));
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  if (error) unawaited(playAppSound('error'));
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    // The theme sets white text on a dark bar, so an error may not simply swap
    // in a lighter red: white on #F87171 is about 2.8:1 and reads as smeared.
    // In dark mode keep the dark bar and reach for the red accent instead.
    content: Text(message, style: TextStyle(
      fontFamily: 'Vazirmatn',
      color: error && context.isDark ? PishkanColors.darkDanger : null,
    )),
    backgroundColor: error
        ? (context.isDark ? PishkanColors.darkSurfaceHigh : context.negative)
        : (context.isDark ? PishkanColors.darkSurfaceHigh : PishkanColors.navy),
    behavior: SnackBarBehavior.floating,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
  ));
}

Future<bool> confirmDialog(BuildContext context, String title, String body, {String confirmLabel = 'تأیید', bool danger = false}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(body, style: const TextStyle(fontSize: 14, height: 1.7)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('انصراف')),
        FilledButton(
          style: danger ? FilledButton.styleFrom(backgroundColor: PishkanColors.danger) : null,
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result == true;
}

/// The soft plush call-to-action used across the app: gradient body, deep
/// soft shadow and a little press travel, like the web panels' buttons.
class PlushButton extends StatefulWidget {
  const PlushButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.arrow = false,
    this.loading = false,
    this.color,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  /// Trailing white arrow disc, like the design's primary CTAs («ورود ←»).
  final bool arrow;
  final bool loading;
  final Color? color;
  final bool expand;

  @override
  State<PlushButton> createState() => _PlushButtonState();
}

class _PlushButtonState extends State<PlushButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null && !widget.loading;
    // Reduced motion keeps every state change and drops only the movement, so
    // the button still darkens and still ticks, it just does not sink.
    final animate = !PishkanMotion.reduced(context);
    final sunk = _pressed && enabled && animate;
    final base = widget.color ?? context.brand;
    final content = AnimatedContainer(
      duration: const Duration(milliseconds: 110),
      transform: Matrix4.translationValues(0, sunk ? 3 : 0, 0),
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
      decoration: BoxDecoration(
        gradient: enabled
            ? LinearGradient(colors: [base, Color.lerp(base, PishkanColors.navy, 0.45)!], begin: Alignment.topCenter, end: Alignment.bottomCenter)
            // Disabled is a *state*, not a lighter brand: a washed-out blue
            // still reads as pressable. These are the palette's own disabled
            // tones, which hold their contrast in both modes.
            : LinearGradient(colors: [context.disabled, context.disabled.withOpacity(0.82)]),
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          // Two shadows sell the depth: a tight contact shadow that the press
          // collapses, and a wide brand glow that stays. Removing both on
          // press is what makes a button look like it went flat rather than
          // down; keeping the glow is what keeps it looking lit.
          BoxShadow(color: context.shadow, blurRadius: sunk ? 4 : 10, offset: Offset(0, sunk ? 1 : 3)),
          BoxShadow(
            color: base.withOpacity(enabled ? (sunk ? 0.22 : 0.38) : 0.10),
            blurRadius: sunk ? 10 : 20,
            offset: Offset(0, sunk ? 3 : 9),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (widget.loading)
            const SizedBox(width: 19, height: 19, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
          else if (widget.icon != null)
            Icon(widget.icon, color: Colors.white, size: 20),
          if (widget.loading || widget.icon != null) const SizedBox(width: 9),
          Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15))),
          if (widget.arrow && !widget.loading) ...[
            const SizedBox(width: 10),
            Container(
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle, boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.18), blurRadius: 6, offset: const Offset(0, 2))]),
              child: Icon(Icons.arrow_back_rounded, color: base, size: 17),
            ),
          ],
        ],
      ),
    );
    // The ripple is layered *under* the gradient rather than over it, so it
    // reads as light moving inside the surface instead of a grey wash painted
    // on top. Without it the press is a silent translation, which is what made
    // the old button feel like an image rather than a control.
    return GestureDetector(
      onTapDown: (_) {
        setState(() => _pressed = true);
        if (enabled) Haptics.press();
      },
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: enabled ? widget.onPressed : null,
      child: widget.expand
          ? SizedBox(width: double.infinity, child: _withRipple(context, enabled: enabled, child: content))
          : _withRipple(context, enabled: enabled, child: content),
    );
  }

  /// Material ink over the rounded shape, clipped so it never spills past the
  /// button's own corners.
  Widget _withRipple(BuildContext context, {required bool enabled, required Widget child}) {
    if (!enabled) return child;
    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: Stack(
        children: [
          child,
          // `Positioned.fill` needs a sized parent; the Stack is sized by the
          // button itself, and the ink is transparent to hit-testing.
          Positioned.fill(
            child: IgnorePointer(
              child: Material(
                color: Colors.transparent,
                child: InkWell(onTap: widget.onPressed, splashColor: Colors.white.withOpacity(0.22), highlightColor: Colors.white.withOpacity(0.08)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// White rounded card with a very soft shadow — the base surface everywhere.
class SoftCard extends StatelessWidget {
  const SoftCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap});

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDark;
    final card = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: context.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: dark ? PishkanColors.darkBorder : const Color(0xFFEAF0F8)),
        boxShadow: [
          BoxShadow(
            color: dark ? const Color(0x59000000) : const Color(0x0E0B1F3A),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: child,
    );
    if (onTap == null) return card;
    // `TactileTap` rather than `InkWell`: an InkWell needs a Material ancestor
    // to paint its splash, and inside the home list there is not always one —
    // so the tap gave no visible feedback at all on exactly the cards that
    // open things. This also makes the press-and-then-navigate behaviour match
    // every other tappable surface in the app.
    return TactileTap(
      onTap: () async => onTap!(),
      scale: 0.985,
      hold: const Duration(milliseconds: 110),
      child: card,
    );
  }
}

/// Lifts [amount] of white over [base], for the glass highlight stop.
///
/// Beside its only caller rather than in the theme: this is one line of colour
/// maths, not a brand colour.
Color _whiten(Color base, double amount) =>
    Color.alphaBlend(Colors.white.withOpacity(amount), base);

/// A translucent surface that lets what is behind it show through.
///
/// This is the glass half of the design language; [SoftCard] is the solid
/// half. Used where a panel sits on top of artwork or a gradient — the home
/// hero, the banner rail's controls, the profile header — so the colour behind
/// keeps working instead of being covered by an opaque card.
///
/// [blur] is off by default on purpose. A `BackdropFilter` re-renders what is
/// behind it every frame, and on the weak phones this app targets that costs
/// more than the effect is worth; a translucent fill plus a hairline highlight
/// reads as glass at a fraction of the cost. Screens that genuinely have
/// something interesting behind them (the hero panel) turn it on for one
/// element, not for a list.
class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = 22,
    this.blur = false,
    this.onTap,
    this.tint,
    this.strong = false,
    this.onBrand = false,
  });

  final Widget child;
  final EdgeInsets padding;
  final double radius;
  final bool blur;
  final VoidCallback? onTap;
  /// Overrides the automatic white/navy tint — used on brand gradients where
  /// the glass has to sit on colour rather than on the page background.
  final Color? tint;
  /// Slightly more opaque, for panels that carry long text over a busy photo.
  final bool strong;
  /// The panel sits on a saturated brand surface, not on the page.
  ///
  /// Over a blue gradient a white veil has to stay thin in *both* themes, or it
  /// washes the gradient out to near-white and the white text on top of it
  /// disappears. The hero and the banner controls use this.
  final bool onBrand;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDark;
    // Glass is a white veil in both themes: in light mode it lifts the panel
    // off the page, in dark mode it is the only thing that reads as "lit".
    // What changes with the theme is the opacity, not the hue.
    final fill = tint ?? Colors.white;
    // Opacity has to follow what is *behind* the glass, not the theme alone.
    //
    // This used to invert on dark mode: 0.82 in light, 0.16 in dark. On the
    // home hero — a white panel intended to sit on a blue gradient — that meant
    // a light mode panel at 82% white, which is an almost-solid white card
    // carrying white text. The hero was unreadable in light mode and perfect in
    // dark, which is exactly backwards from what the screenshot shows.
    //
    // A white veil only lifts a panel off a *light* background; over a dark or
    // saturated one it erases it. So a filled panel is more opaque in light
    // mode and more translucent in dark, and the hero opts into [onBrand],
    // which keeps it a hint of white in both.
    final opacity = onBrand
        ? (dark ? 0.14 : 0.20)
        : strong
            ? (dark ? 0.16 : 0.82)
            : (dark ? 0.10 : 0.62);
    final border = Border.all(
      color: dark || onBrand ? const Color(0x24FFFFFF) : Colors.white.withOpacity(0.70),
      width: 1,
    );

    // A `BoxDecoration` may carry a colour *or* a gradient, never both — it
    // asserts otherwise, which would crash every GlassCard on its first build.
    // So the tint is the gradient's base stop and the highlight is layered on
    // top of it, which is also the more honest description of the material:
    // one fill, lit from the top edge.
    Widget panel = Container(
      padding: padding,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        border: border,
        // A single inset highlight along the top edge is what actually sells
        // the material: it reads as a lit rim, which flat translucency lacks.
        boxShadow: [
          BoxShadow(
            color: dark ? const Color(0x4D000000) : const Color(0x140B1F3A),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
        gradient: LinearGradient(
          begin: AlignmentDirectional.topStart,
          end: AlignmentDirectional.bottomEnd,
          colors: [
            _whiten(fill.withOpacity(opacity), dark ? 0.10 : 0.28),
            fill.withOpacity(opacity),
          ],
        ),
      ),
      child: child,
    );

    if (blur) {
      panel = ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: BackdropFilter(
          // 12 px is enough to read as frosted without smearing the artwork
          // into a flat wash behind the text.
          filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: panel,
        ),
      );
    }

    if (onTap == null) return panel;
    return TactileTap(onTap: () async => onTap!(), scale: 0.985, hold: const Duration(milliseconds: 110), rippleRadius: radius, child: panel);
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.status});

  final String label;
  final String status;

  Color get _color {
    switch (status) {
      case 'completed':
      case 'delivered':
      case 'approved':
      case 'paid':
      case 'confirmed':
      case 'successful':
        return PishkanColors.success;
      case 'canceled':
      case 'rejected':
      case 'failed':
      case 'expired':
        return PishkanColors.danger;
      case 'waiting_customer':
      case 'needs_action':
      case 'pending':
      case 'unpaid':
      case 'partial':
        return PishkanColors.warning;
      default:
        return PishkanColors.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: _color.withOpacity(0.12), borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: TextStyle(color: _color, fontSize: 11.5, fontWeight: FontWeight.w700)),
    );
  }
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.message = 'در حال دریافت اطلاعات…'});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const CircularProgressIndicator(),
        const SizedBox(height: 14),
        Text(message, style: const TextStyle(color: PishkanColors.mutedText, fontSize: 13)),
      ]),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.icon, required this.title, this.hint = '', this.action});
  final IconData icon;
  final String title;
  final String hint;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.08), shape: BoxShape.circle),
            child: Icon(icon, size: 38, color: PishkanColors.primary),
          ),
          const SizedBox(height: 16),
          Text(title, textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: context.ink)),
          if (hint.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(hint, textAlign: TextAlign.center, style: TextStyle(color: context.inkMuted, fontSize: 12.5, height: 1.8)),
          ],
          if (action != null) ...[const SizedBox(height: 18), action!],
        ]),
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return EmptyView(
      icon: Icons.error_outline_rounded,
      title: 'دریافت اطلاعات انجام نشد',
      hint: message,
      action: PlushButton(label: 'تلاش دوباره', icon: Icons.refresh_rounded, onPressed: onRetry, expand: false),
    );
  }
}

/// A service pictogram, with a photo backdrop where available. An explicitly
/// uploaded icon takes precedence; no catalog text is rendered as emoji.
class IconMedallion extends StatelessWidget {
  const IconMedallion({super.key, this.artwork, this.size = 52, this.color, this.glyphBadge = false});
  final ServiceArtwork? artwork;
  final double size;
  final Color? color;

  /// Draws the service's own glyph as a small seal on the picture's corner.
  ///
  /// The illustration says what a service is about; the glyph names it. Since
  /// every bundled service owns a different glyph, two entries that happen to
  /// share a subject are still told apart at a glance.
  final bool glyphBadge;

  @override
  Widget build(BuildContext context) {
    final core = _art();
    if (!glyphBadge) return core;
    final tint = color ?? artwork?.color ?? PishkanColors.primary;
    return Stack(clipBehavior: Clip.none, children: [
      core,
      Positioned(
        right: -2,
        bottom: -2,
        child: Container(
          width: size * 0.40,
          height: size * 0.40,
          decoration: BoxDecoration(
            color: context.surface,
            shape: BoxShape.circle,
            border: Border.all(color: tint.withOpacity(0.20)),
            boxShadow: const [BoxShadow(color: Color(0x1A0B1F3A), blurRadius: 6, offset: Offset(0, 2))],
          ),
          child: Icon(artwork?.icon ?? Icons.grid_view_rounded, size: size * 0.24, color: tint),
        ),
      ),
    ]);
  }

  /// The picture itself, without the seal.
  Widget _art() {
    final tint = color ?? artwork?.color ?? PishkanColors.primary;
    final radius = BorderRadius.circular(size * 0.30);
    if (artwork?.imageUrl.isNotEmpty == true) {
      return ClipRRect(borderRadius: radius, child: AuthImage(url: artwork!.imageUrl, width: size, height: size));
    }
    // A bundled 3D illustration is the service's identity; the glyph is only
    // for services created after this build, which have no asset yet.
    if (artwork?.hasBundledArt == true) {
      // Bind once: promotion does not reach into the errorBuilder closure,
      // and `artwork` is a field of this widget rather than a local.
      final art = artwork!;
      return ClipRRect(
        borderRadius: radius,
        child: Image.asset(
          art.assetPath,
          width: size,
          height: size,
          fit: BoxFit.cover,
          // A tiny cache footprint: these are ≤160 px and read straight from
          // the APK, so no network, no decoding stall on scroll.
          filterQuality: FilterQuality.medium,
          errorBuilder: (_, _, _) => Container(
            width: size, height: size, color: tint.withOpacity(0.11),
            child: Icon(art.icon, color: tint, size: size * 0.52),
          ),
        ),
      );
    }
    return ClipRRect(
      borderRadius: radius,
      child: Container(
        width: size, height: size,
        decoration: BoxDecoration(color: tint.withOpacity(0.11)),
        child: Center(child: Icon(artwork?.icon ?? Icons.grid_view_rounded, color: tint, size: size * 0.52)),
      ),
    );
  }
}

/// Authenticated network image (previews of private documents need the
/// session token; public images simply ignore the header).
/// Like [AuthImage], but draws nothing at all until the file is there.
///
/// Used where another layer is already painted underneath — a bundled asset,
/// for example — so a placeholder, a spinner or a broken-image icon would
/// cover a perfectly good picture with a grey box.
class AuthImageOrNothing extends StatelessWidget {
  const AuthImageOrNothing({super.key, required this.url, this.fit = BoxFit.cover});

  final String url;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return const SizedBox.shrink();
    return CachedNetworkImage(
      imageUrl: api.absolute(url),
      httpHeaders: api.authHeaders(url),
      fit: fit,
      fadeInDuration: const Duration(milliseconds: 200),
      placeholder: (_, _) => const SizedBox.shrink(),
      errorWidget: (_, _, _) => const SizedBox.shrink(),
    );
  }
}

class AuthImage extends StatelessWidget {
  const AuthImage({super.key, required this.url, this.fit = BoxFit.cover, this.width, this.height});
  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return _placeholder(context);
    return CachedNetworkImage(
      imageUrl: api.absolute(url),
      httpHeaders: api.authHeaders(url),
      fit: fit,
      width: width,
      height: height,
      placeholder: (_, _) => _placeholder(context, loading: true),
      errorWidget: (_, _, _) => _placeholder(context),
    );
  }

  Widget _placeholder(BuildContext context, {bool loading = false}) => Container(
        width: width,
        height: height,
        color: context.isDark ? PishkanColors.darkSurfaceHigh : const Color(0xFFEEF2F8),
        alignment: Alignment.center,
        child: loading ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.image_not_supported_outlined, color: PishkanColors.mutedText),
      );
}

/// Ask the customer for one document file: photo from camera/gallery or any
/// allowed file (PDF/images). Returns null when cancelled.
Future<File?> pickDocumentFile(BuildContext context, {bool documentScanner = true}) async {
  final choice = await showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Padding(padding: EdgeInsets.fromLTRB(20, 18, 20, 6), child: Align(alignment: Alignment.centerRight, child: Text('انتخاب مدرک', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)))),
        ListTile(leading: const Icon(Icons.photo_camera_rounded), title: const Text('گرفتن عکس با دوربین'), onTap: () => Navigator.pop(ctx, 'camera')),
        ListTile(leading: const Icon(Icons.photo_library_rounded), title: const Text('انتخاب از گالری'), onTap: () => Navigator.pop(ctx, 'gallery')),
        ListTile(leading: const Icon(Icons.folder_open_rounded), title: const Text('انتخاب فایل (PDF یا تصویر)'), onTap: () => Navigator.pop(ctx, 'file')),
        const SizedBox(height: 10),
      ]),
    ),
  );
  if (choice == null) return null;
  if (choice == 'file') {
    final result = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif']);
    final path = result?.files.single.path;
    return path == null ? null : File(path);
  }
  if (choice == 'camera' && documentScanner) {
    if (!context.mounted) return null;
    return Navigator.push<File>(context, MaterialPageRoute(builder: (_) => const DocumentCameraScreen()));
  }
  final picker = ImagePicker();
  final picked = await picker.pickImage(source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery);
  return picked == null ? null : File(picked.path);
}

/// Full-screen zoomable viewer for a delivered/uploaded image.
class ImageViewerScreen extends StatelessWidget {
  const ImageViewerScreen({super.key, required this.url, this.title = ''});
  final String url;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, iconTheme: const IconThemeData(color: Colors.white), title: Text(title, style: const TextStyle(color: Colors.white, fontSize: 15))),
      body: InteractiveViewer(
        minScale: 0.7,
        maxScale: 4,
        child: Center(child: AuthImage(url: url, fit: BoxFit.contain)),
      ),
    );
  }
}

/// One section heading inside a scrolling page.
class SectionTitle extends StatelessWidget {
  const SectionTitle({super.key, required this.title, this.trailing});
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 18, 4, 10),
      child: Row(children: [
        Expanded(child: Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: context.ink))),
        if (trailing != null) trailing!,
      ]),
    );
  }
}

/// Deterministic rounded progress track (shared by cards, wizard, banners).
class TrackProgressIndicator extends StatelessWidget {
  const TrackProgressIndicator(this.value, this.color, this.height, {super.key});
  final double value;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      // A pale track is the right "empty" on a white card, but on the dark
      // canvas it becomes the brightest thing on screen — brighter than the
      // bar it is meant to sit behind. Dark mode inverts the relationship.
      color: context.isDark ? const Color(0x14FFFFFF) : const Color(0xFFE8EEF7),
      alignment: AlignmentDirectional.centerStart,
      child: FractionallySizedBox(
        widthFactor: value.clamp(0.02, 1),
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [color.withOpacity(0.75), color]),
            borderRadius: BorderRadius.circular(999),
          ),
        ),
      ),
    );
  }
}

/// Mini stage-progress shown on request cards: rounded track + stage label.
class StageProgressBar extends StatelessWidget {
  const StageProgressBar({super.key, required this.progress, this.height = 7});

  final CaseProgress progress;
  final double height;

  Color get _color {
    if (progress.failed) return PishkanColors.danger;
    if (progress.completed) return PishkanColors.success;
    if (progress.waitingForCustomer) return PishkanColors.warning;
    return PishkanColors.primary;
  }

  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: TrackProgressIndicator(progress.fraction, _color, height),
        ),
      ),
      const SizedBox(width: 8),
      Text(progress.currentLabel, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: _color)),
    ]);
  }
}

/// Vertical case timeline (the approved design's tracker): completed stages
/// are green checks, the current stage is a glowing blue node, upcoming
/// stages stay grey, and a failed/cancelled case ends in a red node.
class StageTimeline extends StatelessWidget {
  const StageTimeline({super.key, required this.progress});

  final CaseProgress progress;

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      for (var i = 0; i < caseStageLabels.length; i++)
        _row(context, i, i == caseStageLabels.length - 1),
    ]);
  }

  /// [context] is passed in rather than read from a field: a `StatelessWidget`
  /// has no `context` outside `build`, and the theme lookups below need one.
  Widget _row(BuildContext context, int index, bool last) {
    final dark = context.isDark;
    final done = progress.completed || index < progress.doneCount;
    final current = !progress.completed && !progress.failed && index == progress.currentIndex;
    final failedHere = progress.failed && index == progress.doneCount;
    final stage = caseStageLabels[index];

    final nodeColor = failedHere
        ? PishkanColors.danger
        : done
            ? PishkanColors.success
            : current
                ? context.brand
                : (dark ? const Color(0x33FFFFFF) : const Color(0xFFD7DEE9));
    final node = Container(
      width: 30,
      height: 30,
      decoration: BoxDecoration(
        // An unfinished node is a *hole* in the track, so it is filled with
        // the card it sits on rather than a literal white — on the dark canvas
        // a white disc punches a bright hole through the card.
        color: done || failedHere ? nodeColor : context.surface,
        shape: BoxShape.circle,
        border: Border.all(color: nodeColor, width: 2),
        boxShadow: current ? [BoxShadow(color: PishkanColors.primary.withOpacity(0.30), blurRadius: 10, spreadRadius: 2)] : null,
      ),
      child: Icon(
        done ? Icons.check_rounded : failedHere ? Icons.close_rounded : Icons.circle,
        size: done || failedHere ? 17 : 10,
        color: done || failedHere ? Colors.white : nodeColor,
      ),
    );
    final isCurrent = current || failedHere;
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Column(children: [
          node,
          if (!last)
            Expanded(
              child: Container(
                width: 2.5,
                margin: const EdgeInsets.symmetric(vertical: 3),
                color: index < progress.doneCount
                    ? PishkanColors.success.withOpacity(0.55)
                    : (dark ? const Color(0x1FFFFFFF) : const Color(0xFFE2E8F0)),
              ),
            ),
        ]),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: last ? 2 : 18, top: 3),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                stage.label,
                style: TextStyle(
                  fontWeight: isCurrent || done ? FontWeight.w800 : FontWeight.w600,
                  fontSize: 13.5,
                  color: done || isCurrent ? context.ink : context.inkMuted,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                isCurrent ? progress.currentLabel : stage.hint,
                style: TextStyle(
                  fontSize: 11.5,
                  height: 1.7,
                  color: failedHere
                      ? PishkanColors.danger
                      : progress.waitingForCustomer && isCurrent
                          ? PishkanColors.warning
                          : PishkanColors.mutedText,
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// Portraits are legitimate attachments but are not document-text photos.
bool shouldScreenDocumentPhoto(String title, {String type = ''}) =>
    type != 'personal_photo' && !title.contains('عکس پرسنلی') && !title.contains('عکس شخصی');

/// Store only an explicitly mapped profile document; never guess from a title.
Future<void> saveMappedProfileDocument(BuildContext context, String fileId, String title, String documentType) async {
  if (documentType.isEmpty || documentType == 'other') return;
  try {
    await api.postData('/api/documents/mine', body: {'fileId': fileId, 'docType': documentType, 'title': title});
    if (context.mounted) showSnack(context, 'مدرک در پروفایل ثبت شد و در انتظار تأیید است.');
  } catch (_) {
    if (context.mounted) showSnack(context, 'ذخیره در پروفایل انجام نشد؛ فایل درخواست همچنان موجود است.', error: true);
  }
}

/// The page backdrop.
///
/// Not a flat fill: a very low-contrast two-stop gradient, lit from the top,
/// with one soft glow behind the area where the screen's heading sits. The
/// difference from `scaffoldBackgroundColor` is subtle by design — enough that
/// white cards look like they are resting on something rather than floating in
/// a void, and never enough to compete with the content.
///
/// It is a single widget rather than a per-screen decoration so every page
/// shares one backdrop; two screens with slightly different washes is the
/// fastest way to make an app feel assembled instead of designed.
class PageWash extends StatelessWidget {
  const PageWash({super.key, required this.child, this.glow = true});

  final Widget child;
  /// Turn off on dense screens (long forms, the chat thread) where the glow
  /// would sit behind text rather than behind a heading.
  final bool glow;

  @override
  Widget build(BuildContext context) {
    final dark = context.isDark;
    final top = dark ? const Color(0xFF0C1A2E) : const Color(0xFFEFF4FC);
    final bottom = dark ? PishkanColors.darkBackground : PishkanColors.background;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [top, bottom],
          stops: const [0, 0.55],
        ),
      ),
      child: Stack(children: [
        if (glow)
          PositionedDirectional(
            top: -110,
            end: -70,
            child: IgnorePointer(
              child: Container(
                width: 260,
                height: 260,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(colors: [
                    context.brand.withOpacity(dark ? 0.20 : 0.13),
                    context.brand.withOpacity(0),
                  ]),
                ),
              ),
            ),
          ),
        child,
      ]),
    );
  }
}
