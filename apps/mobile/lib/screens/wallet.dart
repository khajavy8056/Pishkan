import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';

/// Wallet: balance, top-up through the gateway, full transaction ledger.
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _wallet;
  List<Map<String, dynamic>> _transactions = const [];
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    try {
      final wallet = await fetchWallet();
      final transactions = await fetchWalletTransactions();
      if (mounted) {
        setState(() {
          _wallet = wallet;
          _transactions = transactions;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  String _typeLabel(String type) => switch (type) {
        'topup' => 'افزایش موجودی',
        'admin_credit' => 'اعتبار هدیهٔ مدیریت',
        'gift' => 'هدیه',
        'purchase' => 'پرداخت فاکتور',
        'refund' => 'بازگشت وجه',
        'correction' => 'اصلاحیه',
        _ => 'تراکنش کیف پول',
      };

  Future<void> _topup() async {
    final controller = TextEditingController();
    const quickAmounts = [50000, 100000, 200000, 500000];
    final amountToman = await showModalBottomSheet<num>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 18, 20, MediaQuery.of(ctx).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('افزایش موجودی کیف پول', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 14),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final amount in quickAmounts)
              ChoiceChip(label: Text('${faDigits(groupThousands(amount))} تومان'), selected: false, onSelected: (_) => Navigator.pop(ctx, amount)),
          ]),
          const SizedBox(height: 14),
          TextField(
            controller: controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(labelText: 'مبلغ دلخواه (تومان)', suffixText: 'تومان'),
          ),
          const SizedBox(height: 16),
          PlushButton(
            label: 'پرداخت و شارژ',
            onPressed: () {
              final value = num.tryParse(enDigits(controller.text).replaceAll(RegExp(r'[^0-9]'), ''));
              Navigator.pop(ctx, value ?? 0);
            },
          ),
        ]),
      ),
    );
    controller.dispose();
    if (amountToman == null || amountToman < 1000) {
      if (amountToman != null) showSnack(context, 'مبلغ شارژ باید حداقل ۱٬۰۰۰ تومان باشد.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final url = await topupWallet(amountToman * 10); // server counts rials
      final uri = Uri.tryParse(api.absolute(url));
      if (uri == null) throw ApiException('لینک پرداخت دریافت نشد.');
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wallet = _wallet;
    return Scaffold(
      appBar: AppBar(title: const Text('کیف پول')),
      body: wallet == null
          ? (_error != null ? ErrorView(message: _error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.fromLTRB(16, 10, 16, 24), children: [
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    gradient: PishkanColors.brandGradient,
                    borderRadius: BorderRadius.circular(24),
                    boxShadow: [BoxShadow(color: PishkanColors.primary.withOpacity(0.3), blurRadius: 18, offset: const Offset(0, 8))],
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Row(children: [
                      Icon(Icons.account_balance_wallet_rounded, color: Colors.white70),
                      SizedBox(width: 8),
                      Text('موجودی فعلی', style: TextStyle(color: Colors.white70, fontSize: 12.5)),
                    ]),
                    const SizedBox(height: 8),
                    Text(faMoney(asNum(wallet['balance'])), style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: PishkanColors.navy),
                        onPressed: _busy ? null : _topup,
                        icon: Icon(Icons.add_circle_rounded),
                        label: const Text('افزایش موجودی'),
                      ),
                    ),
                  ]),
                ),
                const SectionTitle(title: 'گردش کیف پول'),
                if (_transactions.isEmpty)
                  SoftCard(child: Text('هنوز تراکنشی ندارید. با اولین شارژ یا پرداخت از کیف، سابقه‌اش این‌جا می‌آید.', style: TextStyle(fontSize: 12.5, color: context.inkMuted, height: 1.9)))
                else
                  SoftCard(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    child: Column(children: [
                      for (var i = 0; i < _transactions.length; i++) ...[
                        _txRow(_transactions[i]),
                        if (i < _transactions.length - 1) const Divider(height: 1),
                      ],
                    ]),
                  ),
              ]),
            ),
    );
  }

  Widget _txRow(Map<String, dynamic> tx) {
    final credit = asStr(tx['direction']) == 'credit';
    final amount = asNum(tx['amount']);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 11),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(9),
          decoration: BoxDecoration(color: (credit ? PishkanColors.success : PishkanColors.danger).withOpacity(0.11), shape: BoxShape.circle),
          child: Icon(credit ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded, size: 17, color: credit ? PishkanColors.success : PishkanColors.danger),
        ),
        const SizedBox(width: 11),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(asStr(tx['description']).isEmpty ? _typeLabel(asStr(tx['type'])) : asStr(tx['description']), style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5), maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(faDate(tx['createdAt'], withTime: true), style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
          ]),
        ),
        Text('${credit ? '+' : '−'} ${faMoney(amount.abs())}', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: credit ? PishkanColors.success : PishkanColors.danger)),
      ]),
    );
  }
}
