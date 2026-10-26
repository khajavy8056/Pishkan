/**
 * Single source of truth for every admin-editable setting.
 *
 * The admin UI is rendered from this catalogue, so adding an option here is
 * enough to make it appear (with label, help text, validation and grouping) in
 * «تنظیمات سامانه» — no frontend change required.
 */

export type SettingType =
  | 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  | 'color' | 'json' | 'password' | 'url' | 'email' | 'tel' | 'time' | 'cron';

export interface SettingDef {
  key: string;
  group: SettingGroupCode;
  type: SettingType;
  label: string;
  hint?: string;
  default: string | number | boolean;
  options?: { value: string; label: string }[];
  /** value is encrypted at rest and never returned to the browser in clear text */
  secret?: boolean;
  /** safe to expose without authentication (branding, contact info, feature flags) */
  public?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  /** marks settings whose change requires extra confirmation in the UI */
  critical?: boolean;
}

export type SettingGroupCode =
  | 'general' | 'domain' | 'auth' | 'sms' | 'email' | 'security' | 'services'
  | 'accounting' | 'workforce' | 'assistant' | 'files' | 'backup' | 'maintenance' | 'multibranch';

export const SETTING_GROUPS: {
  code: SettingGroupCode;
  title: string;
  description: string;
  icon: string;
  order: number;
}[] = [
  { code: 'general', title: 'تنظیمات عمومی سایت', description: 'نام، لوگو، اطلاعات تماس، ساعات کاری و متن‌های عمومی', icon: 'store', order: 1 },
  { code: 'domain', title: 'دامنه و نشانی‌ها', description: 'دامنه اصلی، زیردامنه API، HTTPS و اتصال Cloudflare', icon: 'globe', order: 2 },
  { code: 'auth', title: 'ورود و ثبت‌نام', description: 'روش ورود مشتریان و کارکنان، ثبت‌نام و سیاست رمز عبور', icon: 'key', order: 3 },
  { code: 'sms', title: 'پیامک و ملی پیامک', description: 'اتصال به ارائه‌دهنده پیامک، الگوهای تأییدشده و آزمایش ارسال', icon: 'message', order: 4 },
  { code: 'email', title: 'ایمیل و اعلان‌ها', description: 'سرویس ایمیل و اعلان‌های خودکار رویدادها', icon: 'mail', order: 5 },
  { code: 'security', title: 'امنیت', description: 'HTTPS، سیاست نشست‌ها، محدودیت تلاش ورود و نگهداری لاگ', icon: 'shield', order: 6 },
  { code: 'services', title: 'خدمات و گردش کار', description: 'ارجاع خودکار، مدارک، خدمات اختصاصی و وضعیت پذیرش', icon: 'layers', order: 7 },
  { code: 'accounting', title: 'حسابداری و پرداخت', description: 'درگاه پرداخت، مالیات، شماره‌گذاری فاکتور و قوانین بازپرداخت', icon: 'wallet', order: 8 },
  { code: 'workforce', title: 'کارکنان و شیفت‌ها', description: 'قوانین شیفت، حضور و غیاب و ظرفیت کاری', icon: 'calendar', order: 9 },
  { code: 'assistant', title: 'دستیار هوشمند', description: 'رفتار دستیار، منابع پاسخ‌گویی و مدل زبانی', icon: 'sparkles', order: 10 },
  { code: 'files', title: 'فایل‌ها و مدارک', description: 'محدودیت حجم و نوع فایل و نگهداری مدارک', icon: 'folder', order: 11 },
  { code: 'backup', title: 'پشتیبان‌گیری', description: 'زمان‌بندی، مقصد ذخیره و نگهداری نسخه‌های پشتیبان', icon: 'database', order: 12 },
  { code: 'maintenance', title: 'نگهداری و گزارش‌ها', description: 'لاگ‌ها، وضعیت سلامت، حالت تعمیر و گزارش‌های خودکار', icon: 'activity', order: 13 },
  { code: 'multibranch', title: 'چنددفتره', description: 'آماده‌سازی برای مدیریت چند دفتر مستقل (آزمایشی)', icon: 'building', order: 14 },
];

const bool = (v: boolean) => v;

