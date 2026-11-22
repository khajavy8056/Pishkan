import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import 'widgets.dart';

/// The customer's face, used by the profile header, the app bar and the sheets
/// that show who is signed in.
///
/// Resolution order mirrors the server:
///   * the uploaded photo the customer chose (server `avatarUrl`, which carries
///     the preset as a fallback when no photo exists);
///   * a bundled preset illustration (`assets/avatars/preset-NN.webp`), which is
///     what almost everyone sees and what makes the app feel personal offline;
///   * the initial in a tinted disc, only if the bundle is somehow missing.
///
/// Preset numbers are stable per account (assigned server-side), so the same
/// customer sees the same face on every device and after a reinstall.
class UserAvatar extends StatelessWidget {
  const UserAvatar({super.key, this.size = 56, this.withRing = false, this.user});

  final double size;
  final bool withRing;
  /// Override for rendering someone else (e.g. a case assignee); defaults to
  /// the signed-in customer.
  final Map<String, dynamic>? user;

  static const presetCount = 24;

  static String presetAsset(int preset) =>
      'assets/avatars/preset-${(preset < 1 || preset > presetCount ? 1 : preset).toString().padLeft(2, '0')}.webp';

  /// Server-provided preset number, or a deterministic local one so an
  /// unsynced/offline start still shows the right face.
  static int presetFor(Map<String, dynamic>? user) {
    final serverPreset = user?['avatar'] is Map ? asNum((user!['avatar'] as Map)['preset']).toInt() : 0;
    if (serverPreset >= 1 && serverPreset <= presetCount) return serverPreset;
    final id = asStr(user?['id'] ?? SessionStore.instance.userId);
    var hash = 2166136261;
    for (final unit in id.codeUnits) {
      hash = ((hash ^ unit) * 16777619) & 0x7fffffff;
    }
    return 1 + (hash % presetCount);
  }

  /// A photo the server knows about, if the customer uploaded one.
  static String photoUrlFor(Map<String, dynamic>? user) {
    final avatar = user?['avatar'];
    final fromAvatar = avatar is Map ? asStr(avatar['photoUrl']) : '';
    if (fromAvatar.isNotEmpty) return fromAvatar;
    final fromUser = asStr(user?['avatarUrl'] ?? '');
    // `/images/avatars/preset-NN.webp` is a preset, not an upload.
    if (fromUser.contains('/images/avatars/')) return '';
    return fromUser;
  }

  @override
  Widget build(BuildContext context) {
    final data = user ?? SessionStore.instance.user;
    final photo = photoUrlFor(data);
    final ring = withRing
        ? Border.all(color: Colors.white.withOpacity(0.85), width: 2.2)
        : Border.all(color: context.isDark ? PishkanColors.darkBorder : const Color(0xFFE6EDF9));

    Widget face;
    if (photo.isNotEmpty) {
      face = AuthImage(url: photo, width: size, height: size);
    } else {
      face = Image.asset(
        presetAsset(presetFor(data)),
        width: size,
        height: size,
        fit: BoxFit.cover,
        filterQuality: FilterQuality.medium,
        errorBuilder: (_, _, _) => _initial(context, data),
      );
    }

    return Semantics(
      label: 'تصویر پروفایل',
      image: true,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(shape: BoxShape.circle, border: ring),
        child: ClipOval(child: face),
      ),
    );
  }

  Widget _initial(BuildContext context, Map<String, dynamic>? data) {
    final name = asStr(data?['fullName']);
    return Container(
      color: PishkanColors.primary.withOpacity(0.12),
      alignment: Alignment.center,
      child: Text(
        name.isEmpty ? 'پ' : String.fromCharCode(name.runes.first),
        style: TextStyle(color: context.brand, fontWeight: FontWeight.w800, fontSize: size * 0.4),
      ),
    );
  }
}
