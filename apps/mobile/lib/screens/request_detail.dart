import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/stages.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'chat.dart';

/// The customer's case room: live status/step, timeline, documents (upload
/// replacements or reuse a verified profile document), invoices with both
/// payment paths, delivered results, chat entry and cancellation.
class RequestDetailScreen extends StatefulWidget {
  const RequestDetailScreen({super.key, required this.requestId});

  final String requestId;

  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen> with WidgetsBindingObserver {
  RequestDetail? _detail;
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
    // Coming back from the system browser after paying: refresh the case.
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    try {
      final detail = await fetchRequestDetail(widget.requestId);
      if (mounted) {
        setState(() {
          _detail = detail;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _guard(Future<void> Function() action, {String success = ''}) async {
    setState(() => _busy = true);
    try {
      await action();
      if (success.isNotEmpty && mounted) showSnack(context, success);
      await _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } catch (_) {
      if (mounted) showSnack(context, 'عملیات انجام نشد. دوباره تلاش کنید.', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _payOnline(String invoiceId) async {
    await _guard(() async {
      final url = await payInvoiceOnline(invoiceId);
      final uri = Uri.tryParse(api.absolute(url));
      if (uri == null) throw ApiException('لینک پرداخت دریافت نشد.');
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    });
  }

  Future<void> _uploadForRequirement(DocumentRequirement requirement) async {
    final file = await pickDocumentFile(context);
    if (file == null) return;
    await _guard(() async {
      final fileId = await uploadOne(file, documentQuality: shouldScreenDocumentPhoto(requirement.title, type: requirement.documentType));
      await addRequestDocument(widget.requestId, fileId: fileId, title: requirement.title, requirementKey: requirement.key);
      if (mounted) await saveMappedProfileDocument(context, fileId, requirement.title, requirement.documentType);
    }, success: 'مدرک ارسال شد.');
  }

  Future<void> _reuseForRequirement(DocumentRequirement requirement) async {
    await _guard(() async {
      final docs = await fetchMyDocuments();
      final items = (docs['items'] as List).cast<Map<String, dynamic>>();
      final matching = items.where((doc) {
        final type = asStr(doc['docType']).isEmpty ? asStr(doc['type']) : asStr(doc['docType']);
        final statusOk = asStr(doc['status']) == 'approved' && asStr(doc['validity']) != 'expired';
        return requirement.documentType.isNotEmpty && requirement.documentType != 'other' && type == requirement.documentType && statusOk;
      }).toList();
      if (!mounted) return;
      if (matching.isEmpty) {
        showSnack(context, 'در مدارک پروفایل شما مدرک سازگار تأییدشده‌ای نیست؛ فایل تازه بارگذاری کنید.', error: true);
        return;
      }
      final chosen = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        builder: (ctx) => SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Padding(padding: EdgeInsets.fromLTRB(20, 18, 20, 6), child: Align(alignment: Alignment.centerRight, child: Text('استفاده از مدارک پروفایل', style: TextStyle(fontWeight: FontWeight.w800)))),
            for (final doc in matching)
              ListTile(
                leading: const Icon(Icons.folder_shared_rounded, color: PishkanColors.primary),
                title: Text(asStr(doc['title']).isEmpty ? 'مدرک پروفایل' : asStr(doc['title'])),
                subtitle: Text(faDate(doc['createdAt'])),
                onTap: () => Navigator.pop(ctx, doc),
              ),
            const SizedBox(height: 10),
          ]),
        ),
      );
      if (chosen == null || !mounted) return;
      final confirmed = await confirmDialog(context, 'استفاده از مدرک پروفایل؟', 'مدرک تأییدشده به این پرونده پیوست می‌شود و نیاز به تأیید مجدد ندارد.', confirmLabel: 'تأیید و استفاده');
      if (!confirmed) return;
      await reuseProfileDocument(widget.requestId, customerDocumentId: asStr(chosen['id']), requirementKey: requirement.key);
      if (mounted) showSnack(context, 'مدرک پروفایل به پرونده پیوست شد.');
    });
  }

  Future<void> _openDocument(RequestDocument doc) async {
    if (doc.isImage) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => ImageViewerScreen(url: doc.displayUrl.isEmpty ? doc.originalUrl : doc.displayUrl, title: doc.title)));
      return;
    }
    await _guard(() async {
      final dir = await getTemporaryDirectory();
      final name = asStr(doc.file['name']).isEmpty ? 'file-${doc.fileId}' : asStr(doc.file['name']);
      final path = '${dir.path}/$name';
      await api.downloadTo(doc.originalUrl.isEmpty ? '/api/files/${doc.fileId}?variant=original' : doc.originalUrl, path);
      await OpenFilex.open(path);
    });
  }

  Future<void> _saveDeliveredDocument(RequestDocument doc) async {
    await _guard(() async {
      final directory = await Directory.systemTemp.createTemp('pishkan-export-');
      try {
        final rawName = asStr(doc.file['name']).split(RegExp(r'[/\\]')).last;
        final name = rawName.replaceAll(RegExp(r'[\x00-\x1f\x7f]'), '').trim();
        final safeName = name.isEmpty || name == '.' || name == '..' ? 'pishkan-file' : name;
        final temp = File('${directory.path}/download');
        await api.downloadTo('/api/files/${Uri.encodeComponent(doc.fileId)}?variant=original&download=true', temp.path);
        final bytes = await temp.readAsBytes();
        final saved = await FilePicker.platform.saveFile(dialogTitle: 'ذخیره فایل تحویلی', fileName: safeName, bytes: bytes);
        if (saved != null && mounted) showSnack(context, 'فایل در محل انتخاب‌شده ذخیره شد.');
      } finally {
        await directory.delete(recursive: true);
      }
    });
  }

  Future<void> _cancel() async {
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('لغو این درخواست؟'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('در صورت پرداخت، مبلغ طبق قوانین دفتر به کیف پول شما برگردانده می‌شود.', style: TextStyle(fontSize: 13, height: 1.8)),
          const SizedBox(height: 12),
          TextField(controller: reasonController, maxLines: 2, decoration: const InputDecoration(labelText: 'دلیل لغو (اختیاری)')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('انصراف')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: PishkanColors.danger), onPressed: () => Navigator.pop(ctx, true), child: const Text('بله، لغو شود')),
        ],
      ),
    );
    // Read the typed reason before disposing the controller: earlier this
    // always sent an empty string, so the customer's explanation was lost.
    final reason = reasonController.text.trim();
    reasonController.dispose();
    if (confirmed == true) {
      await _guard(() => cancelRequest(widget.requestId, reason), success: 'درخواست لغو شد.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    return Scaffold(
      appBar: AppBar(title: Text(detail == null ? 'پرونده' : detail.serviceTitle, overflow: TextOverflow.ellipsis)),
      body: detail == null
          ? (_error != null ? ErrorView(message: _error!, onRetry: _load) : const LoadingView())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 28), children: [
                _headerCard(detail),
                const SectionTitle(title: 'وضعیت درخواست'),
                SoftCard(
                  child: StageTimeline(
                    progress: caseProgress(status: detail.status, workBucket: detail.workBucket, currentStepTitle: detail.currentStepTitle),
                  ),
                ),
                if (detail.deliveredFiles.isNotEmpty) _deliveredSection(detail),
                _invoicesSection(detail),
                _documentsSection(detail),
                _timelineSection(detail),
                const SizedBox(height: 16),
                Row(children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatThreadOpener(requestId: detail.id, requestTitle: detail.serviceTitle))),
                      icon: const Icon(Icons.chat_bubble_outline_rounded),
                      label: const Text('گفتگو با کارشناس'),
                    ),
                  ),
                  if (detail.canCancel) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : _cancel,
                        style: OutlinedButton.styleFrom(foregroundColor: context.negative, side: BorderSide(color: context.negative.withOpacity(0.35))),
                        icon: const Icon(Icons.cancel_outlined),
                        label: const Text('لغو درخواست'),
                      ),
                    ),
                  ],
                ]),
              ]),
            ),
    );
  }

  Widget _headerCard(RequestDetail detail) {
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(detail.serviceTitle, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: context.ink))),
          StatusChip(label: detail.statusLabel, status: detail.status),
        ]),
        const SizedBox(height: 10),
        _metaRow(Icons.tag_outlined, 'کد پیگیری', faDigits(detail.trackingCode)),
        _metaRow(Icons.calendar_month_outlined, 'تاریخ ثبت', faDate(detail.createdAt, withTime: true)),
        if (detail.currentStepTitle.isNotEmpty) _metaRow(Icons.timeline_rounded, 'مرحلهٔ فعلی', detail.currentStepTitle),
        if (detail.nextStepTitle.isNotEmpty) _metaRow(Icons.next_plan_outlined, 'مرحلهٔ بعد', detail.nextStepTitle),
        if (detail.estimatedCompletionAt.isNotEmpty) _metaRow(Icons.schedule_rounded, 'زمان تقریبی تکمیل', faDate(detail.estimatedCompletionAt)),
        if (detail.completedAt.isNotEmpty) _metaRow(Icons.check_circle_outline_rounded, 'زمان تکمیل', faDate(detail.completedAt, withTime: true)),
        _metaRow(Icons.payments_outlined, 'جمع خدمت', faMoney(detail.total)),
        if (detail.rejectedReason.isNotEmpty) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: context.negative.withOpacity(context.isDark ? 0.16 : 0.09), borderRadius: BorderRadius.circular(12)),
            child: Text('علت رد: ${detail.rejectedReason}', style: const TextStyle(color: Color(0xFF991B1B), fontSize: 12, height: 1.8)),
          ),
        ],
      ]),
    );
  }

  Widget _metaRow(IconData icon, String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Icon(icon, size: 16, color: context.inkMuted),
          const SizedBox(width: 7),
          Text(label, style: TextStyle(fontSize: 12, color: context.inkMuted)),
          const Spacer(),
          Text(value, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
        ]),
      );

  Widget _deliveredSection(RequestDetail detail) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SectionTitle(title: 'نتیجه و فایل‌های تحویلی 🎉'),
      SoftCard(
        child: Column(children: [
          for (final doc in detail.deliveredFiles)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: doc.isImage
                  ? ClipRRect(borderRadius: BorderRadius.circular(10), child: SizedBox(width: 46, height: 46, child: AuthImage(url: doc.displayUrl)))
                  : const Icon(Icons.insert_drive_file_rounded, color: PishkanColors.primary, size: 30),
              title: Text(doc.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              subtitle: Text(faFileSize(doc.size)),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                IconButton(tooltip: 'مشاهده', onPressed: _busy ? null : () => _openDocument(doc), icon: const Icon(Icons.visibility_outlined)),
                IconButton(tooltip: 'ذخیره فایل', onPressed: _busy ? null : () => _saveDeliveredDocument(doc), icon: const Icon(Icons.download_rounded)),
              ]),
            ),
        ]),
      ),
    ]);
  }

  Widget _invoicesSection(RequestDetail detail) {
    if (detail.invoices.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SectionTitle(title: 'فاکتورها و پرداخت'),
      SoftCard(
        child: Column(children: [
          for (var i = 0; i < detail.invoices.length; i++) ...[
            _invoiceRow(detail.invoices[i]),
            if (i < detail.invoices.length - 1) const Divider(height: 22),
          ],
        ]),
      ),
    ]);
  }

  Widget _invoiceRow(Map<String, dynamic> invoice) {
    final total = asNum(invoice['total']);
    final paid = asNum(invoice['paidAmount']);
    final isPaid = paid >= total;
    final purpose = asStr(invoice['purpose']);
    final title = asStr(invoice['title']).isEmpty ? (purpose == 'external_cost' ? 'هزینهٔ سازمانی/سوم‌شخص' : 'هزینهٔ خدمت') : asStr(invoice['title']);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            Text('شماره فاکتور ${faDigits(asStr(invoice['number']))}', style: TextStyle(fontSize: 11, color: context.inkMuted)),
          ]),
        ),
        Text(faMoney(total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
        const SizedBox(width: 8),
        StatusChip(label: isPaid ? 'پرداخت شده' : paid > 0 ? 'پرداخت ناقص' : 'پرداخت نشده', status: isPaid ? 'paid' : 'unpaid'),
      ]),
      if (!isPaid && asStr(invoice['status']) != 'void') ...[
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: PlushButton(label: 'پرداخت آنلاین', icon: Icons.payment_rounded, loading: _busy, onPressed: () => _payOnline(asStr(invoice['id']))),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _busy ? null : () => _guard(() => payInvoiceWithWallet(asStr(invoice['id'])), success: 'فاکتور از کیف پول پرداخت شد.'),
              icon: const Icon(Icons.account_balance_wallet_rounded),
              label: const Text('از کیف پول'),
            ),
          ),
        ]),
      ],
    ]);
  }

  Widget _documentsSection(RequestDetail detail) {
    final requirements = detail.requirements;
    final byKey = <String, List<RequestDocument>>{};
    for (final doc in detail.documents) {
      byKey.putIfAbsent(doc.requirementKey, () => []).add(doc);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SectionTitle(title: 'مدارک پرونده'),
      SoftCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (requirements.isEmpty && detail.documents.isEmpty)
            Text('برای این خدمت مدرکی تعریف نشده است.', style: TextStyle(fontSize: 12.5, color: context.inkMuted)),
          for (var i = 0; i < requirements.length; i++) ...[
            _requirementBlock(requirements[i], byKey[requirements[i].key] ?? const []),
            if (i < requirements.length - 1) const Divider(height: 24),
          ],
          if ((byKey[''] ?? const []).isNotEmpty) ...[
            if (requirements.isNotEmpty) const Divider(height: 24),
            for (final doc in byKey['']!) _documentRow(doc),
          ],
        ]),
      ),
    ]);
  }

  Widget _requirementBlock(DocumentRequirement requirement, List<RequestDocument> docs) {
    final replacedIds = docs.map((d) => d.replacesDocumentId).where((id) => id.isNotEmpty).toSet();
    final active = docs.where((d) => !replacedIds.contains(d.id)).toList();
    final rejected = active.where((d) => d.status == 'rejected').toList();
    final needsUpload = active.isEmpty || rejected.isNotEmpty;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: Text(requirement.title, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5))),
        StatusChip(
          label: active.isEmpty ? (requirement.required ? 'ارسال نشده' : 'اختیاری') : rejected.isNotEmpty ? 'نیازمند اصلاح' : active.any((d) => d.status == 'pending') ? 'در انتظار بررسی' : 'تأیید شده',
          status: docs.isEmpty ? 'unpaid' : rejected.isNotEmpty ? 'rejected' : 'approved',
        ),
      ]),
      if (requirement.description.isNotEmpty) Text(requirement.description, style: TextStyle(fontSize: 11.5, color: context.inkMuted, height: 1.8)),
      for (final doc in docs) _documentRow(doc),
      if (needsUpload) ...[
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _busy ? null : () => _uploadForRequirement(requirement),
              icon: const Icon(Icons.cloud_upload_outlined),
              label: Text(rejected.isNotEmpty ? 'بارگذاری جایگزین' : 'بارگذاری مدرک'),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton.icon(
              onPressed: _busy ? null : () => _reuseForRequirement(requirement),
              icon: const Icon(Icons.folder_shared_outlined),
              label: const Text('از مدارک پروفایل'),
            ),
          ),
        ]),
      ],
    ]);
  }

  Widget _documentRow(RequestDocument doc) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: doc.isImage
          ? ClipRRect(borderRadius: BorderRadius.circular(10), child: SizedBox(width: 44, height: 44, child: AuthImage(url: doc.displayUrl)))
          : Icon(Icons.insert_drive_file_outlined, color: PishkanColors.primary, size: 28),
      title: Text(doc.title, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(switch (doc.status) {
          'approved' => 'تأییدشده',
          'rejected' => 'رد شده — مدرک جایگزین لازم است',
          _ => 'در انتظار بررسی کارشناس',
        }, style: TextStyle(fontSize: 11, color: doc.status == 'rejected' ? PishkanColors.danger : context.inkMuted)),
        if (doc.reviewNote.isNotEmpty) Text(doc.reviewNote, style: const TextStyle(fontSize: 11, color: PishkanColors.danger, height: 1.7)),
      ]),
      trailing: IconButton(icon: const Icon(Icons.visibility_outlined), onPressed: () => _openDocument(doc)),
    );
  }

  Widget _timelineSection(RequestDetail detail) {
    final events = detail.events.where((e) => asStr(e['message']).isNotEmpty).toList();
    if (events.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SectionTitle(title: 'سیر پرونده'),
      SoftCard(
        child: Column(children: [
          for (var i = 0; i < events.length; i++)
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Column(children: [
                Container(width: 11, height: 11, decoration: BoxDecoration(shape: BoxShape.circle, color: i == 0 ? PishkanColors.primary : const Color(0xFFCBD5E1))),
                if (i < events.length - 1) Container(width: 2, height: 34, color: context.hairline),
              ]),
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(asStr(events[i]['message']), style: TextStyle(fontSize: 12.5, height: 1.7)),
                    Text(faDate(events[i]['createdAt'], withTime: true), style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
                  ]),
                ),
              ),
            ]),
        ]),
      ),
    ]);
  }
}
