// Temporary: fails deliberately with the asset list, so the annotation shows
// whether an asset declared in pubspec.yaml is missing on disk — the usual
// cause of a Gradle asset-merge failure that produces no readable output.
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('list declared assets', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final missing = <String>[];
    for (final raw in pubspec.split('\n')) {
      final line = raw.trim();
      if (!line.startsWith('- assets/') && !line.contains('asset: ')) continue;
      final path = line.replaceFirst(RegExp(r'^-\s*'), '').replaceFirst('asset: ', '').trim();
      if (path.isEmpty) continue;
      final f = File(path);
      if (!f.existsSync() && !Directory(path).existsSync()) missing.add(path);
    }
    debugPrint('::error::ASSETS_MISSING ${missing.isEmpty ? "none" : missing.join(", ")}');
  });
}
