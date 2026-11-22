import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';

/// The launcher icon is the one asset nobody can test by looking at the app:
/// it is chosen by the OS, not drawn by our code. A wrong size, a missing
/// density or an icon that lost its transparency ships silently and only shows
/// up once the APK is installed.
///
/// These checks read the real files that Gradle packages.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const res = 'android/app/src/main/res';

  /// Legacy square icon sizes, keyed by density folder.
  const legacySizes = <String, int>{
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
  };

  /// Adaptive foreground is a 108dp canvas, so it is 2.25x the legacy icon.
  const foregroundSizes = <String, int>{
    'mdpi': 108,
    'hdpi': 162,
    'xhdpi': 216,
    'xxhdpi': 324,
    'xxxhdpi': 432,
  };

  test('every density has a launcher icon at the exact expected size', () {
    for (final entry in legacySizes.entries) {
      final file = File('$res/mipmap-${entry.key}/ic_launcher.png');
      expect(file.existsSync(), isTrue, reason: '${file.path} is missing');

      final bytes = file.readAsBytesSync();
      expect(bytes.sublist(0, 8),
          orderedEquals([137, 80, 78, 71, 13, 10, 26, 10]),
          reason: '${file.path} is not a PNG');

      final width = bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19];
      final height = bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23];
      expect(width, entry.value, reason: '${file.path} width');
      expect(height, entry.value, reason: '${file.path} height');
    }
  });

  test('adaptive foregrounds exist and leave room for the system mask', () async {
    for (final entry in foregroundSizes.entries) {
      final file = File('$res/mipmap-${entry.key}/ic_launcher_foreground.png');
      expect(file.existsSync(), isTrue, reason: '${file.path} is missing');

      final image = await decodeImageFromList(file.readAsBytesSync());
      expect(image.width, entry.value, reason: '${file.path} width');
      expect(image.height, entry.value, reason: '${file.path} height');
    }

    // The adaptive icon XML must still reference both layers, or Android falls
    // back to the legacy bitmap and ignores the icon we just built.
    final xml = File('$res/mipmap-anydpi-v26/ic_launcher.xml').readAsStringSync();
    expect(xml, contains('@color/ic_launcher_background'));
    expect(xml, contains('@mipmap/ic_launcher_foreground'));
  });

  test('the in-app logo keeps an alpha channel and is square', () async {
    final file = File('assets/icon.png');
    expect(file.existsSync(), isTrue);

    final bytes = file.readAsBytesSync();
    final width = bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19];
    final height = bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23];
    final colorType = bytes[25];

    // Drawn inside a ClipOval on the splash, the login card and the profile;
    // an opaque square here would show as a hard-edged box in a circle.
    expect(width, height, reason: 'assets/icon.png must be square');
    expect(colorType, 6, reason: 'the logo must stay transparent');
    expect(width, greaterThanOrEqualTo(512),
        reason: 'the splash draws it large, so the source must be big enough');
  });

  test('the web icon set is wired to the same artwork', () {
    for (final path in [
      'apps/web/public/favicon.svg',
      'apps/web/public/favicon.ico',
      'apps/web/public/icons/icon-192.png',
      'apps/web/public/icons/icon-512.png',
    ]) {
      final file = File('../../$path');
      expect(file.existsSync(), isTrue, reason: '$path is missing from the web app');
      expect(file.lengthSync(), greaterThan(200), reason: '$path looks empty');
    }

    // The manifest in index.html points at these exact files; a rename without
    // updating the markup leaves the tab and the home-screen icon blank.
    final html = File('../../apps/web/index.html').readAsStringSync();
    expect(html, contains('/favicon.svg'));
    expect(html, contains('/icons/icon-192.png'));
  });
}
