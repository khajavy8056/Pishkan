import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/format.dart';
import 'package:pishkan_app/core/service_icons.dart';
import 'package:pishkan_app/core/stages.dart';
import 'package:pishkan_app/models/models.dart';

void main() {
  group('caseProgress — the shared stage engine', () {
    test('completed and delivered finish every stage', () {
      for (final status in ['completed', 'delivered']) {
        final p = caseProgress(status: status, workBucket: 'completed');
        expect(p.completed, isTrue);
        expect(p.fraction, 1);
        expect(p.doneCount, caseStageLabels.length);
      }
    });

    test('canceled and rejected fail at their stage', () {
      final canceled = caseProgress(status: 'canceled', workBucket: '');
      expect(canceled.failed, isTrue);
      expect(canceled.currentLabel, 'لغوشده');

      final rejected = caseProgress(status: 'rejected', workBucket: 'queue');
      expect(rejected.failed, isTrue);
      expect(rejected.currentIndex, 1);
    });

    test('queue is expert review, active is in progress', () {
      final queue = caseProgress(status: 'pending', workBucket: 'queue');
      expect(queue.currentIndex, 1);
      expect(queue.doneCount, 1);
      expect(queue.fraction, 0.5);

      final active = caseProgress(status: 'in_progress', workBucket: 'active', currentStepTitle: 'در حال پیگیری از سازمان');
      expect(active.currentIndex, 2);
      expect(active.doneCount, 2);
      expect(active.fraction, 0.75);
      expect(active.currentLabel, 'در حال پیگیری از سازمان');
    });

    test('waiting_customer flags the customer action', () {
      final p = caseProgress(status: 'waiting', workBucket: 'waiting_customer');
      expect(p.waitingForCustomer, isTrue);
      expect(p.currentLabel, 'منتظر اقدام شما');
    });

    test('unknown buckets fall back to expert review', () {
      final p = caseProgress(status: 'brand_new', workBucket: '');
      expect(p.currentIndex, 1);
      expect(p.failed, isFalse);
    });
  });

  group('Persian formatters', () {
    test('numeric Jalali date', () {
      // 23 Oct 2025 (noon UTC) is ۱ آبان ۱۴۰۴.
      expect(faDateNumeric('2025-10-23T12:00:00Z'), '۱۴۰۴/۰۸/۰۱');
      expect(faDateNumeric('not-a-date'), '—');
      expect(faDateNumeric(null), '—');
    });

    test('spaced mobile number', () {
      expect(faMobileSpaced('09121234567'), '۰۹۱۲ ۱۲۳ ۴۵۶۷');
      expect(faMobileSpaced('021123456'), '۰۲۱۱۲۳۴۵۶');
    });
  });

  group('service artwork', () {
    test('server-uploaded icon image is retained', () {
      final art = artworkFor(explicitIcon: '/uploads/public/icon.webp', title: 'تعویض پلاک خودرو');
      expect(art.imageUrl, '/uploads/public/icon.webp');
      expect(art.icon, Icons.directions_car_rounded);
    });

    test('services use vector pictograms rather than emoji text', () {
      expect(artworkFor(title: 'تعویض پلاک خودرو').icon, Icons.directions_car_rounded);
      expect(artworkFor(title: 'صدور کارت ملی هوشمند').icon, Icons.badge_rounded);
      expect(artworkFor(title: 'گذرنامه').icon, Icons.flight_takeoff_rounded);
      expect(artworkFor(title: 'ثبت‌نام وام ازدواج').icon, Icons.favorite_rounded);
      expect(artworkFor(title: 'پروانه کسب').icon, Icons.storefront_rounded);
      expect(artworkFor(explicitIcon: '🦄', title: 'تعویض پلاک خودرو').icon, Icons.directions_car_rounded);
    });

    test('bundled WebP photos only replace legacy default banners', () {
      // A bare category lookup must not borrow another entry's picture; only
      // the per-slug resolvers attach art.
      final art = artworkFor(categorySlug: 'vehicle-services');
      expect(art.assetPath, isEmpty);
      expect(isLegacyDefaultServiceImage('/images/services/vehicle.png'), isTrue);
      expect(isLegacyDefaultServiceImage('/uploads/public/my-banner.webp'), isFalse);
      expect(artworkFor(explicitIcon: 'receipt-text', title: 'خدمت ناشناخته').icon, Icons.description_rounded);
    });

    test('real server buckets and cancelled spelling drive progress', () {
      expect(caseProgress(status: 'in_progress', workBucket: 'in_progress').currentIndex, 2);
      expect(caseProgress(status: 'cancelled', workBucket: 'cancelled').failed, isTrue);
      expect(ServiceRequestSummary.fromJson({'status': 'cancelled'}).isCanceled, isTrue);
      expect(RequestDetail.fromJson({'status': 'cancelled'}).canCancel, isFalse);
    });

    test('fallback is stable for the same slug', () {
      final a = artworkFor(title: 'خدمت نامشخص', slug: 'unknown-1');
      final b = artworkFor(title: 'خدمت نامشخص', slug: 'unknown-1');
      expect(a.color, b.color);
      expect(a.icon, Icons.description_rounded);
    });

    test('artworkForService reads the catalog model', () {
      final service = CatalogService.fromJson({'title': 'کارت سوخت', 'slug': 'fuel-card'});
      expect(artworkForService(service).icon, Icons.local_gas_station_rounded);
    });
  });

  group('CatalogService real DTO spellings', () {
    test('form/documents/finalFee/urgentEnabled parse from the server DTO', () {
      final service = CatalogService.fromJson({
        'id': 'svc9',
        'slug': 'marriage-loan',
        'title': 'ثبت‌نام وام ازدواج',
        'summary': 'خلاصه',
        'image': '/uploads/banner.jpg',
        'categoryId': 'cat1',
        'categoryTitle': 'بانکی',
        'urgentEnabled': true,
        'baseFee': 2000000,
        'discountPercent': 25,
        'finalFee': 1500000,
        'estimatedDays': 3,
        'acceptingRequests': true,
        'tags': ['popular'],
        'form': [
          {'key': 'wifeName', 'label': 'نام همسر', 'type': 'text', 'required': true},
        ],
        'documents': [
          {'key': 'aghd', 'title': 'عقدنامه', 'required': true, 'note': 'اصل عقدنامه'},
        ],
      });
      expect(service.formFields.single.key, 'wifeName');
      expect(service.requirements.single.title, 'عقدنامه');
      expect(service.requirements.single.description, 'اصل عقدنامه');
      expect(service.computedTotal, 1500000);
      expect(service.urgentAvailable, isTrue);
      expect(service.popular, isTrue);
      expect(service.bannerUrl, '/uploads/banner.jpg');
      expect(service.categoryId, 'cat1');
      expect(service.durationText, contains('روز کاری'));
      expect(service.displayDescription, 'خلاصه');
    });
  });

  group('StoryItem caption + createdAt', () {
    test('parses the new fields', () {
      final item = StoryItem.fromJson({
        'id': 's1',
        'title': 'خوش آمدید',
        'caption': 'همهٔ خدمات دفتر اینجاست',
        'mediaType': 'image',
        'mediaUrl': '/app-stories/story-welcome.jpg',
        'createdAt': '2025-10-23T12:00:00Z',
      });
      expect(item.caption, 'همهٔ خدمات دفتر اینجاست');
      expect(item.createdAt, '2025-10-23T12:00:00Z');
    });
  });
}
