import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../models/models.dart';
import '../services/services.dart';
import 'widgets.dart';

/// Renders a service's backend-defined form exactly like the web checkout:
/// the office changes fields/validation in the admin panel and the app
/// follows with no new release. Values live in [values]; call [validate]
/// on the state before submitting.
class DynamicForm extends StatefulWidget {
  const DynamicForm({super.key, required this.fields, required this.values});

  final List<FormFieldDef> fields;
  final Map<String, dynamic> values;

  @override
  State<DynamicForm> createState() => DynamicFormState();
}

class DynamicFormState extends State<DynamicForm> {
  final Map<String, TextEditingController> _controllers = {};
  final Set<String> _uploading = {};
  final Map<String, String> _fileNames = {};
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final field in widget.fields) {
      if (_isTextual(field.type)) {
        _controllers[field.key] = TextEditingController(text: '${widget.values[field.key] ?? ''}');
      }
      if (field.type == 'checkbox' && field.options.isNotEmpty) {
        widget.values[field.key] ??= <String>[];
      }
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  bool _isTextual(String type) => ['text', 'tel', 'number', 'national_id', 'textarea', 'money', 'iban', 'postal_code'].contains(type);

  /// Fill only empty text fields with exactly matching profile keys. Never
  /// infer that another person's national ID belongs to the account owner.
  int fillEmptyFromProfile(Map<String, dynamic> values) {
    var count = 0;
    for (final field in widget.fields) {
      final controller = _controllers[field.key];
      final value = values[field.key]?.toString().trim() ?? '';
      if (controller == null || controller.text.trim().isNotEmpty || value.isEmpty) continue;
      controller.text = value;
      widget.values[field.key] = value;
      count++;
    }
    if (count > 0) setState(() {});
    return count;
  }

  /// Returns the first validation error (Persian) or null when valid.
  /// Also commits text-controller values into the values map.
  String? validate() {
    for (final field in widget.fields) {
      if (_isTextual(field.type)) {
        final raw = enDigits(_controllers[field.key]?.text ?? '').trim();
        widget.values[field.key] = field.type == 'money' || field.type == 'number'
            ? (num.tryParse(raw.replaceAll(RegExp(r'[^0-9.]'), '')) ?? (raw.isEmpty ? '' : raw))
            : raw;
      }
      final value = widget.values[field.key];
      final empty = value == null || (value is String && value.trim().isEmpty) || (value is List && value.isEmpty) || (field.type == 'checkbox' && field.options.isEmpty && value != true);
      if (field.required && empty) {
        _error = '«${field.label}» لازم است.';
        setState(() {});
        return _error;
      }
      if (empty) continue;
      final text = value.toString();
      switch (field.type) {
        case 'national_id':
          if (!validNationalId(text)) return _fail('کد ملی واردشده در «${field.label}» معتبر نیست.');
          break;
        case 'iban':
          if (!validIban(text)) return _fail('شماره شبا در «${field.label}» معتبر نیست.');
          break;
        case 'postal_code':
          if (!RegExp(r'^\d{10}$').hasMatch(text)) return _fail('کد پستی در «${field.label}» باید ۱۰ رقم باشد.');
          break;
        case 'tel':
          if (!validIranMobile(text) && !RegExp(r'^0\d{10}$').hasMatch(text)) return _fail('شماره تلفن در «${field.label}» معتبر نیست.');
          break;
        case 'money':
        case 'number':
          if (num.tryParse(text) == null) return _fail('«${field.label}» باید عددی باشد.');
          break;
      }
      if (field.maxLength > 0 && text.length > field.maxLength) {
        return _fail('«${field.label}» طولانی‌تر از حد مجاز است.');
      }
    }
    _error = null;
    setState(() {});
    return null;
  }

  String _fail(String message) {
    _error = message;
    setState(() {});
    return message;
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final field in widget.fields) ...[
        _fieldWidget(field),
        const SizedBox(height: 14),
      ],
      if (_error != null)
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: const Color(0xFFFEE2E2), borderRadius: BorderRadius.circular(14)),
          child: Text(_error!, style: const TextStyle(color: Color(0xFF991B1B), fontSize: 12.5)),
        ),
    ]);
  }

  Widget _label(FormFieldDef field) => Padding(
        padding: const EdgeInsets.only(bottom: 7),
        child: Row(children: [
          Expanded(
            child: Text.rich(TextSpan(children: [
              TextSpan(text: field.label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
              if (field.required) const TextSpan(text: ' *', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w700)),
            ])),
          ),
        ]),
      );

  Widget _help(FormFieldDef field) => field.help.isEmpty
      ? const SizedBox.shrink()
      : Padding(
          padding: const EdgeInsets.only(top: 5),
          child: Text(field.help, style: const TextStyle(fontSize: 11.5, color: Color(0xFF64748B), height: 1.7)),
        );

  Widget _fieldWidget(FormFieldDef field) {
    switch (field.type) {
      case 'select':
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _label(field),
          DropdownButtonFormField<String>(
            value: widget.values[field.key]?.toString().isNotEmpty == true ? widget.values[field.key].toString() : null,
            items: field.options.map((o) => DropdownMenuItem(value: o, child: Text(o))).toList(),
            onChanged: (v) => setState(() => widget.values[field.key] = v ?? ''),
            decoration: InputDecoration(hintText: field.placeholder.isEmpty ? 'انتخاب کنید' : field.placeholder),
          ),
          _help(field),
        ]);
      case 'radio':
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _label(field),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final option in field.options)
              ChoiceChip(
                label: Text(option),
                selected: widget.values[field.key]?.toString() == option,
                onSelected: (_) => setState(() => widget.values[field.key] = option),
              ),
          ]),
          _help(field),
        ]);
      case 'checkbox':
        if (field.options.isEmpty) {
          return CheckboxListTile(
            value: widget.values[field.key] == true,
            onChanged: (v) => setState(() => widget.values[field.key] = v == true),
            title: Text(field.label, style: const TextStyle(fontSize: 13.5)),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          );
        }
        final selected = (widget.values[field.key] is List ? (widget.values[field.key] as List) : const []).map((e) => e.toString()).toList();
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _label(field),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final option in field.options)
              FilterChip(
                label: Text(option),
                selected: selected.contains(option),
                onSelected: (on) => setState(() {
                  final next = [...selected];
                  if (on) {
                    next.add(option);
                  } else {
                    next.remove(option);
                  }
                  widget.values[field.key] = next;
                }),
              ),
          ]),
          _help(field),
        ]);
      case 'date':
        final raw = '${widget.values[field.key] ?? ''}';
        final parsed = DateTime.tryParse(raw);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _label(field),
          InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: parsed ?? DateTime.now(),
                firstDate: DateTime(1300),
                lastDate: DateTime(2100),
                locale: const Locale('fa', 'IR'),
              );
              if (picked != null) {
                setState(() => widget.values[field.key] = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}');
              }
            },
            child: InputDecorator(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.calendar_month_rounded)),
              child: Text(parsed == null ? (field.placeholder.isEmpty ? 'انتخاب تاریخ' : field.placeholder) : faDate(parsed), style: TextStyle(color: parsed == null ? const Color(0xFF94A3B8) : null)),
            ),
          ),
          _help(field),
        ]);
      case 'file':
        final fileId = '${widget.values[field.key] ?? ''}';
        final busy = _uploading.contains(field.key);
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _label(field),
          OutlinedButton.icon(
            onPressed: busy ? null : () => _uploadField(field),
            icon: busy
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(fileId.isEmpty ? Icons.upload_file_rounded : Icons.check_circle_rounded),
            label: Text(busy ? 'در حال بارگذاری…' : fileId.isEmpty ? 'بارگذاری فایل' : (_fileNames[field.key] ?? 'فایل بارگذاری شد — برای جایگزینی بزنید')),
          ),
          _help(field),
        ]);
      default:
        final isMoney = field.type == 'money';
        final keyboard = switch (field.type) {
          'tel' || 'national_id' || 'postal_code' => TextInputType.phone,
          'number' || 'money' => TextInputType.number,
          'iban' => TextInputType.text,
          _ => TextInputType.text,
        };
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _label(field),
          TextField(
            controller: _controllers[field.key],
            keyboardType: keyboard,
            maxLines: field.type == 'textarea' ? 4 : 1,
            maxLength: field.maxLength > 0 ? field.maxLength : null,
            inputFormatters: (field.type == 'national_id' || field.type == 'postal_code') ? [LengthLimitingTextInputFormatter(10)] : null,
            decoration: InputDecoration(
              hintText: field.placeholder,
              suffixText: isMoney ? 'تومان' : null,
              counterText: '',
            ),
          ),
          _help(field),
        ]);
    }
  }

  Future<void> _uploadField(FormFieldDef field) async {
    final file = await pickDocumentFile(context);
    if (file == null) return;
    setState(() => _uploading.add(field.key));
    try {
      final fileId = await uploadOne(file);
      widget.values[field.key] = fileId;
      _fileNames[field.key] = file.path.split('/').last;
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } catch (_) {
      if (mounted) showSnack(context, 'بارگذاری انجام نشد. دوباره تلاش کنید.', error: true);
    } finally {
      if (mounted) setState(() => _uploading.remove(field.key));
    }
  }
}
