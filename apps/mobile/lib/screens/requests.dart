import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/stages.dart';
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
    ('action', 'در صف بررسی'),
    ('in_progress', 'در حال انجام'),
    ('waiting_customer', 'نیازمند اقدام شما'),
    ('completed', 'پایان‌یافته'),
  ];

  String _bucket = '';
  List<ServiceRequestSummary> _items = const [];
  bool _loading = true;
  String? _error;
  int _generation = 0;
  int _page = 1;
  int _total = 0;
  bool _loadingMore = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final generation = ++_generation;
    final bucket = _bucket;
    _loadingMore = false;
    // Paint the last good list instantly (works offline), then refresh.
    if (_items.isEmpty) {
      final cached = await cachedMyRequests(workBucket: bucket);
      if (mounted && generation == _generation && cached != null && cached.items.isNotEmpty) {
        setState(() {
          _items = cached.items;
          _loading = false;
        });
      }
    }
    if (!mounted || generation != _generation) return;
    if (_items.isEmpty) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final result = await fetchMyRequests(workBucket: bucket);
      if (!mounted || generation != _generation) return;
      setState(() {
        _items = result.items;
        _page = 1;
        _total = result.total;
        _loadingMore = false;
        _loading = false;
        _error = null;
      });
    } on ApiException catch (error) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _loading = false;
        // With a cached list on screen, stay silent instead of erroring out.
        if (_items.isEmpty) _error = error.message;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _loading = false;
        if (_items.isEmpty) _error = 'دریافت فهرست درخواست‌ها انجام نشد.';
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _items.length >= _total) return;
    final generation = _generation;
    final bucket = _bucket;
    setState(() => _loadingMore = true);
    try {
      final result = await fetchMyRequests(page: _page + 1, workBucket: bucket);
      if (!mounted || generation != _generation) return;
      setState(() {
        _items = [..._items, ...result.items];
        _page++;
        _total = result.total;
      });
    } on ApiException catch (error) {
      if (mounted && generation == _generation) showSnack(context, error.message, error: true);
    } finally {
      if (mounted && generation == _generation) setState(() => _loadingMore = false);
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
                    label: Text(label, style: TextStyle(color: context.ink, fontWeight: FontWeight.w600)),
                    selected: _bucket == value,
                    onSelected: (_) {
                      setState(() { _bucket = value; _items = const []; _total = 0; _loadingMore = false; });
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
                            itemCount: _items.length + (_items.length < _total ? 1 : 0),
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) => index < _items.length
                                ? _card(_items[index])
                                : Center(child: TextButton(onPressed: _loadingMore ? null : _loadMore, child: Text(_loadingMore ? 'در حال دریافت…' : 'نمایش درخواست‌های بیشتر'))),
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
          Expanded(child: Text(request.serviceTitle, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: context.ink))),
          StatusChip(label: request.statusLabel, status: request.needsAction ? 'waiting_customer' : request.status),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Icon(Icons.tag_outlined, size: 15, color: context.inkMuted),
          const SizedBox(width: 4),
          Text('کد پیگیری ${faDigits(request.trackingCode)}', style: TextStyle(fontSize: 11.5, color: context.inkMuted)),
          const SizedBox(width: 12),
          Icon(Icons.calendar_month_outlined, size: 15, color: context.inkMuted),
          const SizedBox(width: 4),
          Text(faDate(request.createdAt), style: TextStyle(fontSize: 11.5, color: context.inkMuted)),
          const Spacer(),
          Text(faMoney(request.total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: PishkanColors.primary)),
        ]),
        const SizedBox(height: 10),
        StageProgressBar(progress: caseProgress(status: request.status, workBucket: request.workBucket)),
        if (request.needsAction) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(color: context.caution.withOpacity(context.isDark ? 0.14 : 0.10), borderRadius: BorderRadius.circular(10)),
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
