import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/env.dart';
import 'package:pishkan_app/core/format.dart';
import 'package:pishkan_app/services/services.dart' show compareVersions;

void main() {
  group('digits', () {
    test('latin to Persian and back', () {
      expect(faDigits('09123456789'), '۰۹۱۲۳۴۵۶۷۸۹');
      expect(enDigits('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
      expect(enDigits('٠٩١٢'), '0912');
    });
  });

  group('money', () {
    test('rials render as grouped tomans', () {
      expect(faMoney(1500000), '۱۵۰٬۰۰۰ تومان');
      expect(faMoney(0), '۰ تومان');
      expect(faMoney(null), '—');
    });

    test('grouping', () {
      expect(groupThousands(1234567), '1٬234٬567');
      expect(groupThousands(999), '999');
    });
  });

  group('validators', () {
    test('national id checksum', () {
      // 0499370899 is a well-known structurally-valid sample code.
      expect(validNationalId('0499370899'), isTrue);
      expect(validNationalId('0499370898'), isFalse);
      expect(validNationalId('1111111111'), isFalse);
      expect(validNationalId('123'), isFalse);
      expect(validNationalId('۰۴۹۹۳۷۰۸۹۹'), isTrue);
    });

    test('iban checksum', () {
      expect(validIban('IR820540102680020817909002'), isTrue);
      expect(validIban('IR820540102680020817909003'), isFalse);
      expect(validIban('IR123'), isFalse);
    });

    test('iran mobile', () {
      expect(validIranMobile('09123456789'), isTrue);
      expect(validIranMobile('۰۹۱۲۳۴۵۶۷۸۹'), isTrue);
      expect(validIranMobile('08123456789'), isFalse);
    });
  });

  group('server url + versions', () {
    test('normalise typed server addresses', () {
      expect(normalizeBaseUrl('192.168.1.10:3000'), 'http://192.168.1.10:3000');
      expect(normalizeBaseUrl(' https://api.example.ir/ '), 'https://api.example.ir');
      expect(normalizeBaseUrl('10.0.2.2:3000'), 'http://10.0.2.2:3000');
      expect(normalizeBaseUrl(''), '');
    });

    test('semver-ish comparison', () {
      expect(compareVersions('1.0.0', '1.0.0'), 0);
      expect(compareVersions('1.2.0', '1.0.9'), greaterThan(0));
      expect(compareVersions('0.9.9', '1.0.0'), lessThan(0));
      expect(compareVersions('2', '1.9.9'), greaterThan(0));
    });
  });
}
