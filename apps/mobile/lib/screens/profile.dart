import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/biometric.dart';
import '../core/format.dart';
import '../core/motion.dart';
import '../core/sizes.dart';
import '../core/theme.dart';
import '../core/theme_mode.dart';
import '../models/models.dart';
import '../services/notifier.dart';
import '../services/services.dart';
import '../widgets/avatar.dart';
import '../widgets/screen_header.dart';
import '../widgets/widgets.dart';
import 'assistant.dart';
import 'avatar_picker.dart';
import 'chat.dart';
import 'documents.dart';
import 'login.dart';
import 'my_discounts.dart';
import 'notifications.dart';
import 'offers.dart';
import 'payments.dart';
import 'referrals.dart';
import 'server_setup.dart';
import 'wallet.dart';

/// Profile tab: identity card, quick links, connection settings and
/// edit-profile / change-password / sign-out actions.
class ProfileTab extends StatefulWidget {
  const ProfileTab({super.key});

  @override
  State<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<ProfileTab> {
  String _version = '';
  bool _notificationsOn = true;
  bool _soundsOn = true;
  bool _uiSoundsOn = false;
  /// Whether Android itself allows this app to post (null = not asked yet).
  bool? _notificationPermission;
  bool _biometricOn = false;
  bool _biometricAvailable = false;

  @override
  void initState() {
    super.initState();
    currentAppVersion().then((v) {
      if (mounted) setState(() => _version = v);
    });
    fetchMe().catchError((_) => <String, dynamic>{});
    _loadPrefs();
  }

  Future<void> _loadPrefs() async {
    final notifications = await AppPrefs.notificationsEnabled();
    final sounds = await AppPrefs.soundsEnabled();
    final uiSounds = await AppPrefs.uiSoundsEnabled();
    final biometric = await AppPrefs.biometricEnabled();
    final available = await BiometricAuth.isAvailable();
    if (!mounted) return;
    setState(() {
      _notificationsOn = notifications;
      _soundsOn = sounds;
      _uiSoundsOn = uiSounds;
      _biometricOn = biometric;
      _biometricAvailable = available;
    });
  }

  Future<void> _toggleBiometric(bool value) async {
    if (value) {
      final ok = await BiometricAuth.authenticate();
      if (!ok) {
        if (mounted) showSnack(context, 'تأیید اثر انگشت انجام نشد.', error: true);
        return;
      }
    }
    await AppPrefs.setBiometricEnabled(value);
    if (mounted) setState(() => _biometricOn = value);
  }

  /// One place to understand *why* a notification did not arrive, plus a test
  /// that exercises channel, sound, tray and deep link end to end. Battery
  /// optimisation is the usual Android culprit for "it worked, then stopped".
  Future<void> _openNotificationSettings() async {
    var granted = await NotifierService.permissionGranted();
    if (mounted) setState(() => _notificationPermission = granted);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheet) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 4, 18, 20),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('اعلان‌ها', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: context.ink)),
              const SizedBox(height: 4),
              Text('اعلان‌ها برای مرحلهٔ پرونده، پاسخ کارشناس و اطلاعیه‌های دفتر می‌آیند.', style: TextStyle(fontSize: 12, color: context.inkMuted, height: 1.7)),
              const SizedBox(height: 14),
              if (granted == false)
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: PishkanColors.danger.withOpacity(0.08), borderRadius: BorderRadius.circular(14), border: Border.all(color: PishkanColors.danger.withOpacity(0.25))),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('اجازهٔ اعلان داده نشده است', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: PishkanColors.danger)),
                    const SizedBox(height: 4),
                    Text('بدون این اجازه هیچ اعلانی نمایش داده نمی‌شود. با دکمهٔ زیر درخواست اجازه می‌دهیم؛ اگر پنجره نیامد، از تنظیمات گوشی مسیر «برنامه‌ها ← تک پیشخوان ← اعلان‌ها» را روشن کنید.',
                        style: TextStyle(fontSize: 11.5, height: 1.75, color: context.ink)),
                    const SizedBox(height: 8),
                    PlushButton(
                      label: 'درخواست اجازهٔ اعلان',
                      icon: Icons.notifications_active_rounded,
                      expand: false,
                      onPressed: () async {
                        await NotifierService.requestPermission();
                        final now = await NotifierService.permissionGranted();
                        setSheet(() => granted = now);
                        if (mounted) setState(() => _notificationPermission = now);
                      },
                    ),
                  ]),
                ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                secondary: const Icon(Icons.notifications_active_outlined, color: PishkanColors.primary),
                title: const Text('دریافت اعلان‌ها', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                subtitle: const Text('خاموش کردن، فقط نمایش اعلان در گوشی را قطع می‌کند؛ پرونده‌ها در برنامه به‌روز می‌مانند.', style: TextStyle(fontSize: 11, height: 1.6)),
                value: _notificationsOn,
                onChanged: (value) async {
                  await AppPrefs.setNotificationsEnabled(value);
                  setSheet(() => _notificationsOn = value);
                  if (mounted) setState(() => _notificationsOn = value);
                },
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                secondary: const Icon(Icons.volume_up_outlined, color: PishkanColors.primary),
                title: const Text('صدای اعلان', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                subtitle: const Text('صدایی که برای تغییر وضعیت پرونده پخش می‌شود', style: TextStyle(fontSize: 11, height: 1.6)),
                value: _soundsOn,
                onChanged: (value) async {
                  await AppPrefs.setSoundsEnabled(value);
                  setSheet(() => _soundsOn = value);
                  if (mounted) setState(() => _soundsOn = value);
                },
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                secondary: const Icon(Icons.touch_app_outlined, color: PishkanColors.primary),
                title: const Text('صدای لمس و بازخورد', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                subtitle: const Text('نوای کوتاه هنگام فشردن دکمه‌ها؛ پیش‌فرض خاموش است', style: TextStyle(fontSize: 11, height: 1.6)),
                value: _uiSoundsOn,
                onChanged: (value) async {
                  await AppPrefs.setUiSoundsEnabled(value);
                  setSheet(() => _uiSoundsOn = value);
                  if (mounted) setState(() => _uiSoundsOn = value);
                },
              ),
              const SizedBox(height: 6),
              const Divider(height: 1),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  final sent = await NotifierService.showTestNotification();
                  if (!sheetContext.mounted) return;
                  showSnack(sheetContext, sent
                      ? 'اعلان آزمایشی ارسال شد؛ چند ثانیه بعد در نوار اعلان‌ها ببینید.'
                      : 'ارسال اعلان آزمایشی ممکن نشد؛ اجازهٔ اعلان و باتری را بررسی کنید.',
                      error: !sent);
                },
                icon: const Icon(Icons.science_outlined, size: 18),
                label: const Text('ارسال اعلان آزمایشی'),
              ),
              const SizedBox(height: 8),
              // Telling people to go hunting through Settings is not a fix.
              // This opens the exact page, and says which of the two cases
              // applies so the outcome is never ambiguous.
              OutlinedButton.icon(
                onPressed: () async {
                  final exempt = await openBatteryOptimisationSettings();
                  if (!sheetContext.mounted) return;
                  showSnack(
                    sheetContext,
                    exempt
                        ? 'تک پیشخوان از قبل بدون محدودیت است؛ صفحهٔ تنظیمات باز شد.'
                        : 'صفحهٔ تنظیمات باز شد؛ «بدون محدودیت» را انتخاب کنید تا اعلان‌ها بی‌تأخیر برسند.',
                  );
                },
                icon: const Icon(Icons.battery_saver_outlined, size: 18),
                label: const Text('اجازهٔ اجرا در پس‌زمینه'),
              ),
              const SizedBox(height: 6),
              Text(
                'اندروید برای صرفه‌جویی در باتری، بررسی‌های پس‌زمینه را گاهی ساعت‌ها متوقف می‌کند. با این تنظیم، اعلان‌ها سر وقت می‌رسند.',
                style: TextStyle(fontSize: 10.5, height: 1.8, color: context.inkMuted),
              ),
            ]),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) {
        final user = session.user ?? const {};
        final name = asStr(user['fullName']).isEmpty ? 'کاربر تک پیشخوان' : asStr(user['fullName']);
        final mobile = asStr(user['mobile']);
        final sizes = context.sizes;
        return HeaderScaffold(
          headerHeight: MediaQuery.paddingOf(context).top + sizes.s(210),
          header: Column(children: [
            ScreenHeading(
              title: 'پروفایل',
              trailing: FloatingIconButton(
                icon: Icons.dark_mode_outlined,
                label: 'ظاهر برنامه',
                onTap: () => showThemePicker(context),
              ),
            ),
            SizedBox(height: sizes.s(6)),
            // The face sits centred on the blue, as in the reference, with the
            // name under it -- not in a card of its own, which used to make the
            // top of this screen look like a second app bar stacked on the
            // first.
            _identity(name, mobile, user),
          ]),
          body: 
            ListView(
              padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(16), sizes.gutter, sizes.navPillClearance(context)),
              children: [
            const SectionTitle(title: 'دستیار و پشتیبانی'),
            SoftCard(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              child: Column(children: [
                _link(Icons.auto_awesome_rounded, 'دستیار هوشمند', 'پیدا کردن خدمت، پاسخ پرسش‌ها و وضعیت پرونده', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AssistantScreen()))),
                const Divider(height: 1),
                _link(Icons.forum_rounded, 'گفت‌وگو با دفتر', 'پیام مستقیم با کارشناس، درون برنامه', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatThreadsScreen()))),
              ]),
            ),
            const SectionTitle(title: 'خدمات مالی'),
            SoftCard(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              child: Column(children: [
                _link(Icons.account_balance_wallet_rounded, 'کیف پول', 'موجودی، شارژ و گردش', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const WalletScreen()))),
                const Divider(height: 1),
                _link(Icons.receipt_long_rounded, 'فاکتورها و پرداخت‌ها', 'پرداخت آنلاین یا از کیف پول', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PaymentsScreen()))),
                const Divider(height: 1),
                _link(Icons.group_add_rounded, 'دعوت دوستان', 'لینک دعوت و پاداش کیف پول', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReferralsScreen()))),
                const Divider(height: 1),
                _link(Icons.discount_rounded, 'تخفیفات من', 'کدهای ویژه و شرایط استفاده', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MyDiscountsScreen()))),
                const Divider(height: 1),
                _link(Icons.local_offer_rounded, 'پیشنهادهای اختصاصی', 'خدمت‌های ویژه‌ای که دفتر برایتان تعریف کرده', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const OffersScreen()))),
              ]),
            ),
            const SectionTitle(title: 'حساب و مدارک'),
            SoftCard(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              child: Column(children: [
                _link(Icons.folder_shared_rounded, 'مدارک پروفایل', 'مدرک‌های تأییدشده برای استفادهٔ دوباره', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const DocumentsScreen()))),
                const Divider(height: 1),
                _link(Icons.notifications_rounded, 'اعلان‌ها', 'تغییر وضعیت پرونده‌ها و پاسخ‌ها', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()))),
                const Divider(height: 1),
                _link(Icons.lock_reset_rounded, 'تغییر رمز عبور', 'رمز فعلی و رمز تازه', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChangePasswordScreen()))),
              ]),
            ),
            const SectionTitle(title: 'تنظیمات اپلیکیشن'),
            SoftCard(
              padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
              child: Column(children: [
                ListenableBuilder(
                  listenable: ThemeController.instance,
                  builder: (context, _) => ListTile(
                    leading: Container(
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                      child: Icon(ThemeController.instance.mode.icon, color: PishkanColors.primary, size: 20),
                    ),
                    title: const Text('ظاهر برنامه', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                    subtitle: Text('حالت فعلی: ${ThemeController.instance.mode.label}', style: TextStyle(fontSize: 11.5)),
                    trailing: Icon(Icons.chevron_left_rounded),
                    onTap: () => showThemePicker(context),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                    child: const Icon(Icons.notifications_active_outlined, color: PishkanColors.primary, size: 20),
                  ),
                  title: const Text('اعلان‌ها', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  subtitle: Text(
                    !_notificationsOn
                        ? 'خاموش — هیچ اعلانی نشان داده نمی‌شود'
                        : _notificationPermission == false
                            ? 'اجازهٔ اعلان در تنظیمات گوشی داده نشده است'
                            : 'مرحلهٔ پرونده، پاسخ کارشناس و اطلاعیه‌ها',
                    style: TextStyle(fontSize: 11.5, color: _notificationPermission == false && _notificationsOn ? PishkanColors.danger : context.inkMuted),
                  ),
                  trailing: const Icon(Icons.chevron_left_rounded),
                  onTap: _openNotificationSettings,
                ),
                const Divider(height: 1),
                SwitchListTile(
                  secondary: const Icon(Icons.volume_up_outlined, color: PishkanColors.primary),
                  title: const Text('صدای اعلان', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  subtitle: const Text('صدایی که برای تغییر وضعیت پرونده پخش می‌شود', style: TextStyle(fontSize: 11.5)),
                  value: _soundsOn,
                  onChanged: (value) async {
                    await AppPrefs.setSoundsEnabled(value);
                    if (mounted) setState(() => _soundsOn = value);
                  },
                ),
                const Divider(height: 1),
                SwitchListTile(
                  secondary: const Icon(Icons.touch_app_outlined, color: PishkanColors.primary),
                  title: const Text('صدای لمس و بازخورد', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  subtitle: const Text('نوای کوتاه هنگام فشردن دکمه‌ها؛ پیش‌فرض خاموش است', style: TextStyle(fontSize: 11.5, height: 1.7)),
                  value: _uiSoundsOn,
                  onChanged: (value) async {
                    await AppPrefs.setUiSoundsEnabled(value);
                    if (mounted) setState(() => _uiSoundsOn = value);
                  },
                ),
                const Divider(height: 1),
                SwitchListTile(
                  secondary: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
                    child: Icon(Icons.fingerprint_rounded, color: PishkanColors.primary, size: 20),
                  ),
                  title: const Text('ورود با اثر انگشت', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  subtitle: Text(_biometricAvailable ? 'قفل اپ با اثر انگشت یا چهرهٔ همین گوشی' : 'این گوشی حسگر اثر انگشت فعال ندارد', style: TextStyle(fontSize: 11.5, color: context.inkMuted)),
                  value: _biometricOn,
                  onChanged: _biometricAvailable ? _toggleBiometric : null,
                ),
                const Divider(height: 1),
                _link(Icons.info_outline_rounded, 'دربارهٔ تک پیشخوان', 'معرفی، تماس با دفتر و نسخهٔ اپ', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AboutScreen()))),
              ]),
            ),
            const SectionTitle(title: 'تنظیمات اتصال'),
            SoftCard(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              child: Column(children: [
                _link(Icons.dns_rounded, 'آدرس سرور سامانه', session.serverUrl.isEmpty ? 'تنظیم نشده' : session.serverUrl, () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ServerSetupScreen(fromProfile: true))), ltr: true),
                const Divider(height: 1),
                _link(Icons.language_rounded, 'باز کردن نسخهٔ وب', 'همان حساب و همان پرونده‌ها در مرورگر', () async {
                  final uri = Uri.tryParse(session.serverUrl);
                  if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
                }),
              ]),
            ),
            const SizedBox(height: 18),
            if (_biometricOn && _biometricAvailable) ...[
              OutlinedButton.icon(
                onPressed: () => Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen(lockMessage: 'برای ادامه، اثر انگشت را تأیید کنید.')), (_) => false),
                icon: const Icon(Icons.lock_outline_rounded),
                label: const Text('قفل برنامه'),
              ),
              const SizedBox(height: 8),
            ],
            OutlinedButton.icon(
              onPressed: () async {
                final confirmed = await confirmDialog(context, 'خروج از حساب؟', 'خروج، نشست این گوشی را پاک می‌کند و ورود بعدی به رمز یا کد پیامکی نیاز دارد. برای ورود دوباره با اثر انگشت از «قفل برنامه» استفاده کنید.', confirmLabel: 'خروج', danger: true);
                if (!confirmed) return;
                await logoutServer();
                if (context.mounted) {
                  Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
                }
              },
              style: OutlinedButton.styleFrom(foregroundColor: context.negative, side: BorderSide(color: context.negative.withOpacity(0.35))),
              icon: Icon(Icons.logout_rounded),
              label: const Text('خروج از حساب کاربری'),
            ),
            const SizedBox(height: 14),
            Center(child: Text('اپلیکیشن مشتریان تک پیشخوان · نسخهٔ ${faDigits(_version)}', style: TextStyle(fontSize: 11, color: context.inkMuted))),
              ],
            ),
        );
      },
    );
  }

  /// The centred face block on the blue backdrop. Tapping the face opens the
  /// picker, which is the only place the avatar changes.
  Widget _identity(String name, String mobile, Map<String, dynamic> user) {
    final sizes = context.sizes;
    return Column(mainAxisSize: MainAxisSize.min, children: [
      PressableScale(
        scale: 0.94,
        onTap: () async {
          final changed = await Navigator.push<bool>(context, fadeThroughRoute(const AvatarPickerScreen()));
          if (changed == true) await fetchMe().catchError((_) => <String, dynamic>{});
          if (mounted) setState(() {});
        },
        child: Stack(alignment: AlignmentDirectional.bottomEnd, children: [
          UserAvatar(size: sizes.s(72), withRing: true),
          Container(
            padding: EdgeInsets.all(sizes.s(4)),
            decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: Icon(Icons.edit_rounded, size: sizes.s(12), color: PishkanColors.primary),
          ),
        ]),
      ),
      SizedBox(height: sizes.s(8)),
      Text(name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: sizes.subtitle)),
      SizedBox(height: sizes.s(2)),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Directionality(
          textDirection: TextDirection.ltr,
          child: Text(faMobileSpaced(mobile),
              style: TextStyle(color: Colors.white.withOpacity(0.86), fontSize: sizes.caption, letterSpacing: 0.5)),
        ),
        if (asStr(user['nationalId']).isNotEmpty) ...[
          SizedBox(width: sizes.s(10)),
          Container(width: 1, height: sizes.s(11), color: Colors.white.withOpacity(0.3)),
          SizedBox(width: sizes.s(10)),
          Text('کد ملی ${faDigits(asStr(user['nationalId']))}',
              style: TextStyle(color: Colors.white.withOpacity(0.86), fontSize: sizes.caption)),
        ],
      ]),
    ]);
  }

  Widget _link(IconData icon, String title, String subtitle, VoidCallback onTap, {bool ltr = false}) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(9),
        decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(12)),
        child: Icon(icon, color: PishkanColors.primary, size: 20),
      ),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
      subtitle: Text(subtitle, textDirection: ltr ? TextDirection.ltr : null, textAlign: ltr ? TextAlign.right : null, style: TextStyle(fontSize: 11.5, color: context.inkMuted), maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Icon(Icons.chevron_left_rounded, color: context.inkMuted),
      onTap: onTap,
    );
  }
}

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final Map<String, TextEditingController> _fields = {};
  bool _busy = false;
  bool _loading = true;
  String? _loadError;
  String? _cityId;
  String? _province;
  List<Map<String, dynamic>> _cities = const [];

  static const _defs = <(String, String, IconData)>[
    ('firstName', 'نام', Icons.person_outline_rounded),
    ('lastName', 'نام خانوادگی', Icons.person_outline_rounded),
    ('nationalId', 'کد ملی', Icons.badge_outlined),
    ('email', 'ایمیل', Icons.email_outlined),
    ('fatherName', 'نام پدر', Icons.family_restroom_rounded),
    ('postalCode', 'کد پستی', Icons.markunread_mailbox_outlined),
    ('address', 'نشانی', Icons.home_outlined),
  ];

  @override
  void initState() {
    super.initState();
    for (final (key, _, _) in _defs) {
      _fields[key] = TextEditingController();
    }
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() { _loading = true; _loadError = null; });
    try {
      final user = await fetchMe();
      final cities = asMapList(await api.getData('/api/public/cities'));
      final profile = asMap(asMap(user['profileState'])['profile']);
      if (!mounted) return;
      const profileKeys = {
        'firstName': 'first_name', 'lastName': 'last_name',
        'fatherName': 'father_name', 'postalCode': 'postal_code',
        'address': 'address',
      };
      for (final (key, _, _) in _defs) {
        _fields[key]!.text = asStr(user[key] ?? profile[profileKeys[key]]);
      }
      final cityId = asStr(profile['city_id']);
      if (!mounted) return;
      setState(() {
        _cities = cities;
        _cityId = cities.any((city) => asStr(city['id']) == cityId) ? cityId : null;
        final matching = cities.where((city) => asStr(city['id']) == _cityId);
        _province = matching.isEmpty ? null : asStr(matching.first['province']);
        _loading = false;
      });
    } on ApiException catch (error) {
      if (mounted) setState(() { _loadError = error.message; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _loadError = 'دریافت اطلاعات پروفایل انجام نشد.'; _loading = false; });
    }
  }

  @override
  void dispose() {
    for (final c in _fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_fields['firstName']!.text.trim().isEmpty || _fields['lastName']!.text.trim().isEmpty || _cityId == null) {
      showSnack(context, 'نام، نام خانوادگی و شهر را کامل کنید.', error: true);
      return;
    }
    final nationalId = enDigits(_fields['nationalId']!.text).trim();
    if (!validNationalId(nationalId)) {
      showSnack(context, 'کد ملی معتبر نیست.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final body = <String, dynamic>{
        for (final (key, _, _) in _defs) key: enDigits(_fields[key]!.text).trim(),
        'cityId': _cityId,
      };
      await api.patchData('/api/auth/profile', body: body);
      await fetchMe();
      if (mounted) {
        showSuccess(context, 'مشخصات شما به‌روزرسانی شد.');
        Navigator.pop(context);
      }
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ویرایش مشخصات')),
      body: _loading ? const LoadingView() : _loadError != null ? ErrorView(message: _loadError!, onRetry: _load) : ListView(padding: const EdgeInsets.fromLTRB(16, 10, 16, 24), children: [
        SoftCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            for (var i = 0; i < _defs.length; i++) ...[
              TextField(
                controller: _fields[_defs[i].$1],
                maxLines: _defs[i].$1 == 'address' ? 2 : 1,
                decoration: InputDecoration(labelText: _defs[i].$2, prefixIcon: Icon(_defs[i].$3)),
              ),
              if (i < _defs.length - 1) const SizedBox(height: 12),
            ],
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _province,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'استان محل سکونت', prefixIcon: Icon(Icons.map_outlined)),
              items: [for (final province in (_cities.map((city) => asStr(city['province'])).where((name) => name.isNotEmpty).toSet().toList()..sort())) DropdownMenuItem(value: province, child: Text(province, overflow: TextOverflow.ellipsis))],
              onChanged: _cities.isEmpty ? null : (value) => setState(() { _province = value; _cityId = null; }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: ValueKey('city-$_province'),
              value: _cityId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'شهر محل سکونت', prefixIcon: Icon(Icons.location_city_outlined)),
              items: [for (final city in _cities.where((city) => asStr(city['province']) == _province)) DropdownMenuItem(value: asStr(city['id']), child: Text(asStr(city['name']), overflow: TextOverflow.ellipsis))],
              onChanged: _province == null ? null : (value) => setState(() => _cityId = value),
            ),
            if (_cities.isEmpty) TextButton(onPressed: _load, child: const Text('فهرست شهرها خالی است؛ دریافت دوباره')),
            const SizedBox(height: 18),
            PlushButton(label: 'ذخیرهٔ تغییرات', icon: Icons.save_rounded, loading: _busy, onPressed: _save),
            const SizedBox(height: 6),
            Text('شماره موبایل شناسهٔ ورود شماست و از اینجا تغییر نمی‌کند؛ برای تغییرش با دفتر در تماس باشید.', style: TextStyle(fontSize: 11, color: context.inkMuted, height: 1.8)),
          ]),
        ),
      ]),
    );
  }
}

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_current.text.isEmpty || _next.text.length < 8) {
      showSnack(context, 'رمز فعلی و رمز تازه (حداقل ۸ نویسه) را وارد کنید.', error: true);
      return;
    }
    if (_next.text != _confirm.text) {
      showSnack(context, 'تکرار رمز تازه درست نیست.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await api.postData('/api/auth/password/change', body: {'currentPassword': _current.text, 'newPassword': _next.text});
      await logoutServer();
      if (mounted) {
        showSuccess(context, 'رمز عبور تغییر کرد؛ لطفاً با رمز تازه دوباره وارد شوید.');
        Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
      }
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تغییر رمز عبور')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 10, 16, 24), children: [
        SoftCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(controller: _current, obscureText: true, decoration: const InputDecoration(labelText: 'رمز عبور فعلی', prefixIcon: Icon(Icons.lock_outline_rounded))),
            const SizedBox(height: 12),
            TextField(controller: _next, obscureText: true, decoration: const InputDecoration(labelText: 'رمز عبور تازه', prefixIcon: Icon(Icons.lock_reset_rounded))),
            const SizedBox(height: 12),
            TextField(controller: _confirm, obscureText: true, decoration: const InputDecoration(labelText: 'تکرار رمز تازه', prefixIcon: Icon(Icons.lock_clock_rounded))),
            const SizedBox(height: 18),
            PlushButton(label: 'ثبت رمز تازه', icon: Icons.check_circle_rounded, loading: _busy, onPressed: _save),
          ]),
        ),
      ]),
    );
  }
}

