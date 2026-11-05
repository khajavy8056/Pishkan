import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';

class MyDiscountsScreen extends StatefulWidget {
  const MyDiscountsScreen({super.key});
  @override
  State<MyDiscountsScreen> createState() => _MyDiscountsScreenState();
}

class _MyDiscountsScreenState extends State<MyDiscountsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final items = asMapList(await api.getData('/api/discount-codes/mine'));
      if (mounted) setState(() { _items = items; _loading = false; });
    } on ApiException catch (error) {
      if (mounted) setState(() { _loading = false; _error = error.message; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _error = 'دریافت تخفیف‌ها انجام نشد. اتصال و نسخه سرور را بررسی کنید.'; });
    }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('تخفیفات من')),
    body: _loading ? const Center(child: CircularProgressIndicator()) : _error != null
      ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Text(_error!), TextButton(onPressed: _load, child: const Text('تلاش دوباره'))]))
      : RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('کد را هنگام ثبت درخواست وارد کنید؛ شرایط خدمت و مبلغ هنگام ثبت بررسی می‌شود.', style: TextStyle(height: 1.8)),
        const SizedBox(height: 12),
        if (_items.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('در حال حاضر تخفیفی برای شما نمایش داده نشده است.', textAlign: TextAlign.center)),
        for (final item in _items) Padding(padding: const EdgeInsets.only(bottom: 12), child: SoftCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Expanded(child: Text(asStr(item['title']), style: const TextStyle(fontWeight: FontWeight.bold))), Text(asBool(item['usable']) ? 'قابل استفاده با رعایت شرایط' : 'فعلاً غیرقابل استفاده', style: TextStyle(color: asBool(item['usable']) ? PishkanColors.success : PishkanColors.danger, fontSize: 11))]),
          const SizedBox(height: 8),
          Text('${asStr(item['type']) == 'percent' ? '${faDigits(item['value'])}٪' : faMoney(asNum(item['value']))} · ${asStr(item['serviceTitle']).isNotEmpty ? asStr(item['serviceTitle']) : asStr(item['categoryTitle']).isNotEmpty ? asStr(item['categoryTitle']) : 'همه خدمات'}'),
          if (asStr(item['audience']) == 'first_purchase') const Text('ویژه خرید اول', style: TextStyle(fontSize: 12)),
          if (item['expiresAt'] != null) Text('تا ${faDateNumeric(item['expiresAt'])}', style: const TextStyle(fontSize: 12)),
          TextButton.icon(onPressed: () async { await Clipboard.setData(ClipboardData(text: asStr(item['code']))); if (context.mounted) showSnack(context, 'کد تخفیف کپی شد.'); }, icon: const Icon(Icons.copy_rounded, size: 17), label: Text(asStr(item['code']))),
        ]))),
      ])),
  );
}
