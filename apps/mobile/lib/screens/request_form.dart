import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/dynamic_form.dart';
import '../widgets/widgets.dart';
import 'request_detail.dart';

/// Submit-a-request flow: backend-defined form + required documents +
/// urgency + discount code + payment method. The payable total always comes
/// from the server quote; the request becomes active after the server
/// confirms (and, for online payment, after the gateway round-trip).
class RequestFormScreen extends StatefulWidget {
  const RequestFormScreen({super.key, required this.service});

  final CatalogService service;

  @override
  State<RequestFormScreen> createState() => _RequestFormScreenState();
}

class _RequestFormScreenState extends State<RequestFormScreen> {
  final _formKey = GlobalKey<DynamicFormState>();
  final Map<String, dynamic> _values = {};
  final Map<String, ({String fileId, String name})> _requirementFiles = {};
  final Set<String> _uploading = {};
  final _discountCode = TextEditingController();
  final String _idempotencyKey = 'app-${DateTime.now().microsecondsSinceEpoch.toRadixString(16)}';

  String _priority = 'normal';
  String _paymentMethod = 'online';
  Map<String, dynamic>? _quote;
  bool _quoting = false;
  bool _submitting = false;

  List<String> get _allowedMethods {
    final raw = widget.service.raw['paymentMethods'];
    final list = raw is List ? raw.map((e) => e.toString()).where((e) => e == 'online' || e == 'wallet').toList() : <String>[];
    return list.isEmpty ? const ['online', 'wallet'] : list;
  }

  @override
  void initState() {
    super.initState();
    _paymentMethod = _allowedMethods.first;
    _refreshQuote();
  }

  @override
  void dispose() {
    _discountCode.dispose();
    super.dispose();
  }

