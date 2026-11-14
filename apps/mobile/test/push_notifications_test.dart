import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/services/notifier.dart';
import 'package:pishkan_app/widgets/notification_card.dart';

/// Tests for the notification surfaces the customer actually sees.
///
/// The Android delivery path (FCM → PishkanPushService → tray) cannot be tested
/// here: it needs a device and a Firebase project. What *can* be pinned down is
/// the part that decides what a message looks like, and the classification the
/// native side mirrors — so a change to one has to be made to the other.
void main() {
  AppNotificationEvent stage({double? progress = 0.4, String label = 'بررسی کارشناس'}) =>
      AppNotificationEvent(
        id: 'n1',
        title: 'مرحلهٔ پروندهٔ شما به‌روز شد',
        body: 'مرحلهٔ فعلی: «بررسی کارشناس»',
        link: '/app/requests/r1',
        kind: 'info',
        eventType: 'request_stage',
        progress: progress,
        stageLabel: label,
      );

  test('a stage event is classified as a case, not a generic announcement', () {
    final event = stage();
    expect(event.requestId, 'r1');
    expect(event.isMessage, isFalse);
    expect(event.isBanner, isFalse);
    expect(event.icon, Icons.timeline_rounded);
  });

  test('two stage updates of one case share a tag so the tray shows the newer one', () {
    final first = AppNotificationEvent(
      id: 'a', title: 't', body: 'b', link: '/app/requests/r1', kind: 'info', eventType: 'request_stage');
    final second = AppNotificationEvent(
      id: 'b', title: 't', body: 'b', link: '/app/requests/r1', kind: 'info', eventType: 'request_stage');
    expect(first.notificationTag('srv', 'u1'), second.notificationTag('srv', 'u1'));
    // …while a different case, or a message about the same case, does not.
    final other = AppNotificationEvent(
      id: 'c', title: 't', body: 'b', link: '/app/requests/r2', kind: 'info', eventType: 'request_stage');
    expect(other.notificationTag('srv', 'u1'), isNot(first.notificationTag('srv', 'u1')));
    final chat = AppNotificationEvent(
      id: 'd', title: 'پیام جدید', body: 'b', link: '/app/requests/r1/messages', kind: 'info');
    expect(chat.notificationTag('srv', 'u1'), isNot(first.notificationTag('srv', 'u1')));
  });

  testWidgets('the card shows the stage name and the percentage for a case update', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PishkanNotificationCard(event: stage(progress: 0.6, label: 'تأیید نهایی')),
      ),
    ));
    expect(find.textContaining('تأیید نهایی'), findsOneWidget);
    // faDigits keeps the numerals Persian, like every other number in the app.
    expect(find.text('٪۶۰'), findsOneWidget);
    // Both representations of the same fraction: the ring and the bar.
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(find.byType(CustomPaint), findsWidgets);
    // Specifically no CircularProgressIndicator: it animates forever, and this
    // card floats over the home screen.
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('a plain notice stays compact: no progress bar where there is no progress', (tester) async {
    final notice = AppNotificationEvent(
      id: 'x', title: 'اطلاعیهٔ دفتر', body: 'تعطیلی پنجشنبه', link: '/app/banners', kind: 'info');
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: PishkanNotificationCard(event: notice)),
    ));
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('اطلاعیهٔ دفتر'), findsOneWidget);
  });

  testWidgets('tapping the card calls back once, and the close button dismisses', (tester) async {
    var taps = 0;
    var dismissed = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PishkanNotificationCard(
          event: stage(),
          onTap: () => taps++,
          onDismiss: () => dismissed++,
          compact: true,
        ),
      ),
    ));
    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pump();
    expect(dismissed, 1);
    expect(taps, 0);
  });

  testWidgets('tapping the body of the card navigates', (tester) async {
    var taps = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PishkanNotificationCard(event: stage(), onTap: () => taps++, compact: true),
      ),
    ));
    // No dismiss button in this configuration, so the whole surface is the
    // tap target — which is what the tray notification behaves like too.
    await tester.tap(find.textContaining('بررسی کارشناس').first);
    await tester.pump();
    expect(taps, 1);
  });

  testWidgets('a very long body is clamped instead of pushing the bar off the card', (tester) async {
    final wordy = AppNotificationEvent(
      id: 'w',
      title: 'یادداشت کارشناس',
      body: 'متن بسیار طولانی ' * 40,
      link: '/app/requests/r1',
      kind: 'info',
      eventType: 'request_stage',
      progress: 0.2,
      stageLabel: 'در حال بررسی',
    );
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: PishkanNotificationCard(event: wordy))),
    ));
    expect(tester.takeException(), isNull);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
  });
}
