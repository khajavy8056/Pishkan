import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/api.dart';
import '../core/cache.dart';
import '../core/referral.dart';
import '../core/session.dart';
import '../models/models.dart';

final api = ApiClient.instance;
final session = SessionStore.instance;

/// ---------- App surface (banners / config / device stats feed) ----------

Future<AppConfig?> fetchAppConfig() async {
  try {
    final data = await api.getData('/api/app/config');
    await JsonCache.put('app-config', data);
    return AppConfig.fromJson(asMap(data));
  } catch (_) {
    final cached = await JsonCache.get('app-config');
    return cached == null ? null : AppConfig.fromJson(asMap(cached.value));
  }
}

/// Same public achievement counters and manager-editable labels as the site.
/// Cache only public statistics, never the customer-specific catalog in bootstrap.
Future<Map<String, dynamic>> fetchPublicAchievements() async {
  try {
    final data = asMap(await api.getData('/api/public/bootstrap'));
    final settings = asMap(data['settings']);
    final result = <String, dynamic>{
      'stats': asMap(data['stats']),
      'show': settings['landing.show_stats'],
      'customersText': settings['landing.stat_customers'],
      'customersLabel': settings['landing.stat_customers_label'],
      'hours': settings['office.working_hours'],
    };
    await JsonCache.put('public-achievements', result);
    return result;
  } catch (_) {
    final cached = await JsonCache.get('public-achievements');
    return cached == null ? <String, dynamic>{} : asMap(cached.value);
  }
}

/// Home-screen banners, newest office order.
///
/// Shaped like the catalogue fetches: a successful call refreshes the cache so
/// the next cold start has something to paint before the network answers, and
/// a failed call falls back to the last good list. That fallback is what keeps
/// the home screen from losing its top third when the office PC is briefly
/// unreachable.
Future<List<AppBanner>> fetchBanners() async {
  try {
    final data = await api.getData('/api/app/banners');
    await JsonCache.put('banners', data);
    return asMapList(asMap(data)['banners']).map(AppBanner.fromJson).toList();
  } catch (_) {
    final cached = await JsonCache.get('banners');
    if (cached == null) return const [];
    return asMapList(asMap(cached.value)['banners']).map(AppBanner.fromJson).toList();
  }
}

/// Register this install for the admin usage statistics. Fire-and-forget:
/// any failure is invisible to the customer.
Future<void> registerDevice() async {
  if (!session.hasServer) return;
  try {
    final info = await PackageInfo.fromPlatform();
    String model = '';
    try {
      final android = await DeviceInfoPlugin().androidInfo;
      model = '${android.manufacturer} ${android.model}'.trim();
    } catch (_) {}
    await api.postData('/api/app/device', body: {
      'deviceId': session.deviceId ?? '',
      'platform': 'android',
      'appVersion': info.version,
      'appBuild': info.buildNumber,
      'deviceModel': model,
    });
  } catch (_) {
    // Statistics must never break the app.
  }
}

/// ---------- Auth (same users/passwords as the web panels) ----------

Future<Map<String, dynamic>> _finishAuth(dynamic data) async {
  final map = asMap(data);
  final token = asStr(map['token']);
  final user = asMap(map['user']);
  if (token.isEmpty || user.isEmpty) {
    throw ApiException('پاسخ ورود ناقص بود. دوباره تلاش کنید.');
  }
  // The API identifies the account type with `kind` ('customer' vs staff
  // kinds); the auth payload has no `role` field. Reading the missing field
  // once made this guard reject every real customer.
  final accountKind = asStr(user['kind']);
  if (accountKind != 'customer') {
    throw ApiException('این اپ برای مشتریان است. همکاران و مدیران لطفاً از پنل وب استفاده کنند.');
  }
  await session.signIn(token: token, user: user);
  // Device statistics are nonessential and must not delay sign-in.
  unawaited(registerDevice());
  return user;
}

Future<Map<String, dynamic>> loginWithPassword(String identifier, String password) async {
  final data = await api.postData('/api/auth/customer/login', body: {'identifier': identifier, 'password': password});
  return _finishAuth(data);
}

Future<void> requestOtp(String mobile, {String purpose = 'login'}) async {
  await api.postData('/api/auth/otp/request', body: {'mobile': mobile, 'kind': 'customer', 'purpose': purpose});
}

