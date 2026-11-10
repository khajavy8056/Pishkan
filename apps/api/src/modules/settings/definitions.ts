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
  | 'general' | 'landing' | 'domain' | 'auth' | 'sms' | 'email' | 'security' | 'services'
  | 'accounting' | 'wallet' | 'workforce' | 'payroll' | 'assistant' | 'files' | 'backup'
  | 'maintenance' | 'monitoring' | 'multibranch' | 'support' | 'android_app';

export const SETTING_GROUPS: {
  code: SettingGroupCode;
  title: string;
  description: string;
  icon: string;
  order: number;
}[] = [
  { code: 'general', title: 'تنظیمات عمومی سایت', description: 'نام، لوگو، اطلاعات تماس، ساعات کاری و متن‌های عمومی', icon: 'store', order: 1 },
  { code: 'landing', title: 'صفحهٔ فرود و هویت بصری', description: 'برند و لوگو، متن و تصویر صفحهٔ اصلی، بخش اپلیکیشن، آمار نمایشی و HTML سفارشی — هر تغییری بلافاصله در صفحهٔ اصلی و پنل مشتری دیده می‌شود', icon: 'sparkles', order: 2 },
  { code: 'domain', title: 'دامنه و نشانی‌ها', description: 'دامنه اصلی، زیردامنه API، HTTPS و اتصال Cloudflare', icon: 'globe', order: 2 },
  { code: 'auth', title: 'ورود و ثبت‌نام', description: 'روش ورود مشتریان و کارکنان، ثبت‌نام و سیاست رمز عبور', icon: 'key', order: 3 },
  { code: 'sms', title: 'پیامک و ملی پیامک', description: 'اتصال به ارائه‌دهنده پیامک، الگوهای تأییدشده و آزمایش ارسال', icon: 'message', order: 4 },
  { code: 'email', title: 'ایمیل و اعلان‌ها', description: 'سرویس ایمیل و اعلان‌های خودکار رویدادها', icon: 'mail', order: 5 },
  { code: 'security', title: 'امنیت', description: 'HTTPS، سیاست نشست‌ها، محدودیت تلاش ورود و نگهداری لاگ', icon: 'shield', order: 6 },
  { code: 'services', title: 'خدمات و گردش کار', description: 'ارجاع خودکار، مدارک، خدمات اختصاصی و وضعیت پذیرش', icon: 'layers', order: 7 },
  { code: 'accounting', title: 'حسابداری و پرداخت', description: 'درگاه پرداخت، مالیات، شماره‌گذاری فاکتور و قوانین بازپرداخت', icon: 'wallet', order: 8 },
  { code: 'wallet', title: 'کیف پول مشتریان', description: 'سقف شارژ، محدودیت موجودی و سیاست بازگشت وجه به کیف پول', icon: 'wallet', order: 9 },
  { code: 'workforce', title: 'کارکنان و شیفت‌ها', description: 'قوانین شیفت، حضور و غیاب و ظرفیت کاری', icon: 'calendar', order: 10 },
  { code: 'assistant', title: 'دستیار هوشمند', description: 'رفتار دستیار، منابع پاسخ‌گویی و مدل زبانی', icon: 'sparkles', order: 11 },
  { code: 'files', title: 'فایل‌ها و مدارک', description: 'محدودیت حجم و نوع فایل و نگهداری مدارک', icon: 'folder', order: 12 },
  { code: 'backup', title: 'پشتیبان‌گیری', description: 'زمان‌بندی، مقصد ذخیره و نگهداری نسخه‌های پشتیبان', icon: 'database', order: 13 },
  { code: 'maintenance', title: 'نگهداری و گزارش‌ها', description: 'لاگ‌ها، وضعیت سلامت، حالت تعمیر و گزارش‌های خودکار', icon: 'activity', order: 14 },
  { code: 'monitoring', title: 'مانیتورینگ و لاگ', description: 'نمونه‌برداری شاخص‌ها، آستانه هشدارها و نگهداری لاگ فنی', icon: 'activity', order: 15 },
  { code: 'payroll', title: 'درآمد و تسویه کارکنان', description: 'مبنای محاسبه سهم درصدی، دوره تسویه، حداقل برداشت و اجازه ثبت درخواست برداشت', icon: 'wallet', order: 17 },
  { code: 'multibranch', title: 'چنددفتره', description: 'آماده‌سازی برای مدیریت چند دفتر مستقل (آزمایشی)', icon: 'building', order: 16 },
  { code: 'support', title: 'پشتیبانی و تیکت‌ها', description: 'فعال‌سازی میز پشتیبانی مشتریان و متن راهنمای آن', icon: 'life-buoy', order: 18 },
  { code: 'android_app', title: 'اپ اندروید مشتریان', description: 'نسخه‌بندی و سیاست به‌روزرسانی اپ، نوار اطلاعیه و روشن/خاموش بودن بنرها — مدیریت کامل بنرها در بخش «اپ اندروید» پنل مدیر کل است', icon: 'smartphone', order: 19 },
];

const bool = (v: boolean) => v;

