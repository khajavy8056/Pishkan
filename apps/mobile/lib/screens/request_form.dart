import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/service_icons.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/dynamic_form.dart';
import '../widgets/widgets.dart';
import 'request_detail.dart';

/// Submit-a-request wizard (approved design): اطّلاعات ← مدارک ← بررسی ←
/// تأیید. The form and documents are exactly the ones the office configured
/// for this service; the payable total always comes from the server quote
/// and the request only becomes active after the server confirms it.
class RequestFormScreen extends StatefulWidget {
  const RequestFormScreen({super.key, required this.service});

  final CatalogService service;

  @override
  State<RequestFormScreen> createState() => _RequestFormScreenState();
}

class _RequestFormScreenState extends State<RequestFormScreen> {
  static const _stepLabels = ['اطّلاعات', 'مدارک', 'بررسی', 'تأیید'];

  final _formKey = GlobalKey<DynamicFormState>();
  final Map<String, dynamic> _values = {};
  final Map<String, ({String fileId, String name})> _requirementFiles = {};
  final Set<String> _uploading = {};
  final _discountCode = TextEditingController();
  final String _idempotencyKey = 'app-${DateTime.now().microsecondsSinceEpoch.toRadixString(16)}';

  int _step = 0;
  String _priority = 'normal';
  String _paymentMethod = 'online';
  Map<String, dynamic>? _quote;
  bool _quoting = false;
  int _quoteGeneration = 0;
  String? _quoteError;
  bool _submitting = false;
  bool _loadingAutofill = false;
  String _createdRequestId = '';
  String _createdTrackingCode = '';

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
    final generation = ++_quoteGeneration;
    setState(() {
      _quoting = true;
      _quote = null;
      _quoteError = null;
    });
    try {
      final quote = await fetchQuote(widget.service.id, priority: _priority, discountCode: _discountCode.text.trim());
      if (mounted && generation == _quoteGeneration) setState(() => _quote = quote);
    } on ApiException catch (error) {
      if (mounted && generation == _quoteGeneration) setState(() => _quoteError = error.message);
    } catch (_) {
      if (mounted && generation == _quoteGeneration) setState(() => _quoteError = 'استعلام مبلغ از سرور انجام نشد.');
    } finally {
      if (mounted && generation == _quoteGeneration) setState(() => _quoting = false);
    }
  }

  num get _displayTotal => _quote == null ? widget.service.computedTotal : asNum(_quote!['total']);

  Future<void> _pickRequirementFile(DocumentRequirement requirement) async {
    final file = await pickDocumentFile(context);
    if (file == null) return;
    setState(() => _uploading.add(requirement.key));
    try {
      final fileId = await uploadOne(file, documentQuality: true);
      final name = file.path.split(Platform.pathSeparator).last;
      if (mounted) {
        setState(() => _requirementFiles[requirement.key] = (fileId: fileId, name: name));
        await offerSaveProfileDocument(context, fileId, requirement.title);
      }
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _uploading.remove(requirement.key));
    }
  }

  Future<void> _fillFromProfile() async {
    setState(() => _loadingAutofill = true);
    try {
      final data = asMap(await api.getData('/api/auth/profile/autofill'));
      if (!mounted) return;
      final count = _formKey.currentState?.fillEmptyFromProfile(asMap(data['values'])) ?? 0;
      showSnack(context, count > 0 ? '$count مورد از اطلاعات پروفایل در فیلدهای خالی قرار گرفت.' : 'فیلد خالی منطبق با اطلاعات پروفایل پیدا نشد.');
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _loadingAutofill = false);
    }
  }

  void _next() {
    if (_step == 0) {
      final formError = _formKey.currentState?.validate();
      if (formError != null) {
        showSnack(context, formError, error: true);
        return;
      }
    }
    if (_step == 1) {
      for (final requirement in widget.service.requirements) {
        if (requirement.required && !_requirementFiles.containsKey(requirement.key)) {
          showSnack(context, 'مدرک «${requirement.title}» الزامی است.', error: true);
          return;
        }
      }
    }
    setState(() => _step = (_step + 1).clamp(0, 3));
  }

  Future<void> _submit() async {
    if (_quoting || _quote == null) {
      showSnack(context, 'ابتدا مبلغ را از سرور استعلام کنید.', error: true);
      return;
    }
    final formError = _formKey.currentState?.validate();
    if (formError != null) {
      setState(() => _step = 0);
      showSnack(context, formError, error: true);
      return;
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
            {
              'fileId': entry.value.fileId,
              'requirementKey': entry.key,
              'title': widget.service.requirements.firstWhere((r) => r.key == entry.key, orElse: () => DocumentRequirement.fromJson({'key': entry.key, 'title': entry.value.name})).title,
            },
        ],
        idempotencyKey: _idempotencyKey,
      );
      if (!mounted) return;
      playAppSound('success');
      setState(() {
        _createdRequestId = asStr(created['id']);
        _createdTrackingCode = asStr(created['trackingCode']);
        _step = 3;
      });
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } catch (_) {
      if (mounted) showSnack(context, 'ثبت درخواست انجام نشد. دوباره تلاش کنید.', error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _payCreatedOnline() async {
    try {
      final detail = await fetchRequestDetail(_createdRequestId);
      final unpaid = detail.unpaidInvoices;
      if (unpaid.isEmpty) {
        if (mounted) showSnack(context, 'فاکتور پرداخت‌نشده‌ای برای این پرونده نیست.');
        return;
      }
      final url = await payInvoiceOnline(asStr(unpaid.first['id']));
      final uri = Uri.tryParse(api.absolute(url));
      if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.service.title, overflow: TextOverflow.ellipsis)),
      body: Column(children: [
        _stepper(),
        Expanded(
          child: ListView(padding: const EdgeInsets.fromLTRB(16, 6, 16, 18), children: [
            switch (_step) {
              0 => _infoStep(),
              1 => _documentsStep(),
              2 => _reviewStep(),
              _ => _doneStep(),
            },
          ]),
        ),
        _actionBar(),
      ]),
    );
  }

  Widget _stepper() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 14, 22, 6),
      child: Row(children: [
        for (var i = 0; i < 4; i++) ...[
          Column(mainAxisSize: MainAxisSize.min, children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < _step ? PishkanColors.success : i == _step ? PishkanColors.primary : Colors.white,
                border: Border.all(color: i <= _step ? Colors.transparent : const Color(0xFFCBD5E1), width: 1.6),
                boxShadow: i == _step ? [BoxShadow(color: PishkanColors.primary.withOpacity(0.35), blurRadius: 9, offset: const Offset(0, 3))] : null,
              ),
              child: i < _step
                  ? const Icon(Icons.check_rounded, color: Colors.white, size: 18)
                  : Text(faDigits('${i + 1}'), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: i == _step ? Colors.white : PishkanColors.mutedText)),
            ),
            const SizedBox(height: 4),
            Text(_stepLabels[i], style: TextStyle(fontSize: 10.5, fontWeight: i == _step ? FontWeight.w800 : FontWeight.w500, color: i == _step ? PishkanColors.primary : PishkanColors.mutedText)),
          ]),
          if (i < 3)
            Expanded(
              child: Container(
                height: 2.5,
                margin: const EdgeInsets.only(bottom: 18, left: 6, right: 6),
                decoration: BoxDecoration(color: i < _step ? PishkanColors.success : const Color(0xFFE2E8F0), borderRadius: BorderRadius.circular(99)),
              ),
            ),
        ],
      ]),
    );
  }

  Widget _serviceChip() {
    final service = widget.service;
    return SoftCard(
      child: Row(children: [
        IconMedallion(artwork: artworkForService(service), size: 48),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(service.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: PishkanColors.navy)),
            if (service.durationText.isNotEmpty) Text(faDigits(service.durationText), style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
          ]),
        ),
        Text(faMoney(_displayTotal), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: PishkanColors.primary)),
      ]),
    );
  }

  Widget _infoStep() {
    final service = widget.service;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _serviceChip(),
      const SectionTitle(title: 'اطّلاعات درخواست'),
      if (service.formFields.isNotEmpty) Align(alignment: Alignment.centerRight, child: TextButton.icon(onPressed: _loadingAutofill ? null : _fillFromProfile, icon: const Icon(Icons.person_outline_rounded), label: Text(_loadingAutofill ? 'در حال دریافت…' : 'استفاده از اطلاعات پروفایل خودم'))),
      if (service.formFields.isEmpty)
        const SoftCard(child: Text('این خدمت فرم اطلاعاتی ندارد؛ مستقیم به مرحلهٔ مدارک بروید.', style: TextStyle(color: PishkanColors.mutedText, fontSize: 13, height: 1.9)))
      else
        SoftCard(child: DynamicForm(key: _formKey, fields: service.formFields, values: _values)),
    ]);
  }

  Widget _documentsStep() {
    final service = widget.service;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SectionTitle(title: 'بارگذاری مدارک'),
      if (service.requirements.isEmpty)
        const SoftCard(child: Text('این خدمت مدرک از پیش‌تعریف‌شده‌ای ندارد. اگر بعداً مدرکی لازم شد، کارشناس در پرونده اطلاع می‌دهد و از همین اپ ارسالش می‌کنید.', style: TextStyle(color: PishkanColors.mutedText, fontSize: 13, height: 1.9)))
      else
        SoftCard(
          child: Column(children: [
            for (var i = 0; i < service.requirements.length; i++) ...[
              _requirementRow(service.requirements[i]),
              if (i < service.requirements.length - 1) const Divider(height: 22),
            ],
          ]),
        ),
      const SizedBox(height: 10),
      const Text('عکس واضح و خوانا از اصل مدرک بفرستید؛ کیفیت پایین، بررسی را عقب می‌اندازد.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11.5, color: PishkanColors.mutedText)),
    ]);
  }

  Widget _requirementRow(DocumentRequirement requirement) {
    final uploaded = _requirementFiles[requirement.key];
    final busy = _uploading.contains(requirement.key);
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        padding: const EdgeInsets.all(9),
        decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.12), shape: BoxShape.circle),
        child: Icon(uploaded != null ? Icons.hourglass_top_rounded : Icons.cloud_upload_outlined, color: PishkanColors.primary, size: 21),
      ),
      const SizedBox(width: 10),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${requirement.title}${requirement.required ? ' *' : ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
          if (requirement.description.isNotEmpty) Text(requirement.description, style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.8)),
          if (uploaded != null) Text('${uploaded.name} — در انتظار بررسی کارشناس', style: const TextStyle(fontSize: 11, color: PishkanColors.primary), overflow: TextOverflow.ellipsis),
        ]),
      ),
      busy
          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
          : TextButton(onPressed: () => _pickRequirementFile(requirement), child: Text(uploaded == null ? 'بارگذاری' : 'جایگزین')),
    ]);
  }

  String _readableValue(FormFieldDef field) {
    final value = _values[field.key];
    if (value == null || value == '') return '—';
    if (value is bool) return value ? 'بله' : 'خیر';
    if (value is List) return value.join('، ');
    return faDigits(value.toString());
  }

  Widget _reviewStep() {
    final service = widget.service;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _serviceChip(),
      const SectionTitle(title: 'بررسی اطلاعات'),
      SoftCard(
        child: Column(children: [
          if (service.formFields.isEmpty)
            const Align(alignment: Alignment.centerRight, child: Text('اطلاعات فرمی برای این خدمت ثبت نشده است.', style: TextStyle(color: PishkanColors.mutedText, fontSize: 12.5)))
          else
            for (var i = 0; i < service.formFields.length; i++) ...[
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(service.formFields[i].label, style: const TextStyle(fontSize: 12, color: PishkanColors.mutedText)),
                const SizedBox(width: 12),
                Expanded(child: Text(_readableValue(service.formFields[i]), textAlign: TextAlign.end, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: PishkanColors.navy))),
              ]),
              if (i < service.formFields.length - 1) const Divider(height: 18),
            ],
          if (_requirementFiles.isNotEmpty) ...[
            const Divider(height: 22),
            for (final entry in _requirementFiles.entries)
              Row(children: [
                const Icon(Icons.attach_file_rounded, size: 16, color: PishkanColors.success),
                const SizedBox(width: 6),
                Expanded(child: Text(entry.value.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12))),
              ]),
          ],
        ]),
      ),
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
            onChanged: (_) {
              _quoteGeneration++;
              setState(() { _quote = null; _quoting = false; _quoteError = null; });
            },
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
          if (_quoteError != null) ...[
            const SizedBox(height: 8),
            Text(_quoteError!, style: const TextStyle(color: PishkanColors.danger, fontSize: 12)),
          ],
          if (_quote == null && !_quoting)
            TextButton(onPressed: _refreshQuote, child: const Text('استعلام مبلغ از سرور')),
          const Divider(height: 26),
          Row(children: [
            Text(_quote == null ? 'مبلغ تخمینی' : 'مبلغ قابل پرداخت', style: TextStyle(fontWeight: FontWeight.w800)),
            const Spacer(),
            if (_quoting) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 6),
            Text(faMoney(_displayTotal), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: PishkanColors.primary)),
          ]),
        ]),
      ),
    ]);
  }

  Widget _doneStep() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 18),
      Center(
        child: Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(color: PishkanColors.success.withOpacity(0.12), shape: BoxShape.circle),
          child: const Icon(Icons.check_rounded, size: 56, color: PishkanColors.success),
        ),
      ),
      const SizedBox(height: 16),
      const Center(child: Text('درخواست شما با موفقیت ثبت شد 🎉', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16.5, color: PishkanColors.navy))),
      const SizedBox(height: 8),
      if (_createdTrackingCode.isNotEmpty)
        Center(child: Text('کد پیگیری: ${faDigits(_createdTrackingCode)}', style: const TextStyle(fontSize: 13, color: PishkanColors.mutedText))),
      const SizedBox(height: 10),
      const Text(
        'پروندهٔ شما ساخته شد. از این لحظه، هر مرحله‌ای که پرونده جلو برود با اعلان همین اپ خبردار می‌شوید و در بخش «پیگیری‌ها» می‌توانید سیر آن را ببینید.',
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 12.5, color: PishkanColors.mutedText, height: 2),
      ),
      const SizedBox(height: 20),
      if (_paymentMethod == 'online' && _createdRequestId.isNotEmpty) ...[
        PlushButton(label: 'پرداخت آنلاین هزینهٔ خدمت', icon: Icons.payment_rounded, onPressed: _payCreatedOnline),
        const SizedBox(height: 10),
        const Text('رسیدگی کارشناس بعد از پرداخت شروع می‌شود؛ اگر همین حالا پرداخت نکنید، بعداً از داخل پرونده هم می‌توانید پرداخت کنید.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.9)),
        const SizedBox(height: 12),
      ],
      if (_createdRequestId.isNotEmpty)
        OutlinedButton.icon(
          onPressed: () => Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: _createdRequestId))),
          icon: const Icon(Icons.fact_check_outlined),
          label: const Text('مشاهدهٔ پرونده'),
        ),
    ]);
  }

  Widget _actionBar() {
    if (_step == 3) {
      return Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(24)), boxShadow: [BoxShadow(color: Color(0x140B1F3A), blurRadius: 18, offset: Offset(0, -5))]),
        child: SafeArea(
          top: false,
          child: PlushButton(label: 'بازگشت به خانه', icon: Icons.home_rounded, onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst)),
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(24)), boxShadow: [BoxShadow(color: Color(0x140B1F3A), blurRadius: 18, offset: Offset(0, -5))]),
      child: SafeArea(
        top: false,
        child: Row(children: [
          if (_step > 0) ...[
            Expanded(
              flex: 3,
              child: OutlinedButton(onPressed: _submitting ? null : () => setState(() => _step = _step - 1), child: const Text('مرحلهٔ قبل')),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            flex: 5,
            child: PlushButton(
              label: _step == 2 ? 'ثبت نهایی درخواست' : 'مرحلهٔ بعد',
              arrow: _step < 2,
              icon: _step == 2 ? Icons.check_circle_rounded : null,
              loading: _submitting,
              onPressed: _step == 2 ? _submit : _next,
            ),
          ),
        ]),
      ),
    );
  }
}
