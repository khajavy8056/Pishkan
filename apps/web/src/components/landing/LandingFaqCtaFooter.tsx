import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  HelpCircle,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useBrand } from '../../lib/brand';
import { faNum } from '../../lib/format';
import { parseListSetting, useSite } from '../../lib/site';
import { useRevealOnScroll } from '../landing-motion';
import { CustomHtml } from '../visual';

interface FaqItem {
  q: string;
  a: string;
}

interface FeatureItem {
  title: string;
  desc: string;
}

interface SocialItem {
  title: string;
  url: string;
}

const DEFAULT_FEATURES: FeatureItem[] = [
  { title: 'ثبت درخواست در کمتر از ۲ دقیقه', desc: 'فرم‌های پویا و هوشمند با راهنمای دقیق هر خدمت بدون فیلد اضافی.' },
  { title: 'انتخاب یا ارجاع به کارشناس', desc: 'پرونده بلافاصله در صف ارجاع کارشناس متخصص قرار می‌گیرد.' },
  { title: 'پیگیری زنده و شفاف', desc: 'اعلان فوری برای هر تغییر وضعیت؛ از بررسی مدارک تا تحویل نهایی.' },
  { title: 'مدارک امن در پروفایل', desc: 'مدارک هویتی پرکاربرد یک بار بررسی و برای دفعات بعد آماده می‌شوند.' },
  { title: 'مبلغ شفاف از ابتدا', desc: 'برآورد هزینه و زمان دقیق تحویل پیش از ثبت درخواست مشخص است.' },
  { title: 'تحویل فایل رسمی دیجیتال', desc: 'دریافت خروجی مهرشده و رسید قانونی مستقیم در پنل و گوشی شما.' },
];

