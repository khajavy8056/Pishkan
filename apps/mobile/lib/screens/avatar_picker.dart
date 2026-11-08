import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/avatar.dart';
import '../widgets/widgets.dart';

/// Choose a face: the twelve feminine presets, the twelve masculine ones, or a
/// photo from the phone.
///
/// The choice is saved on the server (not just this device), so it follows the
/// customer to the web panel and to a new phone. Photos are uploaded through
/// the same `/api/files/upload` endpoint as documents and are rejected there if
/// they are not images or are too large.
class AvatarPickerScreen extends StatefulWidget {
  const AvatarPickerScreen({super.key, this.gender = 'unspecified'});

  /// `female`, `male` or `unspecified`; only filters the grid, never hides the
  /// uploaded photo option.
  final String gender;

  @override
  State<AvatarPickerScreen> createState() => _AvatarPickerScreenState();
}

class _AvatarPickerScreenState extends State<AvatarPickerScreen> {
  late String _gender = widget.gender;
  int _selected = 0;
  String _photoUrl = '';
  bool _busy = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await fetchAvatarCatalogue();
      final state = asMap(data['state']);
      if (!mounted) return;
      setState(() {
        _selected = asNum(state['preset']).toInt();
        _photoUrl = asStr(state['photoUrl']);
        final serverGender = asStr(state['gender']);
        if (_gender == 'unspecified' && serverGender.isNotEmpty) _gender = serverGender;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickPreset(int preset) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final state = asMap(await chooseAvatarPreset(preset, gender: _gender));
      if (!mounted) return;
      setState(() {
        _selected = asNum(state['preset']).toInt();
        _photoUrl = '';
        _busy = false;
      });
      await playAppSound('success');
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showSnack(context, error.message, error: true);
    }
  }

  Future<void> _pickPhoto() async {
    if (_busy) return;
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1200, imageQuality: 88);
    if (picked == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final bytes = await picked.readAsBytes();
      final fileId = await uploadImageBytes(bytes, picked.name, purpose: 'avatar');
      final state = asMap(await setAvatarPhoto(fileId));
      if (!mounted) return;
      setState(() {
        _photoUrl = asStr(state['photoUrl']);
        _busy = false;
      });
      await playAppSound('success');
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      showSnack(context, error.message, error: true);
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      showSnack(context, 'ارسال تصویر انجام نشد؛ دوباره تلاش کنید.', error: true);
    }
  }

  Future<void> _removePhoto() async {
    setState(() => _busy = true);
    try {
      await clearAvatarPhoto();
      if (!mounted) return;
      setState(() { _photoUrl = ''; _busy = false; });
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Feminine presets are 1-12 and masculine 13-24; "unspecified" shows both.
    final presets = List<int>.generate(UserAvatar.presetCount, (index) => index + 1).where((preset) {
      if (_gender == 'female') return preset <= 12;
      if (_gender == 'male') return preset > 12;
      return true;
    }).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('انتخاب تصویر پروفایل')),
      body: _loading
          ? const LoadingView()
          : ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 28), children: [
              SoftCard(
                child: Row(children: [
                  UserAvatar(size: 62, withRing: true),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(_photoUrl.isNotEmpty ? 'تصویر شخصی شما' : 'آواتار پیش‌فرض شما',
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: context.ink)),
                      const SizedBox(height: 4),
                      Text('می‌توانید یکی از آواتارها را انتخاب کنید یا عکس خودتان را بگذارید.',
                          style: TextStyle(fontSize: 11.5, color: context.inkMuted, height: 1.7)),
                    ]),
                  ),
                ]),
              ),
              const SizedBox(height: 12),
              Row(children: [
                for (final option in const [('female', 'بانوان', Icons.female_rounded), ('male', 'آقایان', Icons.male_rounded), ('unspecified', 'همه', Icons.people_alt_rounded)])
                  Padding(
                    padding: const EdgeInsets.only(left: 6),
                    child: ChoiceChip(
                      selected: _gender == option.$1,
                      avatar: Icon(option.$3, size: 16),
                      label: Text(option.$2),
                      onSelected: _busy ? null : (_) => setState(() => _gender = option.$1),
                    ),
                  ),
              ]),
              const SizedBox(height: 12),
              GridView.count(
                crossAxisCount: 4,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                children: [
                  for (final preset in presets)
                    _PresetTile(
                      preset: preset,
                      selected: _photoUrl.isEmpty && _selected == preset,
                      onTap: _busy ? null : () => _pickPreset(preset),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              PlushButton(
                label: _photoUrl.isEmpty ? 'گذاشتن عکس از گالری' : 'تغییر عکس شخصی',
                icon: Icons.photo_library_rounded,
                loading: _busy,
                onPressed: _busy ? null : _pickPhoto,
              ),
              if (_photoUrl.isNotEmpty) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _removePhoto,
                  icon: const Icon(Icons.delete_outline_rounded),
                  label: const Text('حذف عکس و بازگشت به آواتار'),
                ),
              ],
            ]),
    );
  }
}

class _PresetTile extends StatelessWidget {
  const _PresetTile({required this.preset, required this.selected, this.onTap});
  final int preset;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: 'آواتار شماره $preset',
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: selected ? context.brand : Colors.transparent,
            boxShadow: selected ? PishkanMetrics.softShadow(context, lift: 0.6) : null,
          ),
          child: ClipOval(
            child: Image.asset(
              UserAvatar.presetAsset(preset),
              fit: BoxFit.cover,
              filterQuality: FilterQuality.medium,
              errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFFE8F0FF)),
            ),
          ),
        ),
      ),
    );
  }
}
