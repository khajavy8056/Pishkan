import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/stages.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'chat.dart';
import 'request_detail.dart';
import 'stories_archive.dart';
import 'wallet.dart';

enum _NotifFilter { all, requests, messages, stories }

/// In-app notification centre (the same feed as the web bell), styled after
/// the approved design: category chips, colorful round icons, unread dots,
/// and — for case notifications — the very stage/progress bar the customer
/// also sees in system notifications.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _items = const [];
  Map<String, ServiceRequestSummary> _requestsById = {};
  _NotifFilter _filter = _NotifFilter.all;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // Paint the last good feed instantly (works offline), then refresh.
    if (_items.isEmpty) {
      final cached = await cachedNotifications();
      if (mounted && cached != null) {
        final list = asMapList(cached['items']);
        if (list.isNotEmpty) {
          setState(() {
            _items = list;
            _loading = false;
          });
        }
      }
    }
    try {
      final data = await fetchNotifications(limit: 80);
      final list = asMapList(data['items']);
      if (list.any((n) => asStr(n['link']).contains('requests/'))) {
        try {
          final mine = await fetchMyRequests();
          _requestsById = {for (final r in mine.items) r.id: r};
        } catch (_) {}
      }
      if (mounted) {
        setState(() {
          _items = list;
          _loading = false;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          // Keep the cached feed on screen instead of an error page.
          if (_items.isEmpty) _error = error.message;
        });
      }
    }
  }

  static String? _requestIdOf(Map<String, dynamic> item) {
    final match = RegExp(r'requests/([A-Za-z0-9_-]+)').firstMatch(asStr(item['link']));
    return match?.group(1);
  }

  static bool _isStory(Map<String, dynamic> item) => asStr(item['link']) == '/app/stories';

  static bool _isMessage(Map<String, dynamic> item) {
    final link = asStr(item['link']);
    return link.contains('messages') || link.contains('support');
  }

  List<Map<String, dynamic>> get _visible {
    return switch (_filter) {
      _NotifFilter.all => _items,
      _NotifFilter.requests => _items.where((n) => _requestIdOf(n) != null).toList(),
      _NotifFilter.messages => _items.where(_isMessage).toList(),
      _NotifFilter.stories => _items.where(_isStory).toList(),
    };
  }

  Future<void> _open(Map<String, dynamic> item) async {
    final id = asStr(item['id']);
    if (asStr(item['readAt']).isEmpty && id.isNotEmpty) {
      try {
        await markNotificationRead(id);
      } catch (_) {}
      if (mounted) {
        setState(() {
          _items = _items.map((n) => asStr(n['id']) == id ? {...n, 'readAt': 'now'} : n).toList();
        });
      }
    }
    if (!mounted) return;
    final link = asStr(item['link']);
    final requestId = _requestIdOf(item);
    if (requestId != null) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: requestId)));
    } else if (_isStory(item)) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => const StoriesArchiveScreen()));
    } else if (link.contains('wallet')) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => const WalletScreen()));
    } else {
      final chatMatch = RegExp(r'messages/([A-Za-z0-9_-]+)').firstMatch(link);
      if (chatMatch != null) {
        Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(threadId: chatMatch.group(1)!, title: 'گفت‌وگو با دفتر')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _items.any((n) => asStr(n['readAt']).isEmpty);
    return Scaffold(
      appBar: AppBar(
        title: const Text('اعلان‌ها'),
        actions: [
          if (hasUnread)
            TextButton(
              onPressed: () async {
                await markAllNotificationsRead();
                _load();
              },
              child: const Text('خواندن همه'),
            ),
        ],
      ),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _items.isEmpty
                  ? const EmptyView(icon: Icons.notifications_none_rounded, title: 'اعلانی ندارید', hint: 'تغییر وضعیت پرونده‌ها، پاسخ کارشناس، استوری تازه و رسید پرداخت‌ها همین‌جا اطلاع‌رسانی می‌شود.')
                  : Column(children: [
                      _chips(),
                      Expanded(
                        child: _visible.isEmpty
                            ? const EmptyView(icon: Icons.filter_alt_off_rounded, title: 'در این دسته اعلانی نیست', hint: 'دستهٔ دیگری را انتخاب کنید.')
                            : RefreshIndicator(
                                onRefresh: _load,
                                child: ListView.separated(
                                  padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
                                  itemCount: _visible.length,
                                  separatorBuilder: (_, _) => const SizedBox(height: 9),
                                  itemBuilder: (_, index) => _card(_visible[index]),
                                ),
                              ),
                      ),
                    ]),
    );
  }

  Widget _chips() {
    Widget chip(_NotifFilter value, String label, IconData icon) {
      final active = _filter == value;
      return Padding(
        padding: const EdgeInsets.only(left: 8),
        child: ChoiceChip(
          selected: active,
          avatar: Icon(icon, size: 16, color: active ? Colors.white : PishkanColors.primary),
          label: Text(label, style: TextStyle(fontSize: 12, fontWeight: active ? FontWeight.w800 : FontWeight.w600, color: active ? Colors.white : PishkanColors.navy)),
          selectedColor: PishkanColors.primary,
          backgroundColor: Colors.white,
          side: BorderSide(color: active ? PishkanColors.primary : const Color(0xFFE2E8F0)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
          onSelected: (_) => setState(() => _filter = value),
        ),
      );
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: Row(children: [
        chip(_NotifFilter.all, 'همه', Icons.notifications_rounded),
        chip(_NotifFilter.requests, 'پرونده‌ها', Icons.timeline_rounded),
        chip(_NotifFilter.messages, 'پیام‌ها', Icons.chat_rounded),
        chip(_NotifFilter.stories, 'استوری‌ها', Icons.auto_stories_rounded),
      ]),
    );
  }

  Widget _card(Map<String, dynamic> item) {
    final unread = asStr(item['readAt']).isEmpty;
    final requestId = _requestIdOf(item);
    final request = requestId == null ? null : _requestsById[requestId];
    final progress = request == null ? null : caseProgress(status: request.status, workBucket: request.workBucket);

    final (IconData icon, Color color) = _isStory(item)
        ? (Icons.auto_stories_rounded, const Color(0xFFDB2777))
        : _isMessage(item)
            ? (Icons.chat_rounded, const Color(0xFF0891B2))
            : requestId != null
                ? (Icons.timeline_rounded, PishkanColors.primary)
                : switch (asStr(item['kind'])) {
                    'success' => (Icons.check_circle_rounded, PishkanColors.success),
                    'warning' => (Icons.warning_amber_rounded, PishkanColors.warning),
                    'error' => (Icons.error_rounded, PishkanColors.danger),
                    _ => (Icons.campaign_rounded, PishkanColors.primary),
                  };

    return SoftCard(
      onTap: () => _open(item),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Stack(children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: color.withOpacity(0.12), shape: BoxShape.circle),
              child: Icon(icon, color: color, size: 20),
            ),
            if (unread) Positioned(top: 2, right: 2, child: Container(width: 9, height: 9, decoration: const BoxDecoration(color: PishkanColors.danger, shape: BoxShape.circle))),
          ]),
          const SizedBox(width: 11),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(asStr(item['title']), style: TextStyle(fontWeight: unread ? FontWeight.w800 : FontWeight.w600, fontSize: 13.5, color: PishkanColors.navy)),
              if (asStr(item['body']).isNotEmpty) Text(asStr(item['body']), style: const TextStyle(fontSize: 12, color: PishkanColors.mutedText, height: 1.8), maxLines: 3, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 3),
              Text(faDate(item['createdAt'], withTime: true), style: const TextStyle(fontSize: 10.5, color: PishkanColors.mutedText)),
            ]),
          ),
          if (requestId != null || _isStory(item) || _isMessage(item)) const Icon(Icons.chevron_left_rounded, color: PishkanColors.mutedText, size: 20),
        ]),
        if (progress != null) ...[
          const SizedBox(height: 10),
          StageProgressBar(progress: progress),
        ],
      ]),
    );
  }
}