Future<Map<String, dynamic>> verifyOtp(String mobile, String code, {String purpose = 'login', String newPassword = '', String referralCode = ''}) async {
  // Password reset has its own endpoint on the server; the OTP verify
  // endpoint only signs the customer in.
  if (purpose == 'reset') {
    final data = await api.postData('/api/auth/password/reset', body: {
      'mobile': mobile,
      'code': code,
      'newPassword': newPassword,
    });
    return _finishAuth(data);
  }
  final data = await api.postData('/api/auth/otp/verify', body: {
    'mobile': mobile,
    'code': code,
    'kind': 'customer',
    'purpose': purpose,
    if (referralCode.isNotEmpty) 'referralCode': referralCode,
  });
  await ReferralStore.clear();
  return _finishAuth(data);
}

/// Result of a registration attempt that did **not** sign the user in yet.
///
/// The account exists, so this is not a failure: the caller must show the
/// message and send the customer back to the login form — previously the two
/// cases were raised as an `ApiException`, so the screen rendered them as a red
/// error and never navigated, leaving the customer stuck on the form.
class PendingRegistration implements Exception {
  PendingRegistration(this.message, {required this.requiresApproval});
  final String message;
  final bool requiresApproval;
  @override
  String toString() => message;
}

Future<Map<String, dynamic>> registerCustomer(Map<String, dynamic> body) async {
  final data = await api.postData('/api/auth/register', body: body);
  await ReferralStore.clear();
  final map = asMap(data);
  if (asStr(map['token']).isEmpty) {
    // The account was created but needs verification/office approval first.
    final requiresApproval = asBool(map['requiresApproval']);
    throw PendingRegistration(
      requiresApproval
          ? 'حساب شما ساخته شد و در انتظار تأیید دفتر است؛ پس از تأیید با همین رمز وارد شوید.'
          : 'حساب شما ساخته شد؛ برای فعال‌سازی، یک‌بار با کد پیامکی وارد شوید.',
      requiresApproval: requiresApproval,
    );
  }
  return _finishAuth(data);
}

Future<Map<String, dynamic>> fetchMe() async {
  final data = await api.getData('/api/auth/me');
  final user = asMap(data);
  if (user.isNotEmpty) await session.updateUser(user);
  return user;
}

/* -------------------------------- assistant ------------------------------- */

/// Assistant availability and the onboarding copy the office configured.
Future<Map<String, dynamic>> fetchAssistantInfo() async {
  return asMap(await api.getData('/api/assistant/info'));
}

/// Ask the assistant. The server decides what a customer may know: answers come
/// from the catalogue and from this customer's own cases, never from others.
Future<Map<String, dynamic>> askAssistant(String message, {List<Map<String, dynamic>> history = const []}) async {
  final data = await api.postData('/api/assistant/chat', body: {
    'message': message,
    'history': history.take(8).toList(),
  });
  return asMap(data);
}

/* --------------------------------- avatars -------------------------------- */

/// The picker catalogue plus the current choice.
Future<Map<String, dynamic>> fetchAvatarCatalogue() async {
  return asMap(await api.getData('/api/customers/me/avatar'));
}

/// Persist a preset choice server-side (survives reinstall and other devices).
Future<Map<String, dynamic>> chooseAvatarPreset(int preset, {String gender = ''}) async {
  final data = await api.putData('/api/customers/me/avatar/preset', body: {
    'preset': preset,
    if (gender.isNotEmpty) 'gender': gender,
  });
  await fetchMe().catchError((_) => <String, dynamic>{});
  return asMap(data);
}

/// Use an uploaded image as the face; `fileId` comes from the upload endpoint.
Future<Map<String, dynamic>> setAvatarPhoto(String fileId) async {
  final data = await api.putData('/api/customers/me/avatar/photo', body: {'fileId': fileId});
  await fetchMe().catchError((_) => <String, dynamic>{});
  return asMap(data);
}

/// Drop the photo and fall back to the preset. The server answers with the
/// new avatar state, which is what the picker redraws from.
Future<Map<String, dynamic>> clearAvatarPhoto() async {
  final data = await api.deletePayload('/api/customers/me/avatar/photo');
  await fetchMe().catchError((_) => <String, dynamic>{});
  return asMap(data);
}

