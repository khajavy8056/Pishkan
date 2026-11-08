import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  static const _soundsKey = 'pishkan.pref.sounds';

  static Future<bool> soundsEnabled() async => (await SharedPreferences.getInstance()).getBool(_soundsKey) ?? true;
  static Future<void> setSoundsEnabled(bool value) async { await (await SharedPreferences.getInstance()).setBool(_soundsKey, value); }

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
    this.eventType = '',
  });

  final String id;
  final String title;
  final String body;
  final String link;
  final String kind;
  final double? progress; // 0..1 for case stage notifications
  final String stageLabel;
  final String eventType;

  bool get isDocumentApproval => eventType == 'document_approved';
  bool get isDocumentRejection => eventType == 'document_rejected';

  bool get isStory => link == '/app/stories';
  bool get isMessage => link.contains('messages') || link.contains('support') || link.startsWith('chat:') || title.contains('پیام') || title.contains('یادداشت');
  bool get isInvoice => link.contains('invoice') || '$title $body'.contains('فاکتور') || '$title $body'.contains('صورتحساب');

  /// Android identifies a notification by BOTH id and tag. Using the full,
  /// account-scoped key as a tag avoids persistent hash collisions and lets
  /// request stages replace one another without swallowing invoices/messages.
  String notificationTag(String server, String userId) {
    final entity = isDocumentApproval && requestId != null
        ? 'request:${requestId!}:document-approvals'
        : isDocumentRejection ? 'event:$id'
        : requestId != null && !isMessage && !isInvoice && !isStory
            ? 'request:${requestId!}:stage'
            : 'event:$id';
    return 'pishkan:$server:$userId:$entity';
  }
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

