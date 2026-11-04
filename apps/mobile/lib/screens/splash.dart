import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/theme.dart';
import '../services/services.dart';
import 'home_shell.dart';
import 'login.dart';
import 'server_setup.dart';

/// Decides where the customer lands: server setup on first run (local
/// installs), login when there is no session, otherwise the dashboard.
/// Also enforces the admin-controlled minimum app version.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  String _message = 'در حال آماده‌سازی…';

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (!mounted) return;

    if (!session.hasServer) {
      _go(const ServerSetupScreen());
      return;
    }

    setState(() => _message = 'در حال اتصال به سامانه…');
    final config = await fetchAppConfig();
    if (!mounted) return;

    if (config != null && config.minVersion.isNotEmpty) {
      final current = await currentAppVersion();
      final outdated = compareVersions(current, config.minVersion) < 0;
      final newerExists = config.latestVersion.isNotEmpty && compareVersions(current, config.latestVersion) < 0;
      if ((outdated && config.forceUpdate) || (newerExists && config.forceUpdate)) {
        await _showUpdateDialog(config.updateUrl, forced: outdated);
        if (outdated && mounted) return; // forced: stay here
      }
    }

    if (!session.isSignedIn) {
      _go(const LoginScreen());
      return;
    }

    // Validate the stored session; a 401 clears it inside ApiClient.
    try {
      await fetchMe();
    } on ApiException {
      if (!session.isSignedIn && mounted) {
        _go(const LoginScreen());
        return;
      }
      // Network trouble: keep going with the cached profile.
    } catch (_) {}
    if (!mounted) return;
    await registerDevice();
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

  void _go(Widget page) {
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: PishkanColors.brandGradient),
        child: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(26),
              child: Image.asset('assets/icon.png', width: 96, height: 96),
            ),
            const SizedBox(height: 20),
            const Text('پیشخوان', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            const Text('خدمات آنلاین دفتر پیشخوان شما', style: TextStyle(color: Color(0xFFCFE0FF), fontSize: 13)),
            const SizedBox(height: 28),
            const CircularProgressIndicator(color: Colors.white),
            const SizedBox(height: 12),
            Text(_message, style: const TextStyle(color: Color(0xFFE6EEFF), fontSize: 12.5)),
          ]),
        ),
      ),
    );
  }
}
