import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/tour.dart';

/// The geometry the phone owns, and the shape of the payload it reads.
///
/// The copy of a tour is the server's business — which is why a wording fix
/// reaches Android without a release. What cannot be delegated is *where the
/// card goes*: a coachmark that lands on top of its own target, or hides under
/// the keyboard, is the failure that makes people call a tour annoying. Both
/// rules are pure functions here, so they can be pinned without a device.
void main() {
  group('catalogue mapping', () {
    test('a step keeps its fallback anchors in the order the server sent them', () {
      final step = TourStepData.fromMap(const {
        'id': 'documents-profile',
        'target': 'tour:profile-document-picker',
        'altTargets': ['tour:request-documents'],
        'title': 'اول از مدارک پروفایل بردارید',
        'body': '…',
      });
      expect(step.targets, ['profile-document-picker', 'request-documents']);
      expect(step.id, 'documents-profile');
      expect(step.interactive, isFalse);
    });

    test('an interactive step lets the page through', () {
      final step = TourStepData.fromMap(const {
        'id': 'x',
        'target': 'tour:request-submit',
        'title': 'ت',
        'body': 'ب',
        'interactive': true,
      });
      expect(step.targets, ['request-submit']);
      expect(step.interactive, isTrue);
    });

    test('a tour without a single step is dropped, not shown empty', () {
      expect(TourData.fromMap(const {'code': 'customer-request', 'label': 'ل', 'steps': []}), isNull);
      expect(TourData.fromMap(const {'code': '', 'steps': [{'id': 'a', 'title': 'ت', 'body': 'ب'}]}), isNull);
      final tour = TourData.fromMap(const {
        'code': 'customer-profile',
        'label': 'مشخصات و مدارک',
        'anchor': 'profile',
        'steps': [
          {'id': 'prefill', 'target': 'tour:profile-form', 'title': 'ت', 'body': 'ب'},
        ],
      });
      expect(tour, isNotNull);
      expect(tour!.anchor, 'profile');
      expect(tour.steps.length, 1);
    });

    test('a tip carries the control it points at', () {
      final tip = TourTipData.fromMap(const {
        'key': 'document-from-profile',
        'target': 'tour:profile-document-picker',
        'altTargets': ['tour:request-documents'],
        'title': 'مدرک را از پروفایل بردارید',
        'body': 'فایل همین مدرک در «مدارک من» هست.',
      });
      expect(tip, isNotNull);
      expect(tip!.key, 'document-from-profile');
      expect(tip.targets, ['profile-document-picker', 'request-documents']);
    });
  });

  group('card placement', () {
    const screen = Size(400, 800);

    test('sits under the target and centres on it when it fits', () {
      final rect = cardRectFor(target: const Rect.fromLTWH(40, 200, 200, 44), card: const Size(180, 150), screen: screen);
      expect(rect.top, 256); // target.bottom + the gap
      expect(rect.bottom, lessThanOrEqualTo(screen.height - 12));
      expect(rect.center.dx, closeTo(140, 0.5));
    });

    test('flips above the target when the bottom of the screen is taken', () {
      final rect = cardRectFor(target: const Rect.fromLTWH(40, 700, 200, 44), card: const Size(300, 150), screen: screen);
      expect(rect.bottom, 688);
      expect(rect.bottom, lessThanOrEqualTo(700));
      expect(rect.left, 12); // too wide to centre on the target: hug the margin
    });

    test('flips above when the keyboard ate the space below', () {
      final rect = cardRectFor(
        target: const Rect.fromLTWH(40, 500, 200, 44),
        card: const Size(300, 150),
        screen: screen,
        bottomInset: 260,
      );
      // The usable bottom is 800 - 260 - 12 = 528, so the only place left is
      // above the target — which is also where the submit button still is.
      expect(rect.bottom, 488);
      expect(rect.bottom, lessThanOrEqualTo(528));
    });

    test('a card taller than the free space is fitted, not hung over the edge', () {
      final rect = cardRectFor(target: const Rect.fromLTWH(40, 300, 200, 44), card: const Size(300, 900), screen: screen);
      expect(rect.top, greaterThanOrEqualTo(12));
      expect(rect.bottom, lessThanOrEqualTo(788));
      expect(rect.left, greaterThanOrEqualTo(12));
      expect(rect.right, lessThanOrEqualTo(screen.width - 12));
    });

    test('survives a screen with almost no room left (no inverted range)', () {
      // A landscape phone with the suggestion bar up leaves a band shorter than
      // any card. `num.clamp` throws when its bounds invert, so this is the case
      // the arithmetic has to survive — a throwing card takes the whole wizard
      // down with it, since the tour layer sits above the navigator.
      final rect = cardRectFor(
        target: const Rect.fromLTWH(40, 10, 200, 20),
        card: const Size(300, 150),
        screen: const Size(400, 200),
        bottomInset: 190,
      );
      expect(rect.top, greaterThanOrEqualTo(0));
      expect(rect.bottom, lessThanOrEqualTo(200));
      expect(rect.height, greaterThan(0));
    });

    test('with no target at all it rests at the bottom, centred', () {
      final rect = cardRectFor(target: null, card: const Size(300, 150), screen: screen);
      expect(rect.bottom, closeTo(screen.height - 12, 0.5));
      expect(rect.center.dx, closeTo(screen.width / 2, 0.5));
    });

    test('a narrow tip is never wider than the screen', () {
      // The phone picks min(screen - 32, 330) for a tip; on this screen that is
      // the cap, and the point of the assertion is that the card is never wider
      // than the space the screen allows.
      const width = 330.0;
      final rect = cardRectFor(target: const Rect.fromLTWH(0, 100, 60, 30), card: const Size(width, 116), screen: screen);
      expect(rect.left, greaterThanOrEqualTo(12));
      expect(rect.right, lessThanOrEqualTo(400 - 12));
    });
  });
}
