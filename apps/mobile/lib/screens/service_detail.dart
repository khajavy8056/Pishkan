import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/format.dart';
import '../core/service_icons.dart';
import '../widgets/service_art_overlay.dart';
import '../core/motion.dart';
import '../core/sizes.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'request_form.dart';
import 'support.dart';

/// Service detail (approved design): banner + floating info card,
/// backend-driven tabs (توضیحات / مدارک موردنیاز / پرسش‌وپاسخ) and the
/// sticky price + «ثبت درخواست» action bar. The rich record (form,
/// documents) is refreshed from the server so the wizard always gets the
/// latest admin configuration.
class ServiceDetailScreen extends StatefulWidget {
  const ServiceDetailScreen({super.key, required this.service});

  final CatalogService service;

  @override
  State<ServiceDetailScreen> createState() => _ServiceDetailScreenState();
}

class _ServiceDetailScreenState extends State<ServiceDetailScreen> {
  int _tab = 0;
  late CatalogService _service;

  @override
  void initState() {
    super.initState();
    _service = widget.service;
    if (_service.slug.isNotEmpty) {
      fetchServiceDetail(_service.slug).then((fresh) {
        if (mounted) setState(() => _service = fresh);
      }).catchError((_) {});
    }
  }

  CatalogService get service => _service;

