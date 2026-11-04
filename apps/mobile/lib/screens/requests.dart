import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'request_detail.dart';

/// My requests with the same status buckets the web panel uses.
class RequestsTab extends StatefulWidget {
  const RequestsTab({super.key});

  @override
  State<RequestsTab> createState() => _RequestsTabState();
}

class _RequestsTabState extends State<RequestsTab> {
  static const _filters = <(String, String)>[
    ('', 'همه'),
    ('queue', 'در صف بررسی'),
    ('active', 'در حال انجام'),
    ('waiting_customer', 'نیازمند اقدام شما'),
    ('completed', 'پایان‌یافته'),
  ];

  String _bucket = '';
  List<ServiceRequestSummary> _items = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await fetchMyRequests(workBucket: _bucket);
      if (!mounted) return;
      setState(() {
        _items = result.items;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'دریافت فهرست درخواست‌ها انجام نشد.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('درخواست‌های من')),
      body: Column(children: [
        SizedBox(
          height: 46,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
            children: [
              for (final (value, label) in _filters)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 8),
                  child: ChoiceChip(
                    label: Text(label),
                    selected: _bucket == value,
                    onSelected: (_) {
                      setState(() => _bucket = value);
                      _load();
                    },
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: _loading
              ? const LoadingView()
              : _error != null
                  ? ErrorView(message: _error!, onRetry: _load)
                  : _items.isEmpty
                      ? const EmptyView(icon: Icons.folder_open_rounded, title: 'درخواستی اینجا نیست', hint: 'وقتی خدمتی را ثبت کنید، پرونده‌اش را همین‌جا می‌بینید و مرحله‌به‌مرحله پیگیرش می‌شوید.')
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
                            itemCount: _items.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) => _card(_items[index]),
                          ),
                        ),
        ),
      ]),
    );
  }

  Widget _card(ServiceRequestSummary request) {
    return SoftCard(
      onTap: () async {
        await Navigator.push(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: request.id)));
        _load();
      },
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(request.serviceTitle, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: PishkanColors.navy))),
          StatusChip(label: request.statusLabel, status: request.needsAction ? 'waiting_customer' : request.status),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          const Icon(Icons.tag_outlined, size: 15, color: PishkanColors.mutedText),
          const SizedBox(width: 4),
          Text('کد پیگیری ${faDigits(request.trackingCode)}', style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText)),
          const SizedBox(width: 12),
          const Icon(Icons.calendar_month_outlined, size: 15, color: PishkanColors.mutedText),
          const SizedBox(width: 4),
          Text(faDate(request.createdAt), style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText)),
          const Spacer(),
          Text(faMoney(request.total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: PishkanColors.primary)),
        ]),
        if (request.needsAction) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(color: const Color(0xFFFFF7E6), borderRadius: BorderRadius.circular(10)),
            child: Row(children: [
              const Icon(Icons.priority_high_rounded, size: 16, color: PishkanColors.warning),
              const SizedBox(width: 6),
              const Expanded(child: Text('این پرونده منتظر اقدام شماست؛ وارد شوید و مورد خواسته‌شده را کامل کنید.', style: TextStyle(fontSize: 11, color: Color(0xFF92400E)))),
            ]),
          ),
        ],
        if (request.priority == 'high') ...[
          const SizedBox(height: 8),
          const Row(children: [
            Icon(Icons.bolt_rounded, size: 15, color: PishkanColors.warning),
            SizedBox(width: 4),
            Text('انجام فوری', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: PishkanColors.warning)),
          ]),
        ],
      ]),
    );
  }
}