  Future<void> _refreshQuote() async {
    setState(() => _quoting = true);
    try {
      final quote = await fetchQuote(widget.service.id, priority: _priority, discountCode: _discountCode.text.trim());
      if (mounted) setState(() => _quote = quote);
    } on ApiException catch (error) {
      if (mounted && _discountCode.text.trim().isNotEmpty) showSnack(context, error.message, error: true);
    } catch (_) {
      // Fall back to the local estimate; the server re-validates on submit.
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  num get _displayTotal => _quote == null ? widget.service.computedTotal : asNum(_quote!['total']);

  Future<void> _pickRequirementFile(DocumentRequirement requirement) async {
    final file = await pickDocumentFile(context);
    if (file == null) return;
    setState(() => _uploading.add(requirement.key));
    try {
      final fileId = await uploadOne(file);
      final name = file.path.split(Platform.pathSeparator).last;
      if (mounted) setState(() => _requirementFiles[requirement.key] = (fileId: fileId, name: name));
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _uploading.remove(requirement.key));
    }
  }

  Future<void> _submit() async {
    final formError = _formKey.currentState?.validate();
    if (formError != null) {
      showSnack(context, formError, error: true);
      return;
    }
    for (final requirement in widget.service.requirements) {
      if (requirement.required && !_requirementFiles.containsKey(requirement.key)) {
        showSnack(context, 'مدرک «${requirement.title}» الزامی است.', error: true);
        return;
      }
    }
    setState(() => _submitting = true);
    try {
      final created = await createRequest(
        serviceId: widget.service.id,
        formData: _values,
        paymentMethod: _paymentMethod,
        priority: _priority,
        discountCode: _discountCode.text.trim(),
        documentIds: [
          for (final entry in _requirementFiles.entries)
            {'fileId': entry.value.fileId, 'requirementKey': entry.key, 'title': widget.service.requirements.firstWhere((r) => r.key == entry.key, orElse: () => DocumentRequirement.fromJson({'key': entry.key, 'title': entry.value.name})).title},
        ],
        idempotencyKey: _idempotencyKey,
      );
      final requestId = asStr(created['id']);
      if (!mounted) return;
      if (_paymentMethod == 'online') {
        await _offerOnlinePayment(requestId);
      } else {
        showSnack(context, 'درخواست شما ثبت و از کیف پول پرداخت شد.');
        _openDetail(requestId);
      }
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } catch (_) {
      if (mounted) showSnack(context, 'ثبت درخواست انجام نشد. دوباره تلاش کنید.', error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _openDetail(String requestId) {
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: requestId)));
  }

  Future<void> _offerOnlinePayment(String requestId) async {
    final pay = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('درخواست شما ثبت شد 🎉'),
        content: const Text('برای شروع رسیدگی، هزینهٔ خدمت را از درگاه پرداخت کنید. اگر همین حالا پرداخت نکنید، بعداً از داخل پرونده هم می‌توانید پرداخت کنید.', style: TextStyle(height: 1.9, fontSize: 13.5)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('بعداً پرداخت می‌کنم')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('پرداخت همین حالا')),
        ],
      ),
    );
    if (pay == true) {
      try {
        final detail = await fetchRequestDetail(requestId);
        final unpaid = detail.unpaidInvoices;
        if (unpaid.isNotEmpty) {
          final url = await payInvoiceOnline(asStr(unpaid.first['id']));
          final uri = Uri.tryParse(api.absolute(url));
          if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      } on ApiException catch (error) {
        if (mounted) showSnack(context, error.message, error: true);
      }
    }
    if (mounted) _openDetail(requestId);
  }

  @override
  Widget build(BuildContext context) {
    final service = widget.service;
    return Scaffold(
      appBar: AppBar(title: Text('ثبت درخواست — ${service.title}', overflow: TextOverflow.ellipsis)),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
        if (service.formFields.isNotEmpty) ...[
          const SectionTitle(title: 'اطلاعات درخواست'),
          SoftCard(child: DynamicForm(key: _formKey, fields: service.formFields, values: _values)),
        ],
        if (service.requirements.isNotEmpty) ...[
          const SectionTitle(title: 'بارگذاری مدارک'),
          SoftCard(
            child: Column(children: [
              for (var i = 0; i < service.requirements.length; i++) ...[
                _requirementRow(service.requirements[i]),
                if (i < service.requirements.length - 1) const Divider(height: 22),
              ],
            ]),
          ),
        ],
        const SectionTitle(title: 'پرداخت و سرعت انجام'),
        SoftCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (service.urgentAvailable) ...[
              const Text('سرعت انجام', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'normal', label: Text('عادی')),
                  ButtonSegment(value: 'high', label: Text('فوری ⚡')),
                ],
                selected: {_priority},
                onSelectionChanged: (next) {
                  setState(() => _priority = next.first);
                  _refreshQuote();
                },
              ),
              const SizedBox(height: 14),
            ],
            TextField(
              controller: _discountCode,
              decoration: InputDecoration(
                labelText: 'کد تخفیف (اختیاری)',
                prefixIcon: const Icon(Icons.local_offer_outlined),
                suffixIcon: TextButton(onPressed: _quoting ? null : _refreshQuote, child: const Text('اعمال')),
              ),
            ),
            const SizedBox(height: 14),
            const Text('روش پرداخت', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              if (_allowedMethods.contains('online'))
                ChoiceChip(
                  label: const Text('پرداخت آنلاین (درگاه)'),
                  selected: _paymentMethod == 'online',
                  onSelected: (_) => setState(() => _paymentMethod = 'online'),
                ),
              if (_allowedMethods.contains('wallet'))
                ChoiceChip(
                  label: const Text('کیف پول'),
                  selected: _paymentMethod == 'wallet',
                  onSelected: (_) => setState(() => _paymentMethod = 'wallet'),
                ),
            ]),
            const Divider(height: 26),
            Row(children: [
              const Text('مبلغ قابل پرداخت', style: TextStyle(fontWeight: FontWeight.w800)),
              const Spacer(),
              if (_quoting) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
              const SizedBox(width: 6),
              Text(faMoney(_displayTotal), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: PishkanColors.primary)),
            ]),
          ]),
        ),
        const SizedBox(height: 18),
        PlushButton(label: 'ثبت نهایی درخواست', icon: Icons.check_circle_rounded, loading: _submitting, onPressed: _submit),
        const SizedBox(height: 10),
        const Text(
          'با ثبت درخواست، پروندهٔ شما ساخته می‌شود و از بخش «درخواست‌های من» می‌توانید مرحله‌به‌مرحله پیگیرش باشید.',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.9),
        ),
      ]),
    );
  }

  Widget _requirementRow(DocumentRequirement requirement) {
    final uploaded = _requirementFiles[requirement.key];
    final busy = _uploading.contains(requirement.key);
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(uploaded != null ? Icons.check_circle_rounded : Icons.cloud_upload_outlined, color: uploaded != null ? PishkanColors.success : PishkanColors.primary),
      const SizedBox(width: 10),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${requirement.title}${requirement.required ? ' *' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          if (requirement.description.isNotEmpty) Text(requirement.description, style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.8)),
          if (uploaded != null) Text(uploaded.name, style: const TextStyle(fontSize: 11, color: PishkanColors.success), overflow: TextOverflow.ellipsis),
        ]),
      ),
      busy
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
          : TextButton(onPressed: () => _pickRequirementFile(requirement), child: Text(uploaded == null ? 'بارگذاری' : 'جایگزین')),
    ]);
  }
}
