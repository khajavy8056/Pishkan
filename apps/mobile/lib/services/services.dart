import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/api.dart';
import '../core/cache.dart';
import '../core/session.dart';
import '../models/models.dart';

final api = ApiClient.instance;
final session = SessionStore.instance;

/// ---------- App surface (stories / config / device stats feed) ----------

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

Future<List<StoryGroup>> fetchStories() async {
  try {
    final data = await api.getData('/api/app/stories');
    await JsonCache.put('stories', data);
    return asMapList(asMap(data)['groups']).map(StoryGroup.fromJson).toList();
  } catch (_) {
    final cached = await JsonCache.get('stories');
    if (cached == null) return const [];
    return asMapList(asMap(cached.value)['groups']).map(StoryGroup.fromJson).toList();
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
  final accountKind = asStr(user['kind']).isNotEmpty ? asStr(user['kind']) : asStr(user['role']);
  if (accountKind != 'customer') {
    throw ApiException('این اپ برای مشتریان است. همکاران و مدیران لطفاً از پنل وب استفاده کنند.');
  }
  await session.signIn(token: token, user: user);
  await registerDevice();
  return user;
}

Future<Map<String, dynamic>> loginWithPassword(String identifier, String password) async {
  final data = await api.postData('/api/auth/customer/login', body: {'identifier': identifier, 'password': password});
  return _finishAuth(data);
}

Future<void> requestOtp(String mobile, {String purpose = 'login'}) async {
  await api.postData('/api/auth/otp/request', body: {'mobile': mobile, 'kind': 'customer', 'purpose': purpose});
}

Future<Map<String, dynamic>> verifyOtp(String mobile, String code, {String purpose = 'login', String newPassword = ''}) async {
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
  });
  return _finishAuth(data);
}

Future<Map<String, dynamic>> registerCustomer(Map<String, dynamic> body) async {
  final data = await api.postData('/api/auth/register', body: body);
  final map = asMap(data);
  if (asStr(map['token']).isEmpty) {
    // The account was created but needs verification/office approval first.
    throw ApiException(
      asBool(map['requiresApproval'])
          ? 'حساب شما ساخته شد و در انتظار تأیید دفتر است؛ پس از تأیید با همین رمز وارد شوید.'
          : 'حساب شما ساخته شد؛ برای فعال‌سازی، یک‌بار با کد پیامکی وارد شوید.',
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
    return cached == null ? const [] : asMapList(cached.value).map(ServiceCategory.fromJson).toList();
  }
}

Future<List<CatalogService>> fetchServices({String category = '', String search = ''}) async {
  final cacheKey = 'services:$category:${search.isEmpty ? '-' : 'q'}';
  try {
    final query = <String, dynamic>{'pageSize': 100};
    if (category.isNotEmpty) query['category'] = category;
    if (search.isNotEmpty) query['q'] = search;
    final data = await api.getData('/api/public/services', query: query);
    if (search.isEmpty) await JsonCache.put(cacheKey, data);
    return parseList(data, CatalogService.fromJson).items;
  } catch (_) {
    final cached = await JsonCache.get(cacheKey);
    return cached == null ? const [] : parseList(cached.value, CatalogService.fromJson).items;
  }
}

Future<CatalogService> fetchServiceDetail(String slug) async {
  try {
    final data = await api.getData('/api/public/services/$slug');
    await JsonCache.put('service:$slug', data);
    return CatalogService.fromJson(asMap(data));
  } catch (_) {
    final cached = await JsonCache.get('service:$slug');
    if (cached == null) rethrow;
    return CatalogService.fromJson(asMap(cached.value));
  }
}

/// Server is the source of truth for the final payable amount.
Future<Map<String, dynamic>> fetchQuote(String serviceId, {String priority = 'normal', String discountCode = ''}) async {
  final query = <String, dynamic>{'priority': priority};
  if (discountCode.isNotEmpty) query['discountCode'] = discountCode;
  final data = await api.getData('/api/catalog/services/$serviceId/quote', query: query);
  return asMap(data);
}

/// ---------- Requests ----------

/// Instant-display cache for the first page of the customer's own requests:
/// tabs paint immediately (even offline) and silently refresh after. Only
/// lists are cached — every action (pay, upload, cancel) still hits the API.
String _myRequestsCacheKey(String workBucket) => 'my-requests:${session.userId}:${workBucket.isEmpty ? '-' : workBucket}';

Future<ParsedList<ServiceRequestSummary>> fetchMyRequests({int page = 1, String workBucket = ''}) async {
  final query = <String, dynamic>{'page': page, 'pageSize': 20};
  if (workBucket.isNotEmpty) query['workBucket'] = workBucket;
  final data = await api.getData('/api/requests/mine', query: query);
  if (page == 1 && session.isSignedIn) {
    try {
      await JsonCache.put(_myRequestsCacheKey(workBucket), data);
    } catch (_) {}
  }
  return parseList(data, ServiceRequestSummary.fromJson);
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

Future<String> uploadOne(File file) async {
  final result = await api.uploadFile(file);
  return asStr(result['id']);
}

/// ---------- Money: invoices, payments, wallet ----------

Future<List<Map<String, dynamic>>> fetchMyInvoices() async {
  final envelope = await api.getEnvelope('/api/accounting/my/invoices', query: {'pageSize': 50});
  return asMapList(asMap(envelope['data'])['items']);
}

Future<List<Map<String, dynamic>>> fetchMyPayments() async {
  final envelope = await api.getEnvelope('/api/accounting/my/payments', query: {'pageSize': 50});
  return asMapList(asMap(envelope['data'])['items']);
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
  return asMapList(asMap(data)['items']);
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
