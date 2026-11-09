/// Lightweight models mapping the existing backend DTOs one-to-one.
/// Everything parses defensively: the backend evolves from the web admin, so
/// unknown/missing fields must never crash the app.

import 'package:flutter/material.dart' show Color;

Map<String, dynamic> _map(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
List<Map<String, dynamic>> _list(dynamic value) =>
    value is List ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : <Map<String, dynamic>>[];
String _str(dynamic value) => value == null ? '' : value.toString();
num _num(dynamic value) => value is num ? value : num.tryParse(_str(value)) ?? 0;
bool _bool(dynamic value) => value == true || value == 1 || value == '1' || value == 'true';

class AppConfig {
  AppConfig.fromJson(Map<String, dynamic> json)
      : brandName = _str(_map(json['brand'])['name']).isEmpty ? 'تک پیشخوان' : _str(_map(json['brand'])['name']),
        tagline = _str(_map(json['brand'])['tagline']),
        logoUrl = _str(_map(json['brand'])['logoUrl']),
        welcomeTitle = _str(_map(json['brand'])['welcomeTitle']),
        passwordLogin = _map(json['auth'])['password'] != false,
        otpLogin = _bool(_map(json['auth'])['otp']),
        registrationOpen = _map(json['auth'])['registrationOpen'] != false,
        passwordReset = _map(json['auth'])['passwordReset'] != false,
        latestVersion = _str(_map(json['version'])['latest']),
        minVersion = _str(_map(json['version'])['min']),
        updateUrl = _str(_map(json['version'])['updateUrl']),
        forceUpdate = _bool(_map(json['version'])['forceUpdate']),
        announcement = _str(json['announcement']),
        bannersEnabled = json['bannersEnabled'] != false,
        supportPhone = _str(json['supportPhone']),
        maintenance = _bool(json['maintenance']);

  final String brandName;
  final String tagline;
  final String logoUrl;
  final String welcomeTitle;
  final bool passwordLogin;
  final bool otpLogin;
  final bool registrationOpen;
  final bool passwordReset;
  final String latestVersion;
  final String minVersion;
  final String updateUrl;
  final bool forceUpdate;
  final String announcement;
  final bool bannersEnabled;
  final String supportPhone;
  final bool maintenance;
}

/// One home-screen banner.
///
/// The server sends a flat list ordered by the office; the app only needs to
/// know what to draw and where a tap goes. [destinationKind] is deliberately a
/// small enum rather than a link to parse: a banner either opens a catalogue
/// service by slug, opens an in-app page or web page, or does nothing.
class AppBanner {
  AppBanner.fromJson(Map<String, dynamic> json)
      : id = _str(json['id']),
        kind = _bannerKind(json['kind']),
        title = _str(json['title']),
        subtitle = _str(json['subtitle']),
        imageUrl = _str(json['imageUrl']),
        accentColor = _parseColor(json['accentColor']),
        destinationKind = _destinationKind(json['destinationKind']),
        destinationSlug = _str(json['destinationSlug']),
        destinationUrl = _str(json['destinationUrl']),
        actionLabel = _str(json['actionLabel']).isEmpty ? 'مشاهده' : _str(json['actionLabel']),
        updatedAt = _str(json['updatedAt']);

  final String id;
  /// general | info | ad | service — drives the badge and the fallback art.
  final String kind;
  final String title;
  final String subtitle;
  final String imageUrl;
  /// Optional accent from the office; used for the fallback gradient.
  final Color? accentColor;
  /// none | service | url
  final String destinationKind;
  final String destinationSlug;
  final String destinationUrl;
  final String actionLabel;
  final String updatedAt;

  bool get isService => destinationKind == 'service' && destinationSlug.isNotEmpty;
  bool get isUrl => destinationKind == 'url' && destinationUrl.isNotEmpty;
  bool get hasImage => imageUrl.isNotEmpty;

  /// Small label shown above the title. A banner that advertises a service
  /// says so; the rest are named for what they are, so the rail does not read
  /// as six identical posters.
  String get badge => switch (kind) {
        'service' => 'خدمت ویژه',
        'ad' => 'پیشنهاد',
        'info' => 'اطلاعیه',
        _ => 'جدید',
      };

  static String _bannerKind(dynamic value) {
    final text = _str(value);
    return const {'general', 'info', 'ad', 'service'}.contains(text) ? text : 'general';
  }

  static String _destinationKind(dynamic value) {
    final text = _str(value);
    return const {'none', 'service', 'url'}.contains(text) ? text : 'none';
  }

  /// `#RRGGBB` from the admin form; anything unexpected becomes null and the
  /// card falls back to the brand gradient.
  static Color? _parseColor(dynamic value) {
    final text = _str(value).trim();
    if (text.isEmpty) return null;
    final hex = text.startsWith('#') ? text.substring(1) : text;
    if (hex.length != 6) return null;
    final parsed = int.tryParse(hex, radix: 16);
    return parsed == null ? null : Color(0xFF000000 | parsed);
  }
}

class ServiceCategory {
  ServiceCategory.fromJson(Map<String, dynamic> json)
      : id = _str(json['id']),
        slug = _str(json['slug']),
        title = _str(json['title']),
        icon = _str(json['icon']),
        color = _str(json['color']),
        image = _str(json['image']),
        serviceCount = _num(json['serviceCount']).toInt();

  final String id;
  final String slug;
  final String title;
  final String icon;
  final String color;
  final String image;
  final int serviceCount;
}

class FormFieldDef {
  FormFieldDef.fromJson(Map<String, dynamic> json)
      : key = _str(json['key']),
        label = _str(json['label']).isEmpty ? _str(json['key']) : _str(json['label']),
        type = _str(json['type']).isEmpty ? 'text' : _str(json['type']),
        required = _bool(json['required']),
        placeholder = _str(json['placeholder']),
        help = _str(json['help']),
        maxLength = _num(json['maxLength']).toInt(),
        options = (json['options'] is List ? (json['options'] as List) : const []).map((e) => _str(e)).where((e) => e.isNotEmpty).toList();

  final String key;
  final String label;
  final String type;
  final bool required;
  final String placeholder;
  final String help;
  final int maxLength;
  final List<String> options;
}

class DocumentRequirement {
  DocumentRequirement.fromJson(Map<String, dynamic> json)
      : key = _str(json['key']),
        title = _str(json['title']).isEmpty ? _str(json['key']) : _str(json['title']),
        required = _bool(json['required']),
        // The catalog DTO spells the guidance text `note`; request
        // snapshots may spell it `description`. Accept both.
        description = _str(json['note']).isEmpty ? _str(json['description']) : _str(json['note']),
        documentType = _str(json['documentType']).isEmpty ? _str(json['type']) : _str(json['documentType']);

  final String key;
  final String title;
  final bool required;
  final String description;
  final String documentType;
}

class CatalogService {
  /// A card for a service the assistant suggested: enough to open the real
  /// detail screen, which then fetches the full record by slug.
  CatalogService.fromSuggestion(Map<String, dynamic> suggestion)
      : this.fromJson({
          'id': suggestion['id'],
          'slug': suggestion['slug'],
          'title': suggestion['title'],
          'summary': suggestion['summary'],
          'categoryTitle': suggestion['categoryTitle'],
          'finalFee': suggestion['fee'],
          'estimatedDays': suggestion['estimatedDays'],
        });

  CatalogService.fromJson(this.raw)
      : id = _str(raw['id']),
        slug = _str(raw['slug']),
        title = _str(raw['title']),
        subtitle = _str(raw['summary']).isEmpty ? _str(raw['subtitle']) : _str(raw['summary']),
        description = _str(raw['description']),
        fullDescription = _str(raw['fullDescription']),
        icon = _str(raw['icon']),
        bannerUrl = _str(raw['image']).isEmpty ? _str(raw['bannerUrl']) : _str(raw['image']),
        baseFee = _num(raw['baseFee']),
        discountPercent = _num(raw['discountPercent']),
        finalFee = _num(raw['finalFee']),
        taxPercent = _num(raw['taxPercent']),
        estimatedDays = _num(raw['estimatedDays']),
        urgentAvailable = _bool(raw['urgentEnabled']) || _bool(raw['urgentAvailable']),
        urgentFee = _num(raw['urgentFee']),
        featured = _bool(raw['featured']),
        acceptingRequests = raw['acceptingRequests'] != false,
        hasExternalCosts = _bool(raw['hasExternalCosts']),
        externalCostsNote = _str(raw['externalCostsNote']),
        contactNotice = _str(raw['contactNotice']),
        categoryId = _str(raw['categoryId']).isEmpty ? _str(_map(raw['category'])['id']) : _str(raw['categoryId']),
        categoryTitle = _str(raw['categoryTitle']).isEmpty ? _str(_map(raw['category'])['title']) : _str(raw['categoryTitle']),
        categorySlug = _str(raw['categorySlug']).isEmpty ? _str(_map(raw['category'])['slug']) : _str(raw['categorySlug']),
        // The catalog DTO spells these `form` and `documents`; older cached
        // payloads used `formFields`/`documentRequirements`. Accept both.
        formFields = _list(raw['form'] ?? raw['formFields']).map(FormFieldDef.fromJson).toList(),
        requirements = _list(raw['documents'] ?? raw['documentRequirements']).map(DocumentRequirement.fromJson).toList(),
        requiresAuthentication = _bool(raw['requiresAuthentication']);

  final Map<String, dynamic> raw;
  final String id;
  final String slug;
  final String title;
  final String subtitle;
  final String description;
  final String fullDescription;
  final String icon;
  final String bannerUrl;
  final num baseFee;
  final num discountPercent;
  final num finalFee;
  final num taxPercent;
  final num estimatedDays;
  final bool urgentAvailable;
  final num urgentFee;
  final bool featured;
  final bool acceptingRequests;
  final bool hasExternalCosts;
  final String externalCostsNote;
  final String contactNotice;
  final String categoryId;
  final String categoryTitle;
  final String categorySlug;
  final List<FormFieldDef> formFields;
  final List<DocumentRequirement> requirements;
  final bool requiresAuthentication;

  String get displayDescription {
    if (fullDescription.isNotEmpty) return fullDescription;
    if (description.isNotEmpty) return description;
    return subtitle;
  }

  /// A service is "popular" when the office flags it in the web admin
  /// (featured flag or a popular tag); the home grid falls back to catalog
  /// order when nothing is flagged.
  bool get popular {
    if (featured) return true;
    final tags = raw['tags'];
    if (tags is List) {
      final joined = tags.map((t) => t.toString().toLowerCase()).join(' ');
      return joined.contains('popular') || joined.contains('محبوب') || joined.contains('پردرخواست');
    }
    return false;
  }

  String get durationText {
    if (estimatedDays <= 0) return '';
    if (estimatedDays < 1) return 'کمتر از یک روز کاری';
    final days = estimatedDays.round();
    return 'حدود $days روز کاری';
  }

  /// Local estimate for display only; the server quote is authoritative.
  num get computedTotal {
    if (finalFee > 0) return finalFee;
    final discount = baseFee * discountPercent / 100;
    final after = baseFee - discount;
    return after + after * taxPercent / 100;
  }
}

class ServiceRequestSummary {
  ServiceRequestSummary.fromJson(Map<String, dynamic> json)
      : id = _str(json['id']),
        trackingCode = _str(json['trackingCode']),
        status = _str(json['status']),
        statusLabel = _str(json['statusLabel']).isEmpty ? _str(json['status']) : _str(json['statusLabel']),
        workBucket = _str(json['workBucket']),
        workBucketLabel = _str(json['workBucketLabel']),
        serviceTitle = _str(json['serviceTitle']),
        priority = _str(json['priority']),
        total = _num(json['total']),
        paymentStatus = _str(json['paymentStatus']),
        createdAt = _str(json['createdAt']),
        updatedAt = _str(json['updatedAt']),
        estimatedCompletionAt = _str(json['estimatedCompletionAt']);

  final String id;
  final String trackingCode;
  final String status;
  final String statusLabel;
  final String workBucket;
  final String workBucketLabel;
  final String serviceTitle;
  final String priority;
  final num total;
  final String paymentStatus;
  final String createdAt;
  final String updatedAt;
  final String estimatedCompletionAt;

  bool get isActive => ['queue', 'active', 'action', 'in_progress', 'waiting_organization', 'followup'].contains(workBucket);
  bool get needsAction => workBucket == 'waiting_customer';
  bool get isDone => status == 'completed' || status == 'delivered';
  bool get isCanceled => status == 'cancelled' || status == 'canceled';
}

class RequestDocument {
  RequestDocument.fromJson(Map<String, dynamic> json)
      : id = _str(json['id']),
        title = _str(json['title']),
        kind = _str(json['kind']),
        status = _str(json['status']),
        reviewNote = _str(json['reviewNote']),
        requirementKey = _str(json['requirementKey']),
        replacesDocumentId = _str(json['replacesDocumentId']),
        file = _map(json['file']);

  final String id;
  final String title;
  final String kind;
  final String status;
  final String reviewNote;
  final String requirementKey;
  final String replacesDocumentId;
  final Map<String, dynamic> file;

  String get fileId => _str(file['id']);
  String get mime => _str(file['mime']);
  String get displayUrl => _str(file['displayUrl']).isEmpty ? _str(file['previewUrl']) : _str(file['displayUrl']);
  String get originalUrl => _str(file['originalUrl']);
  num get size => _num(file['size']);
  bool get isImage => mime.startsWith('image/');
  bool get isDelivered => kind == 'staff' && status == 'approved';
}

class RequestDetail {
  RequestDetail.fromJson(this.raw)
      : id = _str(raw['id']),
        trackingCode = _str(raw['trackingCode']),
        status = _str(raw['status']),
        statusLabel = _str(raw['statusLabel']).isEmpty ? _str(raw['status']) : _str(raw['statusLabel']),
        workBucket = _str(raw['workBucket']),
        serviceTitle = _str(raw['serviceTitle']),
        currentStepTitle = _str(raw['currentStepTitle']),
        nextStepTitle = _str(raw['nextStepTitle']),
        fee = _num(raw['fee']),
        discount = _num(raw['discount']),
        total = _num(raw['total']),
        paymentMethod = _str(raw['paymentMethod']),
        paymentStatus = _str(raw['paymentStatus']),
        createdAt = _str(raw['createdAt']),
        completedAt = _str(raw['completedAt']),
        estimatedCompletionAt = _str(raw['estimatedCompletionAt']),
        rejectedReason = _str(raw['rejectedReason']),
        events = _list(raw['events']),
        documents = _list(raw['documents']).map(RequestDocument.fromJson).toList(),
        invoices = _list(raw['invoices']),
        formData = _map(raw['formData']),
        snapshot = _map(raw['snapshot']);

  final Map<String, dynamic> raw;
  final String id;
  final String trackingCode;
  final String status;
  final String statusLabel;
  final String workBucket;
  final String serviceTitle;
  final String currentStepTitle;
  final String nextStepTitle;
  final num fee;
  final num discount;
  final num total;
  final String paymentMethod;
  final String paymentStatus;
  final String createdAt;
  final String completedAt;
  final String estimatedCompletionAt;
  final String rejectedReason;
  final List<Map<String, dynamic>> events;
  final List<RequestDocument> documents;
  final List<Map<String, dynamic>> invoices;
  final Map<String, dynamic> formData;
  final Map<String, dynamic> snapshot;

  /// Snapshot shape mirrors the web: { service: { form, documents } }.
  /// Both spellings are tried so older requests keep rendering.
  List<DocumentRequirement> get requirements {
    final fromSnapshot = _list(_map(snapshot['service'])['documents']);
    final source = fromSnapshot.isNotEmpty ? fromSnapshot : _list(snapshot['documentRequirements']);
    return source.map(DocumentRequirement.fromJson).toList();
  }

  List<FormFieldDef> get formFields {
    final fromSnapshot = _list(_map(snapshot['service'])['form']);
    final source = fromSnapshot.isNotEmpty ? fromSnapshot : _list(snapshot['formFields']);
    return source.map(FormFieldDef.fromJson).toList();
  }
  List<RequestDocument> get deliveredFiles => documents.where((doc) => doc.isDelivered).toList();
  List<Map<String, dynamic>> get unpaidInvoices => invoices.where((inv) => _num(inv['paidAmount']) < _num(inv['total']) && _str(inv['status']) != 'void').toList();
  bool get canCancel => !['completed', 'delivered', 'cancelled', 'canceled', 'rejected'].contains(status);
}

class ParsedList<T> {
  ParsedList(this.items, this.total);
  final List<T> items;
  final int total;
}

ParsedList<T> parseList<T>(dynamic data, T Function(Map<String, dynamic>) fromJson) {
  if (data is Map) {
    final map = Map<String, dynamic>.from(data);
    final items = _list(map['items']).map(fromJson).toList();
    return ParsedList(items, _num(map['total']).toInt());
  }
  if (data is List) {
    final items = _list(data).map(fromJson).toList();
    return ParsedList(items, items.length);
  }
  return ParsedList(<T>[], 0);
}

Map<String, dynamic> asMap(dynamic value) => _map(value);
List<Map<String, dynamic>> asMapList(dynamic value) => _list(value);
String asStr(dynamic value) => _str(value);
num asNum(dynamic value) => _num(value);
bool asBool(dynamic value) => _bool(value);

/// Flat list of strings, e.g. the assistant's `followUpQuestions`.
List<String> asTextList(dynamic value) {
  if (value is! List) return const [];
  return [for (final item in value) if (_str(item).isNotEmpty) _str(item)];
}