String notificationRevisionKey(Map<String, dynamic> item) {
  final revision = asNum(item['revision']).toInt();
  return '${asStr(item['id'])}:${revision < 1 ? 1 : revision}';
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

  // New IDs are needed because Android retains each channel's original sound.
  static const _requestsChannel = 'pishkan_requests_v2';
  static const _messagesChannel = 'pishkan_messages_v2';
  static const _storiesChannel = 'pishkan_stories_v2';
  static const _invoiceChannel = 'pishkan_invoices_v2';
  static const _generalChannel = 'pishkan_general_v2';

  static String? _pendingLaunchPayload;

  static Future<void> init() async {
    if (_ready) return;
    // Best-effort only: notifications must never block or crash app start.
    try {
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
      final launch = await _plugin.getNotificationAppLaunchDetails();
      final response = launch?.notificationResponse;
      if (launch?.didNotificationLaunchApp == true && response != null) {
        _pendingLaunchPayload = response.payload;
      }
      _ready = true;
      // Register the channels up front. Android fixes a channel's importance
      // and sound the first time it is created and silently ignores later
      // changes, so a channel that only ever appears on the first notification
      // can end up muted for good. Creating them at start makes the sound a
      // one-time decision we control instead of a race with the first event.
      await _createChannels();
    } catch (_) {
      // Leave _ready=false so a later call can retry.
    }
  }

  /// Every channel, silent twin included, declared before it is first used.
  static Future<void> _createChannels() async {
    final android = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android == null) return;
    const channels = <(String, String, String, String)>[
      (_requestsChannel, 'تغییرات پرونده‌ها', 'مرحلهٔ تازهٔ درخواست‌ها همراه نوار پیشرفت', 'notice_soft'),
      (_messagesChannel, 'پیام‌ها', 'پاسخ‌های گفتگو و تیکت پشتیبانی', 'message_soft'),
      (_storiesChannel, 'استوری و اطلاعیه‌ها', 'استوری تازه و اطلاعیه‌های دفتر', 'notice_soft'),
      (_invoiceChannel, 'فاکتورها', 'فاکتورها و وضعیت پرداخت', 'invoice_soft'),
      (_generalChannel, 'اطلاع‌رسانی سامانه', 'اعلان‌های عمومی پیشخوان', 'notice_soft'),
    ];
    for (final (id, name, description, sound) in channels) {
      // With sound (the user has not muted the app) …
      await android.createNotificationChannel(AndroidNotificationChannel(
        id,
        name,
        description: description,
        importance: Importance.high,
        playSound: true,
        sound: RawResourceAndroidNotificationSound(sound),
      ));
      // … and its silent twin, used when the customer turns sounds off. Having
      // it pre-created means the mute toggle never needs a restart.
      await android.createNotificationChannel(AndroidNotificationChannel(
        '${id}_silent',
        '$name (بی‌صدا)',
        description: description,
        importance: Importance.high,
        playSound: false,
      ));
    }
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
    final server = session.serverUrl;
    final userId = session.userId;
    Map<String, dynamic> feed;
    try {
      feed = await fetchNotifications(limit: 30);
    } catch (_) {
      return const [];
    }
    if (!session.isSignedIn || session.serverUrl != server || session.userId != userId) return const [];
    final items = (feed['items'] as List).cast<Map<String, dynamic>>();
    final prefs = await SharedPreferences.getInstance();
    final scope = '$server:$userId';
    final seenKey = '$_seenIdsKey:$scope';
    final baselineKey = '$_baselineKey:$scope';

    // First ever successful poll: record everything as "already known" so a
    // fresh install is not flooded with historical notifications.
    if (!(prefs.getBool(baselineKey) ?? false)) {
      await prefs.setString(seenKey, jsonEncode(items.map(notificationRevisionKey).toList()));
      await prefs.setBool(baselineKey, true);
      return const [];
    }

    List<String> seenList = [];
    try {
      seenList = (jsonDecode(prefs.getString(seenKey) ?? '[]') as List).map((e) => e.toString()).toList();
    } catch (_) {}
    final seen = seenList.toSet();
    // Old app versions stored just the ID; treat that as revision 1 only.
    bool alreadySeen(Map<String, dynamic> n) {
      final id = asStr(n['id']);
      final revision = asNum(n['revision']).toInt();
      return seen.contains(notificationRevisionKey(n)) || (revision <= 1 && seen.contains(id));
    }
    final fresh = items.where((n) => !alreadySeen(n) && asStr(n['readAt']).isEmpty).toList();
    if (fresh.isEmpty) {
      await _remember(prefs, items, seenKey);
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
        eventType: asStr(item['eventType']),
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
          eventType: event.eventType,
        ));
      } else {
        events.add(event);
      }
    }

    if (!session.isSignedIn || session.serverUrl != server || session.userId != userId) return const [];
    if (systemNotifications && await AppPrefs.notificationsEnabled()) {
      await init();
      for (final event in events) {
        await _showSystem(event);
      }
    }
    await _remember(prefs, items, seenKey);
    return events;
  }

  static Future<void> _remember(SharedPreferences prefs, List<Map<String, dynamic>> items, String seenKey) async {
    List<String> previous = [];
    try {
      previous = (jsonDecode(prefs.getString(seenKey) ?? '[]') as List).map((e) => e.toString()).toList();
    } catch (_) {}
    final merged = <String>{...items.map(notificationRevisionKey), ...previous}.toList();
    await prefs.setString(seenKey, jsonEncode(merged.take(300).toList()));
  }

  // The plugin also uses the numeric id as Android's tap PendingIntent request
  // code. Allocate it per full tag (rather than reusing 0) so different tray
  // items retain their own deep links. The tag remains the collision-free key.
  static Future<int> _notificationId(String tag) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    var hash = 2166136261;
    for (final unit in utf8.encode(tag)) {
      hash = ((hash ^ unit) * 16777619) & 0x7fffffff;
    }
    var candidate = hash;
    while (true) {
      final key = 'pishkan.notif.androidId.$candidate';
      final existing = prefs.getString(key);
      if (existing == null || existing == tag) {
        if (existing == null) await prefs.setString(key, tag);
        return candidate;
      }
      candidate = (candidate + 1) & 0x7fffffff;
    }
  }

  /// True when the OS has granted POST_NOTIFICATIONS (Android 13+).
  /// Older versions always report true. Null when the platform could not tell.
  static Future<bool?> permissionGranted() async {
    try {
      await init();
      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      return await android?.areNotificationsEnabled();
    } catch (_) {
      return null;
    }
  }

  /// Raise one sample notification so the customer can verify the whole chain
  /// (channel, sound, tray, deep link) instead of waiting for a real event.
  static Future<bool> showTestNotification() async {
    try {
      await init();
      final granted = await permissionGranted();
      if (granted == false) {
        await requestPermission();
        if (await permissionGranted() == false) return false;
      }
      await _showSystem(AppNotificationEvent(
        id: 'test-${DateTime.now().millisecondsSinceEpoch}',
        title: 'اعلان آزمایشی پیشخوان',
        body: 'اگر این پیام را می‌بینید، اعلان‌ها درست کار می‌کنند.',
        link: '/app/notifications',
        kind: 'info',
        eventType: 'test',
      ));
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> _showSystem(AppNotificationEvent event) async {
    final tag = event.notificationTag(session.serverUrl, session.userId);
    final notificationId = await _notificationId(tag);
    final soundsEnabled = await AppPrefs.soundsEnabled();
    final (channelId, channelName, channelDescription, sound) = switch ((event.isStory, event.isMessage, event.isInvoice, event.requestId != null)) {
      (true, _, _, _) => (_storiesChannel, 'استوری و اطلاعیه‌ها', 'استوری تازه و اطلاعیه‌های دفتر', 'notice_soft'),
      (_, true, _, _) => (_messagesChannel, 'پیام‌ها', 'پاسخ‌های گفتگو و تیکت پشتیبانی', 'message_soft'),
      (_, _, true, _) => (_invoiceChannel, 'فاکتورها', 'فاکتورها و وضعیت پرداخت', 'invoice_soft'),
      (_, _, _, true) => (_requestsChannel, 'تغییرات پرونده‌ها', 'مرحلهٔ تازهٔ درخواست‌ها همراه نوار پیشرفت', 'notice_soft'),
      _ => (_generalChannel, 'اطلاع‌رسانی سامانه', 'اعلان‌های عمومی پیشخوان', 'notice_soft'),
    };
    final progressValue = event.progress == null ? 0 : (event.progress! * 100).round();
    final bodyText = event.progress == null
        ? event.body
        : '${event.body.isEmpty ? '' : '${event.body}\n'}مرحلهٔ فعلی: ${event.stageLabel} (٪${faDigits(progressValue)})';
    final details = AndroidNotificationDetails(
      soundsEnabled ? channelId : '${channelId}_silent',
      channelName,
      channelDescription: channelDescription,
      importance: Importance.high,
      priority: Priority.high,
      icon: 'ic_stat_pishkan',
      largeIcon: const DrawableResourceAndroidBitmap('ic_notif_large'),
      tag: tag,
      playSound: soundsEnabled,
      sound: soundsEnabled ? RawResourceAndroidNotificationSound(sound) : null,
      onlyAlertOnce: event.isDocumentApproval,
      color: PishkanColors.primary,
      showProgress: event.progress != null,
      maxProgress: 100,
      progress: progressValue,
      indeterminate: false,
      styleInformation: BigTextStyleInformation(bodyText),
      ticker: event.title,
    );
    await _plugin.show(
      notificationId,
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
      // Do not run the moment the app starts: the foreground timer is already
      // polling, and a burst of requests on open is what made the first
      // notification late. Two minutes gives the UI time to finish loading.
      initialDelay: const Duration(minutes: 2),
      constraints: Constraints(networkType: NetworkType.connected),
      // `update` instead of `keep`: with `keep`, a schedule registered by an
      // older build survives an upgrade with its old constraints, so a fix to
      // the polling never reaches a phone that already ran the old version.
      existingWorkPolicy: ExistingPeriodicWorkPolicy.update,
      backoffPolicy: BackoffPolicy.exponential,
      backoffPolicyDelay: const Duration(minutes: 5),
    );
  } catch (_) {
    // Background polling is an enhancement; the foreground timer still runs.
  }
}

/// Open the system page that lets Android treat this app as unrestricted.
///
/// Returns true when the app was already exempt (the system page was still
/// opened, so the choice stays with the customer). Used by the profile screen;
/// deliberately not called automatically, because quietly asking for a battery
/// exemption is the kind of thing users rightly resent.
Future<bool> openBatteryOptimisationSettings() async {
  try {
    final exempt = await const MethodChannel('ir.pishkan.app/battery')
        .invokeMethod<bool>('requestIgnore');
    return exempt ?? false;
  } catch (_) {
    return false;
  }
}
