import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../core/env.dart';
import '../core/theme.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'login.dart';

/// First-run (and later, from Profile) server connection setup. Local office
/// installs run on a Windows PC reachable over the office Wi‑Fi, so the
/// customer can type the address shown by the office (e.g. 192.168.1.10:3000)
/// or scan it as a QR code. Production builds can also bake the address in
/// with --dart-define and this screen never appears.
class ServerSetupScreen extends StatefulWidget {
  const ServerSetupScreen({super.key, this.fromProfile = false});

  final bool fromProfile;

  @override
  State<ServerSetupScreen> createState() => _ServerSetupScreenState();
}

class _ServerSetupScreenState extends State<ServerSetupScreen> {
  final _controller = TextEditingController();
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    _controller.text = session.serverUrl;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _connect(String raw) async {
    final url = normalizeBaseUrl(raw);
    if (url.isEmpty) {
      showSnack(context, 'آدرس سرور را وارد کنید.', error: true);
      return;
    }
    setState(() => _checking = true);
    final reachable = await api.ping(url);
    if (!mounted) return;
    setState(() => _checking = false);
    if (!reachable) {
      final keep = await confirmDialog(
        context,
        'اتصال برقرار نشد',
        '«$url» پاسخ نداد.\n\n'
            '• اگر سامانه روی کامپیوتر دفتر نصب است، گوشی باید به همان Wi‑Fi دفتر وصل باشد.\n'
            '• آدرس را از مدیر دفتر بگیرید (معمولاً چیزی شبیه 192.168.1.10:3000).\n\n'
            'می‌خواهید همین آدرس ذخیره شود تا بعداً دوباره امتحان کنید؟',
        confirmLabel: 'ذخیره شود',
      );
      if (!keep) return;
    }
    await session.setServerUrl(url);
    if (!mounted) return;
    if (widget.fromProfile) {
      showSnack(context, 'آدرس سرور به‌روزرسانی شد.');
      Navigator.pop(context);
    } else {
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LoginScreen()));
    }
  }

  Future<void> _scanQr() async {
    final scanned = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const _QrScanScreen()));
    if (scanned != null && scanned.isNotEmpty) {
      _controller.text = scanned;
      await _connect(scanned);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: widget.fromProfile ? AppBar(title: const Text('تنظیم اتصال به سرور')) : null,
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(22, 24, 22, 24), children: [
          if (!widget.fromProfile) ...[
            Center(child: ClipRRect(borderRadius: BorderRadius.circular(22), child: Image.asset('assets/icon.png', width: 76, height: 76))),
            const SizedBox(height: 16),
            const Center(child: Text('به پیشخوان خوش آمدید', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: PishkanColors.navy))),
            const SizedBox(height: 8),
            const Center(
              child: Text(
                'برای شروع، آدرس سامانهٔ دفتر خودتان را وارد کنید.\nاین آدرس را دفتر پیشخوان به شما می‌دهد.',
                textAlign: TextAlign.center,
                style: TextStyle(color: PishkanColors.mutedText, fontSize: 13, height: 1.9),
              ),
            ),
            const SizedBox(height: 22),
          ],
          SoftCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('آدرس سرور', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
              const SizedBox(height: 8),
              TextField(
                controller: _controller,
                keyboardType: TextInputType.url,
                textDirection: TextDirection.ltr,
                decoration: const InputDecoration(hintText: '192.168.1.10:3000', prefixIcon: Icon(Icons.dns_rounded)),
              ),
              const SizedBox(height: 6),
              const Text(
                'نمونه‌ها: روی Wi‑Fi دفتر → 192.168.1.10:3000\nروی اینترنت → https://pishkan.example.ir\nامولاتور اندروید روی همان کامپیوتر → 10.0.2.2:3000',
                style: TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.9),
              ),
              const SizedBox(height: 16),
              PlushButton(label: 'اتصال و ادامه', icon: Icons.link_rounded, loading: _checking, onPressed: () => _connect(_controller.text)),
              const SizedBox(height: 10),
              OutlinedButton.icon(onPressed: _scanQr, icon: const Icon(Icons.qr_code_scanner_rounded), label: const Text('اسکن QR آدرس سرور')),
            ]),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.07), borderRadius: BorderRadius.circular(16)),
            child: const Text(
              'این اپ مستقیم به همان سامانه‌ای وصل می‌شود که نسخهٔ وب دفتر روی آن کار می‌کند؛ حساب کاربری، درخواست‌ها و پرداخت‌های شما دقیقاً همان است که در سایت می‌بینید.',
              style: TextStyle(fontSize: 12, height: 1.9, color: PishkanColors.navy),
            ),
          ),
        ]),
      ),
    );
  }
}

class _QrScanScreen extends StatefulWidget {
  const _QrScanScreen();

  @override
  State<_QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<_QrScanScreen> {
  bool _handled = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('اسکن QR آدرس سرور')),
      body: MobileScanner(
        onDetect: (capture) {
          if (_handled) return;
          for (final barcode in capture.barcodes) {
            final raw = barcode.rawValue ?? '';
            if (raw.isNotEmpty) {
              _handled = true;
              Navigator.pop(context, raw);
              return;
            }
          }
        },
      ),
    );
  }
}
