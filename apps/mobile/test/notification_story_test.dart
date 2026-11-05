import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/screens/story_viewer.dart';
import 'package:pishkan_app/services/notifier.dart';

void main() {
  test('request stage updates share a scoped Android tag, invoices and messages do not', () {
    AppNotificationEvent event(String id, String link, {String title = 'وضعیت'}) =>
        AppNotificationEvent(id: id, link: link, title: title, body: '', kind: 'info');
    final stage = event('n1', '/app/requests/r1');
    expect(stage.notificationTag('https://office', 'u1'), event('n2', '/app/requests/r1').notificationTag('https://office', 'u1'));
    expect(stage.notificationTag('https://office', 'u1'), isNot(event('n3', '/app/requests/r2').notificationTag('https://office', 'u1')));
    expect(stage.notificationTag('https://office', 'u1'), isNot(event('n4', '/app/requests/r1', title: 'فاکتور جدید').notificationTag('https://office', 'u1')));
    expect(stage.notificationTag('https://office', 'u1'), isNot(event('n5', '/app/requests/r1/messages').notificationTag('https://office', 'u1')));
    expect(stage.notificationTag('https://office', 'u1'), isNot(stage.notificationTag('https://office', 'u2')));
    expect(stage.notificationTag('https://office', 'u1'), isNot(stage.notificationTag('https://other', 'u1')));
  });

  testWidgets('story edge navigation skips empty groups and final completion returns home', (tester) async {
    final groups = [
      StoryGroup.fromJson({'title': 'empty', 'items': []}),
      StoryGroup.fromJson({'title': 'group', 'items': [
        {'id': 'a', 'title': 'first', 'durationSeconds': 3},
        {'id': 'b', 'title': 'second', 'durationSeconds': 3},
      ]}),
    ];
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => Scaffold(
      body: TextButton(onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => StoryViewerScreen(groups: groups))), child: const Text('home')),
    ))));
    await tester.tap(find.text('home'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('first'), findsOneWidget);
    await tester.tapAt(const Offset(100, 300));
    await tester.pump();
    expect(find.text('second'), findsOneWidget);
    await tester.tapAt(const Offset(700, 300));
    await tester.pump();
    expect(find.text('first'), findsOneWidget);
    await tester.tapAt(const Offset(100, 300));
    await tester.pump();
    await tester.tapAt(const Offset(100, 300));
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
