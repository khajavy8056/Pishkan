import 'dart:async';

import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'service_detail.dart';

/// Public catalog browser with search + category chips. Reads the same
/// endpoints as the website and falls back to the local cache offline.
class ServicesCatalogTab extends StatefulWidget {
  const ServicesCatalogTab({super.key});

  @override
  State<ServicesCatalogTab> createState() => _ServicesCatalogTabState();
}

class _ServicesCatalogTabState extends State<ServicesCatalogTab> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<ServiceCategory> _categories = const [];
  List<CatalogService> _services = const [];
  String _categorySlug = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final categories = await fetchCategories();
    final services = await fetchServices(category: _categorySlug, search: _search.text.trim());
    if (!mounted) return;
    setState(() {
      _categories = categories;
      _services = services;
      _loading = false;
    });
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _load);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('خدمات')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: TextField(
            controller: _search,
            onChanged: _onSearchChanged,
            decoration: InputDecoration(
              hintText: 'جستجوی خدمت…',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _search.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () {
                        _search.clear();
                        _load();
                      },
                    ),
            ),
          ),
        ),
        SizedBox(
          height: 44,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              Padding(
                padding: const EdgeInsetsDirectional.only(end: 8),
                child: ChoiceChip(
                  label: const Text('همه'),
                  selected: _categorySlug.isEmpty,
                  onSelected: (_) {
                    setState(() => _categorySlug = '');
                    _load();
                  },
                ),
              ),
              for (final category in _categories)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 8),
                  child: ChoiceChip(
                    label: Text('${category.icon} ${category.title}'.trim()),
                    selected: _categorySlug == category.slug,
                    onSelected: (_) {
                      setState(() => _categorySlug = category.slug);
                      _load();
                    },
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Expanded(
          child: _loading
              ? const LoadingView()
              : _services.isEmpty
                  ? const EmptyView(icon: Icons.search_off_rounded, title: 'خدمتی پیدا نشد', hint: 'واژهٔ دیگری را امتحان کنید یا دستهٔ «همه» را انتخاب کنید.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 6, 16, 20),
                        itemCount: _services.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final service = _services[index];
                          return SoftCard(
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ServiceDetailScreen(service: service))),
                            child: Row(children: [
                              IconMedallion(icon: service.icon),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(service.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                                  const SizedBox(height: 3),
                                  Text(
                                    service.subtitle.isEmpty ? service.categoryTitle : service.subtitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText),
                                  ),
                                  const SizedBox(height: 6),
                                  Row(children: [
                                    Text(faMoney(service.computedTotal), style: const TextStyle(fontWeight: FontWeight.w800, color: PishkanColors.primary, fontSize: 12.5)),
                                    if (service.discountPercent > 0) ...[
                                      const SizedBox(width: 8),
                                      StatusChip(label: '${faDigits(service.discountPercent)}٪ تخفیف', status: 'paid'),
                                    ],
                                    if (service.estimatedDays > 0) ...[
                                      const Spacer(),
                                      Text('حدود ${faDigits(service.estimatedDays)} روز', style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
                                    ],
                                  ]),
                                ]),
                              ),
                              const Icon(Icons.chevron_left_rounded, color: PishkanColors.mutedText),
                            ]),
                          );
                        },
                      ),
                    ),
        ),
      ]),
    );
  }
}