export function LandingFeaturesSection() {
  const revealRef = useRevealOnScroll<HTMLElement>();
  const { setting } = useSite();
  const brand = useBrand();

  const features = parseListSetting<FeatureItem>(setting('landing.features'), DEFAULT_FEATURES);
  if (!features.length) return null;

  const title = setting('landing.features_title') || `چرا ${brand.name}؟`;

  return (
    <section ref={revealRef} className="lp-container py-12 lg:py-16">
      <div className="mb-8 text-center" data-reveal>
        <span className="text-xs font-extrabold tracking-widest text-emerald-400">مزیت‌های سامانه</span>
        <h2 className="mt-1.5 text-2xl font-black text-text sm:text-3xl">{title}</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4">
        {features.map((item, idx) => (
          <div key={`${item.title}-${idx}`} data-reveal="zoom" className="cat-card flex items-start gap-3.5 p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-400/12 text-brand-text ring-1 ring-cyan-400/25">
              <CheckCircle2 className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-text">{item.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LandingFaqSection() {
  const revealRef = useRevealOnScroll<HTMLElement>();
  const { setting } = useSite();
  const faqs = parseListSetting<FaqItem>(setting('landing.faq'), []);

  if (!faqs.length) return null;

  return (
    <section ref={revealRef} id="faq" className="lp-container py-12 lg:py-16">
      <div className="lp-measure">
      <div className="mb-8 text-center" data-reveal>
        <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-widest text-cyan-400">
          <HelpCircle className="size-4" />
          پرسش‌های متداول
        </span>
        <h2 className="mt-1.5 text-2xl font-black text-text sm:text-3xl">سؤالات پرتکرار مراجعان</h2>
      </div>

      <div className="space-y-3" data-reveal>
        {faqs.map((item, i) => (
          <details key={`${item.q}-${i}`} className="faq-item group" open={i === 0}>
            <summary className="faq-summary">
              <span className="flex items-center gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-600/15 text-xs font-black text-brand-text">
                  {faNum(i + 1)}
                </span>
                <span>{item.q}</span>
              </span>
              <ChevronDown className="faq-chev size-4" />
            </summary>
            <div className="faq-body">{item.a}</div>
          </details>
        ))}
      </div>
      </div>
    </section>
  );
}

export function LandingCtaSection() {
  const revealRef = useRevealOnScroll<HTMLElement>();
  const { setting } = useSite();
  const { user } = useAuth();

  const isCustomer = user?.kind === 'customer';
  const servicesHref = isCustomer ? '/app/services' : '/services';
  const primaryLink = setting('landing.primary_cta_link') || '/app/services';
  const ctaHref =
    /^https?:\/\//i.test(primaryLink)
      ? primaryLink
      : isCustomer
        ? primaryLink
        : primaryLink.startsWith('/app')
          ? `/login?next=${encodeURIComponent(primaryLink)}`
          : primaryLink;

  return (
    <section ref={revealRef} className="lp-container py-12 lg:py-16">
      <div
        data-reveal="zoom"
        className="cta-panel px-6 py-12 text-center shadow-2xl sm:px-12 sm:py-16"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full bg-cyan-400/20 blur-3xl"
        />

        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1 text-xs font-extrabold text-[#e0f2fe] ring-1 ring-white/25">
          <Sparkles className="size-3.5 text-[#fde68a]" />
          همین حالا شروع کنید
        </span>

        <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">
          آمادهٔ ثبت اولین درخواست آنلاین هستید؟
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#e0f2fe]/90 sm:text-base">
          خدمت خود را انتخاب کنید، مدارک را آپلود کنید و بقیه کار را به دفتر پیشخوان آنلاین بسپارید.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {/^https?:\/\//i.test(ctaHref) ? (
            <a href={ctaHref} className="lp-btn lp-btn-gold lp-btn-lg gold-sheen" rel="noreferrer">
              <Send className="size-4 -scale-x-100" />
              <span>شروع کنید</span>
            </a>
          ) : (
            <Link to={ctaHref} className="lp-btn lp-btn-gold lp-btn-lg gold-sheen">
              <Send className="size-4 -scale-x-100" />
              <span>شروع کنید</span>
            </Link>
          )}
          <Link
            to={servicesHref}
            className="lp-btn lp-btn-soft lp-btn-lg !border-white/25 !bg-white/10 !text-white hover:!bg-white/20"
          >
            <span>مرور خدمات</span>
            <ArrowLeft className="size-4" />
          </Link>
        </div>
      </div>

      <CustomHtml html={setting('landing.custom_html')} className="mt-8" />
    </section>
  );
}

export function LandingFooter() {
  const { setting } = useSite();
  const brand = useBrand();
  const { user } = useAuth();

  const description = setting('site.description');
  const footerText = setting('site.footer_text') || 'تمامی حقوق این سامانه محفوظ است.';
  const email = setting('office.email');
  const phone = setting('office.phone');
  const address = setting('office.address');
  const workingHours = setting('office.working_hours');
  const socials = parseListSetting<SocialItem>(setting('site.social_links'), []);

  const isCustomer = user?.kind === 'customer';
  const servicesHref = isCustomer ? '/app/services' : '/services';

  return (
    <footer className="footer-shell mt-12">
      <div className="lp-container pb-24 pt-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <Link to="/" className="inline-flex items-center gap-3 text-inherit no-underline">
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="size-10 rounded-xl border border-line bg-white/95 object-contain p-1 shadow-lg shadow-cyan-500/20"
                />
              ) : (
                <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-brand-600 shadow-lg shadow-cyan-500/30">
                  <ShieldCheck className="size-5 text-white" />
                </span>
              )}
              <div>
                <div className="text-base font-black text-lp-shell-text">{brand.name}</div>
                {brand.tagline ? (
                  <div className="text-xs text-lp-shell-muted">{brand.tagline}</div>
                ) : null}
              </div>
            </Link>

            {description ? (
              <p className="max-w-sm text-xs leading-relaxed text-lp-shell-muted">{description}</p>
            ) : null}

            {socials.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {socials.map((s) => (
                  <a
                    key={s.title}
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-line bg-surface/60 px-2.5 py-1 text-xs font-bold text-lp-shell-text no-underline transition hover:border-brand-text/40 hover:text-brand-text"
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:col-span-7">
            <div>
              <h3 className="mb-3 text-xs font-black tracking-wider text-lp-shell-text">دسترسی سریع</h3>
              <ul className="space-y-2">
                <li>
                  <a href="#top" className="footer-link">
                    خانه
                  </a>
                </li>
                <li>
                  <Link to={servicesHref} className="footer-link">
                    کاتالوگ خدمات
                  </Link>
                </li>
                <li>
                  <a href="#journey" className="footer-link">
                    مسیر ثبت
                  </a>
                </li>
                <li>
                  <a href="#app" className="footer-link">
                    اپلیکیشن موبایل
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="mb-3 text-xs font-black tracking-wider text-lp-shell-text">سامانه و پشتیبانی</h3>
              <ul className="space-y-2">
                <li>
                  <Link to="/blog" className="footer-link">
                    بلاگ و راهنما
                  </Link>
                </li>
                <li>
                  <Link to="/assistant" className="footer-link">
                    دستیار هوشمند
                  </Link>
                </li>
                <li>
                  <Link to="/status" className="footer-link">
                    وضعیت سامانه
                  </Link>
                </li>
                <li>
                  <Link to="/legal" className="footer-link">
                    شرایط و حریم خصوصی
                  </Link>
                </li>
              </ul>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <h3 className="mb-3 text-xs font-black tracking-wider text-lp-shell-text">ارتباط با ما</h3>
              <ul className="space-y-2 text-xs text-lp-shell-muted">
                {phone ? (
                  <li className="flex items-center gap-2">
                    <Phone className="size-3.5 shrink-0 text-brand-text" />
                    <span dir="ltr">{phone}</span>
                  </li>
                ) : null}
                {email ? (
                  <li className="flex items-center gap-2">
                    <Mail className="size-3.5 shrink-0 text-brand-text" />
                    <span dir="ltr" className="truncate">
                      {email}
                    </span>
                  </li>
                ) : null}
                {workingHours ? (
                  <li className="flex items-start gap-2">
                    <Clock className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
                    <span>{workingHours}</span>
                  </li>
                ) : null}
                {address ? (
                  <li className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
                    <span>{address}</span>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-xs text-lp-shell-muted">
          <p>
            © {footerText} – {brand.name}
          </p>
          <p>طراحی‌شده برای خدمات شفاف و سریع شهروندی</p>
        </div>
      </div>
    </footer>
  );
}
