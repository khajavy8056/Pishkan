import 'package:flutter_test/flutter_test.dart';
import 'package:pishkan_app/core/format.dart';
import 'package:pishkan_app/widgets/jalali_date_picker.dart';
import 'package:shamsi_date/shamsi_date.dart';

/// The calendar arithmetic the date picker is built on.
///
/// The bug these guard is the one the office reported: the value was Persian while
/// the calendar that opened was Gregorian. A picker that draws Persian digits
/// around the wrong month passes a glance and fails a person, so what is asserted
/// here is the two things that cannot both be true of a Gregorian grid: the month
/// lengths of the Jalali calendar, and that a day put into the grid comes back out
/// as the same day the labels would print.
void main() {
  test('the first eleven months are fixed and Esfand carries the leap day', () {
    for (var month = 1; month <= 6; month++) {
      expect(jalaliMonthLength(1404, month), 31, reason: 'month $month');
    }
    for (var month = 7; month <= 11; month++) {
      expect(jalaliMonthLength(1404, month), 30, reason: 'month $month');
    }
    // Esfand is 29 or 30 depending on the year — measured, not assumed, which is
    // what makes a hand-written table unnecessary here.
    expect(jalaliMonthLength(1403, 12) + jalaliMonthLength(1404, 12), anyOf(58, 59));
    var yearLength = 0;
    for (var month = 1; month <= 12; month++) {
      yearLength += jalaliMonthLength(1404, month);
    }
    expect(yearLength, greaterThanOrEqualTo(365));
    expect(yearLength, lessThanOrEqualTo(366));
  });

  test('a day picked in the grid is the day the label prints', () {
    for (var year = 1399; year <= 1407; year++) {
      for (final month in [1, 6, 7, 11, 12]) {
        final last = jalaliMonthLength(year, month);
        for (final day in [1, (last + 1) ~/ 2, last]) {
          final iso = isoOfDate(Jalali(year, month, day).toDateTime());
          final back = Jalali.fromDateTime(DateTime.parse(iso));
          expect([back.year, back.month, back.day], [year, month, day], reason: '$iso from $year/$month/$day');
        }
      }
    }
  });

  test('the value the form stores is always a plain civil date', () {
    expect(isoOfDate(DateTime(2025, 11, 22, 23, 59, 59)), '2025-11-22');
    expect(isoOfDate(DateTime(2025, 1, 1)), '2025-01-01');
    // Never the UTC rendering, which is what `toIsoString()` would have written.
    expect(isoOfDate(DateTime(2026, 3, 21, 0, 30)).length, 10);
  });

  test('the picker and the labels share one list of month names', () {
    expect(jalaliMonthNames.length, 12);
    expect(jalaliMonthNames.first, 'فروردین');
    expect(jalaliMonthNames.last, 'اسفند');
    expect(jalaliWeekdayShort.length, 7);
    // Saturday first, in the one-letter form the grid has room for.
    expect(jalaliWeekdayShort.first, 'ش');
    expect(jalaliWeekdayShort.last, 'ج');
  });
}
