import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/screens/splash.dart';

void main() {
  testWidgets('diagnose splash with a real error listener', (tester) async {
    final errors = <String>[];
    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      final text = details.exceptionAsString();
      if (errors.length < 3) {
        final head = text.split('\n').take(4).join(' | ');
        errors.add(head.length > 420 ? head.substring(0, 420) : head);
      }
    };
    addTearDown(() => FlutterError.onError = previous);

    await tester.pumpWidget(const MaterialApp(home: SplashStage()));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    for (var i = 0; i < errors.length; i++) {
      debugPrint('::error::ERR_$i ${errors[i]}');
    }
    if (errors.isEmpty) debugPrint('::error::ERR_NONE');

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
}
