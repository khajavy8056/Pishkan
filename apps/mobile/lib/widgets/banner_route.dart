import 'package:flutter/material.dart';

import '../core/motion.dart';
import '../models/models.dart';
import '../screens/documents.dart';
import '../screens/requests.dart';
import '../screens/service_detail.dart';
import '../screens/services_catalog.dart';


/// Where a banner tap lands.
///
/// The banner carries a *structured* destination — a catalogue slug, or an
/// in-app path — and this is the single place that turns it into a route. One
/// resolver rather than an `if` at each call site matters because banners are
/// opened from the home rail, from a notification, and from the archive; if
/// those three disagreed, the same banner would behave differently depending
/// on where the customer tapped it.
///
/// A service destination is resolved against the catalogue before navigating.
/// If the slug is gone (the office archived the service after the banner was
/// written), the customer lands on the services list rather than a broken
/// screen — a stale banner must degrade, not fail.
Future<void> openBannerDestination(
  BuildContext context,
  AppBanner banner, {
  required Future<List<CatalogService>> Function() loadServices,
}) async {
  if (banner.isService) {
    final services = await loadServices();
    if (!context.mounted) return;
    final match = services.where((service) => service.slug == banner.destinationSlug);
    if (match.isEmpty) {
      await Navigator.push(context, fadeThroughRoute(const ServicesCatalogTab(showBack: true)));
      return;
    }
    await Navigator.push(context, fadeThroughRoute(ServiceDetailScreen(service: match.first)));
    return;
  }

  if (banner.isUrl) {
    final target = banner.destinationUrl;
    // In-app paths are the ones the office is offered in the admin form; they
    // map to real screens so the customer stays inside the app. Anything else
    // is treated as a plain link and never opened implicitly — there is no
    // in-app browser in the customer app, and silently doing nothing is better
    // than a dead tap.
    switch (target) {
      case '/app/services':
      case '/app/catalog':
        await Navigator.push(context, fadeThroughRoute(const ServicesCatalogTab(showBack: true)));
        return;
      case '/app/requests':
        await Navigator.push(context, fadeThroughRoute(const RequestsTab(showBack: true)));
        return;
      case '/app/documents':
        await Navigator.push(context, fadeThroughRoute(const DocumentsScreen()));
        return;
      default:
        if (target.startsWith('/services/')) {
          final slug = target.substring('/services/'.length);
          await openBannerDestination(
            context,
            AppBanner.fromJson({
              'id': banner.id,
              'title': banner.title,
              'destinationKind': 'service',
              'destinationSlug': slug,
            }),
            loadServices: loadServices,
          );
        }
        return;
    }
  }
  // destinationKind == none: informational only. The tap still gives the
  // pressed animation, which is the honest feedback that nothing is behind it.
}
