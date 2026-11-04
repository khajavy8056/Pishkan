import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/dynamic_form.dart';
import '../widgets/widgets.dart';
import 'request_detail.dart';

/// Personalized custom-service offers the office defined for this customer
/// (same list as the web panel). Accepting collects the service form and
/// starts the case; declining records the refusal with a reason.
class OffersScreen extends StatefulWidget {
  const OffersScreen({super.key});

  @override
  State<OffersScreen> createState() => _OffersScreenState();
}

class _OffersScreenState extends State<OffersScreen> {
  List<Map<String, dynamic>> _offers = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await api.getData('/api/catalog/offers');
      if (mounted) {
        setState(() {
          _offers = asMapList(data);
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

  String _statusLabel(Map<String, dynamic> offer) {
    if (asBool(offer['expired']) && asStr(offer['status']) == 'pending') return 'منقضی‌شده';
    return switch (asStr(offer['status'])) {
      'pending' => 'در انتظار تصمیم شما',
      'accepted' => 'پذیرفته‌شده',
      'declined' => 'ردشده توسط شما',
      'expired' => 'منقضی‌شده',
      _ => asStr(offer['status']),
    };
  }

  Future<void> _accept(Map<String, dynamic> offer) async {
    // Collect the custom service's form first (it has no public page).
    CatalogService? service;
    try {
      final data = await api.getData('/api/catalog/services/${asStr(offer['serviceId'])}');
      service = CatalogService.fromJson(asMap(data));
    } catch (_) {
      service = null;
    }
    if (!mounted) return;
    final requestId = await Navigator.push<String>(
      context,
      MaterialPageRoute(builder: (_) => _OfferAcceptScreen(offer: offer, service: service)),
    );
    if (requestId != null && requestId.isNotEmpty && mounted) {
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: requestId)));
    } else {
      _load();
    }
  }

  Future<void> _decline(Map<String, dynamic> offer) async {
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('رد این پیشنهاد؟'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('دفتر از تصمیم شما باخبر می‌شود. اگر دلیلش را بنویسید، پیشنهاد بهتری برایتان آماده می‌کنند.', style: TextStyle(fontSize: 13, height: 1.8)),
          const SizedBox(height: 12),
          TextField(controller: reasonController, maxLines: 2, decoration: const InputDecoration(labelText: 'دلیل رد (اختیاری)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('انصراف')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: PishkanColors.danger), onPressed: () => Navigator.pop(ctx, true), child: const Text('رد پیشنهاد')),
        ],
      ),
    );
    final reason = reasonController.text.trim();
    reasonController.dispose();
    if (confirmed != true) return;
    try {
      await api.postData('/api/catalog/offers/${asStr(offer['id'])}/decline', body: {'reason': reason});
      showSnack(context, 'تصمیم شما ثبت شد.');
      _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('پیشنهادهای اختصاصی')),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _offers.isEmpty
                  ? const EmptyView(icon: Icons.local_offer_outlined, title: 'پیشنهاد ویژه‌ای برای شما نیست', hint: 'وقتی دفتر خدمت اختصاصی‌ای برایتان تعریف کند، همین‌جا می‌بینید و می‌توانید بپذیرید یا رد کنید.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                        itemCount: _offers.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final offer = _offers[index];
                          final pending = asStr(offer['status']) == 'pending' && !asBool(offer['expired']);
                          return SoftCard(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                              Row(children: [
                                Expanded(child: Text(asStr(offer['title']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: PishkanColors.navy))),
                                StatusChip(label: _statusLabel(offer), status: pending ? 'pending' : asStr(offer['status']) == 'accepted' ? 'approved' : 'expired'),
                              ]),
                              if (asStr(offer['description']).isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Text(asStr(offer['description']), style: const TextStyle(fontSize: 12.5, color: PishkanColors.mutedText, height: 1.9)),
                              ],
                              if (asStr(offer['message']).isNotEmpty) ...[
                                const SizedBox(height: 8),
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.07), borderRadius: BorderRadius.circular(12)),
                                  child: Text('پیام دفتر: ${asStr(offer['message'])}', style: const TextStyle(fontSize: 12, height: 1.8)),
                                ),
                              ],
                              const SizedBox(height: 10),
                              Row(children: [
                                Text('مبلغ: ${faMoney(asNum(offer['amount']))}', style: const TextStyle(fontWeight: FontWeight.w800, color: PishkanColors.primary, fontSize: 13.5)),
                                const Spacer(),
                                if (asStr(offer['expiresAt']).isNotEmpty) Text('اعتبار تا ${faDate(offer['expiresAt'])}', style: const TextStyle(fontSize: 11, color: PishkanColors.warning)),
                              ]),
                              if (pending) ...[
                                const SizedBox(height: 12),
                                Row(children: [
                                  Expanded(child: PlushButton(label: 'پذیرش و شروع', icon: Icons.play_circle_rounded, onPressed: () => _accept(offer))),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: () => _decline(offer),
                                      style: OutlinedButton.styleFrom(foregroundColor: PishkanColors.danger, side: const BorderSide(color: Color(0xFFFECACA))),
                                      icon: const Icon(Icons.close_rounded),
                                      label: const Text('رد پیشنهاد'),
                                    ),
                                  ),
                                ]),
                              ],
                            ]),
                          );
                        },
                      ),
                    ),
    );
  }
}

