import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/service_icons.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
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
    return Scaffold(
      appBar: AppBar(title: const Text('خدمات'), automaticallyImplyLeading: widget.showBack),
      body: RefreshIndicator(
        onRefresh: _loadAll,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 18), children: [
          GestureDetector(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ServiceSearchScreen())),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999), boxShadow: const [BoxShadow(color: Color(0x120B1F3A), blurRadius: 12, offset: Offset(0, 4))]),
              child: const Row(children: [
                Icon(Icons.search_rounded, color: PishkanColors.mutedText),
                SizedBox(width: 8),
                Text('جستجوی خدمت…', style: TextStyle(color: PishkanColors.mutedText, fontSize: 13)),
              ]),
            ),
          ),
          const SizedBox(height: 14),
          if (_categorySlug.isEmpty && _categories.isNotEmpty) ...[
            const SectionTitle(title: 'دسته‌بندی خدمات'),
            _categoryGrid(),
          ] else ...[
          if (_categorySlug.isNotEmpty)
            Align(alignment: Alignment.centerRight, child: TextButton.icon(
              onPressed: () { setState(() { _categorySlug = ''; _services = []; }); _loadServices(); },
              icon: const Icon(Icons.arrow_forward_rounded), label: const Text('همه دسته‌بندی‌ها'),
            )),
          const SizedBox(height: 8),
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
        ]),
      ),
    );
  }

  Widget _categoryGrid() {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.18,
      children: [
        for (final category in _categories)
          Builder(builder: (context) {
            final art = artworkForCategory(category);
            return InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () { setState(() { _categorySlug = category.slug; _services = []; }); _loadServices(); },
              child: ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: Stack(fit: StackFit.expand, children: [
                  if (category.image.isNotEmpty)
                    AuthImage(url: category.image)
                  else if (art.imageUrl.isNotEmpty)
                    AuthImage(url: art.imageUrl)
                  else if (art.assetPath.isNotEmpty)
                    Image.asset(art.assetPath, fit: BoxFit.cover)
                  else
                    Container(color: art.color.withOpacity(0.25), child: Icon(art.icon, size: 50, color: art.color)),
                  const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.transparent, Color(0xD9001935)]))),
                  Positioned(left: 10, right: 10, bottom: 12, child: Text(category.title, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13))),
                ]),
              ),
            );
          }),
      ],
    );
  }

  Widget _grid() {
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 18,
      crossAxisSpacing: 12,
      childAspectRatio: 0.76,
      children: [
        for (final service in _services)
          GestureDetector(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ServiceDetailScreen(service: service))),
            child: Column(children: [
              Container(
                padding: const EdgeInsets.all(9),
                decoration: BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                  boxShadow: const [BoxShadow(color: Color(0x100B1F3A), blurRadius: 12, offset: Offset(0, 5))],
                  border: Border.all(color: artworkForService(service).color.withOpacity(0.14)),
                ),
                child: IconMedallion(artwork: artworkForService(service), size: 44),
              ),
              const SizedBox(height: 7),
              Flexible(
                child: Text(service.title, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: PishkanColors.navy, height: 1.45)),
              ),
              if (service.computedTotal > 0)
                Text(faMoney(service.computedTotal), style: const TextStyle(fontSize: 10, color: PishkanColors.mutedText)),
            ]),
          ),
      ],
    );
  }
}

/// Full-page service search over the same real catalog.
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
    return Scaffold(
      appBar: AppBar(title: const Text('جستجوی خدمت')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
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
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                      children: [
                        for (final service in items)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: SoftCard(
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ServiceDetailScreen(service: service))),
                              child: Row(children: [
                                IconMedallion(artwork: artworkForService(service), size: 50),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(service.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: PishkanColors.navy)),
                                    if (service.categoryTitle.isNotEmpty) Text(service.categoryTitle, style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
                                  ]),
                                ),
                                if (service.computedTotal > 0) Text(faMoney(service.computedTotal), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: PishkanColors.primary)),
                                const SizedBox(width: 4),
                                const Icon(Icons.chevron_left_rounded, color: PishkanColors.mutedText),
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
