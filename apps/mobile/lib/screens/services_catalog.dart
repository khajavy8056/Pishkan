import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/service_icons.dart';
import '../core/motion.dart';
import '../core/sizes.dart';
import '../widgets/screen_header.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import '../widgets/category_card.dart';
import 'service_detail.dart';

/// «خدمات» tab: an image-led category chooser, followed by a service grid. Everything (titles, prices, order) comes
/// from the backend catalog; the service layer keeps the last good copy
/// cached for weak networks.
class ServicesCatalogTab extends StatefulWidget {
  const ServicesCatalogTab({super.key, this.initialCategorySlug = '', this.showBack = false});
  final String initialCategorySlug;
  final bool showBack;

  @override
  State<ServicesCatalogTab> createState() => _ServicesCatalogTabState();
}

class _ServicesCatalogTabState extends State<ServicesCatalogTab> {
  List<ServiceCategory> _categories = [];
  List<CatalogService> _services = [];
  String _categorySlug = '';
  bool _loading = true;
  String? _error;
  int _loadGeneration = 0;

  @override
  void initState() {
    super.initState();
    _categorySlug = widget.initialCategorySlug;
    _loadAll();
  }

  Future<void> _loadAll() async {
    try {
      final categories = await fetchCategories();
      if (mounted) setState(() => _categories = categories);
    } catch (_) {
      // The list can still load; category retrieval may be retried on refresh.
    }
    if (mounted) await _loadServices();
  }

  Future<void> _loadServices() async {
    final generation = ++_loadGeneration;
    final category = _categorySlug;
    setState(() { _loading = true; _error = null; });
    try {
      final services = await fetchServices(category: category);
      if (mounted && generation == _loadGeneration) {
        setState(() { _services = services; _loading = false; });
      }
    } on ApiException catch (error) {
      if (mounted && generation == _loadGeneration) {
        setState(() { _error = error.message; _loading = false; });
      }
    } catch (_) {
      if (mounted && generation == _loadGeneration) {
        setState(() { _error = 'دریافت خدمات انجام نشد.'; _loading = false; });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final sizes = context.sizes;
    final topInset = MediaQuery.paddingOf(context).top;
    return Scaffold(
      backgroundColor: context.surface,
      // Same blue sweep and floating pill as the home page, so the two tabs read
      // as one app rather than two screens that happen to share a palette.
      body: Stack(children: [
        Positioned(
          top: 0, left: 0, right: 0,
          child: BrandBackdrop(
            height: topInset + sizes.s(124),
            child: Column(children: [
              ScreenHeading(title: 'خدمات', onBack: widget.showBack ? () => Navigator.pop(context) : null),
              _searchPill(),
            ]),
          ),
        ),
        RefreshIndicator(
          onRefresh: _loadAll,
          edgeOffset: topInset + sizes.s(60),
          child: ListView(
            padding: EdgeInsets.fromLTRB(sizes.gutter, topInset + sizes.s(118), sizes.gutter, sizes.s(96)),
            children: [
              if (_categorySlug.isEmpty && _categories.isNotEmpty) ...[
                const SectionTitle(title: 'دسته‌بندی خدمات'),
                _categoryGrid(),
              ] else ...[
                if (_categorySlug.isNotEmpty)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () { setState(() { _categorySlug = ''; _services = []; }); _loadServices(); },
                      icon: Icon(Icons.arrow_forward_rounded, size: sizes.s(18)),
                      label: const Text('همه دسته‌بندی‌ها'),
                    ),
                  ),
                if (_loading && _services.isEmpty)
                  const Padding(padding: EdgeInsets.symmetric(vertical: 60), child: Center(child: CircularProgressIndicator()))
                else if (_error != null && _services.isEmpty)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 40), child: ErrorView(message: _error!, onRetry: _loadAll))
                else if (_services.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 40),
                    child: EmptyView(icon: Icons.grid_off_rounded, title: 'خدمتی در این دسته نیست', hint: 'دستهٔ دیگری را انتخاب کنید یا اتصال را بررسی و صفحه را به پایین بکشید.'),
                  )
                else
                  _grid(),
              ],
            ],
          ),
        ),
      ]),
    );
  }

  Widget _searchPill() {
    final sizes = context.sizes;
    return Padding(
      padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(6), sizes.gutter, 0),
      child: Material(
        color: context.surface,
        borderRadius: BorderRadius.circular(PishkanMetrics.radiusPill),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => Navigator.push(context, fadeThroughRoute(const ServiceSearchScreen())),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: sizes.s(16), vertical: sizes.s(12)),
            child: Row(children: [
              Icon(Icons.search_rounded, color: context.inkMuted, size: sizes.s(21)),
              SizedBox(width: sizes.s(8)),
              Text('جستجوی خدمت…', style: TextStyle(color: context.inkMuted, fontSize: sizes.body)),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _categoryGrid() {
    final sizes = context.sizes;
    final textScale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 1.6);
    return Column(children: [
      for (var i = 0; i < _categories.length; i += 2) ...[
        if (i > 0) SizedBox(height: sizes.gap),
        SizedBox(
          height: sizes.s(88),
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(child: CategoryCard(category: _categories[i], onTap: () => _openCategory(_categories[i]))),
            SizedBox(width: sizes.gap),
            Expanded(
              child: i + 1 < _categories.length
                  ? CategoryCard(category: _categories[i + 1], onTap: () => _openCategory(_categories[i + 1]))
                  : const SizedBox.shrink(),
            ),
          ]),
        ),
      ],
    ]);
  }

  void _openCategory(ServiceCategory category) {
    setState(() { _categorySlug = category.slug; _services = []; });
    _loadServices();
  }

  Widget _grid() {
    final sizes = context.sizes;
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: sizes.s(16),
      crossAxisSpacing: sizes.s(10),
      childAspectRatio: 0.74,
      children: [
        for (final service in _services)
          Semantics(
            button: true,
            label: service.title,
            child: PressableScale(
              scale: 0.94,
              onTap: () => Navigator.push(context, fadeThroughRoute(ServiceDetailScreen(service: service))),
              child: Column(children: [
                Hero(
                  tag: 'service-art-${service.slug}',
                  child: Container(
                    padding: EdgeInsets.all(sizes.s(8)),
                    decoration: BoxDecoration(
                      color: context.surface,
                      shape: BoxShape.circle,
                      boxShadow: PishkanMetrics.softShadow(context, lift: 0.7),
                      border: Border.all(color: artworkForService(service).color.withOpacity(0.14)),
                    ),
                    child: IconMedallion(artwork: artworkForService(service), size: sizes.s(44), glyphBadge: true),
                  ),
                ),
                SizedBox(height: sizes.s(7)),
                Flexible(
                  child: Text(service.title, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center,
                      style: TextStyle(fontSize: sizes.micro, fontWeight: FontWeight.w700, color: context.ink, height: 1.45)),
                ),
                if (service.computedTotal > 0)
                  Text(faMoney(service.computedTotal), style: TextStyle(fontSize: sizes.s(10), color: context.inkMuted)),
              ]),
            ),
          ),
      ],
    );
  }
}