export const SETTINGS: SettingDef[] = [
  /* ------------------------------- general -------------------------------- */
  { key: 'site.name', group: 'general', type: 'text', label: 'نام سامانه', hint: 'در هدر، عنوان صفحه‌ها و پیامک‌ها استفاده می‌شود.', default: 'دفتر پیشخوان دولت', public: true },
  { key: 'site.short_name', group: 'general', type: 'text', label: 'نام کوتاه', default: 'پیشخوان', public: true },
  { key: 'site.tagline', group: 'general', type: 'text', label: 'شعار / زیرعنوان', default: 'خدمات دولتی، سریع و شفاف', public: true },
  { key: 'site.description', group: 'general', type: 'textarea', label: 'توضیحات سایت', hint: 'در فوتر و توضیحات متا استفاده می‌شود.', default: 'سامانه جامع ارائه خدمات دفتر پیشخوان دولت', public: true },
  { key: 'site.logo_file_id', group: 'general', type: 'text', label: 'شناسه فایل لوگو', hint: 'از بخش فایل‌ها آپلود کنید؛ خالی یعنی لوگوی پیش‌فرض.', default: '', public: true },
  { key: 'site.welcome_message', group: 'general', type: 'textarea', label: 'پیام خوشامدگویی پنل مشتری', default: 'به سامانه خدمات پیشخوان خوش آمدید. درخواست خود را انتخاب کنید و مراحل را آنلاین دنبال کنید.', public: true },
  { key: 'site.footer_text', group: 'general', type: 'text', label: 'متن فوتر', default: 'تمام حقوق محفوظ است.', public: true },
  { key: 'brand.primary_color', group: 'general', type: 'color', label: 'رنگ اصلی برند', default: '#1d4ed8', public: true },
  { key: 'brand.navy_color', group: 'general', type: 'color', label: 'رنگ سرمه‌ای برند', default: '#0b1f3a', public: true },
  { key: 'office.name', group: 'general', type: 'text', label: 'نام دفتر', default: 'دفتر پیشخوان دولت', public: true },
  { key: 'office.phone', group: 'general', type: 'tel', label: 'تلفن دفتر', default: '', public: true },
  { key: 'office.mobile', group: 'general', type: 'tel', label: 'موبایل دفتر', default: '', public: true },
  { key: 'office.email', group: 'general', type: 'email', label: 'ایمیل دفتر', default: '', public: true },
  { key: 'office.address', group: 'general', type: 'textarea', label: 'نشانی دفتر', default: '', public: true },
  { key: 'office.province', group: 'general', type: 'text', label: 'استان', default: '', public: true },
  { key: 'office.city', group: 'general', type: 'text', label: 'شهر', default: '', public: true },
  { key: 'office.postal_code', group: 'general', type: 'text', label: 'کد پستی', default: '', public: true },
  { key: 'office.working_hours', group: 'general', type: 'text', label: 'ساعات کاری', hint: 'مثال: شنبه تا چهارشنبه ۸ تا ۱۶، پنجشنبه ۸ تا ۱۲', default: 'شنبه تا چهارشنبه ۸:۰۰ تا ۱۶:۰۰', public: true },
  { key: 'site.terms', group: 'general', type: 'textarea', label: 'شرایط استفاده', hint: 'در صفحه‌ای مستقل برای مشتریان نمایش داده می‌شود.', default: '' },
  { key: 'site.privacy', group: 'general', type: 'textarea', label: 'سیاست حریم خصوصی', default: '' },
  { key: 'site.social_links', group: 'general', type: 'json', label: 'شبکه‌های اجتماعی', hint: 'آرایه JSON از {title,url}', default: '[]', public: true },
  { key: 'site.support_notice', group: 'general', type: 'textarea', label: 'اطلاعیه بالای سایت', hint: 'اگر مقدار داشته باشد به‌صورت نوار اطلاعیه نمایش داده می‌شود.', default: '', public: true },
  { key: 'site.calendar', group: 'general', type: 'select', label: 'تقویم نمایش تاریخ', options: [{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }], default: 'jalali', public: true },
  { key: 'site.currency_label', group: 'general', type: 'text', label: 'واحد پول نمایشی', default: 'ریال', public: true },

  /* -------------------------------- domain -------------------------------- */
  { key: 'domain.primary', group: 'domain', type: 'text', label: 'دامنه اصلی', hint: 'بدون https و بدون اسلش پایانی. مثال: pishkhan.example.ir', default: '', public: true },
  { key: 'domain.api', group: 'domain', type: 'text', label: 'زیردامنه API', hint: 'اگر خالی باشد از مسیر /api روی همان دامنه استفاده می‌شود.', default: '', public: true },
  { key: 'domain.public_url', group: 'domain', type: 'url', label: 'نشانی عمومی سامانه', hint: 'برای ساخت لینک‌های مطلق (پیامک، ایمیل، اعلان) استفاده می‌شود.', default: '' },
  { key: 'domain.proxy_provider', group: 'domain', type: 'select', label: 'لایه Proxy / CDN', options: [{ value: 'none', label: 'بدون Proxy' }, { value: 'cloudflare', label: 'Cloudflare' }], default: 'cloudflare' },
  { key: 'domain.ssl_mode', group: 'domain', type: 'select', label: 'حالت SSL', hint: 'حالت Full (strict) توصیه می‌شود؛ هرگز Flexible را برای فرم‌های ورود انتخاب نکنید.', options: [{ value: 'full_strict', label: 'Full (strict) — توصیه‌شده' }, { value: 'full', label: 'Full' }, { value: 'flexible', label: 'Flexible (ناامن)' }], default: 'full_strict' },
  { key: 'domain.cloudflare_zone_id', group: 'domain', type: 'text', label: 'Cloudflare Zone ID', default: '' },
  { key: 'domain.cloudflare_api_token', group: 'domain', type: 'password', secret: true, label: 'Cloudflare API Token', hint: 'توکن با دسترسی Zone.DNS Edit. رمزنگاری‌شده ذخیره می‌شود.', default: '' },
  { key: 'domain.dns_target_ip', group: 'domain', type: 'text', label: 'IP سرور برای رکورد DNS', default: '', public: true },

  /* --------------------------------- auth --------------------------------- */
  { key: 'auth.customer_otp_enabled', group: 'auth', type: 'boolean', label: 'ورود مشتری با رمز یک‌بارمصرف', hint: 'خاموش‌کردن آن فقط وقتی مجاز است که ورود با رمز عبور مشتریان فعال باشد.', default: bool(false), public: true },
  { key: 'auth.customer_password_enabled', group: 'auth', type: 'boolean', label: 'ورود مشتری با نام کاربری و رمز عبور', default: bool(true), public: true },
  { key: 'auth.customer_combined_required', group: 'auth', type: 'boolean', label: 'روش ترکیبی: رمز عبور + تأیید پیامک', hint: 'اگر فعال باشد، رمز عبور معتبر بدون تأیید کد پیامک کافی نیست.', default: bool(false) },
  { key: 'auth.customer_registration_open', group: 'auth', type: 'boolean', label: 'امکان ثبت‌نام عمومی مشتری', default: bool(true), public: true },
  { key: 'auth.customer_auto_register_otp', group: 'auth', type: 'boolean', label: 'ایجاد خودکار حساب در اولین ورود با کد', hint: 'اگر غیرفعال باشد، شماره ناشناس اجازه ورود نمی‌یابد.', default: bool(true) },
  { key: 'auth.customer_require_approval', group: 'auth', type: 'boolean', label: 'نیاز به تأیید حساب توسط دفتر', default: bool(false) },
  { key: 'auth.customer_require_mobile_verification', group: 'auth', type: 'boolean', label: 'الزام تأیید شماره موبایل برای حساب‌های رمز عبوری', default: bool(false) },
  { key: 'auth.staff_mfa_required', group: 'auth', type: 'boolean', label: 'الزام ورود دومرحله‌ای برای کارکنان', hint: 'برای نقش‌های مالی و مدیریتی توصیه می‌شود.', default: bool(false) },
  { key: 'auth.staff_otp_enabled', group: 'auth', type: 'boolean', label: 'ورود پیامکی کارکنان', hint: 'فقط پس از تأیید واقعی پیامک فعال کنید.', default: bool(false), public: true },
  { key: 'auth.staff_password_login', group: 'auth', type: 'boolean', critical: true, label: 'اجازه ورود کارکنان با رمز عبور', hint: 'غیرفعال‌کردن آن فقط با پیامک فعال و شماره موبایل ثبت‌شده مدیر مجاز است تا قفل‌شدن مدیر کل رخ ندهد.', default: bool(true) },
  { key: 'auth.password_min_length', group: 'auth', type: 'number', label: 'حداقل طول رمز عبور', default: 10, min: 8, max: 128 },
  { key: 'auth.password_require_mixed', group: 'auth', type: 'boolean', label: 'الزام ترکیب حرف و رقم در رمز عبور', default: bool(true) },
  { key: 'auth.max_login_attempts', group: 'auth', type: 'number', label: 'حداکثر تلاش ناموفق ورود', default: 5, min: 3, max: 20 },
  { key: 'auth.lockout_minutes', group: 'auth', type: 'number', label: 'مدت قفل حساب (دقیقه)', default: 15, min: 1, max: 1440 },
  { key: 'auth.session_ttl_hours', group: 'auth', type: 'number', label: 'مدت اعتبار نشست (ساعت)', default: 168, min: 1, max: 8760 },
  { key: 'auth.otp_ttl_seconds', group: 'auth', type: 'number', label: 'اعتبار کد یک‌بارمصرف (ثانیه)', default: 120, min: 60, max: 600 },
  { key: 'auth.otp_max_attempts', group: 'auth', type: 'number', label: 'حداکثر تلاش برای هر کد', default: 5, min: 2, max: 10 },
  { key: 'auth.otp_resend_seconds', group: 'auth', type: 'number', label: 'زمان انتظار ارسال مجدد (ثانیه)', default: 60, min: 30, max: 600 },
  { key: 'auth.otp_daily_limit', group: 'auth', type: 'number', label: 'حداکثر ارسال کد در روز برای هر شماره', default: 10, min: 3, max: 50 },
  { key: 'auth.allow_customer_password_reset', group: 'auth', type: 'boolean', label: 'امکان بازیابی رمز عبور با پیامک', default: bool(true) },
  { key: 'auth.otp_code_length', group: 'auth', type: 'number', label: 'طول کد یک‌بارمصرف', default: 5, min: 4, max: 8 },

  /* ---------------------------------- sms --------------------------------- */
  { key: 'sms.enabled', group: 'sms', type: 'boolean', label: 'ارسال پیامک فعال باشد', default: bool(false) },
  { key: 'sms.provider', group: 'sms', type: 'select', label: 'ارائه‌دهنده پیامک', options: [{ value: 'melipayamak', label: 'ملی پیامک (Melipayamak)' }, { value: 'console', label: 'شبیه‌ساز محیط توسعه' }], default: 'melipayamak' },
  { key: 'sms.auth_mode', group: 'sms', type: 'select', label: 'روش احراز هویت', hint: 'مطابق مستندات رسمی ملی پیامک انتخاب کنید.', options: [{ value: 'credentials', label: 'نام کاربری و رمز عبور' }, { value: 'apikey', label: 'کلید API' }], default: 'credentials' },
  { key: 'sms.username', group: 'sms', type: 'password', secret:true, label: 'نام کاربری ملی پیامک', default: '' },
  { key: 'sms.password', group: 'sms', type: 'password', secret: true, label: 'رمز عبور ملی پیامک', default: '' },
  { key: 'sms.api_key', group: 'sms', type: 'password', secret: true, label: 'کلید API ملی پیامک', default: '' },
  { key: 'sms.sender_line', group: 'sms', type: 'text', label: 'شماره خط ارسال', hint: 'برای ارسال با الگو لازم نیست؛ برای ارسال ساده الزامی است.', default: '' },
  { key: 'sms.base_url', group: 'sms', type: 'url', label: 'نشانی سرویس', hint: 'مقدار پیش‌فرض طبق مستندات رسمی؛ فقط در صورت تغییر سرویس ویرایش کنید.', default: 'https://rest.payamak-panel.com/api' },
  { key: 'sms.otp_template_id', group: 'sms', type: 'text', label: 'شناسه الگوی تأییدشده کد ورود', hint: 'الگو باید در پنل ملی پیامک تأیید شده باشد.', default: '' },
  { key: 'sms.otp_template_body', group: 'sms', type: 'text', label: 'متن الگوی کد ورود', hint: 'نام پارامتر کد را با همین متن مشخص کنید. مثال: کد ورود شما {0} است', default: 'کد ورود شما {0} است' },
  { key: 'sms.otp_param_name', group: 'sms', type: 'text', label: 'نام پارامتر کد در الگو', hint: 'مطابق الگوی ثبت‌شده در ملی پیامک.', default: '0' },
  { key: 'sms.notify_template_id', group: 'sms', type: 'text', label: 'شناسه الگوی اعلان‌ها', default: '' },
  { key: 'sms.notify_enabled', group: 'sms', type: 'boolean', label: 'ارسال پیامک اعلان رویدادها', default: bool(false) },
  { key: 'sms.daily_limit', group: 'sms', type: 'number', label: 'سقف ارسال روزانه سامانه', hint: 'برای جلوگیری از مصرف ناخواسته اعتبار.', default: 500, min: 1, max: 100000 },
  { key: 'sms.log_body', group: 'sms', type: 'boolean', label: 'ثبت متن پیامک در لاگ داخلی', hint: 'برای حریم خصوصی مشتریان بهتر است خاموش باشد.', default: bool(false) },
  { key: 'sms.test_recipient', group: 'sms', type: 'tel', label: 'شماره مقصد پیامک آزمایشی', default: '' },

  /* --------------------------------- email -------------------------------- */
  { key: 'email.enabled', group: 'email', type: 'boolean', label: 'ارسال ایمیل فعال باشد', default: bool(false) },
  { key: 'email.host', group: 'email', type: 'text', label: 'هاست SMTP', default: '' },
  { key: 'email.port', group: 'email', type: 'number', label: 'پورت SMTP', default: 587, min: 1, max: 65535 },
  { key: 'email.secure', group: 'email', type: 'boolean', label: 'اتصال امن (TLS)', default: bool(true) },
  { key: 'email.user', group: 'email', type: 'text', label: 'نام کاربری SMTP', default: '' },
  { key: 'email.password', group: 'email', type: 'password', secret: true, label: 'رمز عبور SMTP', default: '' },
  { key: 'email.from_name', group: 'email', type: 'text', label: 'نام فرستنده', default: 'دفتر پیشخوان' },
  { key: 'email.from_address', group: 'email', type: 'email', label: 'ایمیل فرستنده', default: '' },
  { key: 'email.notify_new_request', group: 'email', type: 'boolean', label: 'ایمیل هنگام ثبت درخواست جدید', default: bool(true) },
  { key: 'email.notify_status_change', group: 'email', type: 'boolean', label: 'ایمیل هنگام تغییر وضعیت پرونده', default: bool(true) },
  { key: 'email.notify_payment', group: 'email', type: 'boolean', label: 'ایمیل هنگام پرداخت', default: bool(true) },

  /* -------------------------------- security ------------------------------- */
  { key: 'security.force_https', group: 'security', type: 'boolean', label: 'اجبار HTTPS', hint: 'درخواست‌های HTTP به HTTPS هدایت می‌شوند.', default: bool(true) },
  { key: 'security.hsts', group: 'security', type: 'boolean', label: 'فعال‌سازی HSTS', default: bool(true) },
  { key: 'security.trust_proxy', group: 'security', type: 'boolean', label: 'اعتماد به هدرهای Proxy', hint: 'در پشت Nginx/Cloudflare باید فعال باشد.', default: bool(true) },
  { key: 'security.bind_session_to_ip', group: 'security', type: 'boolean', label: 'اتصال نشست به IP', hint: 'امنیت بیشتر، اما برای کاربران موبایل با IP متغیر آزاردهنده است.', default: bool(false) },
  { key: 'security.max_sessions_per_user', group: 'security', type: 'number', label: 'حداکثر نشست همزمان هر کاربر', default: 5, min: 1, max: 50 },
  { key: 'security.audit_retention_days', group: 'security', type: 'number', label: 'نگهداری تاریخچه عملیات (روز)', default: 365, min: 30, max: 3650 },
  { key: 'security.admin_ip_allowlist', group: 'security', type: 'text', label: 'محدودسازی IP پنل مدیر', hint: 'IPها با کاما جدا شوند؛ خالی یعنی بدون محدودیت.', default: '' },
  { key: 'security.require_mfa_finance', group: 'security', type: 'boolean', label: 'الزام ورود دومرحله‌ای برای نقش‌های مالی', default: bool(false) },
  { key: 'security.password_expiry_days', group: 'security', type: 'number', label: 'انقضای رمز عبور کارکنان (روز)', hint: 'صفر یعنی بدون انقضا.', default: 0, min: 0, max: 365 },
  { key: 'security.content_security_policy', group: 'security', type: 'textarea', label: 'سیاست CSP', hint: 'خالی یعنی مقدار پیش‌فرض امن سامانه.', default: '' },

  /* -------------------------------- services ------------------------------- */
  { key: 'services.accepting_requests', group: 'services', type: 'boolean', label: 'پذیرش درخواست به‌صورت سراسری', hint: 'خاموش کردن این گزینه فقط نمایش کاتالوگ را حفظ می‌کند.', default: bool(true), public: true },
  { key: 'services.auto_assign', group: 'services', type: 'boolean', label: 'ارجاع خودکار به کارشناس', default: bool(true) },
  { key: 'services.auto_assign_strategy', group: 'services', type: 'select', label: 'سازوکار ارجاع', options: [{ value: 'round_robin', label: 'نوبتی بین کارشناسان واجد شرایط' }, { value: 'least_loaded', label: 'کمترین بار کاری' }, { value: 'fixed', label: 'کارشناس ثابت هر خدمت' }, { value: 'queue', label: 'صف انتظار برای مدیر' }], default: 'least_loaded' },
  { key: 'services.max_active_cases_per_staff', group: 'services', type: 'number', label: 'حداکثر پرونده فعال هر کارشناس', default: 20, min: 1, max: 500 },
  { key: 'services.require_document_approval', group: 'services', type: 'boolean', label: 'الزام تأیید مدارک پیش از پیشروی پرونده', default: bool(true) },
  { key: 'services.allow_custom_services', group: 'services', type: 'boolean', label: 'اجازه ایجاد خدمت اختصاصی توسط کارکنان مجاز', default: bool(true) },
  { key: 'services.custom_offer_expiry_hours', group: 'services', type: 'number', label: 'اعتبار پیشنهاد خدمت اختصاصی (ساعت)', default: 72, min: 1, max: 720 },
  { key: 'services.request_number_prefix', group: 'services', type: 'text', label: 'پیشوند شماره پیگیری', default: 'PK' },
  { key: 'services.notify_customer_status', group: 'services', type: 'boolean', label: 'اطلاع‌رسانی تغییر وضعیت به مشتری', default: bool(true) },
  { key: 'services.auto_close_completed_days', group: 'services', type: 'number', label: 'بستن خودکار پرونده تکمیل‌شده پس از (روز)', hint: 'صفر یعنی غیرفعال.', default: 0, min: 0, max: 90 },
  { key: 'services.default_payment_methods', group: 'services', type: 'json', label: 'روش‌های پرداخت پیش‌فرض خدمات', hint: 'آرایه JSON از online, cash, pos, transfer', default: '["online","cash","pos"]' },
  { key: 'services.default_estimated_days', group: 'services', type: 'number', label: 'زمان تخمینی پیش‌فرض (روز کاری)', default: 3, min: 1, max: 90 },
  { key: 'services.show_prices_publicly', group: 'services', type: 'boolean', label: 'نمایش هزینه‌ها در کاتالوگ عمومی', default: bool(true), public: true },
  { key: 'services.catalog_notice', group: 'services', type: 'textarea', label: 'یادداشت بالای کاتالوگ خدمات', hint: 'برای اعلام «هزینه‌ها نمونه و نیازمند تأیید است».', default: 'هزینه‌ها و شرایط نمایش‌داده‌شده نمونه هستند و هزینه نهایی پس از بررسی مدارک اعلام می‌شود.', public: true },

  /* ------------------------------- accounting ------------------------------ */
  { key: 'accounting.online_payment_enabled', group: 'accounting', type: 'boolean', label: 'پرداخت آنلاین فعال', default: bool(false), public: true },
  { key: 'accounting.cash_payment_enabled', group: 'accounting', type: 'boolean', label: 'ثبت پرداخت حضوری توسط کارمند', default: bool(true) },
  { key: 'accounting.gateway', group: 'accounting', type: 'select', label: 'درگاه پرداخت', options: [{ value: 'none', label: 'بدون درگاه' }, { value: 'test', label: 'درگاه آزمایشی (شبیه‌ساز)' }, { value: 'zarinpal', label: 'زرین‌پال' }, { value: 'idpay', label: 'آیدی‌پی' }], default: 'none' },
  { key: 'accounting.gateway_merchant_id', group: 'accounting', type: 'password', secret:true, label: 'شناسه پذیرنده / Merchant ID', default: '' },
  { key: 'accounting.gateway_api_key', group: 'accounting', type: 'password', secret: true, label: 'کلید API درگاه', default: '' },
  { key: 'accounting.gateway_sandbox', group: 'accounting', type: 'boolean', label: 'حالت آزمایشی درگاه', default: bool(true) },
  { key: 'accounting.tax_percent', group: 'accounting', type: 'number', label: 'درصد مالیات بر ارزش افزوده', default: 0, min: 0, max: 50 },
  { key: 'accounting.office_share_percent', group: 'accounting', type: 'number', label: 'سهم دفتر از مبلغ خدمت (درصد)', hint: 'برای گزارش سود عملیاتی؛ مابقی سهم سازمان متولی در نظر گرفته می‌شود.', default: 100, min: 0, max: 100 },
  { key: 'accounting.invoice_prefix', group: 'accounting', type: 'text', label: 'پیشوند شماره فاکتور', default: 'INV' },
  { key: 'accounting.allow_refund', group: 'accounting', type: 'boolean', label: 'امکان بازپرداخت', default: bool(true) },
  { key: 'accounting.refund_window_days', group: 'accounting', type: 'number', label: 'مهلت بازپرداخت (روز)', default: 7, min: 0, max: 90 },
  { key: 'accounting.revenue_recognition', group: 'accounting', type: 'select', label: 'مبنای شناسایی درآمد', options: [{ value: 'on_payment', label: 'هنگام پرداخت (نقدی)' }, { value: 'on_invoice', label: 'هنگام صدور فاکتور (تعهدی)' }], default: 'on_payment' },
  { key: 'accounting.fiscal_year_start_month', group: 'accounting', type: 'number', label: 'ماه شروع سال مالی (شمسی)', default: 1, min: 1, max: 12 },
  { key: 'accounting.min_online_payment', group: 'accounting', type: 'number', label: 'حداقل مبلغ پرداخت آنلاین (ریال)', default: 10000, min: 0, max: 100000000 },

  /* -------------------------------- workforce ------------------------------ */
  { key: 'workforce.week_starts_on', group: 'workforce', type: 'number', label: 'روز شروع هفته (۰=شنبه)', default: 0, min: 0, max: 6 },
  { key: 'workforce.late_grace_minutes', group: 'workforce', type: 'number', label: 'مهلت تأخیر مجاز (دقیقه)', default: 10, min: 0, max: 120 },
  { key: 'workforce.attendance_required', group: 'workforce', type: 'boolean', label: 'ثبت حضور و غیاب الزامی است', default: bool(true) },
  { key: 'workforce.allow_self_checkin', group: 'workforce', type: 'boolean', label: 'ثبت ورود و خروج توسط خود کارمند', default: bool(true) },
  { key: 'workforce.shift_swap_requires_approval', group: 'workforce', type: 'boolean', label: 'تأیید مدیر برای تغییر شیفت', default: bool(true) },
  { key: 'workforce.max_weekly_hours', group: 'workforce', type: 'number', label: 'حداکثر ساعات کاری هفتگی', default: 44, min: 1, max: 100 },
  { key: 'workforce.default_shift_capacity', group: 'workforce', type: 'number', label: 'ظرفیت پیش‌فرض هر شیفت', default: 10, min: 1, max: 200 },
  { key: 'workforce.auto_assign_on_shift', group: 'workforce', type: 'boolean', label: 'فقط کارشناسان حاضر در شیفت ارجاع بگیرند', default: bool(true) },

  /* -------------------------------- assistant ------------------------------ */
  { key: 'assistant.enabled', group: 'assistant', type: 'boolean', label: 'دستیار هوشمند فعال', default: bool(true), public: true },
  { key: 'assistant.name', group: 'assistant', type: 'text', label: 'نام دستیار', default: 'دستیار هوشمند پیشخوان', public: true },
  { key: 'assistant.welcome', group: 'assistant', type: 'textarea', label: 'پیام شروع گفت‌وگو', default: 'سلام! چه خدمتی نیاز دارید؟ من می‌توانم خدمت مناسب را پیدا کنم و شما را به ثبت درخواست هدایت کنم.', public: true },
  { key: 'assistant.catalog_only', group: 'assistant', type: 'boolean', label: 'پاسخ فقط بر پایه کاتالوگ تأییدشده', hint: 'اگر اطلاعات کافی نباشد، دستیار باید اعلام کند و کارشناس را پیشنهاد دهد.', default: bool(true) },
  { key: 'assistant.max_suggestions', group: 'assistant', type: 'number', label: 'حداکثر پیشنهاد خدمت در هر پاسخ', default: 3, min: 1, max: 8 },
  { key: 'assistant.llm_provider', group: 'assistant', type: 'select', label: 'موتور پاسخ‌گویی', options: [{ value: 'builtin', label: 'موتور داخلی جست‌وجوی معنایی (بدون سرویس خارجی)' }, { value: 'openai', label: 'سرویس مدل زبانی سازگار با OpenAI' }], default: 'builtin' },
  { key: 'assistant.llm_base_url', group: 'assistant', type: 'url', label: 'نشانی سرویس مدل', default: 'https://api.openai.com/v1' },
  { key: 'assistant.llm_api_key', group: 'assistant', type: 'password', secret: true, label: 'کلید API مدل', default: '' },
  { key: 'assistant.llm_model', group: 'assistant', type: 'text', label: 'نام مدل', default: 'gpt-4o-mini' },
  { key: 'assistant.disclaimer', group: 'assistant', type: 'textarea', label: 'سلب مسئولیت', default: 'پاسخ‌های دستیار راهنمای اولیه است و جایگزین نظر کارشناس رسمی نیست.', public: true },

  /* ---------------------------------- files -------------------------------- */
  { key: 'files.max_size_mb', group: 'files', type: 'number', label: 'حداکثر حجم هر فایل (مگابایت)', default: 10, min: 1, max: 100 },
  { key: 'files.allowed_types', group: 'files', type: 'json', label: 'پسوندهای مجاز', default: '["jpg","jpeg","png","webp","pdf"]' },
  { key: 'files.retention_days', group: 'files', type: 'number', label: 'نگهداری فایل مدارک (روز)', hint: 'صفر یعنی نگهداری دائمی.', default: 0, min: 0, max: 3650 },
  { key: 'files.image_max_width', group: 'files', type: 'number', label: 'حداکثر عرض تصویر پردازش‌شده (پیکسل)', default: 1600, min: 400, max: 6000 },

  /* --------------------------------- backup -------------------------------- */
  { key: 'backup.enabled', group: 'backup', type: 'boolean', label: 'پشتیبان‌گیری خودکار فعال', default: bool(true) },
  { key: 'backup.schedule_cron', group: 'backup', type: 'cron', label: 'زمان‌بندی پشتیبان‌گیری', hint: 'قالب cron؛ مثال: 0 2 * * * برای هر روز ساعت ۲ بامداد.', default: '0 2 * * *' },
  { key: 'backup.retention_days', group: 'backup', type: 'number', label: 'نگهداری نسخه‌های پشتیبان (روز)', default: 30, min: 1, max: 365 },
  { key: 'backup.destination', group: 'backup', type: 'select', label: 'مقصد ذخیره', options: [{ value: 'local', label: 'پوشه محلی سرور' }, { value: 'remote', label: 'مقصد خارجی (rclone/S3)' }], default: 'local' },
  { key: 'backup.remote_config', group: 'backup', type: 'password', secret: true, label: 'تنظیمات مقصد خارجی', hint: 'JSON ابزار rclone یا اعتبارنامه S3؛ رمزنگاری‌شده ذخیره می‌شود.', default: '' },
  { key: 'backup.include_uploads', group: 'backup', type: 'boolean', label: 'شامل فایل‌های مدارک', default: bool(true) },
  { key: 'backup.verify_after_backup', group: 'backup', type: 'boolean', label: 'بررسی صحت نسخه پشتیبان پس از ایجاد', default: bool(true) },
  { key: 'backup.require_restore_confirmation', group: 'backup', type: 'boolean', label: 'الزام تأیید متنی برای بازیابی', default: bool(true) },

  /* ------------------------------ maintenance ------------------------------ */
  { key: 'maintenance.mode', group: 'maintenance', type: 'boolean', label: 'حالت تعمیرات', hint: 'پنل مشتری غیرفعال و پیام نگهداری نمایش داده می‌شود؛ ورود مدیر باز می‌ماند.', default: bool(false), public: true },
  { key: 'maintenance.message', group: 'maintenance', type: 'textarea', label: 'پیام حالت تعمیرات', default: 'سامانه موقتاً در حال به‌روزرسانی است. لطفاً چند دقیقه دیگر مراجعه کنید.', public: true },
  { key: 'maintenance.log_level', group: 'maintenance', type: 'select', label: 'سطح لاگ', options: [{ value: 'debug', label: 'debug' }, { value: 'info', label: 'info' }, { value: 'warn', label: 'warn' }, { value: 'error', label: 'error' }], default: 'info' },
  { key: 'maintenance.log_retention_days', group: 'maintenance', type: 'number', label: 'نگهداری لاگ فنی (روز)', default: 30, min: 1, max: 365 },
  { key: 'maintenance.healthcheck_public', group: 'maintenance', type: 'boolean', label: 'نمایش عمومی وضعیت سرویس', default: bool(true) },
  { key: 'maintenance.support_phone', group: 'maintenance', type: 'tel', label: 'تلفن پشتیبانی', default: '', public: true },
  { key: 'maintenance.demo_mode', group: 'maintenance', type: 'boolean', label: 'حالت نمایشی', hint: 'داده‌های نمونه نمایش داده می‌شود؛ در محیط عملیاتی خاموش باشد.', default: bool(false) },

  /* ------------------------------ multibranch ------------------------------ */
  { key: 'multibranch.enabled', group: 'multibranch', type: 'boolean', label: 'فعال‌سازی ساختار چنددفتره', hint: 'رزرو برای توسعه آینده؛ در نسخه فعلی جداسازی داده بین دفاتر پیاده‌سازی نشده است. برای هر دفتر نصب و پایگاه داده مستقل استفاده کنید.', default: bool(false) },
  { key: 'multibranch.default_branch_name', group: 'multibranch', type: 'text', label: 'نام دفتر پیش‌فرض', default: 'دفتر مرکزی' },
  { key: 'multibranch.allow_cross_branch_reports', group: 'multibranch', type: 'boolean', label: 'گزارش تلفیقی بین دفاتر', default: bool(false) },
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingDef(key: string): SettingDef | undefined {
  return SETTINGS_BY_KEY.get(key);
}

export function defaultValues(): Record<string, string | number | boolean> {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
}

export function publicKeys(): string[] {
  return SETTINGS.filter((s) => s.public).map((s) => s.key);
}
