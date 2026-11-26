import 'package:flutter/material.dart';
import 'package:shamsi_date/shamsi_date.dart';

import '../core/format.dart';
import '../core/theme.dart';

/// A Jalali month grid for picking a date, returning the ISO string the API
/// stores.
///
/// ## Why this file exists
///
/// The phone used Material's `showDatePicker` with `locale: const Locale('fa')`.
/// That gives you Persian digits and translated month names around a *Gregorian*
/// month grid — and the range was `firstDate: DateTime(1300), lastDate:
/// DateTime(2100)`, which are Gregorian years. So a person choosing «۱۴۰۴/۰۹/۰۱»
/// was choosing the 1st of the 9th month of a year numbered 1404 *in the
/// Gregorian calendar*, and the label shown afterwards named a different day than
/// the one they had tapped. The office put it plainly: «تقویم که باز می‌شد میلادی
/// بود».
///
/// ## What stays the same
///
/// Only the *face* of the field is Jalali. The value returned is `yyyy-MM-dd`
/// Gregorian — the string every other client sends, every filter compares and
/// every report formats — so no migration and no second date format anywhere in
/// the system. Conversion in both directions goes through `shamsi_date`, the same
/// library [faDateNumeric] uses for the labels, which is what keeps the grid and
/// the text under it from ever disagreeing about which day is which.
///
/// Month lengths are read off the calendar (month 12 absorbs the leap day)
/// instead of from a table, and every weekday/leading-cell computation goes
/// through UTC day numbers, so a device set to a daylight-saving timezone cannot
/// shift the whole month by one cell.
Future<String?> showJalaliDatePicker(
  BuildContext context, {
  String? initialIso,
  DateTime? firstDate,
  DateTime? lastDate,
  bool clearable = false,
}) {
  return showDialog<String>(
    context: context,
    builder: (dialogContext) => _JalaliDateDialog(
      initialIso: initialIso,
      firstDate: firstDate,
      lastDate: lastDate,
      clearable: clearable,
    ),
  );
}

/// `yyyy-MM-dd` for a local date, from its parts.
///
/// `toIsoString()` is not used on purpose: it renders the value in UTC, so a
/// picker opened shortly after midnight local time would hand back yesterday.
String isoOfDate(DateTime date) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${date.year.toString().padLeft(4, '0')}-${two(date.month)}-${two(date.day)}';
}

/// A civil day number, so ranges and weekday offsets compare without timezones.
int _dayNumber(DateTime value) =>
    DateTime.utc(value.year, value.month, value.day).millisecondsSinceEpoch ~/ Duration.millisecondsPerDay;

DateTime _dateOfJalali(int jy, int jm, int jd) => Jalali(jy, jm, jd).toDateTime();

/// Days in a Jalali month: six of 31, five of 30, and the last one carrying the
/// leap day — measured from one Nowruz to the next rather than assumed.
int jalaliMonthLength(int jy, int jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return _dayNumber(_dateOfJalali(jy + 1, 1, 1)) - _dayNumber(_dateOfJalali(jy, 1, 1)) - 336;
}

/// How many empty cells come before day 1, in a Saturday-first row.
int _leadingCells(int jy, int jm) => _dateOfJalali(jy, jm, 1).weekday % 7;

class _JalaliDateDialog extends StatefulWidget {
  const _JalaliDateDialog({
    this.initialIso,
    this.firstDate,
    this.lastDate,
    this.clearable = false,
  });

  final String? initialIso;
  final DateTime? firstDate;
  final DateTime? lastDate;
  final bool clearable;

  @override
  State<_JalaliDateDialog> createState() => _JalaliDateDialogState();
}

class _JalaliDateDialogState extends State<_JalaliDateDialog> {
  late final int _minDay;
  late final int _maxDay;
  late final int _selectedDay;
  late final int _todayDay;
  late int _jy;
  late int _jm;

