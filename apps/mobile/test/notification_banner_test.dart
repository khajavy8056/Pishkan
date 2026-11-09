import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';
import 'package:pishkan_app/services/notifier.dart';
import 'package:pishkan_app/widgets/banner_carousel.dart';

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

  test('document approvals update one tag without replacing rejection or stage notices', () {
    AppNotificationEvent event(String id, String type) => AppNotificationEvent(
      id: id, link: '/app/requests/r1', title: 'مدرک', body: '', kind: 'success', eventType: type);
    final tag = event('a', 'document_approved').notificationTag('server', 'user');
    expect(event('b', 'document_approved').notificationTag('server', 'user'), tag);
    expect(event('c', 'document_rejected').notificationTag('server', 'user'), isNot(tag));
    expect(event('c', 'document_rejected').notificationTag('server', 'user'), isNot(event('d', 'document_rejected').notificationTag('server', 'user')));
    expect(event('e', '').notificationTag('server', 'user'), isNot(tag));
    expect(notificationRevisionKey({'id': 'a', 'revision': 2}), 'a:2');
    expect(notificationRevisionKey({'id': 'a'}), 'a:1');
  });

  testWidgets('the banner rail advances on its own and opens the card that is showing',
      (tester) async {
    AppBanner card(String id, String title) => AppBanner.fromJson({
          'id': id,
          'kind': 'service',
          'title': title,
          'destinationKind': 'service',
          'destinationSlug': 'plate-replacement-appointment',
        });

    final opened = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 220,
          child: BannerCarousel(
            banners: [card('a', 'اول'), card('b', 'دوم')],
            // A short interval keeps the test at ~1s instead of the 7s the app
            // uses; the behaviour under test is the advance, not the wait.
            interval: const Duration(milliseconds: 400),
            onOpenBanner: (banner) => opened.add(banner.id),
          ),
        ),
      ),
    ));

    // First card is on screen.
    expect(find.text('اول'), findsOneWidget);

    // It advances without any input — the whole point of the rail.
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    expect(find.text('دوم'), findsOneWidget);

    // A tap opens *that* banner, not the one the rail started on.
    await tester.tap(find.text('دوم'));
    await tester.pump();
    expect(opened, ['b']);

    // And leaving the tree stops the timer: no pending-timer failure.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('a single banner never starts a timer', (tester) async {
    final banner = AppBanner.fromJson({
      'id': 'only',
      'title': 'تنها',
      'destinationKind': 'none',
    });
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 220,
          child: BannerCarousel(
            banners: [banner],
            interval: const Duration(milliseconds: 100),
            onOpenBanner: (_) {},
          ),
        ),
      ),
    ));
    await tester.pump(const Duration(milliseconds: 300));
    // With one card there is nothing to advance to, and a timer that kept
    // firing would animate the same page to itself forever.
    expect(tester.takeException(), isNull);
    expect(find.text('تنها'), findsOneWidget);
  });
}
