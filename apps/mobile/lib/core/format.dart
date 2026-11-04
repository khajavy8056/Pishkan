import 'package:shamsi_date/shamsi_date.dart';

const _faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const _jalaliMonths = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

String faDigits(Object? value) {
  final text = '${value ?? ''}';
  final buffer = StringBuffer();
  for (final rune in text.runes) {
    final char = String.fromCharCode(rune);
    final index = '0123456789'.indexOf(char);
    buffer.write(index >= 0 ? _faDigits[index] : char);
  }
  return buffer.toString();
}

/// Convert Persian/Arabic digits in user input back to Latin for the API.
String enDigits(Object? value) {
  final text = '${value ?? ''}';
  final buffer = StringBuffer();
  for (final rune in text.runes) {
    final char = String.fromCharCode(rune);
    var index = _faDigits.indexOf(char);
    if (index < 0) index = '٠١٢٣٤٥٦٧٨٩'.split('').indexOf(char);
    buffer.write(index >= 0 ? '$index' : char);
  }
  return buffer.toString();
}

String groupThousands(num value) {
  final negative = value < 0;
  final digits = value.abs().round().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('٬');
    buffer.write(digits[i]);
  }
  return '${negative ? '−' : ''}${buffer.toString()}';
}

/// Money is stored in rials on the server; the customer UI shows tomans.
String faMoney(num? rials) {
  if (rials == null) return '—';
  return '${faDigits(groupThousands(rials / 10))} تومان';
}

DateTime? parseServerDate(Object? value) {
  if (value == null) return null;
  final text = value.toString().trim();
  if (text.isEmpty) return null;
  var parsed = DateTime.tryParse(text);
  if (parsed == null) parsed = DateTime.tryParse(text.replaceFirst(' ', 'T'));
  return parsed?.toLocal();
}

String faDate(Object? value, {bool withTime = false}) {
  final date = value is DateTime ? value : parseServerDate(value);
  if (date == null) return '—';
  final jalali = Jalali.fromDateTime(date);
  final base = '${jalali.day} ${_jalaliMonths[jalali.month - 1]} ${jalali.year}';
  if (!withTime) return faDigits(base);
  final hh = date.hour.toString().padLeft(2, '0');
  final mm = date.minute.toString().padLeft(2, '0');
  return faDigits('$base · ساعت $hh:$mm');
}

String faFileSize(num? bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return faDigits('${bytes.round()} بایت');
  if (bytes < 1024 * 1024) return faDigits('${(bytes / 1024).toStringAsFixed(0)} کیلوبایت');
  return faDigits('${(bytes / (1024 * 1024)).toStringAsFixed(1)} مگابایت');
}

/// Iranian national code check digit validation (matches the web panel).
bool validNationalId(String input) {
  final code = enDigits(input).trim();
  if (!RegExp(r'^\d{10}$').hasMatch(code)) return false;
  if (RegExp(r'^(\d)\1{9}$').hasMatch(code)) return false;
  var sum = 0;
  for (var i = 0; i < 9; i++) {
    sum += int.parse(code[i]) * (10 - i);
  }
  final remainder = sum % 11;
  final checkDigit = int.parse(code[9]);
  return remainder < 2 ? checkDigit == remainder : checkDigit == 11 - remainder;
}

/// Iranian IBAN (Sheba) validation.
bool validIban(String input) {
  final value = enDigits(input).replaceAll(' ', '').toUpperCase();
  if (!RegExp(r'^IR\d{24}$').hasMatch(value)) return false;
  final rearranged = '${value.substring(4)}1827${value.substring(2, 4)}';
  var remainder = BigInt.zero;
  for (var i = 0; i < rearranged.length; i += 7) {
    final chunk = '${remainder.toString()}${rearranged.substring(i, (i + 7 > rearranged.length) ? rearranged.length : i + 7)}';
    remainder = BigInt.parse(chunk) % BigInt.from(97);
  }
  return remainder == BigInt.one;
}

bool validIranMobile(String input) => RegExp(r'^09\d{9}$').hasMatch(enDigits(input).trim());
