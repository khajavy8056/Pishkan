/// Build-time configuration.
///
/// Environments are selected with `--dart-define` so the very same source
/// produces a local, staging or production build; only the connection
/// settings change (see README):
///
///   flutter run   --dart-define=APP_ENV=local      --dart-define=API_BASE_URL=http://10.0.2.2:3000
///   flutter build apk --dart-define=APP_ENV=production --dart-define=API_BASE_URL=https://api.example.ir
///
/// A server address typed by the user inside the app (needed for LAN/office
/// installs) always wins over the build-time default.
class Env {
  static const String appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'local');
  static const String defaultApiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: '');

  static bool get isProduction => appEnv == 'production';
}

/// Normalise whatever the user typed ("192.168.1.10:3000", "office.local",
/// "https://api.example.ir/") into a clean base URL without a trailing slash.
///
/// Only the *origin* is kept. A path, a query or a trailing `#` in the typed
/// address would otherwise be glued to every API call (`http://host/panel` +
/// `/api/...` → `http://host/api/...` silently losing `/panel`, or with
/// Dio's `queryParameters` fighting a query already in the base URL).
String normalizeBaseUrl(String raw) {
  var value = raw.trim();
  if (value.isEmpty) return value;
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    value = 'http://$value';
  }
  final uri = Uri.tryParse(value);
  if (uri == null || !uri.hasAuthority || uri.host.isEmpty) return '';
  return '${uri.scheme}://${uri.authority}';
}

/// Credentials must only be sent to the configured server, never a third-party
/// image, story, or payment host (including another port on the same host).
bool sameServerOrigin(String baseUrl, String targetUrl) {
  final base = Uri.tryParse(baseUrl);
  final target = Uri.tryParse(targetUrl);
  if (base == null || target == null || !base.hasAuthority || !target.hasAuthority) return false;
  if (!['http', 'https'].contains(base.scheme) || !['http', 'https'].contains(target.scheme)) return false;
  return base.origin == target.origin;
}
