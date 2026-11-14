import 'package:flutter/material.dart';

// One exclusive Material glyph per bundled service.
//
// Keyword rules could never give 193 services their own icon: they collapsed
// to about twenty repeated symbols, so «دریافت کروکی تصادف» and «خرید لاستیک»
// both drew a car. Every slug below is listed with a glyph chosen for its own
// subject, and tools/checks/service_glyphs.py fails the build if two services
// ever share one. A service created later from the admin panel is absent from
// this map and keeps the keyword fallback, because no release can know it.
//
// Names are Material icon names without the `Icons.` prefix or `_rounded`
// suffix; each is resolved to a real const in [serviceGlyph].
const serviceGlyphNames = <String, String>{

  // ── بیمه و تأمین اجتماعی ──
  'social-security-receipt': 'receipt_long',
  'social-security-records-objection': 'difference',
  'insurance-history': 'history_toggle_off',
  'salary-deduction-undertaking': 'request_quote',
  'insurance-list-submission': 'playlist_add_check',
  'rural-health-insurance-registration': 'local_hospital',
  'payslip-inquiry': 'wallet',

  // ── ثبت شرکت، برند و مؤسسه ──
  'register-llc': 'business',
  'register-jsc': 'apartment',
  'register-institution': 'account_balance',
  'amend-jsc': 'note_add',
  'amend-llc': 'drive_file_rename_outline',
  'logo-natural': 'image',
  'logo-legal': 'collections',
  'brand-natural': 'sell',
  'brand-legal': 'local_offer',
  'business-card-natural': 'badge',
  'business-card-legal': 'business_center',

  // ── یارانه، کالابرگ و سهام عدالت ──
  'subsidy-decile-objection': 'sync_problem',
  'justice-shares-newborn': 'child_care',
  'subsidy-adult-separation': 'call_split',
  'subsidy-bank-account-change': 'credit_card',
  'sejam-registration': 'price_check',
  'justice-shares-bank-change': 'swap_horiz',
  'subsidy-status-inquiry': 'manage_search',
  'justice-shares-value': 'trending_up',
  'justice-shares-profit-inquiry': 'insights',
  'subsidy-establishment-request': 'add_card',
  'subsidy-head-change': 'switch_account',
  'subsidy-add-household-member': 'group_add',

  // ── خدمات خودرو و پلاک ──
  'plate-replacement-appointment': 'event_available',
  'highway-toll-payment': 'toll',
  'traffic-fines-payment': 'gavel',
  'traffic-fines-detail': 'format_list_bulleted',
  'vehicle-transfer-tax': 'price_change',
  'plate-address-verification': 'add_location_alt',
  'annual-vehicle-toll': 'date_range',
  'traffic-plan-debt-inquiry': 'traffic',
  'fuel-card-registration': 'local_gas_station',
  'irankhodro-car-registration': 'directions_car',
  'saipa-car-registration': 'car_rental',
  'bahman-car-registration': 'commute',
  'car-lottery-winner-completion': 'emoji_events',
  'scrap-car-replacement': 'car_crash',
  'transport-vehicle-tax-return': 'local_shipping',
  'fleet-competency-license': 'assignment_ind',
  'fleet-competency-renewal': 'restart_alt',
  'car-insurance-inquiry': 'car_repair',
  'motorcycle-license-one-day': 'two_wheeler',
  'motorcycle-license-appointment': 'schedule',
  'gasoline-to-cng-conversion': 'propane_tank',
  'kavir-tire-purchase': 'tire_repair',
  'cargo-dynamic-code': 'qr_code_2',
  'state-tire-purchase': 'build_circle',

  // ── مالیات ──
  'tax-note-article-100': 'calculate',
  'economic-code-registration': 'numbers',
  'business-tax-return': 'assignment',
  'real-estate-rent-tax-return': 'attach_money',

  // ── یارانه، کالابرگ و سهام عدالت ──
  'subsidy-decile-inquiry': 'bar_chart',
  'subsidy-means-test-request': 'query_stats',
  'kala-barg-credit-inquiry': 'shopping_basket',

  // ── قضایی و ثنا ──
  'sana-registration': 'account_balance_wallet',
  'no-criminal-record': 'verified_user',
  'judicial-appointment': 'event_note',
  'sana-password-recovery': 'lock_reset',
  'case-status-notification': 'notifications_active',

  // ── آزمون، استخدام و کنکور ──
  'gov-employment-exam': 'work',
  'exam-entry-card': 'confirmation_number',
  'konkur-registration': 'edit_note',
  'konkur-major-selection': 'checklist',
  'farhangian-konkur-registration': 'school',
  'farhangian-major-selection': 'local_library',
  'kardani-technical-registration': 'engineering',
  'kardani-to-karshenasi': 'trending_flat',
  'masters-exam-registration': 'workspace_premium',
  'masters-major-selection': 'format_list_numbered',
  'phd-exam-registration': 'science',
  'phd-major-selection': 'biotech',
  'applied-science-registration': 'handyman',
  'engineering-council-exam': 'architecture',
  'vocational-periodic-exam': 'construction',
  'konkur-education-records': 'fact_check',
  'education-ministry-recruitment': 'co_present',
  'organization-internal-recruitment': 'groups',
  'day-bank-recruitment': 'person_add_alt',

  // ── مسکن و زمین ──
  'national-housing-registration': 'location_city',
  'youth-population-housing': 'holiday_village',
  'youth-housing-plan': 'house',
  'housing-purchase-loan': 'real_estate_agent',
  'rent-deposit-loan': 'key',
  'dilapidated-fabric-loan': 'foundation',
  'amlak-eskan-registration': 'home_work',
  'rent-contract-tracking-code': 'pin',
  'rural-land-allocation': 'landscape',

  // ── خدمات بانکی و وام ──
  'marriage-loan-registration': 'favorite',
  'marriage-loan-followup': 'volunteer_activism',
  'marriage-loan-cancellation': 'heart_broken',
  'child-loan-registration': 'child_friendly',
  'child-loan-followup': 'stroller',
  'child-loan-cancellation': 'do_not_disturb',
  'credit-score-inquiry': 'speed',
  'sayad-cheque-registration': 'post_add',
  'sayad-cheque-confirmation': 'how_to_reg',
  'sayad-cheque-transfer': 'sync_alt',
  'home-business-loan': 'storefront',
  'emdad-employment-loan': 'redeem',
  'behzisti-employment-loan': 'support',
  'resalat-bank-loan': 'savings',
  'resalat-document-matching': 'compare_arrows',
  'barekat-credit-validation': 'check_circle',
  'proxy-bank-account': 'person_add',

  // ── پلیس، گذرنامه و سربازی ──
  'pilgrimage-passport': 'flight_takeoff',
  'accident-sketch': 'minor_crash',
  'plate-history-inquiry': 'history',
  'active-plates-inquiry': 'directions_car_filled',
  'student-military-exemption': 'flag',
  'military-card-authenticity': 'military_tech',
  'exit-country-permit': 'flight',
  'international-driving-license': 'public',

  // ── بیمه و تأمین اجتماعی ──
  'optional-insurance-contract': 'plagiarism',
  'insurance-record-transfer': 'move_up',
  'unemployment-insurance': 'work_off',
  'maternity-leave-tamin': 'pregnant_woman',
  'medical-aids-cost-tamin': 'medical_services',
  'military-service-insurance-buy': 'paid',
  'tamin-pensioner-payslip': 'request_page',
  'tamin-pensioner-deduction-letter': 'article',

  // ── دانشگاه و دانشجو ──
  'university-course-selection': 'library_books',
  'university-add-drop': 'swap_vert',
  'university-tuition-payment': 'credit_score',
  'student-transfer-request': 'transfer_within_a_station',
  'army-officer-university': 'shield',
  'graduation-completion': 'celebration',
  'sajjad-education-verification': 'rule',
  'sajjad-tuition-exemption-cancel': 'money_off',
  'azad-konkur-major-selection': 'list_alt',
  'azad-bachelor-discontinuous': 'cast_for_education',
  'azad-bachelor-continuous': 'assignment_late',
  'azad-associate-discontinuous': 'import_contacts',
  'azad-associate-continuous': 'book',

  // ── مجوز کسب‌وکار ──
  'business-license-issue': 'verified',
  'amaken-approval': 'local_police',
  'health-card-issue': 'medical_information',
  'home-business-permit': 'cottage',
  'business-license-renewal': 'update',
  'business-license-address-change': 'location_on',
  'mobasher-card': 'contact_page',
  'guild-debt-payment': 'receipt',
  'postal-code-certificate': 'markunread_mailbox',

  // ── مدارس و دانش‌آموزان ──
  'school-textbook-order': 'menu_book',
  'school-registration': 'assignment_turned_in',
  'shahed-schools-registration': 'star',
  'sampad-7th-registration': 'psychology',
  'sampad-nemoneh-10th': 'functions',
  'student-assessment-registration': 'monitor_heart',
  'student-assessment-result': 'grading',
  'final-exam-entry-card': 'quiz',
  'diploma-verification-medu': 'card_membership',
  'school-transport-registration': 'airport_shuttle',
  'grade-improvement-registration': 'upgrade',
  'student-olympiad-registration': 'stars',

  // ── مشاوره ──
  'consult-tamin': 'support_agent',
  'consult-tax': 'analytics',
  'consult-labor': 'handshake',
  'consult-setadiran': 'shopping_cart_checkout',
  'consult-education': 'psychology_alt',
  'consult-general': 'forum',

  // ── سایر خدمات ──
  'civil-pensioner-payslip': 'summarize',
  'civil-pensioner-order': 'history_edu',
  'civil-pensioner-deduction-letter': 'note_alt',
  'civil-pensioner-arbaeen-loan': 'luggage',
  'civil-pensioner-essential-loan': 'local_atm',
  'civil-pensioner-supplementary-insurance': 'healing',
  'civil-pensioner-children-marriage-loan': 'diamond',
  'smart-national-card-registration': 'fingerprint',
  'civil-registry-address-change': 'edit_location',
  'inheritance-certificate': 'family_restroom',
  'vocational-certificate-inquiry': 'approval',
  'sejam-edit': 'manage_accounts',
  'property-deed-inquiry': 'description',
  'hamyab-registration': 'person_search',
  'arbaeen-currency': 'currency_exchange',
  'health-insurance-registration': 'health_and_safety',
  'health-insurance-renewal': 'autorenew',
  'masir-counseling-registration': 'diversity_3',
  'masir-counseling-appointment': 'calendar_month',
  'sports-insurance-registration': 'sports_soccer',
  'sports-insurance-renewal': 'fitness_center',
  'ili-registration': 'translate',
  'ili-tuition-payment': 'payments',
  'ili-book-purchase': 'auto_stories',
  'samah-registration': 'mosque',
  'petroleum-products-request': 'oil_barrel',
};

