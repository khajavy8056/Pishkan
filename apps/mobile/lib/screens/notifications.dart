import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/stages.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../services/notifier.dart';
import '../widgets/notification_card.dart';
import '../widgets/widgets.dart';
import 'notification_route.dart';

enum _NotifFilter { all, requests, messages, announcements }

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

  static bool _isAnnouncement(Map<String, dynamic> item) => asStr(item['link']) == '/app/banners';

  static bool _isMessage(Map<String, dynamic> item) {
    final link = asStr(item['link']);
    return link.contains('messages') || link.contains('support') || link.startsWith('chat:');
  }

  List<Map<String, dynamic>> get _visible {
    return switch (_filter) {
      _NotifFilter.all => _items,
      _NotifFilter.requests => _items.where((n) => _requestIdOf(n) != null).toList(),
      _NotifFilter.messages => _items.where(_isMessage).toList(),
      _NotifFilter.announcements => _items.where(_isAnnouncement).toList(),
    };
  }

  Future<void> _open(Map<String, dynamic> item) async {
    final id = asStr(item['id']);
    if (asStr(item['readAt']).isEmpty && id.isNotEmpty) {
      try {
        await markNotificationRead(id);
        if (mounted) {
          setState(() {
            _items = _items.map((n) => asStr(n['id']) == id ? {...n, 'readAt': 'now'} : n).toList();
          });
        }
      } catch (_) {
        // Do not pretend the server recorded a read while offline.
      }
    }
    if (!mounted) return;
    openCustomerNotification(context, asStr(item['link']));
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
                  ? const EmptyView(icon: Icons.notifications_none_rounded, title: 'اعلانی ندارید', hint: 'تغییر وضعیت پرونده‌ها، پاسخ کارشناس، اطلاعیهٔ تازه و رسید پرداخت‌ها همین‌جا اطلاع‌رسانی می‌شود.')
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
          label: Text(label, style: TextStyle(fontSize: 12, fontWeight: active ? FontWeight.w800 : FontWeight.w600, color: active ? Colors.white : context.ink)),
          selectedColor: PishkanColors.primary,
          backgroundColor: context.surface,
          side: BorderSide(color: active ? PishkanColors.primary : context.hairline),
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
        chip(_NotifFilter.announcements, 'اطلاعیه‌ها', Icons.campaign_rounded),
      ]),
    );
  }

  Widget _card(Map<String, dynamic> item) {
    final unread = asStr(item['readAt']).isEmpty;
    final requestId = _requestIdOf(item);
    final request = requestId == null ? null : _requestsById[requestId];
    // Progress comes from the case itself, not from the notification row: the
    // row records the stage that fired, while the case knows how far along it
    // is *now*, which is what a progress bar should show.
    final progress = request == null ? null : caseProgress(status: request.status, workBucket: request.workBucket);

    final event = AppNotificationEvent(
      id: asStr(item['id']),
      title: asStr(item['title']),
      body: asStr(item['body']),
      link: asStr(item['link']),
      kind: asStr(item['kind']),
      eventType: asStr(item['eventType']),
      progress: progress?.fraction,
      stageLabel: progress?.currentLabel ?? '',
    );

    return Stack(children: [
      PishkanNotificationCard(
        event: event,
        compact: false,
        timeLabel: faDate(item['createdAt'], withTime: true),
        onTap: () => _open(item),
      ),
      if (unread)
        Positioned(top: 10, left: 10, child: UnreadPip()),
    ]);
  }
}
