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
String normalizeBaseUrl(String raw) {
  var value = raw.trim();
  if (value.isEmpty) return value;
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    value = 'http://$value';
  }
  while (value.endsWith('/')) {
    value = value.substring(0, value.length - 1);
  }
  return value;
}
