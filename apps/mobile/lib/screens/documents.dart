import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';

/// Verified profile-document vault: keep identity documents once, reuse
/// them across future requests without re-uploading (same as the web).
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  List<Map<String, dynamic>> _items = const [];
  List<Map<String, dynamic>> _types = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await fetchMyDocuments();
      if (mounted) {
        setState(() {
          _items = (data['items'] as List).cast<Map<String, dynamic>>();
          _types = (data['types'] as List).cast<Map<String, dynamic>>();
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

  String _typeLabel(String code) {
    for (final type in _types) {
      if (asStr(type['code']) == code) return asStr(type['label']).isEmpty ? code : asStr(type['label']);
    }
    return code;
  }

  String _statusLabel(String status) => switch (status) {
        'approved' || 'verified' => 'تأییدشده',
        'rejected' => 'ردشده',
        _ => 'در انتظار تأیید',
      };

  Future<void> _open(Map<String, dynamic> doc) async {
    final file = asMap(doc['file']);
    final fileId = asStr(doc['fileId']).isEmpty ? asStr(file['id']) : asStr(doc['fileId']);
    final mime = asStr(file['mime']);
    if (fileId.isEmpty) return;
    if (mime.startsWith('image/')) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => ImageViewerScreen(url: '/api/files/$fileId', title: asStr(doc['title']))));
      return;
    }
    try {
      final dir = await getTemporaryDirectory();
      final name = asStr(file['name']).isEmpty ? 'document-$fileId' : asStr(file['name']);
      final path = '${dir.path}/$name';
      await api.downloadTo('/api/files/$fileId?variant=original', path);
      await OpenFilex.open(path);
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  Future<void> _add() async {
    final file = await pickDocumentFile(context);
    if (file == null) return;
    if (!mounted) return;
    final type = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 18, 20, 6), child: Align(alignment: Alignment.centerRight, child: Text('این مدرک چیست؟', style: TextStyle(fontWeight: FontWeight.w800)))),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final t in _types)
                  ListTile(leading: const Icon(Icons.badge_outlined), title: Text(asStr(t['label'])), onTap: () => Navigator.pop(ctx, asStr(t['code']))),
                if (_types.isEmpty) ListTile(leading: const Icon(Icons.badge_outlined), title: const Text('مدرک هویتی'), onTap: () => Navigator.pop(ctx, 'national_card')),
              ],
            ),
          ),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (type == null) return;
    try {
      final fileId = await uploadOne(file, documentQuality: true);
      await api.postData('/api/documents/mine', body: {'fileId': fileId, 'docType': type});
      if (mounted) showSnack(context, 'مدرک به پروفایل افزوده شد.');
      _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  Future<void> _delete(Map<String, dynamic> doc) async {
    final confirmed = await confirmDialog(context, 'حذف این مدرک؟', 'اگر این مدرک در پرونده‌ای استفاده شده باشد، نسخهٔ پرونده دست‌نخورده می‌ماند و فقط از پروفایل حذف می‌شود.', confirmLabel: 'حذف', danger: true);
    if (!confirmed) return;
    try {
      await api.deleteData('/api/documents/mine/${asStr(doc['id'])}');
      _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('مدارک پروفایل من')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.add_rounded), label: const Text('افزودن مدرک')),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : Column(children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
                    child: Container(
                      padding: const EdgeInsets.all(13),
                      decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.07), borderRadius: BorderRadius.circular(16)),
                      child: const Text('مدرک‌های تأییدشده را یک‌بار اینجا نگه دارید؛ در درخواست‌های بعدی بدون بارگذاری دوباره با یک لمس پیوست پرونده می‌شوند.', style: TextStyle(fontSize: 12, height: 1.9, color: PishkanColors.navy)),
                    ),
                  ),
                  Expanded(
                    child: _items.isEmpty
                        ? const EmptyView(icon: Icons.folder_shared_outlined, title: 'مدرکی در پروفایل ندارید', hint: 'کارت ملی، شناسنامه یا سندهایتان را همین‌جا امن نگه دارید.')
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 8, 16, 90),
                              itemCount: _items.length,
                              separatorBuilder: (_, _) => const SizedBox(height: 10),
                              itemBuilder: (context, index) {
                                final doc = _items[index];
                                final file = asMap(doc['file']);
                                final mime = asStr(file['mime']);
                                final fileId = asStr(doc['fileId']).isEmpty ? asStr(file['id']) : asStr(doc['fileId']);
                                final status = asStr(doc['status']);
                                return SoftCard(
                                  child: Row(children: [
                                    if (mime.startsWith('image/') && fileId.isNotEmpty)
                                      ClipRRect(borderRadius: BorderRadius.circular(12), child: SizedBox(width: 50, height: 50, child: AuthImage(url: '/api/files/$fileId?v=thumb')))
                                    else
                                      Container(width: 50, height: 50, decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.1), borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.description_rounded, color: PishkanColors.primary)),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                        Text(asStr(doc['title']).isEmpty ? _typeLabel(asStr(doc['docType']).isEmpty ? asStr(doc['type']) : asStr(doc['docType'])) : asStr(doc['title']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                                        Text('${_typeLabel(asStr(doc['docType']).isEmpty ? asStr(doc['type']) : asStr(doc['docType']))} · ${faDate(doc['createdAt'])}', style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
                                        if (asStr(doc['reviewNote']).isNotEmpty) Text(asStr(doc['reviewNote']), style: const TextStyle(fontSize: 11, color: PishkanColors.danger)),
                                      ]),
                                    ),
                                    StatusChip(label: _statusLabel(status), status: status),
                                    IconButton(icon: const Icon(Icons.visibility_outlined), onPressed: () => _open(doc)),
                                    IconButton(icon: const Icon(Icons.delete_outline_rounded, color: PishkanColors.danger), onPressed: () => _delete(doc)),
                                  ]),
                                );
                              },
                            ),
                          ),
                  ),
                ]),
    );
  }
}