Future<void> logoutServer() async {
  try {
    await api.postData('/api/auth/logout');
  } catch (_) {}
  // The next person on this phone must never see this customer's cached
  // requests/notifications, even for a split second.
  final uid = session.userId;
  if (uid.isNotEmpty) {
    try {
      await JsonCache.removeByPrefix('my-requests:$uid');
      await JsonCache.removeByPrefix('notifications:$uid');
      await JsonCache.removeByPrefix('services:');
    } catch (_) {}
  }
  await session.signOut();
}

/// ---------- Catalog (cached for weak connections) ----------

Future<List<ServiceCategory>> fetchCategories() async {
  try {
    final data = await api.getData('/api/public/categories');
    await JsonCache.put('categories', data);
    return asMapList(data).map(ServiceCategory.fromJson).toList();
  } catch (_) {
    final cached = await JsonCache.get('categories');
    if (cached == null) rethrow;
    return asMapList(cached.value).map(ServiceCategory.fromJson).toList();
  }
}

Future<List<CatalogService>> fetchServices({String category = '', String search = ''}) async {
  // Catalog responses can include a customer's private custom services.
  // Never reuse one customer's cached list for another account.
  final cacheKey = 'services:${session.userId}:$category:-';
  try {
    // The server caps each page at 100. Load every page rather than silently
    // hiding services beyond the first page; cache only a complete response.
    final all = <Map<String, dynamic>>[];
    var page = 1;
    while (true) {
      final query = <String, dynamic>{'page': page, 'pageSize': 100};
      if (category.isNotEmpty) query['category'] = category;
      if (search.isNotEmpty) query['q'] = search;
      final envelope = await api.getEnvelope('/api/public/services', query: query);
      final items = asMapList(envelope['data']);
      all.addAll(items);
      final total = asNum(asMap(envelope['meta'])['total']).toInt();
      if (items.isEmpty || all.length >= total || items.length < 100) break;
      page++;
    }
    if (search.isEmpty) await JsonCache.put(cacheKey, all);
    return all.map(CatalogService.fromJson).toList();
  } catch (_) {
    if (search.isNotEmpty) rethrow;
    final cached = await JsonCache.get(cacheKey);
    if (cached == null) rethrow;
    return parseList(cached.value, CatalogService.fromJson).items;
  }
}

Future<CatalogService> fetchServiceDetail(String slug) async {
  try {
    final data = await api.getData('/api/public/services/$slug');
    final record = asMap(data);
    // Private custom offers must never survive sign-out in the public cache.
    if (!asBool(record['isCustom'])) await JsonCache.put('service:$slug', data);
    return CatalogService.fromJson(record);
  } on ApiException catch (error) {
    // Never resurrect a deleted or unauthorized service from stale cache.
    if (error.statusCode == 401 || error.statusCode == 403 || error.statusCode == 404) rethrow;
    final cached = await JsonCache.get('service:$slug');
    if (cached == null) rethrow;
    return CatalogService.fromJson(asMap(cached.value));
  }
}

/// Server is the source of truth for the final payable amount.
Future<Map<String, dynamic>> fetchQuote(String serviceId, {String priority = 'normal', String discountCode = ''}) async {
  final data = await api.postData('/api/requests/quote', body: {
    'serviceId': serviceId,
    'priority': priority,
    if (discountCode.isNotEmpty) 'discountCode': discountCode,
  });
  return asMap(data);
}

/// ---------- Requests ----------

/// Instant-display cache for the first page of the customer's own requests:
/// tabs paint immediately (even offline) and silently refresh after. Only
/// lists are cached — every action (pay, upload, cancel) still hits the API.
String _myRequestsCacheKey(String workBucket) => 'my-requests:${session.userId}:${workBucket.isEmpty ? '-' : workBucket}';

Future<ParsedList<ServiceRequestSummary>> fetchMyRequests({int page = 1, String workBucket = ''}) async {
  final query = <String, dynamic>{'page': page, 'pageSize': 20};
  if (workBucket.isNotEmpty) query['bucket'] = workBucket;
  final envelope = await api.getEnvelope('/api/requests', query: query);
  final data = envelope['data'];
  if (page == 1 && session.isSignedIn) {
    try {
      await JsonCache.put(_myRequestsCacheKey(workBucket), data);
    } catch (_) {}
  }
  final parsed = parseList(data, ServiceRequestSummary.fromJson);
  final total = asNum(asMap(envelope['meta'])['total']).toInt();
  return ParsedList(parsed.items, total);
}

