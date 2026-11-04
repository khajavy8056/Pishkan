import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'session.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code = ''});
  final String message;
  final int? statusCode;
  final String code;

  @override
  String toString() => message;
}

/// Thin typed layer over the existing backend. Every response follows the
/// `{ ok, data, meta, error }` envelope; this class unwraps it and turns
/// failures into [ApiException] with a Persian, user-facing message.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  Dio? _dio;
  String _dioBase = '';

  Dio get _client {
    final base = SessionStore.instance.serverUrl;
    if (_dio == null || _dioBase != base) {
      _dioBase = base;
      _dio = Dio(BaseOptions(
        baseUrl: base,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        sendTimeout: const Duration(seconds: 60),
        validateStatus: (code) => code != null && code < 600,
      ));
      _dio!.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        final token = SessionStore.instance.token;
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        options.headers['X-Pishkan-Client'] = 'android-app';
        handler.next(options);
      }));
    }
    return _dio!;
  }

  Map<String, String> authHeaders() {
    final token = SessionStore.instance.token;
    return token == null || token.isEmpty ? const {} : {'Authorization': 'Bearer $token'};
  }

  /// Resolve a server-relative path (`/api/files/x?v=preview`) to a URL.
  String absolute(String path) {
    if (path.isEmpty) return path;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    final base = SessionStore.instance.serverUrl;
    return path.startsWith('/') ? '$base$path' : '$base/$path';
  }

  Future<dynamic> getData(String path, {Map<String, dynamic>? query}) async {
    final response = await _send(() => _client.get(path, queryParameters: query));
    return response['data'];
  }

  Future<Map<String, dynamic>> getEnvelope(String path, {Map<String, dynamic>? query}) async {
    return _send(() => _client.get(path, queryParameters: query));
  }

  Future<dynamic> postData(String path, {Map<String, dynamic>? body, Map<String, dynamic>? query, Map<String, String>? headers}) async {
    final response = await _send(() => _client.post(path, data: body ?? {}, queryParameters: query, options: Options(headers: headers)));
    return response['data'];
  }

  Future<dynamic> patchData(String path, {Map<String, dynamic>? body}) async {
    final response = await _send(() => _client.patch(path, data: body ?? {}));
    return response['data'];
  }

  Future<dynamic> putData(String path, {Map<String, dynamic>? body}) async {
    final response = await _send(() => _client.put(path, data: body ?? {}));
    return response['data'];
  }

  Future<void> deleteData(String path) async {
    await _send(() => _client.delete(path));
  }

  /// Upload one file to the central secure file store. Returns the file id.
  Future<Map<String, dynamic>> uploadFile(File file, {String purpose = 'document'}) async {
    final name = file.path.split(Platform.pathSeparator).last;
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(file.path, filename: name),
    });
    final response = await _send(() => _client.post('/api/files/upload', data: form, queryParameters: {'purpose': purpose}));
    final data = response['data'];
    if (data is Map) return Map<String, dynamic>.from(data);
    throw ApiException('پاسخ نامعتبر هنگام بارگذاری فایل');
  }

  /// Download an authenticated file into [savePath] (e.g. delivered results).
  Future<void> downloadTo(String path, String savePath) async {
    try {
      final response = await _client.download(path, savePath);
      if ((response.statusCode ?? 500) >= 400) {
        throw ApiException('دانلود فایل انجام نشد. دوباره تلاش کنید.');
      }
    } on DioException catch (error) {
      throw _dioToApi(error);
    }
  }

  Future<bool> ping(String baseUrl) async {
    try {
      final dio = Dio(BaseOptions(connectTimeout: const Duration(seconds: 8), receiveTimeout: const Duration(seconds: 8)));
      final response = await dio.get('$baseUrl/api/health');
      return (response.statusCode ?? 500) < 400;
    } catch (_) {
      return false;
    }
  }

  Future<Map<String, dynamic>> _send(Future<Response<dynamic>> Function() run) async {
    if (!SessionStore.instance.hasServer) {
      throw ApiException('آدرس سرور تنظیم نشده است.');
    }
    Response<dynamic> response;
    try {
      response = await run();
    } on DioException catch (error) {
      throw _dioToApi(error);
    }
    final status = response.statusCode ?? 0;
    final body = response.data;
    if (status == 401) {
      if (SessionStore.instance.isSignedIn) {
        await SessionStore.instance.signOut();
      }
      throw ApiException('نشست شما پایان یافته است. لطفاً دوباره وارد شوید.', statusCode: 401, code: 'UNAUTHORIZED');
    }
    if (body is Map && body['ok'] == true) {
      return Map<String, dynamic>.from(body);
    }
    String message = 'خطایی در ارتباط با سرور رخ داد.';
    String code = '';
    if (body is Map && body['error'] is Map) {
      final error = Map<String, dynamic>.from(body['error'] as Map);
      message = (error['message'] ?? message).toString();
      code = (error['code'] ?? '').toString();
    } else if (status >= 500) {
      message = 'سرور موقتاً در دسترس نیست. لطفاً کمی بعد تلاش کنید.';
    }
    if (kDebugMode) debugPrint('API $status $code $message');
    throw ApiException(message, statusCode: status, code: code);
  }

  ApiException _dioToApi(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return ApiException('ارتباط با سرور طولانی شد. اتصال اینترنت یا Wi‑Fi دفتر را بررسی کنید.');
      case DioExceptionType.connectionError:
        return ApiException('اتصال به سرور ممکن نیست. اگر سامانه روی کامپیوتر دفتر است، مطمئن شوید گوشی به همان Wi‑Fi وصل است.');
      default:
        final data = error.response?.data;
        if (data is Map && data['error'] is Map) {
          final err = Map<String, dynamic>.from(data['error'] as Map);
          return ApiException((err['message'] ?? 'خطا در ارتباط با سرور').toString(), statusCode: error.response?.statusCode, code: (err['code'] ?? '').toString());
        }
        return ApiException('خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.');
    }
  }
}
