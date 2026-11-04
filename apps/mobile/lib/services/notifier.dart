import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import '../core/format.dart';
import '../core/session.dart';
import '../core/stages.dart';
import '../core/theme.dart';
import '../models/models.dart';
import 'services.dart';

/// On-device preferences (notification master switch, biometric unlock).
class AppPrefs {
  static const _notificationsKey = 'pishkan.pref.notifications';
  static const _biometricKey = 'pishkan.pref.biometric';

  static Future<bool> notificationsEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_notificationsKey) ?? true;
  }

  static Future<void> setNotificationsEnabled(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_notificationsKey, value);
  }

  static Future<bool> biometricEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_biometricKey) ?? false;
  }

  static Future<void> setBiometricEnabled(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_biometricKey, value);
  }
}

/// One fresh thing worth telling the customer about: a case moved a stage,
/// a reply arrived, a story was published... Consumed both by the system
/// tray notification (background) and the in-app banner (foreground).
class AppNotificationEvent {
  AppNotificationEvent({
    required this.id,
    required this.title,
    required this.body,
    required this.link,
    required this.kind,
    this.progress,
    this.stageLabel = '',
  });

  final String id;
  final String title;
  final String body;
  final String link;
  final String kind;
  final double? progress; // 0..1 for case stage notifications
  final String stageLabel;

  bool get isStory => link == '/app/stories';
  bool get isMessage => link.contains('messages');
  String? get requestId {
    final match = RegExp(r'requests/([A-Za-z0-9_-]+)').firstMatch(link);
    return match?.group(1);
  }

  IconData get icon {
    if (isStory) return Icons.auto_stories_rounded;
    if (isMessage) return Icons.chat_rounded;
    if (requestId != null) return Icons.timeline_rounded;
    return switch (kind) {
      'success' => Icons.check_circle_rounded,
      'warning' => Icons.warning_amber_rounded,
      'error' => Icons.error_rounded,
      _ => Icons.campaign_rounded,
    };
  }

  Color get color {
    if (isStory) return const Color(0xFFDB2777);
    if (isMessage) return const Color(0xFF0891B2);
    if (requestId != null) return PishkanColors.primary;
    return switch (kind) {
      'success' => PishkanColors.success,
      'warning' => PishkanColors.warning,
      'error' => PishkanColors.danger,
      _ => PishkanColors.primary,
    };
  }
}

const _seenIdsKey = 'pishkan.notif.seenIds';
const _baselineKey = 'pishkan.notif.baselineDone';

/// Rich notifications without Firebase: the server already records a
/// notification row for every meaningful event (stage changes, replies,
/// payments, new stories). The app polls that feed — a 15-minute WorkManager
/// job in the background and a gentle timer while foregrounded — and raises
/// proper Android notifications, with a stage progress bar for cases, in the
/// style of ride-hailing apps. When a real FCM project exists later, the
/// same server rows can drive instant push with no UI change.
class NotifierService {
  static final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;
  static void Function(String link)? onTapLink;

  static const _requestsChannel = 'pishkan_requests';
  static const _messagesChannel = 'pishkan_messages';
  static const _storiesChannel = 'pishkan_stories';
  static const _generalChannel = 'pishkan_general';

  static String? _pendingLaunchPayload;

