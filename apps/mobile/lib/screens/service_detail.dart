import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'request_form.dart';

/// Service detail: price, description and the required-document list, all
/// straight from the backend so office edits appear immediately.
class ServiceDetailScreen extends StatefulWidget {
  const ServiceDetailScreen({super.key, required this.service});

  final CatalogService service;

  @override
  State<ServiceDetailScreen> createState() => _ServiceDetailScreenState();
}

class _ServiceDetailScreenState extends State<ServiceDetailScreen> {
  late CatalogService _service;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _service = widget.service;
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    try {
      final detail = await fetchServiceDetail(widget.service.slug.isEmpty ? widget.service.id : widget.service.slug);
      if (mounted) setState(() => _service = detail);
    } catch (_) {
      // Keep the list DTO when offline and nothing was cached for the detail.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final service = _service;
    final image = asStr(service.raw['imageUrl']).isEmpty ? asStr(service.raw['coverUrl']) : asStr(service.raw['imageUrl']);
    return Scaffold(
      appBar: AppBar(title: Text(service.title, overflow: TextOverflow.ellipsis)),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 6, 16, 110), children: [
        if (image.isNotEmpty) ...[
          ClipRRect(borderRadius: BorderRadius.circular(22), child: AuthImage(url: image, height: 190)),
          const SizedBox(height: 14),
        ],
        SoftCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              IconMedallion(icon: service.icon, size: 58),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(service.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: PishkanColors.navy, height: 1.4)),
                  if (service.subtitle.isNotEmpty) Text(service.subtitle, style: const TextStyle(fontSize: 12, color: PishkanColors.mutedText)),
                  const SizedBox(height: 4),
                  Text(service.categoryTitle, style: const TextStyle(fontSize: 11.5, color: PishkanColors.primary, fontWeight: FontWeight.w600)),
                ]),
              ),
            ]),
            if (service.displayDescription.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(service.displayDescription, style: const TextStyle(fontSize: 13.5, height: 2, color: Color(0xFF334155))),
            ],
            const Divider(height: 28),
            _priceRow('کارمزد خدمت', faMoney(service.baseFee)),
            if (service.discountPercent > 0) _priceRow('تخفیف (${faDigits(service.discountPercent)}٪)', '−${faMoney(service.baseFee * service.discountPercent / 100)}'),
            if (service.taxPercent > 0) _priceRow('مالیات بر ارزش افزوده (${faDigits(service.taxPercent)}٪)', faMoney((service.baseFee - service.baseFee * service.discountPercent / 100) * service.taxPercent / 100)),
            const SizedBox(height: 6),
            Row(children: [
              const Text('مبلغ قابل پرداخت', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14)),
              const Spacer(),
              Text(faMoney(service.computedTotal), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: PishkanColors.primary)),
            ]),
            if (service.estimatedDays > 0) ...[
              const SizedBox(height: 8),
              Row(children: [
                const Icon(Icons.schedule_rounded, size: 17, color: PishkanColors.mutedText),
                const SizedBox(width: 6),
                Text('زمان تقریبی انجام: حدود ${faDigits(service.estimatedDays)} روز کاری', style: const TextStyle(fontSize: 12, color: PishkanColors.mutedText)),
              ]),
            ],
            if (service.urgentAvailable) ...[
              const SizedBox(height: 8),
              Row(children: [
                const Icon(Icons.bolt_rounded, size: 17, color: PishkanColors.warning),
                const SizedBox(width: 6),
                Text('انجام فوری هم ممکن است (در مرحلهٔ ثبت انتخاب می‌شود).', style: const TextStyle(fontSize: 12, color: PishkanColors.mutedText)),
              ]),
            ],
          ]),
        ),
        if (_loading) const Padding(padding: EdgeInsets.all(24), child: LoadingView()),
        if (service.requirements.isNotEmpty) ...[
          const SectionTitle(title: 'مدارک موردنیاز'),
          SoftCard(
            child: Column(children: [
              for (var i = 0; i < service.requirements.length; i++) ...[
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(service.requirements[i].required ? Icons.description_rounded : Icons.description_outlined, color: PishkanColors.primary, size: 21),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(service.requirements[i].title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13))),
                        StatusChip(label: service.requirements[i].required ? 'الزامی' : 'اختیاری', status: service.requirements[i].required ? 'unpaid' : 'paid'),
                      ]),
                      if (service.requirements[i].description.isNotEmpty)
                        Text(service.requirements[i].description, style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.8)),
                    ]),
                  ),
                ]),
                if (i < service.requirements.length - 1) const Divider(height: 22),
              ],
            ]),
          ),
        ],
        const SectionTitle(title: 'مراحل کار'),
        const SoftCard(
          child: Column(children: [
            _StepRow(number: '۱', text: 'فرم خدمت را تکمیل و مدارک را بارگذاری می‌کنید.'),
            Divider(height: 20),
            _StepRow(number: '۲', text: 'کارشناس دفتر مدارک را بررسی می‌کند؛ اگر چیزی لازم بود همین‌جا به شما اطلاع می‌دهد.'),
            Divider(height: 20),
            _StepRow(number: '۳', text: 'نتیجهٔ نهایی داخل همین پرونده تحویل شما می‌شود و می‌توانید آن را دانلود کنید.'),
          ]),
        ),
      ]),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
          child: PlushButton(
            label: 'ثبت درخواست این خدمت',
            icon: Icons.assignment_add,
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => RequestFormScreen(service: service))),
          ),
        ),
      ),
    );
  }

  Widget _priceRow(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Text(label, style: const TextStyle(fontSize: 12.5, color: PishkanColors.mutedText)),
          const Spacer(),
          Text(value, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
        ]),
      );
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.number, required this.text});
  final String number;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        width: 28,
        height: 28,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: PishkanColors.primary.withOpacity(0.12), shape: BoxShape.circle),
        child: Text(number, style: const TextStyle(fontWeight: FontWeight.w800, color: PishkanColors.primary, fontSize: 13)),
      ),
      const SizedBox(width: 10),
      Expanded(child: Text(text, style: const TextStyle(fontSize: 12.5, height: 1.9))),
    ]);
  }
}