  @override
  void initState() {
    super.initState();
    // Bounds in *Jalali* years — `DateTime(1300)` reads as a sane guard rail and
    // is in fact 700 years of Gregorian months.
    _minDay = _dayNumber(widget.firstDate ?? _dateOfJalali(1300, 1, 1));
    _maxDay = _dayNumber(widget.lastDate ?? _dateOfJalali(1450, 12, 30));

    final anchor = (widget.initialIso == null ? null : DateTime.tryParse(widget.initialIso!)) ?? DateTime.now();
    final jalali = Jalali.fromDateTime(anchor);
    _jy = jalali.year;
    _jm = jalali.month;
    // Compared as day numbers, so a stored date and the grid can only ever agree
    // on one cell being "the one you picked".
    _selectedDay = widget.initialIso == null ? 0 : _dayNumber(anchor);
    _todayDay = _dayNumber(DateTime.now());
  }

  void _shiftMonths(int months) {
    setState(() {
      var jy = _jy;
      var jm = _jm + months;
      while (jm < 1) {
        jm += 12;
        jy -= 1;
      }
      while (jm > 12) {
        jm -= 12;
        jy += 1;
      }
      _jy = jy;
      _jm = jm;
    });
  }

  void _closeWith(String value) => Navigator.pop(context, value);

  @override
  Widget build(BuildContext context) {
    final length = jalaliMonthLength(_jy, _jm);
    final leading = _leadingCells(_jy, _jm);
    final weekRows = ((leading + length) / 7).ceil();
    final rows = weekRows + 1; // + the weekday header

    return AlertDialog(
      contentPadding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      actionsPadding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
      content: SizedBox(
        width: 316,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                IconButton(
                  tooltip: 'ماه بعد',
                  onPressed: () => _shiftMonths(1),
                  icon: const Icon(Icons.chevron_left_rounded),
                ),
                IconButton(
                  tooltip: 'ماه قبل',
                  onPressed: () => _shiftMonths(-1),
                  icon: const Icon(Icons.chevron_right_rounded),
                ),
                Expanded(
                  child: Center(
                    child: Text(
                      faDigits('${jalaliMonthNames[_jm - 1]} $_jy'),
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'یک سال قبل',
                  onPressed: () => _shiftMonths(-12),
                  icon: const Icon(Icons.keyboard_double_arrow_right_rounded),
                ),
                IconButton(
                  tooltip: 'یک سال بعد',
                  onPressed: () => _shiftMonths(12),
                  icon: const Icon(Icons.keyboard_double_arrow_left_rounded),
                ),
              ],
            ),
            SizedBox(
              height: rows * 40.0,
              child: GridView.builder(
                padding: EdgeInsets.zero,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7, childAspectRatio: 1),
                itemCount: rows * 7,
                itemBuilder: (context, index) {
                  if (index < 7) {
                    return Center(
                      child: Text(
                        jalaliWeekdayShort[index],
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: PishkanColors.mutedText),
                      ),
                    );
                  }
                  final jd = index - 7 - leading + 1;
                  if (jd < 1 || jd > length) return const SizedBox.shrink();
                  final dayNumber = _dayNumber(_dateOfJalali(_jy, _jm, jd));
                  final enabled = dayNumber >= _minDay && dayNumber <= _maxDay;
                  final isSelected = _selectedDay != 0 && dayNumber == _selectedDay;
                  final isToday = dayNumber == _todayDay;
                  return Material(
                    color: isSelected ? PishkanColors.primary : Colors.transparent,
                    shape: CircleBorder(
                      side: !isSelected && isToday
                          ? const BorderSide(color: PishkanColors.primary)
                          : BorderSide.none,
                    ),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: enabled ? () => _closeWith(isoOfDate(_dateOfJalali(_jy, _jm, jd))) : null,
                      child: Center(
                        child: Text(
                          faDigits('$jd'),
                          style: TextStyle(
                            fontSize: 13,
                            color: !enabled
                                ? PishkanColors.mutedText.withValues(alpha: 0.45)
                                : (isSelected ? Colors.white : null),
                            fontWeight: isSelected || isToday ? FontWeight.w700 : FontWeight.w500,
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
      actions: [
        if (widget.clearable) TextButton(onPressed: () => _closeWith(''), child: const Text('پاک کردن')),
        TextButton(
          onPressed: () {
            final now = DateTime.now();
            if (_dayNumber(now) < _minDay || _dayNumber(now) > _maxDay) return;
            _closeWith(isoOfDate(now));
          },
          child: const Text('امروز'),
        ),
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('بستن')),
      ],
    );
  }
}
