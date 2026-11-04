import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'home_shell.dart';
import 'server_setup.dart';

enum _Mode { password, otp, register, reset }

/// Customer door only — exactly like the public web login. Staff/admins are
/// rejected with a clear message and keep using the staff web panel.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  AppConfig? _config;
  _Mode _mode = _Mode.password;
  bool _busy = false;
  bool _otpSent = false;
  bool _obscure = true;

  final _identifier = TextEditingController();
  final _password = TextEditingController();
  final _mobile = TextEditingController();
  final _code = TextEditingController();
  final _fullName = TextEditingController();
  final _nationalId = TextEditingController();
  final _newPassword = TextEditingController();

  @override
  void initState() {
    super.initState();
    fetchAppConfig().then((config) {
      if (mounted) setState(() => _config = config);
    });
  }

  @override
  void dispose() {
    for (final c in [_identifier, _password, _mobile, _code, _fullName, _nationalId, _newPassword]) {
      c.dispose();
    }
    super.dispose();
  }

  void _goHome() {
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const HomeShell()));
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } catch (_) {
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
      await verifyOtp(mobile, code);
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
      await verifyOtp(mobile, code, purpose: 'reset_password', newPassword: _newPassword.text);
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
      await registerCustomer({
        'mobile': mobile,
        'password': _password.text,
        'fullName': _fullName.text.trim(),
        if (nationalId.isNotEmpty) 'nationalId': nationalId,
      });
      if (mounted) _goHome();
    });
  }

  @override
  Widget build(BuildContext context) {
    final config = _config;
    final brand = config?.brandName ?? 'پیشخوان';
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(22, 18, 22, 24), children: [
          Row(children: [
            const Spacer(),
            IconButton(
              tooltip: 'تغییر آدرس سرور',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ServerSetupScreen(fromProfile: true))),
              icon: const Icon(Icons.dns_outlined),
            ),
          ]),
          Center(child: ClipRRect(borderRadius: BorderRadius.circular(22), child: Image.asset('assets/icon.png', width: 72, height: 72))),
          const SizedBox(height: 14),
          Center(child: Text('ورود به $brand', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: PishkanColors.navy))),
          const SizedBox(height: 6),
          const Center(child: Text('با همان شماره موبایل و رمز نسخهٔ وب وارد شوید.', style: TextStyle(color: PishkanColors.mutedText, fontSize: 12.5))),
          const SizedBox(height: 20),
          _modeSwitcher(config),
          const SizedBox(height: 16),
          SoftCard(child: _form(config)),
          const SizedBox(height: 16),
          if (_mode == _Mode.password && config?.passwordReset != false)
            Center(
              child: TextButton(
                onPressed: () => setState(() {
                  _mode = _Mode.reset;
                  _otpSent = false;
                }),
                child: const Text('رمز عبور را فراموش کرده‌ام'),
              ),
            ),
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('این اپ ویژهٔ مشتریان است؛ همکاران دفتر از پنل وب وارد شوند.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11.5, color: PishkanColors.mutedText)),
          ),
        ]),
      ),
    );
  }

  Widget _modeSwitcher(AppConfig? config) {
    final modes = <(_Mode, String)>[
      if (config?.passwordLogin != false) (_Mode.password, 'با رمز عبور'),
      if (config == null || config.otpLogin) (_Mode.otp, 'کد پیامکی'),
      if (config == null || config.registrationOpen) (_Mode.register, 'ثبت‌نام'),
    ];
    if (!modes.any((m) => m.$1 == _mode) && _mode != _Mode.reset && modes.isNotEmpty) {
      _mode = modes.first.$1;
    }
    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999), border: Border.all(color: const Color(0xFFE2E8F0))),
      child: Row(children: [
        for (final (mode, label) in modes)
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() {
                _mode = mode;
                _otpSent = false;
              }),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  gradient: _mode == mode ? PishkanColors.brandGradient : null,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  label,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: _mode == mode ? Colors.white : PishkanColors.navy),
                ),
              ),
            ),
          ),
      ]),
    );
  }

  Widget _passwordField(TextEditingController controller, String label) {
    return TextField(
      controller: controller,
      obscureText: _obscure,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: const Icon(Icons.lock_outline_rounded),
        suffixIcon: IconButton(
          onPressed: () => setState(() => _obscure = !_obscure),
          icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
        ),
      ),
    );
  }

  Widget _form(AppConfig? config) {
    switch (_mode) {
      case _Mode.password:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(
            controller: _identifier,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'شماره موبایل', prefixIcon: Icon(Icons.phone_android_rounded)),
          ),
          const SizedBox(height: 12),
          _passwordField(_password, 'رمز عبور'),
          const SizedBox(height: 18),
          PlushButton(label: 'ورود', icon: Icons.login_rounded, loading: _busy, onPressed: _submitPassword),
        ]);
      case _Mode.otp:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(
            controller: _mobile,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'شماره موبایل', prefixIcon: Icon(Icons.phone_android_rounded)),
          ),
          if (_otpSent) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'کد پیامک‌شده', prefixIcon: Icon(Icons.sms_outlined)),
            ),
          ],
          const SizedBox(height: 18),
          PlushButton(
            label: _otpSent ? 'تأیید و ورود' : 'ارسال کد پیامکی',
            icon: _otpSent ? Icons.check_circle_rounded : Icons.sms_rounded,
            loading: _busy,
            onPressed: _otpSent ? _submitOtp : () => _sendOtp('login'),
          ),
          if (_otpSent)
            TextButton(onPressed: _busy ? null : () => _sendOtp('login'), child: const Text('ارسال دوبارهٔ کد')),
        ]);
      case _Mode.register:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(controller: _fullName, decoration: const InputDecoration(labelText: 'نام و نام خانوادگی', prefixIcon: Icon(Icons.person_outline_rounded))),
          const SizedBox(height: 12),
          TextField(controller: _mobile, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'شماره موبایل', prefixIcon: Icon(Icons.phone_android_rounded))),
          const SizedBox(height: 12),
          TextField(controller: _nationalId, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'کد ملی (اختیاری)', prefixIcon: Icon(Icons.badge_outlined))),
          const SizedBox(height: 12),
          _passwordField(_password, 'رمز عبور (حداقل ۸ نویسه)'),
          const SizedBox(height: 18),
          PlushButton(label: 'ساخت حساب و ورود', icon: Icons.person_add_alt_rounded, loading: _busy, onPressed: _submitRegister),
        ]);
      case _Mode.reset:
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('بازیابی رمز عبور', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
          const SizedBox(height: 10),
          TextField(controller: _mobile, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'شماره موبایل', prefixIcon: Icon(Icons.phone_android_rounded))),
          if (_otpSent) ...[
            const SizedBox(height: 12),
            TextField(controller: _code, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'کد پیامک‌شده', prefixIcon: Icon(Icons.sms_outlined))),
            const SizedBox(height: 12),
            _passwordField(_newPassword, 'رمز عبور جدید'),
          ],
          const SizedBox(height: 18),
          PlushButton(
            label: _otpSent ? 'ثبت رمز جدید و ورود' : 'ارسال کد بازیابی',
            icon: Icons.lock_reset_rounded,
            loading: _busy,
            onPressed: _otpSent ? _submitReset : () => _sendOtp('reset_password'),
          ),
          TextButton(
            onPressed: () => setState(() => _mode = _Mode.password),
            child: const Text('بازگشت به ورود'),
          ),
        ]);
    }
  }
}
