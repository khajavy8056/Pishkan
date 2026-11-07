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

  group('AppConfig + stories', () {
    test('config defaults stay customer-friendly', () {
      final config = AppConfig.fromJson({});
      expect(config.passwordLogin, isTrue);
      expect(config.registrationOpen, isTrue);
      expect(config.storiesEnabled, isTrue);
      expect(config.forceUpdate, isFalse);
    });

    test('story groups parse', () {
      final group = StoryGroup.fromJson({
        'title': 'تعطیلی پنجشنبه',
        'items': [
          {'id': 's1', 'mediaType': 'video', 'mediaUrl': '/api/app/stories/s1/media', 'durationSeconds': 60},
        ],
      });
      expect(group.items.single.isVideo, isTrue);
      expect(group.items.single.durationSeconds, 30); // clamped
      expect(group.items.single.effectiveMediaUrl, '/api/app/stories/s1/media');
    });
  });
}