/// The exclusive glyph for a bundled service, or null when this build has never
/// heard of the slug (a service added from the admin panel after the release).
IconData? serviceGlyph(String slug) {
  final name = serviceGlyphNames[slug];
  if (name == null) return null;
  return _glyphByName(name);
}

/// Resolves a glyph name from [serviceGlyphNames] to a real [IconData].
///
/// A `switch` over string constants, not a reflective lookup: every branch is
/// checked by the compiler, so a name that does not exist in this Flutter
/// version is a build error rather than a blank icon on a customer's phone.
IconData? _glyphByName(String name) {
  switch (name) {
    case 'account_balance':
      return Icons.account_balance_rounded;
    case 'account_balance_wallet':
      return Icons.account_balance_wallet_rounded;
    case 'add_card':
      return Icons.add_card_rounded;
    case 'add_location_alt':
      return Icons.add_location_alt_rounded;
    case 'airport_shuttle':
      return Icons.airport_shuttle_rounded;
    case 'analytics':
      return Icons.analytics_rounded;
    case 'apartment':
      return Icons.apartment_rounded;
    case 'approval':
      return Icons.approval_rounded;
    case 'architecture':
      return Icons.architecture_rounded;
    case 'article':
      return Icons.article_rounded;
    case 'assignment':
      return Icons.assignment_rounded;
    case 'assignment_ind':
      return Icons.assignment_ind_rounded;
    case 'assignment_late':
      return Icons.assignment_late_rounded;
    case 'assignment_turned_in':
      return Icons.assignment_turned_in_rounded;
    case 'attach_money':
      return Icons.attach_money_rounded;
    case 'auto_stories':
      return Icons.auto_stories_rounded;
    case 'autorenew':
      return Icons.autorenew_rounded;
    case 'badge':
      return Icons.badge_rounded;
    case 'bar_chart':
      return Icons.bar_chart_rounded;
    case 'biotech':
      return Icons.biotech_rounded;
    case 'book':
      return Icons.book_rounded;
    case 'build_circle':
      return Icons.build_circle_rounded;
    case 'business':
      return Icons.business_rounded;
    case 'business_center':
      return Icons.business_center_rounded;
    case 'calculate':
      return Icons.calculate_rounded;
    case 'calendar_month':
      return Icons.calendar_month_rounded;
    case 'call_split':
      return Icons.call_split_rounded;
    case 'car_crash':
      return Icons.car_crash_rounded;
    case 'car_rental':
      return Icons.car_rental_rounded;
    case 'car_repair':
      return Icons.car_repair_rounded;
    case 'card_membership':
      return Icons.card_membership_rounded;
    case 'cast_for_education':
      return Icons.cast_for_education_rounded;
    case 'celebration':
      return Icons.celebration_rounded;
    case 'check_circle':
      return Icons.check_circle_rounded;
    case 'checklist':
      return Icons.checklist_rounded;
    case 'child_care':
      return Icons.child_care_rounded;
    case 'child_friendly':
      return Icons.child_friendly_rounded;
    case 'co_present':
      return Icons.co_present_rounded;
    case 'collections':
      return Icons.collections_rounded;
    case 'commute':
      return Icons.commute_rounded;
    case 'compare_arrows':
      return Icons.compare_arrows_rounded;
    case 'confirmation_number':
      return Icons.confirmation_number_rounded;
    case 'construction':
      return Icons.construction_rounded;
    case 'contact_page':
      return Icons.contact_page_rounded;
    case 'cottage':
      return Icons.cottage_rounded;
    case 'credit_card':
      return Icons.credit_card_rounded;
    case 'credit_score':
      return Icons.credit_score_rounded;
    case 'currency_exchange':
      return Icons.currency_exchange_rounded;
    case 'date_range':
      return Icons.date_range_rounded;
    case 'description':
      return Icons.description_rounded;
    case 'diamond':
      return Icons.diamond_rounded;
    case 'difference':
      return Icons.difference_rounded;
    case 'directions_car':
      return Icons.directions_car_rounded;
    case 'directions_car_filled':
      return Icons.directions_car_filled_rounded;
    case 'diversity_3':
      return Icons.diversity_3_rounded;
    case 'do_not_disturb':
      return Icons.do_not_disturb_rounded;
    case 'drive_file_rename_outline':
      return Icons.drive_file_rename_outline_rounded;
    case 'edit_location':
      return Icons.edit_location_rounded;
    case 'edit_note':
      return Icons.edit_note_rounded;
    case 'emoji_events':
      return Icons.emoji_events_rounded;
    case 'engineering':
      return Icons.engineering_rounded;
    case 'event_available':
      return Icons.event_available_rounded;
    case 'event_note':
      return Icons.event_note_rounded;
    case 'fact_check':
      return Icons.fact_check_rounded;
    case 'family_restroom':
      return Icons.family_restroom_rounded;
    case 'favorite':
      return Icons.favorite_rounded;
    case 'fingerprint':
      return Icons.fingerprint_rounded;
    case 'fitness_center':
      return Icons.fitness_center_rounded;
    case 'flag':
      return Icons.flag_rounded;
    case 'flight':
      return Icons.flight_rounded;
    case 'flight_takeoff':
      return Icons.flight_takeoff_rounded;
    case 'format_list_bulleted':
      return Icons.format_list_bulleted_rounded;
    case 'format_list_numbered':
      return Icons.format_list_numbered_rounded;
    case 'forum':
      return Icons.forum_rounded;
    case 'foundation':
      return Icons.foundation_rounded;
    case 'functions':
      return Icons.functions_rounded;
    case 'gavel':
      return Icons.gavel_rounded;
    case 'grading':
      return Icons.grading_rounded;
    case 'group_add':
      return Icons.group_add_rounded;
    case 'groups':
      return Icons.groups_rounded;
    case 'handshake':
      return Icons.handshake_rounded;
    case 'handyman':
      return Icons.handyman_rounded;
    case 'healing':
      return Icons.healing_rounded;
    case 'health_and_safety':
      return Icons.health_and_safety_rounded;
    case 'heart_broken':
      return Icons.heart_broken_rounded;
    case 'history':
      return Icons.history_rounded;
    case 'history_edu':
      return Icons.history_edu_rounded;
    case 'history_toggle_off':
      return Icons.history_toggle_off_rounded;
    case 'holiday_village':
      return Icons.holiday_village_rounded;
    case 'home_work':
      return Icons.home_work_rounded;
    case 'house':
      return Icons.house_rounded;
    case 'how_to_reg':
      return Icons.how_to_reg_rounded;
    case 'image':
      return Icons.image_rounded;
    case 'import_contacts':
      return Icons.import_contacts_rounded;
    case 'insights':
      return Icons.insights_rounded;
    case 'key':
      return Icons.key_rounded;
    case 'landscape':
      return Icons.landscape_rounded;
    case 'library_books':
      return Icons.library_books_rounded;
    case 'list_alt':
      return Icons.list_alt_rounded;
    case 'local_atm':
      return Icons.local_atm_rounded;
    case 'local_gas_station':
      return Icons.local_gas_station_rounded;
    case 'local_hospital':
      return Icons.local_hospital_rounded;
    case 'local_library':
      return Icons.local_library_rounded;
    case 'local_offer':
      return Icons.local_offer_rounded;
    case 'local_police':
      return Icons.local_police_rounded;
    case 'local_shipping':
      return Icons.local_shipping_rounded;
    case 'location_city':
      return Icons.location_city_rounded;
    case 'location_on':
      return Icons.location_on_rounded;
    case 'lock_reset':
      return Icons.lock_reset_rounded;
    case 'luggage':
      return Icons.luggage_rounded;
    case 'manage_accounts':
      return Icons.manage_accounts_rounded;
    case 'manage_search':
      return Icons.manage_search_rounded;
    case 'markunread_mailbox':
      return Icons.markunread_mailbox_rounded;
    case 'medical_information':
      return Icons.medical_information_rounded;
    case 'medical_services':
      return Icons.medical_services_rounded;
    case 'menu_book':
      return Icons.menu_book_rounded;
    case 'military_tech':
      return Icons.military_tech_rounded;
    case 'minor_crash':
      return Icons.minor_crash_rounded;
    case 'money_off':
      return Icons.money_off_rounded;
    case 'monitor_heart':
      return Icons.monitor_heart_rounded;
    case 'mosque':
      return Icons.mosque_rounded;
    case 'move_up':
      return Icons.move_up_rounded;
    case 'note_add':
      return Icons.note_add_rounded;
    case 'note_alt':
      return Icons.note_alt_rounded;
    case 'notifications_active':
      return Icons.notifications_active_rounded;
    case 'numbers':
      return Icons.numbers_rounded;
    case 'oil_barrel':
      return Icons.oil_barrel_rounded;
    case 'paid':
      return Icons.paid_rounded;
    case 'payments':
      return Icons.payments_rounded;
    case 'person_add':
      return Icons.person_add_rounded;
    case 'person_add_alt':
      return Icons.person_add_alt_rounded;
    case 'person_search':
      return Icons.person_search_rounded;
    case 'pin':
      return Icons.pin_rounded;
    case 'plagiarism':
      return Icons.plagiarism_rounded;
    case 'playlist_add_check':
      return Icons.playlist_add_check_rounded;
    case 'post_add':
      return Icons.post_add_rounded;
    case 'pregnant_woman':
      return Icons.pregnant_woman_rounded;
    case 'price_change':
      return Icons.price_change_rounded;
    case 'price_check':
      return Icons.price_check_rounded;
    case 'propane_tank':
      return Icons.propane_tank_rounded;
    case 'psychology':
      return Icons.psychology_rounded;
    case 'psychology_alt':
      return Icons.psychology_alt_rounded;
    case 'public':
      return Icons.public_rounded;
    case 'qr_code_2':
      return Icons.qr_code_2_rounded;
    case 'query_stats':
      return Icons.query_stats_rounded;
    case 'quiz':
      return Icons.quiz_rounded;
    case 'real_estate_agent':
      return Icons.real_estate_agent_rounded;
    case 'receipt':
      return Icons.receipt_rounded;
    case 'receipt_long':
      return Icons.receipt_long_rounded;
    case 'redeem':
      return Icons.redeem_rounded;
    case 'request_page':
      return Icons.request_page_rounded;
    case 'request_quote':
      return Icons.request_quote_rounded;
    case 'restart_alt':
      return Icons.restart_alt_rounded;
    case 'rule':
      return Icons.rule_rounded;
    case 'savings':
      return Icons.savings_rounded;
    case 'schedule':
      return Icons.schedule_rounded;
    case 'school':
      return Icons.school_rounded;
    case 'science':
      return Icons.science_rounded;
    case 'sell':
      return Icons.sell_rounded;
    case 'shield':
      return Icons.shield_rounded;
    case 'shopping_basket':
      return Icons.shopping_basket_rounded;
    case 'shopping_cart_checkout':
      return Icons.shopping_cart_checkout_rounded;
    case 'speed':
      return Icons.speed_rounded;
    case 'sports_soccer':
      return Icons.sports_soccer_rounded;
    case 'star':
      return Icons.star_rounded;
    case 'stars':
      return Icons.stars_rounded;
    case 'storefront':
      return Icons.storefront_rounded;
    case 'stroller':
      return Icons.stroller_rounded;
    case 'summarize':
      return Icons.summarize_rounded;
    case 'support':
      return Icons.support_rounded;
    case 'support_agent':
      return Icons.support_agent_rounded;
    case 'swap_horiz':
      return Icons.swap_horiz_rounded;
    case 'swap_vert':
      return Icons.swap_vert_rounded;
    case 'switch_account':
      return Icons.switch_account_rounded;
    case 'sync_alt':
      return Icons.sync_alt_rounded;
    case 'sync_problem':
      return Icons.sync_problem_rounded;
    case 'tire_repair':
      return Icons.tire_repair_rounded;
    case 'toll':
      return Icons.toll_rounded;
    case 'traffic':
      return Icons.traffic_rounded;
    case 'transfer_within_a_station':
      return Icons.transfer_within_a_station_rounded;
    case 'translate':
      return Icons.translate_rounded;
    case 'trending_flat':
      return Icons.trending_flat_rounded;
    case 'trending_up':
      return Icons.trending_up_rounded;
    case 'two_wheeler':
      return Icons.two_wheeler_rounded;
    case 'update':
      return Icons.update_rounded;
    case 'upgrade':
      return Icons.upgrade_rounded;
    case 'verified':
      return Icons.verified_rounded;
    case 'verified_user':
      return Icons.verified_user_rounded;
    case 'volunteer_activism':
      return Icons.volunteer_activism_rounded;
    case 'wallet':
      return Icons.wallet_rounded;
    case 'work':
      return Icons.work_rounded;
    case 'work_off':
      return Icons.work_off_rounded;
    case 'workspace_premium':
      return Icons.workspace_premium_rounded;
    default:
      return null;
  }
}
