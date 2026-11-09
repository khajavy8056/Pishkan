import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/biometric.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/notifier.dart' show AppPrefs;
import '../services/services.dart';
import 'home_shell.dart';
import 'login.dart';
import 'server_setup.dart';

/// First screen (approved design): brand over the office artwork while the
/// app decides where the customer lands — server setup on first run, login
/// without a session, otherwise the dashboard (behind the optional
/// fingerprint lock). Also enforces the admin-controlled minimum version.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  String _message = 'در حال آماده‌سازی…';
  String _brand = 'تک پیشخوان';
  String _tagline = 'سامانهٔ جامع خدمات دولت';

  @override
  void initState() {
    super.initState();
    _boot();
  }

  /// Wall-clock floor for the splash animation.
  ///
  /// The brief asks for five to seven seconds of intro so the identity is
  /// actually seen, but the work has to happen inside that window, not after
  /// it: [_bootSteps] runs immediately and this only pads the remainder, so a
  /// fast connection still leaves after six seconds and a slow one leaves as
  /// soon as it is ready. Nobody waits 6 s *plus* the network.
  static const _minimumSplash = Duration(seconds: 6);
  final _bootStarted = DateTime.now();

  Future<void> _holdSplash() async {
    final elapsed = DateTime.now().difference(_bootStarted);
    final remaining = _minimumSplash - elapsed;
    if (remaining > Duration.zero) await Future<void>.delayed(remaining);
  }

  Future<void> _boot() async {
    // Short brand beat only — never wait for permissions or a slow network
    // here. Notification permission is asked later, inside the shell.
    try {
      await _bootSteps();
    } catch (_) {
      // Whatever went wrong, the customer must land on a real screen.
      if (mounted) _go(session.hasServer ? const LoginScreen() : const ServerSetupScreen());
    }
  }

  Future<void> _bootSteps() async {
    await Future<void>.delayed(const Duration(milliseconds: 350));
    // main() paints promptly even if secure storage is slow. Give the same
    // in-flight load a little longer before deciding the user has no session.
    try { await session.load().timeout(const Duration(seconds: 5)); } catch (_) {}
    if (!mounted) return;

    if (!session.hasServer) {
      _go(const ServerSetupScreen());
      return;
    }

    setState(() => _message = 'در حال اتصال به سامانه…');
    AppConfig? config;
    try {
      config = await fetchAppConfig().timeout(const Duration(seconds: 6));
    } catch (_) {
      config = null; // Offline on a slow LAN must not gate the login screen.
    }
    if (!mounted) return;
    final cfg = config;
    if (cfg != null) {
      setState(() {
        _brand = cfg.brandName.isEmpty ? _brand : cfg.brandName;
        if (cfg.tagline.isNotEmpty) _tagline = cfg.tagline;
      });
    }

    if (cfg != null && cfg.minVersion.isNotEmpty) {
      final current = await currentAppVersion();
      final outdated = compareVersions(current, cfg.minVersion) < 0;
      final newerExists = cfg.latestVersion.isNotEmpty && compareVersions(current, cfg.latestVersion) < 0;
      if (outdated || (newerExists && cfg.forceUpdate)) {
        final hardBlock = outdated && cfg.forceUpdate;
        await _showUpdateDialog(cfg.updateUrl, forced: hardBlock);
        if (hardBlock && mounted) return;
      }
    }

    if (!session.isSignedIn) {
      _go(const LoginScreen());
      return;
    }

    // Optional fingerprint lock before showing any personal data.
    if (await AppPrefs.biometricEnabled()) {
      if (!await BiometricAuth.isAvailable()) {
        if (mounted) _go(const LoginScreen(lockMessage: 'برای ادامه، با رمز عبور وارد شوید.'));
        return;
      }
      final unlocked = await BiometricAuth.authenticate();
      if (!mounted) return;
      if (!unlocked) {
        _go(const LoginScreen(lockMessage: 'برای ادامه، اثر انگشت را تأیید کنید یا با رمز وارد شوید.'));
        return;
      }
    }

    try {
      await fetchMe().timeout(const Duration(seconds: 6));
    } on ApiException {
      if (!session.isSignedIn && mounted) {
        _go(const LoginScreen());
        return;
      }
    } catch (_) {}
    if (!mounted) return;
    unawaited(registerDevice());
    _go(const HomeShell());
  }

  Future<void> _showUpdateDialog(String updateUrl, {required bool forced}) async {
    await showDialog<void>(
      context: context,
      barrierDismissible: !forced,
      builder: (ctx) => AlertDialog(
        title: const Text('نسخهٔ جدید اپلیکیشن'),
        content: Text(
          forced
              ? 'برای ادامهٔ استفاده از اپ، لازم است نسخهٔ جدید را نصب کنید.'
              : 'نسخهٔ جدیدی از اپلیکیشن منتشر شده است. پیشنهاد می‌کنیم همین حالا به‌روز کنید.',
          style: const TextStyle(height: 1.8, fontSize: 14),
        ),
        actions: [
          if (!forced) TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('بعداً')),
          FilledButton(
            onPressed: () async {
              final url = updateUrl.isEmpty ? session.serverUrl : updateUrl;
              final uri = Uri.tryParse(api.absolute(url));
              if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
              if (!forced && ctx.mounted) Navigator.pop(ctx);
            },
            child: const Text('دریافت نسخهٔ جدید'),
          ),
        ],
      ),
    );
  }

  Future<void> _go(Widget page) async {
    await _holdSplash();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return Scaffold(
      body: Stack(children: [
        // Office artwork (bundled so the very first screen works offline).
        Positioned.fill(
          child: Image.asset(
            'assets/splash-office.jpg',
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => Container(decoration: BoxDecoration(gradient: PishkanColors.brandGradient)),
          ),
        ),
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.white.withOpacity(0.10), Colors.transparent, const Color(0xFF1452D9).withOpacity(0.88)],
                stops: const [0, 0.42, 0.86],
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
              ),
            ),
          ),
        ),
        SafeArea(
          child: Column(children: [
            SizedBox(height: size.height * 0.055),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: Colors.white.withOpacity(0.92), shape: BoxShape.circle, boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.14), blurRadius: 22, offset: const Offset(0, 8))]),
              child: ClipOval(child: Image.asset('assets/icon.png', width: 72, height: 72)),
            ),
            const SizedBox(height: 16),
            Text(_brand, style: TextStyle(color: context.ink, fontSize: 27, fontWeight: FontWeight.w800, shadows: [Shadow(color: Colors.white70, blurRadius: 12)])),
            const SizedBox(height: 5),
            Text(_tagline, style: const TextStyle(color: Color(0xFF274B73), fontSize: 13.5, fontWeight: FontWeight.w600)),
            const Spacer(),
            const Text('خدمات دولتی، ساده‌تر از همیشه', style: TextStyle(color: Colors.white, fontSize: 16.5, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            const Text('سریع • آسان • مطمئن', style: TextStyle(color: Color(0xFFD8E7FF), fontSize: 13, fontWeight: FontWeight.w600)),
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 70),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: const LinearProgressIndicator(minHeight: 5, backgroundColor: Colors.white24, valueColor: AlwaysStoppedAnimation(Colors.white)),
              ),
            ),
            const SizedBox(height: 10),
            Text(_message, style: const TextStyle(color: Color(0xFFE6EEFF), fontSize: 12)),
            const SizedBox(height: 26),
          ]),
        ),
      ]),
    );
  }
}