/// «درباره ما»: brand, tagline and support contact from the server config,
/// app version, and a plain-language promise of how the app and the web
/// panel share one account and one database.
class AboutScreen extends StatefulWidget {
  const AboutScreen({super.key});

  @override
  State<AboutScreen> createState() => _AboutScreenState();
}

class _AboutScreenState extends State<AboutScreen> {
  AppConfig? _config;
  String _version = '';

  @override
  void initState() {
    super.initState();
    fetchAppConfig().then((config) {
      if (mounted) setState(() => _config = config);
    });
    currentAppVersion().then((v) {
      if (mounted) setState(() => _version = v);
    });
  }

  Future<void> _call(String phone) async {
    final uri = Uri.tryParse('tel:${enDigits(phone).replaceAll(RegExp(r'[^\d+]'), '')}');
    if (uri != null) await launchUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    final config = _config;
    final brand = config?.brandName.isNotEmpty == true ? config!.brandName : 'تک پیشخوان';
    final tagline = (config?.tagline.isNotEmpty == true) ? config!.tagline : 'سامانهٔ جامع خدمات دولت';
    final phone = config?.supportPhone ?? '';
    return Scaffold(
      appBar: AppBar(title: const Text('دربارهٔ ما')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 14, 16, 24), children: [
        Center(
          child: Column(children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: context.surface, shape: BoxShape.circle, boxShadow: [BoxShadow(color: Color(0x1A1452D9), blurRadius: 18, offset: Offset(0, 7))]),
              child: ClipOval(child: Image.asset('assets/icon.png', width: 64, height: 64)),
            ),
            const SizedBox(height: 12),
            Text(brand, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19, color: context.ink)),
            const SizedBox(height: 4),
            Text(tagline, style: TextStyle(color: context.inkMuted, fontSize: 12.5)),
          ]),
        ),
        const SizedBox(height: 20),
        const SoftCard(
          child: Text(
            'این اپ، تک پیشخوان شماست؛ بدون صف و معطّلی. درخواست ثبت می‌کنید، مدارک را از همین‌جا می‌فرستید، مرحله‌به‌مرحله با اعلان در جریان پیشرفت پرونده قرار می‌گیرید و نتیجه را همین‌جا تحویل می‌گیرید. حسابتان در اپ و نسخهٔ وب یکی است؛ هرچه این‌جا می‌بینید، در سایت دفتر هم همان است.',
            style: TextStyle(height: 2, fontSize: 13),
          ),
        ),
        const SizedBox(height: 14),
        SoftCard(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
          child: Column(children: [
            if (phone.isNotEmpty)
              ListTile(
                leading: Icon(Icons.call_rounded, color: PishkanColors.primary),
                title: const Text('تلفن تماس دفتر', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                subtitle: Text(faMobileSpaced(phone), style: TextStyle(fontSize: 12, color: context.inkMuted)),
                trailing: Icon(Icons.chevron_left_rounded, color: context.inkMuted),
                onTap: () => _call(phone),
              ),
            ListTile(
              leading: Icon(Icons.language_rounded, color: PishkanColors.primary),
              title: const Text('نشانی سامانه', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
              subtitle: Text(session.serverUrl, textDirection: TextDirection.ltr, textAlign: TextAlign.right, style: TextStyle(fontSize: 11.5, color: context.inkMuted), maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ]),
        ),
        const SizedBox(height: 18),
        Center(child: Text('اپلیکیشن مشتریان $brand · نسخهٔ ${faDigits(_version)}', style: TextStyle(fontSize: 11, color: context.inkMuted))),
      ]),
    );
  }
}

/// Three-way appearance sheet: auto (follows the phone), light, dark.
///
/// Applied immediately — the sheet itself sits inside the rebuilt MaterialApp,
/// so the customer sees the result before dismissing it.
Future<void> showThemePicker(BuildContext context) async {
  final chosen = await showModalBottomSheet<AppThemeMode>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Padding(
            padding: EdgeInsets.only(bottom: 6),
            child: Text('ظاهر برنامه', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          ),
          Text('«هماهنگ با گوشی» با روشن/تاریک شدن خودکار سیستم عوض می‌شود.',
              style: TextStyle(fontSize: 11.5, color: context.inkMuted, height: 1.7)),
          const SizedBox(height: 10),
          for (final mode in AppThemeMode.values)
            RadioListTile<AppThemeMode>(
              value: mode,
              groupValue: ThemeController.instance.mode,
              contentPadding: EdgeInsets.zero,
              secondary: Icon(mode.icon),
              title: Text(mode.label, style: const TextStyle(fontWeight: FontWeight.w600)),
              onChanged: (value) => Navigator.pop(ctx, value),
            ),
        ]),
      ),
    ),
  );
  if (chosen != null) await ThemeController.instance.set(chosen);
}