export const SETTINGS: SettingDef[] = [
  /* ------------------------------- general -------------------------------- */
  { key: 'site.name', group: 'general', type: 'text', label: 'نام سامانه', hint: 'در هدر، عنوان صفحه‌ها و پیامک‌ها استفاده می‌شود.', default: 'تک پیشخوان', public: true },
  { key: 'site.short_name', group: 'general', type: 'text', label: 'نام کوتاه', default: 'تک پیشخوان', public: true },
  { key: 'site.tagline', group: 'general', type: 'text', label: 'شعار / زیرعنوان', default: 'سریع • مطمئن • آسان', public: true },
  { key: 'site.description', group: 'general', type: 'textarea', label: 'توضیحات سایت', hint: 'در فوتر و توضیحات متا استفاده می‌شود.', default: 'سامانه جامع ارائه خدمات دفتر پیشخوان دولت', public: true },
  { key: 'site.logo_file_id', group: 'general', type: 'text', label: 'شناسه فایل لوگو', hint: 'از بخش فایل‌ها آپلود کنید؛ خالی یعنی لوگوی پیش‌فرض.', default: '', public: true },
  { key: 'site.welcome_message', group: 'general', type: 'textarea', label: 'پیام خوشامدگویی پنل مشتری', default: 'به سامانه خدمات پیشخوان خوش آمدید. درخواست خود را انتخاب کنید و مراحل را آنلاین دنبال کنید.', public: true },
  { key: 'site.footer_text', group: 'general', type: 'text', label: 'متن فوتر', default: 'تمام حقوق محفوظ است.', public: true },
  { key: 'brand.primary_color', group: 'general', type: 'color', label: 'رنگ اصلی برند', default: '#1d4ed8', public: true },
  { key: 'brand.navy_color', group: 'general', type: 'color', label: 'رنگ سرمه‌ای برند', default: '#0b1f3a', public: true },
  { key: 'office.name', group: 'general', type: 'text', label: 'نام دفتر', default: 'تک پیشخوان', public: true },
  { key: 'office.phone', group: 'general', type: 'tel', label: 'تلفن دفتر', default: '', public: true },
  { key: 'office.mobile', group: 'general', type: 'tel', label: 'موبایل دفتر', default: '', public: true },
  { key: 'office.email', group: 'general', type: 'email', label: 'ایمیل دفتر', default: '', public: true },
  { key: 'office.address', group: 'general', type: 'textarea', label: 'نشانی دفتر', default: '', public: true },
  { key: 'office.province', group: 'general', type: 'text', label: 'استان', default: 'خوزستان', public: true },
  { key: 'office.city', group: 'general', type: 'text', label: 'شهر', default: 'اندیمشک', public: true },
  { key: 'office.postal_code', group: 'general', type: 'text', label: 'کد پستی', default: '', public: true },
  { key: 'office.working_hours', group: 'general', type: 'text', label: 'ساعات کاری', hint: 'مثال: شنبه تا چهارشنبه ۸ تا ۱۶، پنجشنبه ۸ تا ۱۲', default: 'شنبه تا چهارشنبه ۸:۰۰ تا ۱۶:۰۰', public: true },
  { key: 'site.terms', group: 'general', type: 'textarea', label: 'شرایط استفاده', hint: 'در صفحه‌ای مستقل برای مشتریان نمایش داده می‌شود.', default: '' },
  { key: 'site.privacy', group: 'general', type: 'textarea', label: 'سیاست حریم خصوصی', default: '' },
  { key: 'site.social_links', group: 'general', type: 'json', label: 'شبکه‌های اجتماعی', hint: 'آرایه JSON از {title,url}', default: '[]', public: true },
  { key: 'site.support_notice', group: 'general', type: 'textarea', label: 'اطلاعیه بالای سایت', hint: 'اگر مقدار داشته باشد به‌صورت نوار اطلاعیه نمایش داده می‌شود.', default: '', public: true },
  { key: 'site.calendar', group: 'general', type: 'select', label: 'تقویم نمایش تاریخ', options: [{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }], default: 'jalali', public: true },
  { key: 'site.currency_label', group: 'general', type: 'text', label: 'واحد پول نمایشی', default: 'ریال', public: true },


  /* -------------------------------- landing -------------------------------- */
  { key: 'site.name_en', group: 'landing', type: 'text', label: 'نام لاتین برند', hint: 'زیر نام فارسی برند در کنار لوگو نمایش داده می‌شود (مثل Pishkan). خالی یعنی نمایش داده نشود.', default: 'Pishkan', public: true },
  { key: 'site.logo_url', group: 'landing', type: 'text', label: 'نشانی تصویر لوگو', hint: 'نشانی کامل تصویر لوگو (http/https) یا مسیر داخلی مثل /images/logo.png. اگر خالی باشد، از «شناسهٔ فایل لوگو» در تنظیمات عمومی استفاده می‌شود؛ و اگر آن هم خالی باشد نشان پیش‌فرض برند نمایش داده می‌شود.', default: '', public: true },
  { key: 'landing.hero_badge', group: 'landing', type: 'text', label: 'برچسب بالای عنوان اصلی', default: 'سامانهٔ هوشمند خدمات دولتی', public: true },
  { key: 'landing.hero_title', group: 'landing', type: 'text', label: 'عنوان بزرگ صفحهٔ اصلی', hint: 'خالی یعنی همان «نام سامانه» از تنظیمات عمومی. به این ترتیب با تغییر نام سامانه، عنوان صفحهٔ اصلی هم خودکار عوض می‌شود.', default: '', public: true },
  { key: 'landing.hero_subtitle', group: 'landing', type: 'text', label: 'زیرعنوان صفحهٔ اصلی', default: 'همراه شما در انجام امور اداری و خدمات دولتی', public: true },
  { key: 'landing.hero_text', group: 'landing', type: 'textarea', label: 'متن معرفی زیر عنوان', default: 'به‌سادگی درخواست خود را ثبت کنید و در کوتاه‌ترین زمان از خدمات دولتی بهره‌مند شوید؛ همهٔ مراحل، از ثبت تا تحویل، شفاف و قابل پیگیری است.', public: true },
  { key: 'landing.hero_image_url', group: 'landing', type: 'text', label: 'تصویر اصلی (هیرو)', hint: 'نشانی کامل تصویر یا مسیر داخلی. خالی یعنی تصویر پیش‌فرض سامانه.', default: '', public: true },
  { key: 'landing.panel_hero_url', group: 'landing', type: 'text', label: 'تصویر بنر داشبورد مشتری', hint: 'بنر بالای داشبورد مشتری. خالی یعنی تصویر اصلی (هیرو) و اگر آن هم خالی باشد، بنر پیش‌فرض سامانه.', default: '', public: true },
  { key: 'landing.primary_cta_label', group: 'landing', type: 'text', label: 'متن دکمهٔ اصلی', default: 'ثبت درخواست خدمت', public: true },
  { key: 'landing.primary_cta_link', group: 'landing', type: 'text', label: 'پیوند دکمهٔ اصلی', hint: 'مسیر داخلی مثل /app/services یا نشانی کامل. مسیرهای داخل پنل برای مهمان ابتدا به صفحهٔ ورود می‌روند و پس از ورود همان‌جا ادامه می‌یابند.', default: '/app/services', public: true },
  { key: 'landing.secondary_cta_label', group: 'landing', type: 'text', label: 'متن دکمهٔ دوم', default: 'پیگیری درخواست', public: true },
  { key: 'landing.secondary_cta_link', group: 'landing', type: 'text', label: 'پیوند دکمهٔ دوم', hint: 'مسیر داخلی مثل /app/requests یا نشانی کامل. خالی یعنی دکمهٔ دوم نمایش داده نشود.', default: '/app/requests', public: true },
  { key: 'landing.features_title', group: 'landing', type: 'text', label: 'عنوان بخش «چرا ما؟»', hint: 'خالی یعنی: چرا «نام سامانه»؟', default: '', public: true },
  { key: 'landing.features', group: 'landing', type: 'json', label: 'ویژگی‌های بخش «چرا ما؟»', hint: 'آرایهٔ JSON از {icon,title,text}؛ آیکون‌ها از مجموعهٔ Lucide (مثل zap, shield-check, headset, heart-handshake, cpu, badge-check).', default: '[{"icon":"zap","title":"سرعت بالا","text":"ثبت و پیگیری درخواست در چند دقیقه، بدون مراجعهٔ غیرضروری."},{"icon":"shield-check","title":"امنیت پیشرفته","text":"مدارک و اطلاعات شما رمزنگاری‌شده و فقط در دسترس کارشناس مسئول است."},{"icon":"headset","title":"پشتیبانی قوی","text":"گفت‌وگوی زنده با دفتر و پاسخ‌گویی کارشناسان در ساعات کاری."},{"icon":"heart-handshake","title":"رضایت مشتریان","text":"شفافیت کامل هزینه و مراحل، از ثبت تا تحویل نهایی."},{"icon":"cpu","title":"مدیریت هوشمند","text":"ارجاع خودکار پرونده به کارشناس مناسب و یادآوری‌های به‌موقع."},{"icon":"badge-check","title":"رعایت استانداردها","text":"فرایندها مطابق ضوابط دفاتر پیشخوان دولت و قابل حسابرسی."}]', public: true },
  { key: 'landing.show_stats', group: 'landing', type: 'boolean', label: 'نمایش نوار آمار در صفحهٔ اصلی', hint: 'تعداد خدمات و پرونده‌های تکمیل‌شده از دادهٔ واقعی سامانه خوانده می‌شود.', default: bool(true), public: true },
  { key: 'landing.stat_customers', group: 'landing', type: 'text', label: 'عدد نمایشی «کاربران/مشتریان»', hint: 'خالی یعنی شمارش واقعی مشتریان ثبت‌نام‌شده. می‌توانید متن دلخواه مثل «+۵۰٬۰۰۰» بنویسید.', default: '', public: true },
  { key: 'landing.stat_customers_label', group: 'landing', type: 'text', label: 'برچسب آمار مشتریان', default: 'مشتری همراه', public: true },
  { key: 'landing.show_app_section', group: 'landing', type: 'boolean', label: 'نمایش بخش اپلیکیشن موبایل', default: bool(true), public: true },
  { key: 'landing.app_title', group: 'landing', type: 'text', label: 'عنوان بخش اپلیکیشن', hint: 'خالی یعنی: اپلیکیشن اندروید «نام سامانه».', default: '', public: true },
  { key: 'landing.app_text', group: 'landing', type: 'textarea', label: 'متن بخش اپلیکیشن', default: 'خدمات دولتی را همیشه و همه‌جا در دسترس داشته باشید؛ ثبت و پیگیری درخواست‌ها، مشاهدهٔ اعلان‌ها و مدیریت کیف پول از روی گوشی.', public: true },
  { key: 'landing.app_android_url', group: 'landing', type: 'url', label: 'پیوند دانلود اپلیکیشن اندروید', hint: 'پیوند مستقیم فایل APK یا صفحهٔ فروشگاه. تا وقتی خالی است، دکمهٔ دانلود «به‌زودی» نمایش داده می‌شود.', default: '', public: true },
  { key: 'landing.app_button_label', group: 'landing', type: 'text', label: 'متن دکمهٔ دانلود اپلیکیشن', default: 'دریافت اپلیکیشن', public: true },
  { key: 'landing.mascot_url', group: 'landing', type: 'text', label: 'تصویر ربات پشتیبانی (ماسکات)', hint: 'در منوی پنل مشتری نمایش داده می‌شود. خالی یعنی تصویر پیش‌فرض سامانه.', default: '', public: true },
  { key: 'landing.announcements', group: 'landing', type: 'json', label: 'اطلاعیه‌های داشبورد مشتری', hint: 'آرایهٔ JSON از {title, date, link}؛ در کارت «آخرین اطلاعیه‌ها»ی داشبورد مشتری نمایش داده می‌شود. اگر خالی باشد، اعلان‌های خود مشتری نشان داده می‌شوند.', default: '[]', public: true },
  { key: 'landing.custom_html', group: 'landing', type: 'textarea', label: 'HTML سفارشی صفحهٔ اصلی', hint: 'کد HTML خام که پیش از فوتر در صفحهٔ اصلی درج می‌شود (بنر، ویدیو، فرم خارجی و…). فقط اگر به کد آن مطمئن هستید استفاده کنید؛ اسکریپت‌ها نیز اجرا می‌شوند.', default: '', public: true },

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
  { key: 'sms.push_enabled', group: 'sms', type: 'boolean', label: 'اعلان لحظه‌ای (Push) روی گوشی/مرورگر کارکنان', hint: 'وقتی پروندهٔ تازه وارد صف آزاد می‌شود، کارشناسان واجد شرایط روی دستگاهشان اعلان می‌گیرند؛ هر کارمند از صفحهٔ صف آزاد آن را برای دستگاه خودش فعال می‌کند.', default: bool(true) },
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
  { key: 'services.auto_assign', group: 'services', type: 'boolean', label: 'ارجاع خودکار فوری به کارشناس', hint: 'خاموش (پیش‌فرض): پرونده وارد «صف آزاد» می‌شود تا کارشناس واجد شرایط خودش آن را بپذیرد؛ اگر تا موعد واگذاری اجباری پذیرفته نشد سیستم آن را خودکار ارجاع می‌دهد. روشن: همان لحظهٔ ثبت به بهترین کارشناس ارجاع می‌شود.', default: bool(false) },
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
  { key: 'accounting.online_payment_enabled', group: 'accounting', type: 'boolean', label: 'پرداخت آنلاین فعال', hint: 'با خاموش‌بودن آن، فقط پرداخت از کیف پول در دسترس است.', default: bool(false), public: true },
  { key: 'accounting.cash_payment_enabled', group: 'accounting', type: 'boolean', label: 'ثبت پرداخت حضوری (منسوخ — حذف شد)', hint: 'از نسخه ۱٫۳ روش‌های نقدی/کارت‌خوان/حواله از گردش پرداخت مشتری حذف شده‌اند و این کلید دیگر اثری ندارد. داده‌های تاریخی حفظ می‌شوند.', default: bool(false) },
  { key: 'accounting.gateway', group: 'accounting', type: 'select', label: 'درگاه پرداخت', hint: '«شبیه‌ساز» فقط برای آزمون در محیط غیرعملیاتی است و در production غیرفعال می‌شود.', options: [{ value: 'none', label: 'بدون درگاه' }, { value: 'sandbox', label: 'شبیه‌ساز آزمایشی (Sandbox داخلی)' }, { value: 'zarinpal', label: 'زرین‌پال' }], default: 'none' },
  { key: 'accounting.gateway_merchant_id', group: 'accounting', type: 'password', secret:true, label: 'شناسه پذیرنده / Merchant ID', default: '' },
  { key: 'accounting.gateway_api_key', group: 'accounting', type: 'password', secret: true, label: 'کلید API درگاه', default: '' },
  { key: 'accounting.gateway_sandbox', group: 'accounting', type: 'boolean', label: 'حالت آزمایشی درگاه (Sandbox)', hint: 'در زرین‌پال به محیط sandbox وصل می‌شود؛ هیچ تراکنش واقعی انجام نمی‌شود.', default: bool(true) },
  { key: 'accounting.gateway_callback_url', group: 'accounting', type: 'url', label: 'نشانی بازگشت از درگاه (Callback)', hint: 'اگر خالی باشد از ZARINPAL_CALLBACK_BASE_URL یا API_URL استفاده می‌شود. برای درگاه واقعی باید HTTPS عمومی باشد.', default: '' },
  { key: 'accounting.gateway_timeout_seconds', group: 'accounting', type: 'number', label: 'مهلت پاسخ درگاه (ثانیه)', default: 15, min: 5, max: 60 },
  { key: 'accounting.gateway_health_check', group: 'accounting', type: 'boolean', label: 'بررسی دوره‌ای وضعیت درگاه', hint: 'نتیجه در مرکز مانیتورینگ نمایش داده می‌شود؛ در حالت زنده، درخواست پرداخت واقعی ارسال نمی‌شود.', default: bool(true) },
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
  { key: 'workforce.force_assign_enabled', group: 'workforce', type: 'boolean', label: 'واگذاری اجباری پرونده‌های پذیرفته‌نشده', hint: 'اگر تا بخشی از زمان برآوردشده کسی پرونده را از صف برندارد، سیستم آن را خودکار به یک کارمند آزاد واگذار می‌کند.', default: bool(true) },
  { key: 'workforce.force_assign_ratio', group: 'workforce', type: 'number', label: 'نسبت زمان برای واگذاری اجباری (درصد)', hint: 'مثلاً ۶۶ یعنی وقتی دو سوم زمان برآوردی خدمت سپری شد. مقدار در لحظه ثبت درخواست قطعی می‌شود.', default: 66, min: 10, max: 100 },
  { key: 'workforce.waiting_case_weight', group: 'workforce', type: 'number', label: 'وزن ظرفیت پروندهٔ منتظر مشتری/سازمان (درصد)', hint: 'در محاسبهٔ «بار کاری» کارشناس، پرونده‌ای که منتظر مشتری یا پاسخ سازمان است این درصد از یک پروندهٔ فعال حساب می‌شود؛ مسئولیت پیگیری‌اش باقی می‌ماند اما کل ظرفیت را نمی‌گیرد.', default: 25, min: 0, max: 100 },
  { key: 'workforce.online_window_minutes', group: 'workforce', type: 'number', label: 'پنجرهٔ «آنلاین بودن» برای واگذاری خودکار (دقیقه)', hint: 'در واگذاری اجباری/خودکار، کارمندی که بیش از این مدت در سامانه فعالیت نداشته کنار گذاشته می‌شود تا پرونده به فرد غایب نرسد. صفر یعنی غیرفعال. پذیرش دستی از صف آزاد همیشه ممکن است.', default: 120, min: 0, max: 1440 },
  { key: 'workforce.followup_reminder_enabled', group: 'workforce', type: 'boolean', label: 'یادآوری خودکار پیگیری پرونده‌های منتظر', hint: 'وقتی پرونده‌ای مدت زیادی منتظر مشتری یا سازمان می‌ماند، سیستم روزانه به کارشناس مسئول (و در صورت انتظار از مشتری، به خود مشتری) یادآوری می‌کند.', default: bool(true) },
  { key: 'workforce.followup_after_hours', group: 'workforce', type: 'number', label: 'آستانهٔ یادآوری پیگیری (ساعت بدون تغییر)', default: 24, min: 1, max: 720 },
  { key: 'workforce.auto_assign_on_shift', group: 'workforce', type: 'boolean', label: 'فقط کارشناسان حاضر در شیفت ارجاع بگیرند', hint: 'برای دفتر تازه‌راه‌اندازی‌شده خاموش است؛ پس از تعریف شیفت‌ها و حضور کارکنان می‌توانید آن را فعال کنید.', default: bool(false) },

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
  { key: 'files.image_max_width', group: 'files', type: 'number', label: 'حداکثر عرض تصویر (منسوخ — بدون اثر)', hint: 'این کلید در نسخه‌های قبلی هرگز اعمال نمی‌شد. برای محدودکردن ابعاد از «حداکثر بُعد نسخه نمایشی» استفاده کنید.', default: 1600, min: 400, max: 6000 },
  { key: 'files.process_images', group: 'files', type: 'boolean', label: 'پردازش خودکار تصاویر و تولید WebP', hint: 'خاموش‌کردن آن فقط نسخه اصلی را نگه می‌دارد و کیفیت را تغییر نمی‌دهد.', default: bool(true) },
  { key: 'files.image_quality_mode', group: 'files', type: 'select', label: 'سیاست کیفیت تصویر', hint: '«کیفیت‌محور» هرگز اسکن مدارک را با فشرده‌سازی افت‌دار ذخیره نمی‌کند.', options: [{ value: 'quality_first', label: 'کیفیت‌محور (پیشنهادی)' }, { value: 'lossless_only', label: 'فقط Lossless' }, { value: 'balanced', label: 'متعادل (اجازه Lossy با دروازه کیفیت)' }], default: 'quality_first' },
  { key: 'files.image_target_savings_percent', group: 'files', type: 'number', label: 'هدف کاهش حجم تصویر (درصد)', hint: 'اگر با حفظ کیفیت محقق نشود، کیفیت فدای عدد نمی‌شود.', default: 70, min: 1, max: 95 },
  { key: 'files.image_min_savings_percent', group: 'files', type: 'number', label: 'کمترین کاهش حجم برای جایگزینی (درصد)', hint: 'کمتر از این مقدار، فایل اصلی بدون بازکدگذاری حفظ می‌شود.', default: 8, min: 1, max: 50 },
  { key: 'files.image_lossy_quality', group: 'files', type: 'number', label: 'کیفیت شروع فشرده‌سازی Lossy (فقط تصاویر غیرسندی)', default: 95, min: 70, max: 100 },
  { key: 'files.image_max_pixels', group: 'files', type: 'number', label: 'حداکثر پیکسل قابل پردازش', hint: 'محافظ مصرف حافظه؛ تصویر بزرگ‌تر رد می‌شود.', default: 50000000, min: 1000000, max: 200000000 },
  { key: 'files.image_max_dimension', group: 'files', type: 'number', label: 'حداکثر بُعد نسخه نمایشی (پیکسل)', hint: 'صفر یعنی ابعاد اصلی حفظ شود (پیشنهادی برای مدارک).', default: 0, min: 0, max: 8000 },
  { key: 'files.preview_max_width', group: 'files', type: 'number', label: 'عرض پیش‌نمایش تصویر (پیکسل)', hint: 'صفر یعنی پیش‌نمایش ساخته نشود.', default: 640, min: 0, max: 2000 },
  { key: 'files.keep_original_archive', group: 'files', type: 'boolean', label: 'نگهداری نسخه اصلی مدارک', hint: 'نسخه اصلی برای بازیابی و بازبینی انسانی لازم است.', default: bool(true) },
  { key: 'files.original_retention_days', group: 'files', type: 'number', label: 'نگهداری نسخه اصلی پس از بهینه‌سازی (روز)', hint: 'صفر یعنی نگهداری دائمی. حذف فقط با اجرای دستی و تأیید انجام می‌شود.', default: 0, min: 0, max: 3650 },
  { key: 'files.require_reuse_confirmation', group: 'files', type: 'boolean', label: 'الزام تأیید مشتری برای استفاده دوباره از مدرک', default: bool(true) },
  { key: 'files.document_default_validity_days', group: 'files', type: 'number', label: 'اعتبار پیش‌فرض مدارک بدون تاریخ انقضا (روز)', default: 365, min: 1, max: 3650 },

  /* --------------------------------- wallet -------------------------------- */
  { key: 'wallet.enabled', group: 'wallet', type: 'boolean', label: 'کیف پول مشتریان فعال', hint: 'با خاموش‌شدن آن، شارژ و پرداخت از کیف پول در دسترس نیست (موجودی و سابقه حفظ می‌شود).', default: bool(true), public: true },
  { key: 'wallet.min_topup', group: 'wallet', type: 'number', label: 'حداقل مبلغ شارژ (ریال)', default: 10000, min: 1000, max: 10000000 },
  { key: 'wallet.max_topup', group: 'wallet', type: 'number', label: 'حداکثر مبلغ شارژ در هر تراکنش (ریال)', default: 50000000, min: 10000, max: 500000000 },
  { key: 'wallet.max_balance', group: 'wallet', type: 'number', label: 'حداکثر موجودی مجاز کیف پول (ریال)', hint: 'از انباشت مبلغ غیرعادی جلوگیری می‌کند.', default: 200000000, min: 100000, max: 2000000000 },
  { key: 'wallet.allow_wallet_payment', group: 'wallet', type: 'boolean', label: 'امکان پرداخت هزینه خدمات از کیف پول', default: bool(true), public: true },
  { key: 'wallet.refund_to_wallet', group: 'wallet', type: 'boolean', label: 'بازگشت وجه پرداخت‌های کیف پولی به کیف پول', hint: 'اگر خاموش باشد، بازپرداخت تراکنش کیف پولی مسدود می‌شود تا دوبار اعتبار ایجاد نشود.', default: bool(true) },
  { key: 'wallet.admin_credit_requires_reason', group: 'wallet', type: 'boolean', label: 'الزام ثبت دلیل برای شارژ مدیریتی', default: bool(true) },
  { key: 'wallet.admin_credit_max', group: 'wallet', type: 'number', label: 'حداکثر شارژ مدیریتی در هر عملیات (ریال)', default: 100000000, min: 10000, max: 2000000000 },

  /* -------------------------------- payroll -------------------------------- */
  { key: 'payroll.commission_basis', group: 'payroll', type: 'select', label: 'مبنای محاسبه سهم کارکنان درصدی', hint: '«درآمد دفتر (بدون مالیات)» یعنی مالیات که فقط وصول می‌شود از مبنا کنار می‌رود. تغییر این تنظیم فقط روی سهم‌های جدید اثر دارد.', options: [{ value: 'net_of_tax', label: 'درآمد دفتر بدون مالیات (پیشنهادی)' }, { value: 'gross', label: 'کل مبلغ فاکتور' }], default: 'net_of_tax' },
  { key: 'payroll.settlement_period', group: 'payroll', type: 'select', label: 'دوره تسویه پیش‌فرض درآمد', hint: 'درآمد هر خدمت در پایان دوره‌ای که به آن تعلق دارد قابل برداشت می‌شود. برای هر کارمند می‌توان در قرارداد مقدار دیگری تعیین کرد.', options: [{ value: 'daily', label: 'روزانه' }, { value: 'weekly', label: 'هفتگی' }, { value: 'monthly', label: 'ماهانه' }, { value: 'custom', label: 'دوره اختصاصی' }], default: 'weekly' },
  { key: 'payroll.settlement_days', group: 'payroll', type: 'number', label: 'طول دوره اختصاصی (روز)', hint: 'فقط وقتی دوره «اختصاصی» انتخاب شده باشد استفاده می‌شود.', default: 7, min: 1, max: 365 },
  { key: 'payroll.min_withdrawal', group: 'payroll', type: 'number', label: 'حداقل مبلغ درخواست برداشت (ریال)', hint: 'کارمند نمی‌تواند کمتر از این مبلغ درخواست برداشت ثبت کند.', default: 500000, min: 0, max: 100000000000 },
  { key: 'payroll.withdrawal_enabled', group: 'payroll', type: 'boolean', label: 'امکان ثبت درخواست برداشت', hint: 'با خاموش‌شدن آن، درآمد کارکنان درصدی ثبت و نمایش داده می‌شود اما درخواست برداشت پذیرفته نمی‌شود.', default: bool(true) },
  { key: 'payroll.withdrawal_requires_approval', group: 'payroll', type: 'boolean', label: 'تأیید مدیر برای پرداخت برداشت', hint: 'حسابداری بررسی و تأیید می‌کند؛ پرداخت فقط با مجوز تسویه ثبت می‌شود. این کلید برای اطلاع‌رسانی به مدیر است.', default: bool(true) },
  { key: 'payroll.salary_period', group: 'payroll', type: 'select', label: 'دوره پرداخت حقوق ثابت', options: [{ value: 'monthly', label: 'ماهانه' }], default: 'monthly' },

  /* ------------------------------- monitoring ------------------------------ */
  { key: 'monitoring.enabled', group: 'monitoring', type: 'boolean', label: 'جمع‌آوری شاخص‌های مانیتورینگ', hint: 'نمونه‌برداری دوره‌ای CPU، حافظه، دیسک، تأخیر دیتابیس و ترافیک API.', default: bool(true) },
  { key: 'monitoring.sample_interval_seconds', group: 'monitoring', type: 'number', label: 'فاصله نمونه‌برداری (ثانیه)', default: 30, min: 10, max: 600 },
  { key: 'monitoring.retain_metrics_days', group: 'monitoring', type: 'number', label: 'نگهداری شاخص‌ها (روز)', default: 30, min: 1, max: 365 },
  { key: 'monitoring.log_level', group: 'monitoring', type: 'select', label: 'کمترین سطح لاگ ذخیره‌شده', options: [{ value: 'DEBUG', label: 'DEBUG' }, { value: 'INFO', label: 'INFO' }, { value: 'WARNING', label: 'WARNING' }, { value: 'ERROR', label: 'ERROR' }, { value: 'CRITICAL', label: 'CRITICAL' }, { value: 'SECURITY', label: 'SECURITY' }], default: 'INFO' },
  { key: 'monitoring.log_retention_days', group: 'monitoring', type: 'number', label: 'نگهداری لاگ ساختاریافته (روز)', default: 90, min: 7, max: 3650 },
  { key: 'monitoring.alert_error_rate_percent', group: 'monitoring', type: 'number', label: 'آستانه نرخ خطای API (درصد)', default: 5, min: 1, max: 100 },
  { key: 'monitoring.alert_latency_ms', group: 'monitoring', type: 'number', label: 'آستانه زمان پاسخ API (میلی‌ثانیه)', default: 2000, min: 200, max: 60000 },
  { key: 'monitoring.alert_disk_percent', group: 'monitoring', type: 'number', label: 'آستانه مصرف دیسک (درصد)', default: 85, min: 50, max: 99 },
  { key: 'monitoring.alert_memory_percent', group: 'monitoring', type: 'number', label: 'آستانه مصرف حافظه Node (درصد)', default: 85, min: 50, max: 99 },
  { key: 'monitoring.alert_payment_failures', group: 'monitoring', type: 'number', label: 'تعداد پرداخت ناموفق برای هشدار (در ۱۵ دقیقه)', default: 3, min: 1, max: 100 },
  { key: 'monitoring.alert_failed_logins', group: 'monitoring', type: 'number', label: 'تعداد ورود ناموفق برای هشدار امنیتی (در ۵ دقیقه)', default: 5, min: 1, max: 100 },
  { key: 'monitoring.notify_critical', group: 'monitoring', type: 'boolean', label: 'اعلان داخلی برای هشدارهای بحرانی', hint: 'از زیرساخت اعلان موجود برای مدیران دارای مجوز استفاده می‌کند.', default: bool(true) },

  /* --------------------------------- backup -------------------------------- */
  { key: 'backup.enabled', group: 'backup', type: 'boolean', label: 'پشتیبان‌گیری خودکار فعال', default: bool(true) },
  { key: 'backup.schedule_cron', group: 'backup', type: 'cron', label: 'زمان‌بندی پشتیبان‌گیری', hint: 'قالب cron؛ مثال: 0 2 * * * برای هر روز ساعت ۲ بامداد.', default: '0 2 * * *' },
  { key: 'backup.retention_days', group: 'backup', type: 'number', label: 'نگهداری نسخه‌های پشتیبان (روز)', default: 30, min: 1, max: 365 },
  { key: 'backup.retention_min_count', group: 'backup', type: 'number', label: 'حداقل تعداد نسخهٔ سالم نگه‌داشته‌شده', hint: 'حتی اگر از مهلت نگهداری گذشته باشند، این تعداد از تازه‌ترین نسخه‌های سالم هرگز خودکار حذف نمی‌شوند.', default: 3, min: 1, max: 50 },
  { key: 'backup.destination', group: 'backup', type: 'select', label: 'مقصد ذخیره', options: [{ value: 'local', label: 'پوشه محلی سرور' }, { value: 'remote', label: 'مقصد خارجی (rclone/S3)' }], default: 'local' },
  { key: 'backup.remote_config', group: 'backup', type: 'password', secret: true, label: 'تنظیمات مقصد خارجی', hint: 'JSON ابزار rclone یا اعتبارنامه S3؛ رمزنگاری‌شده ذخیره می‌شود.', default: '' },
  { key: 'backup.include_uploads', group: 'backup', type: 'boolean', label: 'شامل فایل‌های مدارک', default: bool(true) },
  { key: 'backup.verify_after_backup', group: 'backup', type: 'boolean', label: 'بررسی صحت نسخه پشتیبان پس از ایجاد', default: bool(true) },
  { key: 'backup.require_restore_confirmation', group: 'backup', type: 'boolean', label: 'الزام تأیید متنی برای بازیابی', default: bool(true) },
  { key: 'support.enabled', group: 'support', type: 'boolean', label: 'میز پشتیبانی (تیکت) فعال', hint: 'با خاموش‌کردن، مشتری نمی‌تواند تیکت جدید باز کند؛ تیکت‌های قبلی همچنان دیده می‌شوند.', default: bool(true) },
  { key: 'support.intro', group: 'support', type: 'textarea', label: 'متن راهنمای بالای صفحهٔ پشتیبانی مشتری', hint: 'مثلاً ساعات پاسخ‌گویی و زمان تقریبی پاسخ.', default: 'معمولاً در ساعات کاری حداکثر تا چند ساعت پاسخ می‌دهیم. برای پیگیری یک پروندهٔ مشخص، شماره پیگیری آن را در متن پیام بنویسید یا از فهرست انتخاب کنید.', public: true },

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

  /* --------------------------- Android customer app --------------------------- */
  { key: 'app.latest_version', group: 'android_app', type: 'text', label: 'آخرین نسخه منتشرشده اپ', hint: 'آخرین نسخه‌ای که منتشر کرده‌اید. اپ اگر قدیمی‌تر باشد پیام به‌روزرسانی نشان می‌دهد؛ پس این مقدار باید با نسخه‌ای که واقعاً منتشر شده برابر باشد، وگرنه همهٔ کاربران پیام «نسخهٔ تازه موجود است» می‌بینند.', default: '1.6.3', public: true },
  { key: 'app.min_version', group: 'android_app', type: 'text', label: 'حداقل نسخه مجاز', hint: 'نسخه‌های قدیمی‌تر از این نمی‌توانند ادامه دهند و باید به‌روزرسانی شوند. پایین نگه داشتنش یعنی هیچ کاربری به‌خاطر نسخه از اپ بیرون نمی‌ماند.', default: '1.0.0', public: true },
  { key: 'app.update_url', group: 'android_app', type: 'url', label: 'پیوند دریافت نسخه تازه', hint: 'لینک مستقیم APK یا صفحه فروشگاه؛ خالی یعنی از «پیوند دانلود اپلیکیشن اندروید» صفحه فرود استفاده شود.', default: '', public: true },
  { key: 'app.force_update', group: 'android_app', type: 'boolean', label: 'به‌روزرسانی اجباری', hint: 'وقتی روشن است، کاربر قدیمی بدون به‌روزرسانی نمی‌تواند وارد اپ شود.', default: bool(false), public: true },
  { key: 'app.banners_enabled', group: 'android_app', type: 'boolean', label: 'نمایش بنرها در اپ', hint: 'وقتی خاموش باشد، ریل بنرها در صفحهٔ اصلی اپ پنهان می‌شود؛ بنرها پاک نمی‌شوند.', default: bool(true), public: true },
  { key: 'app.announcement', group: 'android_app', type: 'textarea', label: 'اطلاعیه سراسری داخل اپ', hint: 'وقتی پر باشد، بالای صفحه اصلی اپ به همه مشتری‌ها نشان داده می‌شود.', default: '', public: true },
  { key: 'app.welcome_title', group: 'android_app', type: 'text', label: 'عنوان خوشامد اپ', hint: 'خالی یعنی نام سامانه.', default: '', public: true },
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
