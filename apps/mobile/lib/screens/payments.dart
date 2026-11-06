import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'request_detail.dart';

/// Invoices (with pay actions) and payment history — the same ledgers the
/// web accounting screens show.
class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> with WidgetsBindingObserver {
  bool _showPayments = false;
  List<Map<String, dynamic>> _invoices = const [];
  List<Map<String, dynamic>> _payments = const [];
  bool _loading = true;
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
      final invoices = await fetchMyInvoices();
      final payments = await fetchMyPayments();
      if (mounted) {
        setState(() {
          _invoices = invoices;
          _payments = payments;
          _loading = false;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.message;
        });
      }
    }
  }

  Future<void> _pay(Map<String, dynamic> invoice, {required bool wallet}) async {
    setState(() => _busy = true);
    try {
      if (wallet) {
        await payInvoiceWithWallet(asStr(invoice['id']));
        showSnack(context, 'فاکتور از کیف پول پرداخت شد.');
        await _load();
      } else {
        final url = await payInvoiceOnline(asStr(invoice['id']));
        final uri = Uri.tryParse(api.absolute(url));
        if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _paymentStatusLabel(String status) => switch (status) {
        'confirmed' || 'successful' || 'paid' => 'موفق',
        'failed' || 'rejected' => 'ناموفق',
        'refunded' => 'عودت‌شده',
        _ => 'در انتظار',
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('فاکتورها و پرداخت‌ها')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
          child: SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('فاکتورهای من')),
              ButtonSegment(value: true, label: Text('سوابق پرداخت')),
            ],
            selected: {_showPayments},
            onSelectionChanged: (next) => setState(() => _showPayments = next.first),
          ),
        ),
        Expanded(
          child: _loading
              ? const LoadingView()
              : _error != null
                  ? ErrorView(message: _error!, onRetry: _load)
                  : _showPayments
                      ? _paymentsList()
                      : _invoicesList(),
        ),
      ]),
    );
  }

  Widget _invoicesList() {
    if (_invoices.isEmpty) {
      return const EmptyView(icon: Icons.receipt_long_outlined, title: 'فاکتوری ندارید', hint: 'فاکتورهای صادرشده برای شما (هزینهٔ خدمت و هزینه‌های سازمانی) این‌جا دیده می‌شوند.');
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
        itemCount: _invoices.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final invoice = _invoices[index];
          final total = asNum(invoice['total']);
          final paid = asNum(invoice['paidAmount']);
          final isPaid = paid >= total;
          final requestId = asStr(invoice['requestId']);
          return SoftCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(asStr(invoice['title']).isEmpty ? 'فاکتور ${faDigits(asStr(invoice['number']))}' : asStr(invoice['title']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                    Text('شماره ${faDigits(asStr(invoice['number']))} · صدور ${faDate(invoice['issuedAt'])}', style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
                  ]),
                ),
                StatusChip(label: isPaid ? 'پرداخت شده' : paid > 0 ? 'پرداخت ناقص' : 'پرداخت نشده', status: isPaid ? 'paid' : 'unpaid'),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                Text(faMoney(total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
                if (!isPaid && paid > 0) Text(' (پرداخت‌شده: ${faMoney(paid)})', style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
                const Spacer(),
                if (requestId.isNotEmpty)
                  TextButton(
                    onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: requestId))),
                    child: const Text('مشاهدهٔ پرونده'),
                  ),
              ]),
              if (!isPaid && asStr(invoice['status']) != 'void') ...[
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(child: PlushButton(label: 'پرداخت آنلاین', icon: Icons.payment_rounded, loading: _busy, onPressed: () => _pay(invoice, wallet: false))),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _pay(invoice, wallet: true),
                      icon: const Icon(Icons.account_balance_wallet_rounded),
                      label: const Text('از کیف پول'),
                    ),
                  ),
                ]),
              ],
            ]),
          );
        },
      ),
    );
  }

  Widget _paymentsList() {
    if (_payments.isEmpty) {
      return const EmptyView(icon: Icons.payments_outlined, title: 'پرداختی ثبت نشده است', hint: 'رسیدهای پرداخت درگاهی و کیف پول این‌جا نگه‌داری می‌شوند.');
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
        itemCount: _payments.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final payment = _payments[index];
          final status = asStr(payment['status']);
          final ok = ['confirmed', 'successful', 'paid'].contains(status);
          return SoftCard(
            child: Row(children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: (ok ? PishkanColors.success : PishkanColors.warning).withOpacity(0.12), shape: BoxShape.circle),
                child: Icon(ok ? Icons.check_rounded : Icons.hourglass_bottom_rounded, color: ok ? PishkanColors.success : PishkanColors.warning),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(faMoney(asNum(payment['amount'])), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
                  Text(
                    '${faDate(payment['paidAt'] ?? payment['createdAt'], withTime: true)}${asStr(payment['trackingCode']).isEmpty && asStr(payment['reference']).isEmpty ? '' : ' · پیگیری ${faDigits(asStr(payment['trackingCode']).isEmpty ? asStr(payment['reference']) : asStr(payment['trackingCode']))}'}',
                    style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText),
                  ),
                ]),
              ),
              StatusChip(label: _paymentStatusLabel(status), status: ok ? 'successful' : status),
            ]),
          );
        },
      ),
    );
  }
}
