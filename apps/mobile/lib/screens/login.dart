import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/biometric.dart';
import '../core/format.dart';
import '../core/motion.dart';
import '../core/referral.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/notifier.dart' show AppPrefs;
import '../services/push.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'home_shell.dart';
import 'server_setup.dart';

enum _Mode { password, otp, register, reset }

/// Customer door only — exactly like the public web login (approved design):
/// pill ورود/ثبت‌نام switch, password, SMS code, or fingerprint when this
/// device already holds a session. Staff/admins are rejected with a clear
/// message and keep using the staff web panel.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, this.lockMessage = ''});

  /// Shown when arriving here because the biometric lock was not passed.
  final String lockMessage;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  AppConfig? _config;
  _Mode _mode = _Mode.password;
  bool _busy = false;
  bool _otpSent = false;
  bool _obscure = true;
  bool _canBiometric = false;

  final _identifier = TextEditingController();
  final _password = TextEditingController();
  final _mobile = TextEditingController();
  final _code = TextEditingController();
  final _fullName = TextEditingController();
  final _nationalId = TextEditingController();
  final _newPassword = TextEditingController();
  final _referral = TextEditingController();
  /// Voluntary, but it decides which default avatar set the account gets.
  String _gender = '';

  void _receiveReferral() { if (mounted) setState(() => _referral.text = ReferralStore.code.value); }

  @override
  void initState() {
    super.initState();
    ReferralStore.code.addListener(_receiveReferral);
    _receiveReferral();
    fetchAppConfig().then((config) {
      if (mounted) setState(() => _config = config);
    });
    // Storage can finish after the first screen on slow devices. Listen for
    // that completion so a valid saved session still offers biometric unlock.
    session.addListener(_refreshBiometric);
    _refreshBiometric();
  }

  Future<void> _refreshBiometric() async {
    final available = session.isSignedIn && await AppPrefs.biometricEnabled() && await BiometricAuth.isAvailable();
    if (mounted) setState(() => _canBiometric = available && session.isSignedIn);
  }

  @override
  void dispose() {
    session.removeListener(_refreshBiometric);
    ReferralStore.code.removeListener(_receiveReferral);
    for (final c in [_identifier, _password, _mobile, _code, _fullName, _nationalId, _newPassword, _referral]) {
      c.dispose();
    }
    super.dispose();
  }

  void _goHome() {
    // Bind this phone to the new account before leaving the login screen.
    // Waiting for the shell's first frame would leave a few seconds in which a
    // case update has nowhere to go; more importantly, on a phone that held a
    // previous account the token is reassigned here, which is what stops the
    // old owner's notifications.
    unawaited(PushService.refreshToken());
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomeShell()));
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      // Every path through here ends in either a screen change or a snackbar,
      // and both are easy to miss if the eye is on the keyboard. The haptic is
      // the confirmation that arrives first.
      Haptics.settle();
    } on ApiException catch (error) {
      Haptics.settle();
      if (mounted) showSnack(context, error.message, error: true);
    } catch (_) {
      Haptics.settle();
      if (mounted) showSnack(context, 'خطایی رخ داد. دوباره تلاش کنید.', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitPassword() async {
    final id = enDigits(_identifier.text).trim();
    if (id.isEmpty || _password.text.isEmpty) {
      showSnack(context, 'شماره موبایل و رمز عبور را وارد کنید.', error: true);
      return;
    }
    await _run(() async {
      await loginWithPassword(id, _password.text);
      if (mounted) _goHome();
    });
  }

  Future<void> _biometricUnlock() async {
    final ok = await BiometricAuth.authenticate();
    if (!ok || !mounted) return;
    await _run(() async {
      try {
        await fetchMe().timeout(const Duration(seconds: 6));
      } on ApiException catch (error) {
        // A revoked/expired session must never be unlocked locally.
        if (error.statusCode == 401) rethrow;
        if (error.statusCode != null) rethrow;
      } on TimeoutException catch (_) {
        // Open cached sections after a successful biometric check; actions
        // still require confirmation from the server.
      }
      unawaited(registerDevice());
      if (mounted && session.isSignedIn) _goHome();
    });
  }

  Future<void> _sendOtp(String purpose) async {
    final mobile = enDigits(_mobile.text).trim();
    if (!validIranMobile(mobile)) {
      showSnack(context, 'شماره موبایل معتبر وارد کنید (مثل 09123456789).', error: true);
      return;
    }
    await _run(() async {
      await requestOtp(mobile, purpose: purpose);
      if (mounted) {
        setState(() => _otpSent = true);
        showSnack(context, 'کد ورود پیامک شد.');
      }
    });
  }

  Future<void> _submitOtp() async {
    final mobile = enDigits(_mobile.text).trim();
    final code = enDigits(_code.text).trim();
    if (!validIranMobile(mobile) || code.isEmpty) {
      showSnack(context, 'موبایل و کد پیامکی را کامل وارد کنید.', error: true);
      return;
    }
    await _run(() async {
      final referral = _referral.text.trim();
      if (!ReferralStore.matchesServer(referral)) throw ApiException('این دعوت متعلق به سرور دیگری است. آدرس دفتر را بررسی کنید.');
      await verifyOtp(mobile, code, referralCode: referral);
      if (mounted) _goHome();
    });
  }

  Future<void> _submitReset() async {
    final mobile = enDigits(_mobile.text).trim();
    final code = enDigits(_code.text).trim();
    if (!validIranMobile(mobile) || code.isEmpty || _newPassword.text.length < 8) {
      showSnack(context, 'موبایل، کد پیامکی و رمز جدید (حداقل ۸ نویسه) لازم است.', error: true);
      return;
    }
    await _run(() async {
      await verifyOtp(mobile, code, purpose: 'reset', newPassword: _newPassword.text);
      if (mounted) _goHome();
    });
  }

  Future<void> _submitRegister() async {
    final mobile = enDigits(_mobile.text).trim();
    if (_fullName.text.trim().length < 3) {
      showSnack(context, 'نام و نام خانوادگی را کامل وارد کنید.', error: true);
      return;
    }
    if (!validIranMobile(mobile)) {
      showSnack(context, 'شماره موبایل معتبر وارد کنید.', error: true);
      return;
    }
    if (_password.text.length < 8) {
      showSnack(context, 'رمز عبور باید حداقل ۸ نویسه باشد.', error: true);
      return;
    }
    final nationalId = enDigits(_nationalId.text).trim();
    if (nationalId.isNotEmpty && !validNationalId(nationalId)) {
      showSnack(context, 'کد ملی واردشده معتبر نیست.', error: true);
      return;
    }
    await _run(() async {
      final referral = _referral.text.trim();
      if (!ReferralStore.matchesServer(referral)) throw ApiException('این دعوت متعلق به سرور دیگری است. آدرس دفتر را بررسی کنید.');
      try {
        await registerCustomer({
          'mobile': mobile,
          'password': _password.text,
          'fullName': _fullName.text.trim(),
          if (nationalId.isNotEmpty) 'nationalId': nationalId,
          if (referral.isNotEmpty) 'referralCode': referral,
          if (_gender.isNotEmpty) 'gender': _gender,
        });
        if (mounted) _goHome();
      } on PendingRegistration catch (pending) {
        // The account exists but is not usable yet: this is success with a
        // message, not an error. Return to the login form with the mobile
        // filled in so the customer can sign in once the office approves.
        if (!mounted) return;
        showSnack(context, pending.message);
        setState(() {
          _mode = _Mode.password;
          _identifier.text = mobile;
          _password.clear();
        });
      }
    });
  }

  bool get _isLoginSide => _mode == _Mode.password || _mode == _Mode.otp;

  @override
  Widget build(BuildContext context) {
    final config = _config;
    final brand = config?.brandName ?? 'تک پیشخوان';
    final tagline = (config?.tagline.isNotEmpty == true) ? config!.tagline : 'سامانهٔ جامع خدمات دولت';
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(24, 14, 24, 24), children: [
          Row(children: [
            const Spacer(),
            IconButton(
              tooltip: 'تغییر آدرس سرور',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ServerSetupScreen(fromProfile: true))),
              icon: Icon(Icons.dns_outlined, color: context.inkMuted),
            ),
          ]),
          Center(
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: context.surface, shape: BoxShape.circle, boxShadow: [BoxShadow(color: Color(0x1A1452D9), blurRadius: 20, offset: Offset(0, 8))]),
              child: ClipOval(child: Image.asset('assets/icon.png', width: 62, height: 62)),
            ),
          ),
          const SizedBox(height: 12),
          Center(child: Text(brand, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: context.ink))),
          const SizedBox(height: 4),
          Center(child: Text(tagline, style: TextStyle(color: context.inkMuted, fontSize: 12.5))),
          if (widget.lockMessage.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(color: context.caution.withOpacity(context.isDark ? 0.14 : 0.10), borderRadius: BorderRadius.circular(12)),
              child: Text(widget.lockMessage, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: context.caution)),
            ),
          ],
          const SizedBox(height: 20),
          if (_mode != _Mode.reset) _modeSwitcher(config),
          const SizedBox(height: 18),
          _form(config),
        ]),
      ),
    );
  }

  Widget _modeSwitcher(AppConfig? config) {
    final showRegister = config == null || config.registrationOpen;
    if (!showRegister && _mode == _Mode.register) _mode = _Mode.password;
    return Container(
      padding: const EdgeInsets.all(5),
      // The track, not a decoration: it sits behind both pills, so it has to be
      // a step *away* from the surface in whichever direction the mode goes.
      // It used to be a fixed pale blue — near-white — while the inactive pill's
      // label is `context.ink`, which is near-white in dark mode. Light text on
      // a light track is the unreadable pair in the screenshots.
      decoration: BoxDecoration(color: context.surfaceSunken, borderRadius: BorderRadius.circular(999)),
      child: Row(children: [
        _switchPill('ورود', _isLoginSide, () => setState(() {
              _mode = _Mode.password;
              _otpSent = false;
            })),
        if (showRegister)
          _switchPill('ثبت نام', _mode == _Mode.register, () => setState(() {
                _mode = _Mode.register;
                _otpSent = false;
              })),
      ]),
    );
  }

  Widget _switchPill(String label, bool active, VoidCallback onTap) {
    return Expanded(
      child: GestureDetector(
        onTap: () {
          if (!active) Haptics.select();
          onTap();
        },
        child: AnimatedContainer(
          duration: PishkanMotion.scaled(context, PishkanMotion.standard),
          padding: const EdgeInsets.symmetric(vertical: 11),
          decoration: BoxDecoration(
            gradient: active ? PishkanColors.brandGradient : null,
            borderRadius: BorderRadius.circular(999),
            boxShadow: active ? [BoxShadow(color: PishkanColors.primary.withOpacity(0.35), blurRadius: 10, offset: const Offset(0, 4))] : null,
          ),
          child: Text(label, textAlign: TextAlign.center, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: active ? Colors.white : context.ink)),
        ),
      ),
    );
  }

  Widget _passwordField(TextEditingController controller, String hint) {
    return TextField(
      controller: controller,
      obscureText: _obscure,
      // The reveal toggle is the one control on this screen people press
      // uncertainly, often twice, to check whether the dots actually hid
      // something. So it ticks on the way in and the icon *rotates* into its
      // new state — a straight swap of two near-identical eye glyphs gives no
      // confirmation that anything happened.
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.lock_outline_rounded),
        suffixIcon: IconButton(
          onPressed: () {
            Haptics.select();
            setState(() => _obscure = !_obscure);
          },
          icon: AnimatedSwitcher(
            duration: PishkanMotion.reduced(context) ? Duration.zero : PishkanMotion.quick,
            transitionBuilder: (child, animation) => RotationTransition(
              turns: Tween<double>(begin: 0.75, end: 1).animate(animation),
              child: FadeTransition(opacity: animation, child: child),
            ),
            // The key is what makes AnimatedSwitcher swap rather than update
            // the same icon in place.
            child: Icon(
              _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
              key: ValueKey(_obscure),
            ),
          ),
        ),
      ),
    );
  }

  Widget _orDivider() =>  Padding(
        padding: EdgeInsets.symmetric(vertical: 14),
        child: Row(children: [
          Expanded(child: Divider()),
          Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Text('یا', style: TextStyle(color: context.inkMuted, fontSize: 12))),
          Expanded(child: Divider()),
        ]),
      );

  Widget _form(AppConfig? config) {
    switch (_mode) {
      case _Mode.password:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(
            controller: _identifier,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(hintText: 'شماره موبایل', prefixIcon: Icon(Icons.smartphone_rounded)),
          ),
          const SizedBox(height: 12),
          _passwordField(_password, 'رمز عبور'),
          if (config?.passwordReset != false)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => setState(() {
                  _mode = _Mode.reset;
                  _otpSent = false;
                }),
                child: const Text('فراموشی رمز عبور؟'),
              ),
            )
          else
            const SizedBox(height: 16),
          PlushButton(label: 'ورود', arrow: true, loading: _busy, onPressed: _submitPassword),
          _orDivider(),
          if (config == null || config.otpLogin)
            OutlinedButton.icon(
              onPressed: _busy ? null : () => setState(() => _mode = _Mode.otp),
              icon: Icon(Icons.sms_rounded),
              label: const Text('ورود با کد پیامکی'),
            ),
          if (_canBiometric) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _busy ? null : _biometricUnlock,
              icon: Icon(Icons.fingerprint_rounded, size: 26),
              label: const Text('ورود با اثر انگشت'),
            ),
          ],
          if (config == null || config.registrationOpen) ...[
            const SizedBox(height: 16),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Text('حساب کاربری ندارید؟', style: TextStyle(fontSize: 12.5, color: context.inkMuted)),
              TextButton(onPressed: () => setState(() => _mode = _Mode.register), child: const Text('ثبت نام کنید')),
            ]),
          ],
        ]);
      case _Mode.otp:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(controller: _referral, textDirection: TextDirection.ltr, decoration: const InputDecoration(hintText: 'کد دعوت (اختیاری)')),
          const SizedBox(height: 12),
          TextField(
            controller: _mobile,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(hintText: 'شماره موبایل', prefixIcon: Icon(Icons.smartphone_rounded)),
          ),
          if (_otpSent) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(hintText: 'کد پیامک‌شده', prefixIcon: Icon(Icons.sms_outlined)),
            ),
          ],
          const SizedBox(height: 18),
          PlushButton(label: _otpSent ? 'تأیید و ورود' : 'ارسال کد پیامکی', arrow: true, loading: _busy, onPressed: _otpSent ? _submitOtp : () => _sendOtp('login')),
          if (_otpSent) TextButton(onPressed: _busy ? null : () => _sendOtp('login'), child: const Text('ارسال دوبارهٔ کد')),
          TextButton(onPressed: () => setState(() => _mode = _Mode.password), child: const Text('ورود با رمز عبور')),
        ]);
      case _Mode.register:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(controller: _referral, textDirection: TextDirection.ltr, decoration: const InputDecoration(hintText: 'کد دعوت (اختیاری)')),
          const SizedBox(height: 12),
          TextField(controller: _fullName, decoration: const InputDecoration(hintText: 'نام و نام خانوادگی', prefixIcon: Icon(Icons.person_outline_rounded))),
          const SizedBox(height: 12),
          TextField(controller: _mobile, keyboardType: TextInputType.phone, decoration: const InputDecoration(hintText: 'شماره موبایل', prefixIcon: Icon(Icons.smartphone_rounded))),
          const SizedBox(height: 12),
          TextField(controller: _nationalId, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'کد ملی (اختیاری)', prefixIcon: Icon(Icons.badge_outlined))),
          const SizedBox(height: 12),
          _passwordField(_password, 'رمز عبور (حداقل ۸ نویسه)'),
          const SizedBox(height: 14),
          Text('جنسیت (برای انتخاب آواتار پیش‌فرض — اختیاری)', style: TextStyle(fontSize: 11.5, color: context.inkMuted)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            for (final option in const [('female', 'زن'), ('male', 'مرد')])
              ChoiceChip(
                label: Text(option.$2),
                selected: _gender == option.$1,
                onSelected: (selected) => setState(() => _gender = selected ? option.$1 : ''),
              ),
          ]),
          const SizedBox(height: 18),
          PlushButton(label: 'ثبت نام و ورود', arrow: true, loading: _busy, onPressed: _submitRegister),
        ]);
      case _Mode.reset:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('بازیابی رمز عبور', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: context.ink)),
          const SizedBox(height: 12),
          TextField(controller: _mobile, keyboardType: TextInputType.phone, decoration: const InputDecoration(hintText: 'شماره موبایل', prefixIcon: Icon(Icons.smartphone_rounded))),
          if (_otpSent) ...[
            const SizedBox(height: 12),
            TextField(controller: _code, keyboardType: TextInputType.number, decoration: const InputDecoration(hintText: 'کد پیامک‌شده', prefixIcon: Icon(Icons.sms_outlined))),
            const SizedBox(height: 12),
            _passwordField(_newPassword, 'رمز عبور جدید'),
          ],
          const SizedBox(height: 18),
          PlushButton(label: _otpSent ? 'ثبت رمز جدید و ورود' : 'ارسال کد بازیابی', arrow: true, loading: _busy, onPressed: _otpSent ? _submitReset : () => _sendOtp('reset')),
          TextButton(onPressed: () => setState(() => _mode = _Mode.password), child: const Text('بازگشت به ورود')),
        ]);
    }
  }
}