  static Future<void> init() async {
    if (_ready) return;
    const androidInit = AndroidInitializationSettings('ic_stat_pishkan');
    await _plugin.initialize(
      const InitializationSettings(android: androidInit),
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload ?? '';
        if (payload.isNotEmpty) onTapLink?.call(payload);
      },
    );
    // Cold start from a tray notification: remember where to deep-link once
    // the shell is mounted.
    try {
      final launch = await _plugin.getNotificationAppLaunchDetails();
      if (launch?.didNotificationLaunchApp == true) {
        _pendingLaunchPayload = launch!.notificationResponse?.payload;
      }
    } catch (_) {}
    _ready = true;
  }

  /// The deep-link of the notification that cold-started the app, once.
  static String? takePendingLaunchPayload() {
    final pending = _pendingLaunchPayload;
    _pendingLaunchPayload = null;
    return pending;
  }

  static Future<void> requestPermission() async {
    await init();
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await android?.requestNotificationsPermission();
  }

  /// Fetch the server feed and surface anything new.
  ///
  /// [systemNotifications] is true for the background job (tray), false when
  /// the app is in the foreground (the shell shows in-app banners instead so
  /// nothing appears twice). Returns the fresh events either way.
  static Future<List<AppNotificationEvent>> checkForUpdates({required bool systemNotifications}) async {
    if (!session.hasServer || !session.isSignedIn) return const [];
    Map<String, dynamic> feed;
    try {
      feed = await fetchNotifications(limit: 30);
    } catch (_) {
      return const [];
    }
    final items = (feed['items'] as List).cast<Map<String, dynamic>>();
    final prefs = await SharedPreferences.getInstance();

    // First ever successful poll: record everything as "already known" so a
    // fresh install is not flooded with historical notifications.
    if (!(prefs.getBool(_baselineKey) ?? false)) {
      await prefs.setString(_seenIdsKey, jsonEncode(items.map((n) => asStr(n['id'])).toList()));
      await prefs.setBool(_baselineKey, true);
      return const [];
    }

    List<String> seenList = [];
    try {
      seenList = (jsonDecode(prefs.getString(_seenIdsKey) ?? '[]') as List).map((e) => e.toString()).toList();
    } catch (_) {}
    final seen = seenList.toSet();

    final fresh = items.where((n) => !seen.contains(asStr(n['id'])) && asStr(n['readAt']).isEmpty).toList();
    if (fresh.isEmpty) {
      await _remember(prefs, items);
      return const [];
    }

    // Attach stage progress to case notifications (one list call, best effort).
    Map<String, ServiceRequestSummary> requestsById = {};
    if (fresh.any((n) => asStr(n['link']).contains('requests/'))) {
      try {
        final mine = await fetchMyRequests();
        requestsById = {for (final r in mine.items) r.id: r};
      } catch (_) {}
    }

    final events = <AppNotificationEvent>[];
    for (final item in fresh.reversed) {
      final link = asStr(item['link']);
      final event = AppNotificationEvent(
        id: asStr(item['id']),
        title: asStr(item['title']),
        body: asStr(item['body']),
        link: link,
        kind: asStr(item['kind']),
      );
      final request = event.requestId == null ? null : requestsById[event.requestId];
      if (request != null) {
        final progress = caseProgress(status: request.status, workBucket: request.workBucket);
        events.add(AppNotificationEvent(
          id: event.id,
          title: event.title.isEmpty ? request.serviceTitle : event.title,
          body: event.body,
          link: link,
          kind: event.kind,
          progress: progress.fraction,
          stageLabel: progress.currentLabel,
        ));
      } else {
        events.add(event);
      }
    }

    if (systemNotifications && await AppPrefs.notificationsEnabled()) {
      await init();
      for (final event in events) {
        await _showSystem(event);
      }
    }
    await _remember(prefs, items);
    return events;
  }

  static Future<void> _remember(SharedPreferences prefs, List<Map<String, dynamic>> items) async {
    List<String> previous = [];
    try {
      previous = (jsonDecode(prefs.getString(_seenIdsKey) ?? '[]') as List).map((e) => e.toString()).toList();
    } catch (_) {}
    final merged = <String>{...items.map((n) => asStr(n['id'])), ...previous}.toList();
    await prefs.setString(_seenIdsKey, jsonEncode(merged.take(300).toList()));
  }

  static Future<void> _showSystem(AppNotificationEvent event) async {
    final (channelId, channelName, channelDescription) = switch ((event.isStory, event.isMessage, event.requestId != null)) {
      (true, _, _) => (_storiesChannel, 'استوری و اطلاعیه‌ها', 'استوری تازه و اطلاعیه‌های دفتر'),
      (_, true, _) => (_messagesChannel, 'پیام‌ها', 'پاسخ‌های گفتگو و تیکت پشتیبانی'),
      (_, _, true) => (_requestsChannel, 'تغییرات پرونده‌ها', 'مرحلهٔ تازهٔ درخواست‌ها همراه نوار پیشرفت'),
      _ => (_generalChannel, 'اطلاع‌رسانی سامانه', 'اعلان‌های عمومی پیشخوان'),
    };
    final progressValue = event.progress == null ? 0 : (event.progress! * 100).round();
    final bodyText = event.progress == null
        ? event.body
        : '${event.body.isEmpty ? '' : '${event.body}\n'}مرحلهٔ فعلی: ${event.stageLabel} (٪${faDigits(progressValue)})';
    final details = AndroidNotificationDetails(
      channelId,
      channelName,
      channelDescription: channelDescription,
      importance: Importance.high,
      priority: Priority.high,
      icon: 'ic_stat_pishkan',
      color: PishkanColors.primary,
      showProgress: event.progress != null,
      maxProgress: 100,
      progress: progressValue,
      indeterminate: false,
      styleInformation: BigTextStyleInformation(bodyText),
      ticker: event.title,
    );
    await _plugin.show(
      event.id.hashCode & 0x7fffffff,
      event.title,
      event.body.isEmpty ? event.stageLabel : event.body,
      NotificationDetails(android: details),
      payload: event.link,
    );
  }
}

/// WorkManager entry point — must stay a top-level function.
@pragma('vm:entry-point')
void notificationCallbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    WidgetsFlutterBinding.ensureInitialized();
    await SessionStore.instance.load();
    await NotifierService.checkForUpdates(systemNotifications: true);
    return true;
  });
}

/// Register the 15-minute background check (minimum allowed by Android).
Future<void> ensureBackgroundPolling() async {
  try {
    await Workmanager().initialize(notificationCallbackDispatcher);
    await Workmanager().registerPeriodicTask(
      'pishkan-notification-poll',
      'pishkanNotificationPoll',
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
      backoffPolicy: BackoffPolicy.exponential,
      backoffPolicyDelay: const Duration(minutes: 5),
    );
  } catch (_) {
    // Background polling is an enhancement; the foreground timer still runs.
  }
}