class _OfferAcceptScreen extends StatefulWidget {
  const _OfferAcceptScreen({required this.offer, required this.service});

  final Map<String, dynamic> offer;
  final CatalogService? service;

  @override
  State<_OfferAcceptScreen> createState() => _OfferAcceptScreenState();
}

class _OfferAcceptScreenState extends State<_OfferAcceptScreen> {
  final _formKey = GlobalKey<DynamicFormState>();
  final Map<String, dynamic> _values = {};
  String _paymentMethod = 'online';
  bool _busy = false;

  Future<void> _submit() async {
    final error = _formKey.currentState?.validate();
    if (error != null) {
      showSnack(context, error, error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      final data = await api.postData('/api/catalog/offers/${asStr(widget.offer['id'])}/accept', body: {
        'formData': _values,
        'paymentMethod': _paymentMethod,
      });
      final map = asMap(data);
      final requestId = asStr(map['requestId']).isEmpty ? asStr(asMap(map['request'])['id']) : asStr(map['requestId']);
      if (mounted) Navigator.pop(context, requestId);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fields = widget.service?.formFields ?? const <FormFieldDef>[];
    return Scaffold(
      appBar: AppBar(title: Text('شروع «${asStr(widget.offer['title'])}»', overflow: TextOverflow.ellipsis)),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 10, 16, 24), children: [
        if (fields.isNotEmpty) ...[
          const SectionTitle(title: 'اطلاعات لازم برای شروع'),
          SoftCard(child: DynamicForm(key: _formKey, fields: fields, values: _values)),
        ] else
          const SoftCard(child: Text('این خدمت فرم اضافه‌ای ندارد؛ با پذیرش، پرونده ساخته می‌شود و کارشناس اگر مدرکی لازم باشد داخل پرونده از شما می‌خواهد.', style: TextStyle(fontSize: 12.5, height: 1.9))),
        const SectionTitle(title: 'روش پرداخت'),
        SoftCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              ChoiceChip(label: const Text('پرداخت آنلاین'), selected: _paymentMethod == 'online', onSelected: (_) => setState(() => _paymentMethod = 'online')),
              const SizedBox(width: 8),
              ChoiceChip(label: const Text('کیف پول'), selected: _paymentMethod == 'wallet', onSelected: (_) => setState(() => _paymentMethod = 'wallet')),
            ]),
            const Divider(height: 24),
            Row(children: [
              const Text('مبلغ پیشنهاد', style: TextStyle(fontWeight: FontWeight.w800)),
              const Spacer(),
              Text(faMoney(asNum(widget.offer['amount'])), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: PishkanColors.primary)),
            ]),
          ]),
        ),
        const SizedBox(height: 18),
        PlushButton(label: 'پذیرش پیشنهاد و ساخت پرونده', icon: Icons.check_circle_rounded, loading: _busy, onPressed: _submit),
      ]),
    );
  }
}
