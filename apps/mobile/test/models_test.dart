import 'package:flutter/material.dart' show Color;
import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/models/models.dart';

void main() {
  test('category reads managed artwork', () {
    final category = ServiceCategory.fromJson({'title': 'دسته', 'image': '/uploads/public/c.webp', 'icon': '/uploads/public/i.webp', 'color': '#123456'});
    expect(category.image, '/uploads/public/c.webp');
    expect(category.icon, '/uploads/public/i.webp');
    expect(category.color, '#123456');
  });

  group('CatalogService', () {
    test('parses the public DTO and mirrors web price math', () {
      final service = CatalogService.fromJson({
        'id': 'svc1',
        'slug': 'plate-change',
        'title': 'تعویض پلاک',
        'icon': '🚗',
        'baseFee': 1000000,
        'discountPercent': 10,
        'taxPercent': 10,
        'categoryTitle': 'خودرو',
        'formFields': [
          {'key': 'nationalId', 'label': 'کد ملی', 'type': 'national_id', 'required': true},
        ],
        'documentRequirements': [
          {'key': 'card', 'title': 'کارت خودرو', 'required': true, 'documentType': 'car_card'},
        ],
      });
      expect(service.title, 'تعویض پلاک');
      // 1,000,000 − 10% = 900,000; +10% tax = 990,000
      expect(service.computedTotal, 990000);
      expect(service.formFields.single.type, 'national_id');
      expect(service.requirements.single.documentType, 'car_card');
    });

    test('survives an empty payload', () {
      final service = CatalogService.fromJson({});
      expect(service.title, '');
      expect(service.computedTotal, 0);
      expect(service.formFields, isEmpty);
    });
  });

  group('RequestDetail snapshot', () {
    test('reads form/documents from snapshot.service like the web', () {
      final detail = RequestDetail.fromJson({
        'id': 'r1',
        'trackingCode': 'PK-1',
        'status': 'in_progress',
        'snapshot': {
          'service': {
            'form': [
              {'key': 'name', 'label': 'نام', 'type': 'text'},
            ],
            'documents': [
              {'key': 'meli', 'title': 'کارت ملی', 'required': true},
            ],
          },
        },
        'documents': [
          {
            'id': 'd1',
            'title': 'کارت ملی',
            'kind': 'customer',
            'status': 'rejected',
            'requirementKey': 'meli',
            'reviewNote': 'تار است',
            'file': {'id': 'f1', 'mime': 'image/jpeg'},
          },
          {
            'id': 'd2',
            'title': 'نتیجه',
            'kind': 'staff',
            'status': 'approved',
            'file': {'id': 'f2', 'mime': 'application/pdf'},
          },
        ],
        'invoices': [
          {'id': 'i1', 'total': 5000, 'paidAmount': 0, 'status': 'issued'},
          {'id': 'i2', 'total': 5000, 'paidAmount': 5000, 'status': 'paid'},
        ],
      });
      expect(detail.requirements.single.key, 'meli');
      expect(detail.formFields.single.key, 'name');
      expect(detail.deliveredFiles.single.id, 'd2');
      expect(detail.unpaidInvoices.single['id'], 'i1');
      expect(detail.canCancel, isTrue);
    });
  });

  group('AppConfig + banners', () {
    test('config defaults stay customer-friendly', () {
      final config = AppConfig.fromJson({});
      expect(config.passwordLogin, isTrue);
      expect(config.registrationOpen, isTrue);
      expect(config.bannersEnabled, isTrue);
      expect(config.forceUpdate, isFalse);
    });

    test('banners parse with their destination and keep an unusable kind safe', () {
      final service = AppBanner.fromJson({
        'id': 'b1',
        'kind': 'service',
        'title': 'تعویض پلاک',
        'subtitle': 'بدون صف',
        'destinationKind': 'service',
        'destinationSlug': 'plate-replacement-appointment',
        'accentColor': '#0EA5A4',
        'updatedAt': '2026-01-01T00:00:00Z',
      });
      expect(service.isService, isTrue);
      expect(service.destinationSlug, 'plate-replacement-appointment');
      expect(service.accentColor, const Color(0xFF0EA5A4));
      // No action label from the office falls back to a readable default
      // rather than an empty button.
      expect(service.actionLabel, 'مشاهده');

      // An unknown kind and an unknown destination must degrade to something
      // renderable: the rail is fed by the server, and a newer server must not
      // be able to crash an older app.
      final unknown = AppBanner.fromJson({'id': 'b2', 'kind': 'carousel', 'destinationKind': 'deeplink'});
      expect(unknown.kind, 'general');
      expect(unknown.destinationKind, 'none');
      expect(unknown.hasImage, isFalse);

      // A malformed colour is dropped, not parsed into black.
      expect(AppBanner.fromJson({'id': 'b3', 'accentColor': '#12345'}).accentColor, isNull);
    });

    test('the image cache key changes only when the banner does', () {
      AppBanner make(String updatedAt) => AppBanner.fromJson({
            'id': 'b1',
            'imageUrl': '/api/app/banners/b1/image',
            'updatedAt': updatedAt,
          });
      final first = make('2026-01-01T00:00:00Z');
      final same = make('2026-01-01T00:00:00Z');
      final edited = make('2026-02-02T00:00:00Z');
      // Same URL + same token == same cache entry: no re-download on relaunch.
      expect(first.imageCacheKey, same.imageCacheKey);
      // A replaced picture must produce a *different* URL or the disk cache
      // would serve the old one forever.
      expect(edited.imageCacheKey, isNot(first.imageCacheKey));
      expect(first.imageCacheKey, contains('/api/app/banners/b1/image'));
    });
  });
}
