import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'request_detail.dart';
import 'wallet.dart';

/// In-app notification centre (the same feed as the web bell). Tapping a
/// case notification deep-links into that request.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await fetchNotifications();
      final list = asMapList(data['items']);
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
          _error = error.message;
        });
      }
    }
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
    // Web links look like /app/requests/:id — extract ids for deep-linking.
    final link = asStr(item['link']);
    final match = RegExp(r'requests/([A-Za-z0-9_-]+)').firstMatch(link);
    if (match != null && mounted) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: match.group(1)!)));
    } else if (link.contains('wallet') && mounted) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => const WalletScreen()));
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
                  ? const EmptyView(icon: Icons.notifications_none_rounded, title: 'اعلانی ندارید', hint: 'تغییر وضعیت پرونده‌ها، پاسخ کارشناس و رسید پرداخت‌ها همین‌جا اطلاع‌رسانی می‌شود.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
                        itemCount: _items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 9),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final unread = asStr(item['readAt']).isEmpty;
                          final kind = asStr(item['kind']);
                          final (icon, color) = switch (kind) {
                            'success' => (Icons.check_circle_rounded, PishkanColors.success),
                            'warning' => (Icons.warning_amber_rounded, PishkanColors.warning),
                            'error' => (Icons.error_rounded, PishkanColors.danger),
                            _ => (Icons.info_rounded, PishkanColors.primary),
                          };
                          return SoftCard(
                            onTap: () => _open(item),
                            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
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
                                  Text(asStr(item['title']), style: TextStyle(fontWeight: unread ? FontWeight.w800 : FontWeight.w600, fontSize: 13.5)),
                                  if (asStr(item['body']).isNotEmpty)
                                    Text(asStr(item['body']), style: const TextStyle(fontSize: 12, color: PishkanColors.mutedText, height: 1.8), maxLines: 3, overflow: TextOverflow.ellipsis),
                                  const SizedBox(height: 3),
                                  Text(faDate(item['createdAt'], withTime: true), style: const TextStyle(fontSize: 10.5, color: PishkanColors.mutedText)),
                                ]),
                              ),
                            ]),
                          );
                        },
                      ),
                    ),
    );
  }
}