/// Last good first page of my requests (this device, this user) or null.
Future<ParsedList<ServiceRequestSummary>?> cachedMyRequests({String workBucket = ''}) async {
  if (!session.isSignedIn) return null;
  try {
    final cached = await JsonCache.get(_myRequestsCacheKey(workBucket));
    if (cached == null) return null;
    return parseList(cached.value, ServiceRequestSummary.fromJson);
  } catch (_) {
    return null;
  }
}

Future<RequestDetail> fetchRequestDetail(String id) async {
  final data = await api.getData('/api/requests/$id');
  return RequestDetail.fromJson(asMap(data));
}

Future<Map<String, dynamic>> createRequest({
  required String serviceId,
  required Map<String, dynamic> formData,
  required String paymentMethod,
  required String priority,
  String discountCode = '',
  required List<Map<String, dynamic>> documentIds,
  required String idempotencyKey,
}) async {
  final data = await api.postData('/api/requests', body: {
    'serviceId': serviceId,
    'formData': formData,
    'paymentMethod': paymentMethod,
    'priority': priority,
    if (discountCode.isNotEmpty) 'discountCode': discountCode,
    'documentIds': documentIds,
  }, headers: {'Idempotency-Key': idempotencyKey});
  return asMap(data);
}

Future<void> addRequestDocument(String requestId, {required String fileId, required String title, String requirementKey = ''}) async {
  await api.postData('/api/requests/$requestId/documents', body: {
    'fileId': fileId,
    'title': title,
    if (requirementKey.isNotEmpty) 'requirementKey': requirementKey,
  });
}

/// Attach an existing verified profile document to a request (customer
/// confirms explicitly; the profile copy stays untouched).
Future<void> reuseProfileDocument(String requestId, {required String customerDocumentId, String requirementKey = ''}) async {
  await api.postData('/api/requests/$requestId/documents', body: {
    'customerDocumentId': customerDocumentId,
    'confirmReuse': true,
    if (requirementKey.isNotEmpty) 'requirementKey': requirementKey,
  });
}

Future<void> cancelRequest(String requestId, String reason) async {
  await api.postData('/api/requests/$requestId/cancel', body: {'reason': reason});
}

Future<String> uploadOne(File file, {bool documentQuality = false}) async {
  final result = await api.uploadFile(file, documentQuality: documentQuality);
  return asStr(result['id']);
}

/// Upload an image held in memory (avatar selection) and return its file id.
Future<String> uploadImageBytes(List<int> bytes, String filename, {String purpose = 'avatar'}) async {
  final result = await api.uploadBytes(Uint8List.fromList(bytes), filename, purpose: purpose);
  return asStr(result['id']);
}

/// ---------- Money: invoices, payments, wallet ----------

Future<List<Map<String, dynamic>>> fetchMyInvoices() async {
  final envelope = await api.getEnvelope('/api/accounting/my/invoices', query: {'pageSize': 50});
  return asMapList(envelope['data']);
}

Future<List<Map<String, dynamic>>> fetchMyPayments() async {
  final envelope = await api.getEnvelope('/api/accounting/my/payments', query: {'pageSize': 50});
  return asMapList(envelope['data']);
}

/// Returns the payment URL the caller opens in the system browser.
Future<String> payInvoiceOnline(String invoiceId) async {
  final data = await api.postData('/api/accounting/my/invoices/$invoiceId/pay');
  return asStr(asMap(data)['paymentUrl']);
}

Future<void> payInvoiceWithWallet(String invoiceId) async {
  await api.postData('/api/wallet/my/invoices/$invoiceId/pay');
}

Future<Map<String, dynamic>> fetchWallet() async {
  return asMap(await api.getData('/api/wallet/my'));
}

Future<List<Map<String, dynamic>>> fetchWalletTransactions({int page = 1}) async {
  final data = await api.getData('/api/wallet/my/transactions', query: {'page': page, 'pageSize': 30});
  return asMapList(data);
}

Future<String> topupWallet(num amountRials) async {
  final data = await api.postData('/api/wallet/my/topup', body: {'amount': amountRials});
  return asStr(asMap(data)['paymentUrl']);
}

