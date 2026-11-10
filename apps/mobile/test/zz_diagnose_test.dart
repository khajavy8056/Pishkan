import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/screens/splash.dart';
import 'package:pishkan_app/core/motion.dart';

/// TEMPORARY. Emits GitHub workflow-command annotations so the failure text is
/// readable from the Actions API even when the raw log is not.
void main() {
  testWidgets('diagnose splash', (tester) async {
    try {
      await tester.pumpWidget(const MaterialApp(home: SplashStage()));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      // Drain every queued error, one at a time: `takeException` returns a
      // summary once more than one is pending, and the summary hides the cause.
      for (var i = 0; i < 6; i++) {
        final e = tester.takeException();
        if (e == null) break;
        debugPrint('::error::SPLASH_ERR_$i ${e.toString().replaceAll("\n", " | ").substring(0, e.toString().length > 300 ? 300 : e.toString().length)}');
      }
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      final e2 = tester.takeException();
      debugPrint('::error::SPLASH_STAGE_2 ${e2 ?? "none"}');
    } catch (err, st) {
      debugPrint('::error::SPLASH_THROW ${err.toString().replaceAll("\n", " | ")}');
      debugPrint('::error::SPLASH_STACK ${st.toString().split("\n").take(6).join(" | ")}');
    }
  });

  testWidgets('diagnose tactile', (tester) async {
    var fired = 0;
    try {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: Center(child: SizedBox(
          width: 220, height: 96,
          child: TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue)),
        ))),
      ));
      await tester.tap(find.byType(TactileTap));
      await tester.pump();
      debugPrint('::error::TACTILE_AFTER_TAP fired=$fired exc=${tester.takeException() ?? "none"}');
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();
      debugPrint('::error::TACTILE_AFTER_HOLD fired=$fired exc=${tester.takeException() ?? "none"}');
      await tester.pump(const Duration(milliseconds: 600));
      debugPrint('::error::TACTILE_AFTER_RIPPLE fired=$fired exc=${tester.takeException() ?? "none"}');
    } catch (err, st) {
      debugPrint('::error::TACTILE_THROW ${err.toString().replaceAll("\n", " | ")}');
    }
  });
}
