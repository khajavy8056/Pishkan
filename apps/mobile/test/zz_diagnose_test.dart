import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/motion.dart';

/// Temporary: runs each tactile scenario in isolation and reports which one
/// produces a FlutterError, so the failing test can be named instead of guessed.
void main() {
  Future<String> run(WidgetTester tester, String label, Future<void> Function() body) async {
    String out = 'ok';
    final prev = FlutterError.onError;
    FlutterError.onError = (d) {
      final t = d.exceptionAsString().split('\n').first;
      out = t.length > 220 ? t.substring(0, 220) : t;
    };
    try {
      await body();
    } catch (e) {
      out = 'THREW ${e.toString().split('\n').first}'.substring(0, 220);
    } finally {
      FlutterError.onError = prev;
    }
    return '$label=$out';
  }

  Widget host(Widget child) => MaterialApp(
        home: Scaffold(body: Center(child: SizedBox(width: 220, height: 96, child: child))),
      );

  testWidgets('isolate tactile scenarios', (tester) async {
    final results = <String>[];

    results.add(await run(tester, 'A_press_before_tap', () async {
      var fired = 0;
      await tester.pumpWidget(host(TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));
      await tester.tap(find.byType(TactileTap));
      await tester.pump();
      if (fired != 0) throw 'fired early ($fired)';
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();
      if (fired != 1) throw 'fired=$fired';
      await tester.pump(const Duration(milliseconds: 600));
    }));

    results.add(await run(tester, 'B_double_tap', () async {
      var fired = 0;
      await tester.pumpWidget(host(TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));
      await tester.tap(find.byType(TactileTap));
      await tester.tap(find.byType(TactileTap));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump();
      if (fired != 1) throw 'fired=$fired';
      await tester.pump(const Duration(milliseconds: 600));
    }));

    results.add(await run(tester, 'C_ripple', () async {
      await tester.pumpWidget(host(TactileTap(onTap: () async {}, child: const ColoredBox(color: Colors.blue))));
      final g = await tester.press(find.byType(TactileTap));
      await tester.pump(const Duration(milliseconds: 80));
      await g.up();
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump(const Duration(milliseconds: 600));
    }));

    results.add(await run(tester, 'D_reduced', () async {
      var fired = 0;
      await tester.pumpWidget(MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: Scaffold(body: Center(child: SizedBox(width: 220, height: 96,
            child: TactileTap(onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))))),
        ),
      ));
      await tester.tap(find.byType(TactileTap));
      await tester.pump();
      await tester.pump();
      if (fired != 1) throw 'fired=$fired';
      await tester.pump(const Duration(milliseconds: 300));
    }));

    results.add(await run(tester, 'E_disabled', () async {
      var fired = 0;
      await tester.pumpWidget(host(TactileTap(enabled: false, onTap: () async => fired++, child: const ColoredBox(color: Colors.blue))));
      await tester.tap(find.byType(TactileTap));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump();
      if (fired != 0) throw 'fired=$fired';
    }));

    for (final r in results) {
      debugPrint('::error::T_$r');
    }
  });
}
