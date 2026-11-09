import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/service_icons.dart';
import '../models/models.dart';
import '../services/services.dart';
import 'widgets.dart';

/// A service picture that prefers the server's copy and never flashes blank.
///
/// The artwork ships inside the APK, but the office can replace any picture on
/// the server without waiting for a release. So the order is:
///
///   1. the **bundled** asset, painted immediately — it is local, so the first
///      frame after a tap is already the right illustration rather than an
///      empty box;
///   2. the **server** copy on top of it, once it has downloaded.
///
/// Doing it the other way round (network first, spinner until it lands) is what
/// makes a detail page feel slow on a 3G connection, and it also means an
/// offline customer sees nothing at all. CachedNetworkImage keeps the file on
/// disk, so from the second visit the server layer is served from cache and
/// replaces the asset in the same frame — no download, no flicker, and an
/// office-side replacement shows up on the next launch.
class ServiceArtOverlay extends StatelessWidget {
  const ServiceArtOverlay({
    super.key,
    required this.service,
    required this.art,
    this.fit = BoxFit.cover,
  });

  final CatalogService service;
  final ServiceArtwork art;
  final BoxFit fit;

  /// The server path this service's group backdrop lives at. Kept in step with
  /// `GROUP_BACKDROPS` in the API's default-artwork.ts.
  ///
  /// The path is stable, which is what makes the on-disk cache worth having —
  /// but it also means a picture the office replaces would keep coming out of
  /// the cache forever, since a cached entry is keyed by URL and the URL never
  /// changes. The service's `updatedAt` rides along as a query token instead:
  /// unchanged records keep their exact URL and stay cached, a replaced record
  /// gets a new one and downloads once. The server ignores the parameter.
  String get _remoteUrl {
    final group = art.backdropGroup;
    if (group.isEmpty) return '';
    final version = service.updatedAt.trim();
    final base = '/images/services/backdrops/$group.webp';
    if (version.isEmpty) return base;
    final stamp = Uri.encodeQueryComponent(version);
    return '$base?v=$stamp';
  }

  @override
  Widget build(BuildContext context) {
    final local = art.largeAssetPath.isNotEmpty ? art.largeAssetPath : art.assetPath;
    final remote = _remoteUrl;

    final fallback = local.isEmpty
        ? const ColoredBox(color: Colors.transparent)
        : Image.asset(local, fit: fit, gaplessPlayback: true);

    if (remote.isEmpty) return fallback;

    // A tiny transparent image under the cached one keeps the frame painted
    // while the file is missing: CachedNetworkImage's placeholder never
    // removes the asset behind it.
    return Stack(
      fit: StackFit.expand,
      children: [
        fallback,
        CachedServiceImage(url: remote, fit: fit),
      ],
    );
  }
}

/// The network half of [ServiceArtOverlay]: cached on disk, and invisible
/// (rather than an error icon) whenever the file is not available yet.
class CachedServiceImage extends StatelessWidget {
  const CachedServiceImage({super.key, required this.url, this.fit = BoxFit.cover});

  final String url;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    return AuthImageOrNothing(url: url, fit: fit);
  }
}