  @override
  Widget build(BuildContext context) {
    final art = artworkForService(service);
    return Scaffold(
      body: CustomScrollView(slivers: [
        SliverToBoxAdapter(child: _banner(art)),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 120),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              _tabBar(),
              const SizedBox(height: 14),
              // Tabs cross-fade: switching between توضیحات و مدارک reads as one
              // panel changing its contents, not as the page reloading.
              SoftSwitcher(
                duration: PishkanMotion.quick,
                child: KeyedSubtree(
                  key: ValueKey(_tab),
                  child: switch (_tab) {
                    0 => _description(),
                    1 => _documents(),
                    _ => _qa(),
                  },
                ),
              ),
            ]),
          ),
        ),
      ]),
      // A bottomNavigationBar, not a bottomSheet: the sheet did not take the
      // device's gesture inset into account, so on a phone with a nav bar the
      // "ثبت درخواست" button sat underneath the system buttons. This also lets
      // the bar shrink away when the keyboard opens instead of overlapping it.
      bottomNavigationBar: _actionBar(),
    );
  }

  Widget _banner(ServiceArtwork art) {
    // The generated illustration is the default; a banner the office uploaded
    // (or a real photo URL) always wins, and the tiny legacy PNGs are ignored.
    final localArt = art.largeAssetPath.isNotEmpty ? art.largeAssetPath : art.assetPath;
    final useLocalArt = localArt.isNotEmpty && (service.bannerUrl.isEmpty || isLegacyDefaultServiceImage(service.bannerUrl));
    final hasBanner = service.bannerUrl.isNotEmpty && !useLocalArt;
    return SizedBox(
      height: 300,
      child: Stack(children: [
        Positioned.fill(
          child: hasBanner
              ? AuthImage(url: service.bannerUrl, fit: BoxFit.cover)
              // The landing half of the list's Hero: same tag, so the tile the
              // customer tapped expands into this header.
              : Hero(
                  tag: 'service-art-${service.slug}',
                  // The bundled asset paints at once and the server's copy
                  // lands on top of it: instant and replaceable at the same
                  // time, instead of a spinner on a slow connection.
                  child: useLocalArt
                      ? _illustrationBackdrop()
                      : _bannerArt(art),
                ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(children: [
              _roundButton(Icons.arrow_forward_ios_rounded, () => Navigator.pop(context), iconSize: 18),
              const Spacer(),
              _roundButton(Icons.link_rounded, () async {
                await Clipboard.setData(ClipboardData(text: api.absolute('/services/${service.slug}')));
                if (mounted) showSnack(context, 'پیوند این خدمت کپی شد.');
              }),
            ]),
          ),
        ),
        Positioned(
          left: 16,
          right: 16,
          bottom: 14,
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
            decoration: BoxDecoration(color: context.surface, borderRadius: BorderRadius.circular(22), boxShadow: const [BoxShadow(color: Color(0x1A0B1F3A), blurRadius: 18, offset: Offset(0, 8))]),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                IconMedallion(artwork: art, size: 46),
                const SizedBox(width: 10),
                Expanded(child: Text(service.title, maxLines: 2, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: context.ink))),
              ]),
              if (service.subtitle.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(service.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: context.inkMuted, height: 1.7)),
              ],
              const SizedBox(height: 10),
              Wrap(spacing: 8, runSpacing: 6, children: [
                if (service.durationText.isNotEmpty) _metaChip(Icons.timer_outlined, PishkanColors.primary, faDigits(service.durationText)),
                if (service.categoryTitle.isNotEmpty) _metaChip(Icons.grid_view_rounded, const Color(0xFF7C3AED), service.categoryTitle),
                if (service.urgentAvailable) _metaChip(Icons.bolt_rounded, const Color(0xFFF59E0B), 'انجام فوری دارد'),
                if (service.popular) _metaChip(Icons.local_fire_department_rounded, PishkanColors.danger, 'محبوب'),
                if (service.hasExternalCosts) _metaChip(Icons.account_balance_outlined, PishkanColors.warning, 'هزینهٔ سازمانی دارد'),
              ]),
            ]),
          ),
        ),
      ]),
    );
  }

  /// The 3D tile is a square on a studio backdrop; on a 300 px hero it is
  /// centred over a tinted wash of its own category colour instead of being
  /// stretched. The wash keeps the header calm in both themes.
  /// The header picture of a service page.
  ///
  /// This is the wide 1280px backdrop, filling the 300px banner and cropped to
  /// cover — not the square icon. It used to draw the icon at 236px in the
  /// middle of a tinted panel, which threw away the whole backdrop and left the
  /// header mostly empty.
  ///
  /// The gradient underneath stays as the last resort: if both the bundled
  /// file and the server copy are missing, the page still shows the service's
  /// own tint instead of a black rectangle.
  Widget _illustrationBackdrop() {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: context.isDark
              ? [PishkanColors.darkSurfaceHigh, PishkanColors.darkBackground]
              : [Color.alphaBlend(artTintFor(service).withOpacity(0.16), Colors.white), PishkanColors.background],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: ServiceArtOverlay(service: service, art: artworkForService(service)),
    );
  }

  Color artTintFor(CatalogService service) => artworkForService(service).color;

  Widget _bannerArt(ServiceArtwork art) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [art.color.withOpacity(0.85), art.color.withOpacity(0.55), const Color(0xFF1452D9)],
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
        ),
      ),
      child: Center(child: Icon(art.icon, size: 84, color: Colors.white)),
    );
  }

  Widget _roundButton(IconData icon, VoidCallback onTap, {double iconSize = 22}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.white.withOpacity(0.94), shape: BoxShape.circle, boxShadow: const [BoxShadow(color: Color(0x22000000), blurRadius: 10, offset: Offset(0, 4))]),
        // The disc stays white in both themes, so the glyph stays navy.
        child: Icon(icon, color: PishkanColors.navy, size: iconSize),
      ),
    );
  }

  Widget _metaChip(IconData icon, Color color, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(color: color.withOpacity(0.11), borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 15, color: color),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color)),
      ]),
    );
  }

  Widget _tabBar() {
    Widget tab(int index, String label) {
      final active = _tab == index;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _tab = index),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              color: active ? PishkanColors.primary : Colors.transparent,
              borderRadius: BorderRadius.circular(999),
              boxShadow: active ? [BoxShadow(color: PishkanColors.primary.withOpacity(0.3), blurRadius: 8, offset: const Offset(0, 3))] : null,
            ),
            child: Text(label, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: active ? Colors.white : context.ink)),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(color: context.isDark ? PishkanColors.darkSurfaceHigh : const Color(0xFFEAF1FE), borderRadius: BorderRadius.circular(999)),
      child: Row(children: [
        tab(0, 'توضیحات'),
        tab(1, 'مدارک موردنیاز'),
        tab(2, 'پرسش و پاسخ'),
      ]),
    );
  }

  Widget _description() {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(
        service.displayDescription.isNotEmpty ? service.displayDescription : 'توضیحات تکمیلی این خدمت را می‌توانید از کارشناسان دفتر بپرسید.',
        style: TextStyle(height: 2, fontSize: 13.5, color: context.ink),
      ),
      const SizedBox(height: 16),
      SoftCard(
        child: Column(children: [
          _priceRow('هزینهٔ خدمات دفتر', faMoney(service.baseFee)),
          if (service.discountPercent > 0) ...[
            const Divider(),
            _priceRow('تخفیف (${faDigits(service.discountPercent.round())}٪)', '−${faMoney(service.baseFee * service.discountPercent / 100)}'),
          ],
          const Divider(),
          _priceRow('قابل پرداخت', faMoney(service.computedTotal), bold: true),
          if (service.hasExternalCosts && service.externalCostsNote.isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: context.isDark ? const Color(0x332D1B00) : const Color(0xFFFFF7E6), borderRadius: BorderRadius.circular(12)),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(Icons.info_outline_rounded, size: 17, color: context.isDark ? PishkanColors.darkWarning : const Color(0xFF92400E)),
                const SizedBox(width: 6),
                Expanded(child: Text(service.externalCostsNote, style: TextStyle(fontSize: 11.5, color: context.isDark ? PishkanColors.darkWarning : const Color(0xFF92400E), height: 1.8))),
              ]),
            ),
          ],
          if (service.contactNotice.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(service.contactNotice, style: TextStyle(fontSize: 11.5, color: context.inkMuted, height: 1.8)),
          ],
        ]),
      ),
    ]);
  }

  Widget _priceRow(String label, String value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(children: [
        Text(label, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w500, color: bold ? context.ink : context.inkMuted, fontSize: 13)),
        const Spacer(),
        Text(value, style: TextStyle(fontWeight: FontWeight.w800, fontSize: bold ? 15 : 13, color: bold ? PishkanColors.primary : context.ink)),
      ]),
    );
  }

  Widget _documents() {
    final docs = service.requirements;
    if (docs.isEmpty) {
      return  SoftCard(
        child: Text('این خدمت مدرک از پیش‌تعریف‌شده‌ای ندارد؛ هر مدرکی لازم شود، کارشناس در پرونده راهنمایی‌تان می‌کند.', style: TextStyle(height: 1.9, fontSize: 13, color: context.inkMuted)),
      );
    }
    return Column(children: [
      for (var i = 0; i < docs.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: SoftCard(
            child: Row(children: [
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: PishkanColors.primary, shape: BoxShape.circle),
                child: Text(faDigits('${i + 1}'), style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(docs[i].title, style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: context.ink)),
                  if (docs[i].description.isNotEmpty) Text(docs[i].description, style: TextStyle(fontSize: 11.5, color: context.inkMuted, height: 1.7)),
                ]),
              ),
              if (docs[i].required)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: PishkanColors.danger.withOpacity(0.1), borderRadius: BorderRadius.circular(999)),
                  child: const Text('الزامی', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: PishkanColors.danger)),
                )
              else
                Text('اختیاری', style: TextStyle(fontSize: 11, color: context.inkMuted)),
            ]),
          ),
        ),
    ]);
  }

  Widget _qa() {
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(Icons.support_agent_rounded, color: PishkanColors.primary),
          SizedBox(width: 8),
          Text('سوالی دربارهٔ این خدمت دارید؟', style: TextStyle(fontWeight: FontWeight.w800, color: context.ink)),
        ]),
        const SizedBox(height: 8),
        Text('کارشناسان دفتر در ساعات کاری پاسخ‌گوی شما هستند. سؤال‌تان را بپرسید تا پیش از ثبت درخواست، با اطمینان اقدام کنید.', style: TextStyle(height: 1.9, fontSize: 13, color: context.inkMuted)),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SupportTab())),
          icon: const Icon(Icons.chat_bubble_outline_rounded),
          label: const Text('گفت‌وگو با پشتیبانی'),
        ),
      ]),
    );
  }

  Widget _actionBar() {
    final sizes = context.sizes;
    final open = service.acceptingRequests;
    return Container(
      padding: EdgeInsets.fromLTRB(sizes.gutter, sizes.s(10), sizes.gutter, sizes.s(12)),
      decoration: BoxDecoration(
        color: context.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [BoxShadow(color: Color(0x140B1F3A), blurRadius: 18, offset: Offset(0, -5))],
      ),
      // minimum: the inset is added to whatever SafeArea reserves, so the bar
      // grows with the device instead of hiding behind it.
      child: SafeArea(
        top: false,
        minimum: EdgeInsets.only(bottom: MediaQuery.viewPaddingOf(context).bottom > 0 ? 0 : sizes.s(4)),
        child: Row(children: [
          Expanded(
            flex: 4,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text('قیمت نهایی', style: TextStyle(fontSize: sizes.micro, color: context.inkMuted)),
              Text(service.computedTotal > 0 ? faMoney(service.computedTotal) : 'توافقی', style: TextStyle(fontWeight: FontWeight.w800, fontSize: sizes.subtitle, color: context.ink)),
            ]),
          ),
          SizedBox(width: sizes.s(10)),
          Expanded(
            flex: 6,
            child: PlushButton(
              label: open ? 'ثبت درخواست' : 'پذیرش موقتاً بسته است',
              arrow: open,
              onPressed: open ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => RequestFormScreen(service: service))) : null,
            ),
          ),
        ]),
      ),
    );
  }
}
