import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/theme.dart';
import '../services/services.dart';

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(message, style: const TextStyle(fontFamily: 'Vazirmatn')),
    backgroundColor: error ? PishkanColors.danger : PishkanColors.navy,
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
    this.loading = false,
    this.color,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
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
    final base = widget.color ?? PishkanColors.primary;
    final content = AnimatedContainer(
      duration: const Duration(milliseconds: 110),
      transform: Matrix4.translationValues(0, _pressed && enabled ? 3 : 0, 0),
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
      decoration: BoxDecoration(
        gradient: enabled
            ? LinearGradient(colors: [base, Color.lerp(base, PishkanColors.navy, 0.45)!], begin: Alignment.topCenter, end: Alignment.bottomCenter)
            : const LinearGradient(colors: [Color(0xFFB6C2D4), Color(0xFF9FB0C9)]),
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: base.withOpacity(enabled ? 0.35 : 0.12),
            blurRadius: _pressed ? 8 : 18,
            offset: Offset(0, _pressed ? 3 : 9),
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
          Text(widget.label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
        ],
      ),
    );
    return GestureDetector(
      onTapDown: (_) => setState(() => _pressed = true),
      onTapUp: (_) => setState(() => _pressed = false),
      onTapCancel: () => setState(() => _pressed = false),
      onTap: enabled ? widget.onPressed : null,
      child: widget.expand ? SizedBox(width: double.infinity, child: content) : content,
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
    final card = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFEAF0F8)),
        boxShadow: const [BoxShadow(color: Color(0x0E0B1F3A), blurRadius: 16, offset: Offset(0, 6))],
      ),
      child: child,
    );
    if (onTap == null) return card;
    return InkWell(onTap: onTap, borderRadius: BorderRadius.circular(22), child: card);
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
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: PishkanColors.navy)),
          if (hint.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(hint, textAlign: TextAlign.center, style: const TextStyle(color: PishkanColors.mutedText, fontSize: 12.5, height: 1.8)),
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
      icon: Icons.wifi_off_rounded,
      title: 'ارتباط برقرار نشد',
      hint: message,
      action: PlushButton(label: 'تلاش دوباره', icon: Icons.refresh_rounded, onPressed: onRetry, expand: false),
    );
  }
}

/// An emoji/icon medallion for services & categories (icons come from the
/// backend as emoji, exactly like the web panels).
class IconMedallion extends StatelessWidget {
  const IconMedallion({super.key, required this.icon, this.size = 52, this.color});
  final String icon;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tint = color ?? PishkanColors.primary;
    final isEmoji = icon.isNotEmpty && !icon.startsWith('http');
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [tint.withOpacity(0.16), tint.withOpacity(0.05)], begin: Alignment.topRight, end: Alignment.bottomLeft),
        borderRadius: BorderRadius.circular(size * 0.32),
      ),
      alignment: Alignment.center,
      child: isEmoji
          ? Text(icon, style: TextStyle(fontSize: size * 0.44))
          : Icon(Icons.grid_view_rounded, color: tint, size: size * 0.5),
    );
  }
}

/// Authenticated network image (previews of private documents need the
/// session token; public images simply ignore the header).
class AuthImage extends StatelessWidget {
  const AuthImage({super.key, required this.url, this.fit = BoxFit.cover, this.width, this.height});
  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return _placeholder();
    return CachedNetworkImage(
      imageUrl: api.absolute(url),
      httpHeaders: api.authHeaders(),
      fit: fit,
      width: width,
      height: height,
      placeholder: (_, _) => _placeholder(loading: true),
      errorWidget: (_, _, _) => _placeholder(),
    );
  }

  Widget _placeholder({bool loading = false}) => Container(
        width: width,
        height: height,
        color: const Color(0xFFEEF2F8),
        alignment: Alignment.center,
        child: loading ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.image_not_supported_outlined, color: PishkanColors.mutedText),
      );
}

/// Ask the customer for one document file: photo from camera/gallery or any
/// allowed file (PDF/images). Returns null when cancelled.
Future<File?> pickDocumentFile(BuildContext context) async {
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
  final picker = ImagePicker();
  final picked = await picker.pickImage(source: choice == 'camera' ? ImageSource.camera : ImageSource.gallery, imageQuality: 88);
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
        Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: PishkanColors.navy))),
        if (trailing != null) trailing!,
      ]),
    );
  }
}
