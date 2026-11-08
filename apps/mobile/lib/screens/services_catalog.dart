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
    return HeaderScaffold(
      headerHeight: MediaQuery.paddingOf(context).top + sizes.s(124),
      header: Column(children: [
        ScreenHeading(title: 'خدمات', onBack: widget.showBack ? () => Navigator.pop(context) : null),
        _searchPill(),
      ]),
      body: RefreshIndicator(
        onRefresh: _loadAll,
        child: ListView(
          padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(16), sizes.gutter, sizes.navPillClearance(context)),
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
    // The card is a fixed-height landscape tile, so the row has to grow with
    // the customer's text-size setting or the label clips at the bottom. The
    // old grid handled this with a text-scaled aspect ratio; fixed heights
    // need the scale applied directly.
    final textScale = MediaQuery.textScalerOf(context).scale(1).clamp(1.0, 1.6);
    return Column(children: [
      for (var i = 0; i < _categories.length; i += 2) ...[
        if (i > 0) SizedBox(height: sizes.gap),
        SizedBox(
          height: sizes.s(88) * textScale,
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

class ServiceSearchScreen extends StatefulWidget {
  const ServiceSearchScreen({super.key});

  @override
  State<ServiceSearchScreen> createState() => _ServiceSearchScreenState();
}

class _ServiceSearchScreenState extends State<ServiceSearchScreen> {
  final _query = TextEditingController();
  List<CatalogService> _all = [];
  bool _loaded = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loaded = false; _error = null; });
    try {
      final services = await fetchServices();
      if (mounted) setState(() { _all = services; _loaded = true; });
    } on ApiException catch (error) {
      if (mounted) setState(() { _error = error.message; _loaded = true; });
    } catch (_) {
      if (mounted) setState(() { _error = 'دریافت خدمات انجام نشد.'; _loaded = true; });
    }
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final term = _query.text.trim();
    final items = _all.where((service) => term.isEmpty || service.title.contains(term) || service.slug.contains(term) || service.description.contains(term) || service.subtitle.contains(term)).toList();
    final sizes = context.sizes;
    return Scaffold(
      backgroundColor: context.surface,
      appBar: AppBar(title: const Text('جستجوی خدمت')),
      body: Column(children: [
        Padding(
          padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(8), sizes.gutter, sizes.s(10)),
          child: TextField(
            controller: _query,
            autofocus: true,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(hintText: 'مثلاً تعویض پلاک، گذرنامه…', prefixIcon: Icon(Icons.search_rounded)),
          ),
        ),
        Expanded(
          child: !_loaded
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? ErrorView(message: _error!, onRetry: _load)
              : items.isEmpty
                  ? const EmptyView(icon: Icons.search_off_rounded, title: 'خدمتی پیدا نشد', hint: 'عبارت دیگری را امتحان کنید یا از کارشناس بپرسید.')
                  : ListView(
                      padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(4), sizes.gutter, sizes.s(16)),
                      children: [
                        for (final service in items)
                          Padding(
                            padding: EdgeInsets.only(bottom: sizes.gap),
                            child: SoftCard(
                              onTap: () => Navigator.push(context, fadeThroughRoute(ServiceDetailScreen(service: service))),
                              child: Row(children: [
                                Hero(
                                  tag: 'service-art-${service.slug}',
                                  child: IconMedallion(artwork: artworkForService(service), size: 50),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(service.title, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: context.ink)),
                                    if (service.categoryTitle.isNotEmpty) Text(service.categoryTitle, style: TextStyle(fontSize: 11, color: context.inkMuted)),
                                  ]),
                                ),
                                if (service.computedTotal > 0) Text(faMoney(service.computedTotal), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: PishkanColors.primary)),
                                const SizedBox(width: 4),
                                Icon(Icons.chevron_left_rounded, color: context.inkMuted),
                              ]),
                            ),
                          ),
                      ],
                    ),
        ),
      ]),
    );
  }
}