/// ---------- Notifications / support / chat ----------

/// The customer notification centre lives under /customers/me (same feed
/// the web bell reads): data = items[], meta.unread = unread count.
String _notificationsCacheKey() => 'notifications:${session.userId}';

Future<Map<String, dynamic>> fetchNotifications({int limit = 50}) async {
  final envelope = await api.getEnvelope('/api/customers/me/notifications', query: {'limit': limit});
  final result = {
    'items': asMapList(envelope['data']),
    'unreadCount': asNum(asMap(envelope['meta'])['unread']).toInt(),
  };
  if (limit >= 50 && session.isSignedIn) {
    try {
      await JsonCache.put(_notificationsCacheKey(), result);
    } catch (_) {}
  }
  return result;
}

/// Last good notification feed on this device (instant paint), or null.
Future<Map<String, dynamic>?> cachedNotifications() async {
  if (!session.isSignedIn) return null;
  try {
    final cached = await JsonCache.get(_notificationsCacheKey());
    if (cached == null) return null;
    return asMap(cached.value);
  } catch (_) {
    return null;
  }
}

Future<void> markNotificationRead(String id) async {
  await api.postData('/api/customers/me/notifications/read', body: {'id': id});
}

Future<void> markAllNotificationsRead() async {
  await api.postData('/api/customers/me/notifications/read', body: {});
}

Future<List<Map<String, dynamic>>> fetchTickets() async {
  final data = await api.getData('/api/support/tickets');
  return asMapList(data);
}

Future<Map<String, dynamic>> fetchTicket(String id) async {
  return asMap(await api.getData('/api/support/tickets/$id'));
}

Future<List<Map<String, dynamic>>> fetchChatThreads() async {
  final data = await api.getData('/api/messages/threads');
  return asMapList(data);
}

/// One call returns {thread, messages} and marks the other side read.
Future<Map<String, dynamic>> fetchThread(String threadId) async {
  return asMap(await api.getData('/api/messages/threads/$threadId'));
}

/// Get-or-create a conversation (per-request or general). Returns thread id.
Future<String> openThread({String requestId = '', String subject = '', String message = ''}) async {
  final data = await api.postData('/api/messages/threads', body: {
    if (requestId.isNotEmpty) 'requestId': requestId,
    if (subject.isNotEmpty) 'subject': subject,
    if (message.isNotEmpty) 'message': message,
  });
  return asStr(asMap(data)['id']);
}

/// Incremental sync: new messages after [after], the other side's last read
/// time, and whether they are typing. One small request per few seconds only
/// while the conversation is on screen.
Future<Map<String, dynamic>> syncThread(String threadId, {String after = ''}) async {
  return asMap(await api.getData('/api/messages/threads/$threadId/sync', query: {
    if (after.isNotEmpty) 'after': after,
  }));
}

/// Best-effort typing presence. Failures are ignored by the caller.
Future<void> setTyping(String threadId, bool typing) async {
  await api.postData('/api/messages/threads/$threadId/typing', body: {'typing': typing});
}

Future<void> sendChatMessage(String threadId, {String body = '', String fileId = ''}) async {
  await api.postData('/api/messages/threads/$threadId/messages', body: {
    'body': body.isEmpty ? '📎 پیوست ارسال شد' : body,
    if (fileId.isNotEmpty) 'fileId': fileId,
  });
}

/// ---------- Profile documents ----------

Future<Map<String, dynamic>> fetchMyDocuments() async {
  final envelope = await api.getEnvelope('/api/documents/mine');
  return {
    'items': asMapList(envelope['data']),
    'types': asMapList(asMap(envelope['meta'])['types']),
  };
}

/// ---------- Version helpers ----------

int compareVersions(String a, String b) {
  List<int> parts(String v) => v.split('.').map((p) => int.tryParse(p.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0).toList();
  final pa = parts(a);
  final pb = parts(b);
  for (var i = 0; i < 3; i++) {
    final x = i < pa.length ? pa[i] : 0;
    final y = i < pb.length ? pb[i] : 0;
    if (x != y) return x.compareTo(y);
  }
  return 0;
}

Future<String> currentAppVersion() async {
  try {
    final info = await PackageInfo.fromPlatform();
    return info.version;
  } catch (_) {
    return '1.0.0';
  }
}
