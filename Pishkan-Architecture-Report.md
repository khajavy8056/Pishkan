# گزارش نقشه معماری پشکان

- تاریخ snapshot: **2026-10-29**
- مخزن: `khajavy8056/Pishkan`
- شاخه: `arena/3ec9e234-pishkan`
- Commit بررسی‌شده: [`ab145955a23fe547f700803b7432eb26fa356ad4`](https://github.com/khajavy8056/Pishkan/tree/ab145955a23fe547f700803b7432eb26fa356ad4)
- GitHub branch ref هنگام استخراج: `ab145955a23fe547f700803b7432eb26fa356ad4`؛ PR #2 باز است و به `arena/82749fce-pishkan` هدف‌گذاری شده است.
- شواهد پایه‌شده روی فایل پیوست نیست؛ پیوست مستقلی در workspace موجود نبود.

## پوشش ماشینی و حجم استخراج

| سنجه | مقدار |
|---|---:|
| فایل‌های Git-tracked در snapshot (به‌جز خود سه خروجی/generator) | 179 |
| پوشه‌ها با ریشه repository | 50 |
| گره‌های ساختاریافته | 1054 |
| ماژول‌های کد (گروه‌بندی بر اساس مسیر) | 64 |
| ارتباطات ساختاریافته | 3545 |
| importهای محلی resolveشده | 502 |
| UI → API زنجیره‌ای (استنباط medium) | 589 |
| endpointهای Express استخراج‌شده | 180 |
| Routeهای React استخراج‌شده | 51 |
| جدول‌های واقعی پس از اجرای migration SQL در SQLite حافظه‌ای | 44 |
| FKهای صریح از PRAGMA foreign_key_list | 48 |
| migrationها | 15 |
| فایل‌های آزمون (`.test.*`) | 21 |
| سناریوهای جریان | 6 |

منبع واحد داده برای HTML و JSON، `Pishkan-Architecture-Data.json` است؛ فایل generator: `tools/generate_pishkan_architecture.py` (Python standard library). HTML JSON را inline دارد و برای render، فونت، CDN یا server dependency ندارد.

## روش استخراج و سطح اطمینان

1. `git ls-files` برای فهرست commit بررسی‌شده استفاده شد؛ مسیر نام فایل به‌تنهایی مسئولیت را تعیین نکرد: متون TypeScript/TSX، imports، route registration، component router، package manifests، configها و SQL خوانده شدند. فایل‌های binary به‌عنوان فایل/asset فهرست شدند، نه اینکه محتوای آنها تحلیل شود.
2. تمام ۱۵ فایل migration در SQLite in-memory اجرا شد. ۴۴ جدول، ستون‌ها، PKها و فقط FKهایی که واقعاً در schema تعریف شده‌اند از `PRAGMA` استخراج شدند. هیچ پایگاه‌داده تولیدی باز نشد.
3. Importهای محلی به فایل‌های واقعی resolve شدند؛ import packageها با package.json تطبیق داده شدند. `app.use` mountها، Express verbs و React `<Route>`ها با مسیر فایل/خط ثبت شدند.
4. SQL links فقط از clauseهای `FROM/JOIN/INSERT/UPDATE/DELETE` واقعی استخراج شدند. گره FK فقط با migration-backed constraint ساخته شد؛ conventionهای `*_id` به‌تنهایی رابطه رسمی محسوب نشدند.
5. Flowها به‌صورت گام‌های دستیِ مبتنی بر سورس کد علامت‌گذاری شدند؛ edgeهای flow با `sourcePath` و snippet code قابل ردیابی‌اند. وضعیت سرویس‌های خارجی از وجود adapter/test تعیین شد، نه از اتصال به حساب زنده.
6. گراف import روی specifierهای resolveشده با Tarjan از نظر چرخه بررسی شد؛ در صورت نبود cycle، نتیجه فقط برای importهای استاتیک resolveشده معتبر است. پکیج‌های مستقیم از سه package manifest استخراج می‌شوند.

**تعریف:** `direct/high` یعنی فراخوانی، import، route، SQL یا constraint در فایل ثبت‌شده مشاهده شده؛ `inferred/medium` یعنی رابطه از mapping/contract چند فایل نتیجه شده است. مقدار secret، token، credential، داده مشتری یا مقدار `.env` استخراج/نمایش داده نشده است.

## معماری واقعی در یک نگاه

- **وب:** React 19 + React Router 7 + Vite 7 + Tailwind 4، SPA فارسی/RTL. `apps/web/src/main.tsx` ریشه routing/provider است؛ `apps/web/src/lib/api.ts` از درخواست‌های HTTP و URLهای نسبی استفاده می‌کند. Vite proxy در `apps/web/vite.config.ts` سرور-side برای `/api` و `/uploads` تعریف شده است.
- **API:** Express 5 + TypeScript، bootstrap از `apps/api/src/index.ts`; middleware/route mount از `apps/api/src/http/app.ts`; ۱۷ گروه route، زیر `/api` و `/api/v1`.
- **دامنه:** auth, catalog, requests, accounting, workforce/shifts, payroll, profiles, messages, notifications, automation, assistant, settings, sms, audit, backup/system.
- **داده:** `apps/api/src/db/index.ts` façade مشترک PostgreSQL `pg` و Node `node:sqlite`; تولید طبق `env.ts` PostgreSQL-only؛ SQLite برای توسعه/آزمون.
- **حفظ schema:** ۱۵ migration SQL ترتیبی، checksum registry. نقشه ERD تنها FKهای اعلام‌شده در DDL را قطعی نشان می‌دهد.
- **گراف وابستگی:** importهای نسبی با مسیرهای NodeNext `.js` که به `.ts/.tsx` موجود resolve می‌شوند نیز پوشش داده شده‌اند. 502 import محلی resolve شد؛ 0 چرخه استاتیک ثبت شد. JSON top importers و فایل‌های پرتکرار را نگه می‌دارد.
- **استقرار:** `deploy/nginx`, `deploy/systemd`, `deploy/postgres`, scripts نصب Linux/Windows و راهنمای عملیات. وجود پیکربندی، نصب موفق/زنده را اثبات نمی‌کند.
- **اجرای React:** `apps/web/src/main.tsx`. **اجرای API:** `apps/api/src/index.ts`. فرمان‌های npm در root/package workspace نشان داده شده‌اند.

## مسیرهای مهم عملیات

نمودارهای گام‌به‌گام، شرط‌های خطا، timeout، replay/409، نقاط transaction و مرز آزمون در نمای «جریان‌ها»ی HTML قرار دارند: ثبت درخواست، claim هم‌زمان کارکنان، پرداخت زرین‌پال، ارسال SMS رویدادی، assistant، مدیریت خدمت.

یافته مهم claim: endpoint واقعی `POST /api/requests/:id/claim` دارای `requirePermission('requests.edit')` و `claimRequest` تراکنشی است؛ `UPDATE ... WHERE assigned_to IS NULL AND status='new'` به تعداد تغییرات نگاه می‌کند و بازنده conflict می‌گیرد. بازآزمایی دو کارمند در workspace SQLite بوده؛ PostgreSQL multi-process load test هنوز انجام نشده است. در UI بعد از claim فقط queue همان client دوباره load می‌شود؛ channelی مانند WebSocket/SSE برای refresh سایر کاربران در سورس دیده نشد.

## نقش، دسترسی و داده

شش نقش system از `apps/api/src/lib/permissions.ts` استخراج شده‌اند: `super_admin` wildcard، `manager`, `service_expert`, `operator`, `document_reviewer`, `accountant`. مشتری یک `kind='customer'` است، نه یک role پیش‌فرض؛ permission list او خالی است و routeها به مالکیت object مقید می‌شوند. React route guard برای تجربه کاربری است؛ API نیز route-level `requirePermission`, `requireAuth`, office-scope و مالکیت را اعمال می‌کند. جدول HTML ماتریس مجوز دقیق نقش‌های پیش‌فرض را نشان می‌دهد؛ نقش سفارشی می‌تواند در پنل ساخته/ویرایش شود.

بخش‌های قابل توجه: request detail محدود به مشتری صاحب پرونده یا کارمند مسئول، مگر نقش دفتر؛ فایل‌ها با مالکیت/پرونده مربوطه کنترل می‌شوند؛ حسابداری دفتر علاوه بر permission role، office-scope جدا دارد. ارتباط‌های بین entityهایی که FK صریح ندارند در ERD به‌صورت constraint جا زده نشده‌اند.

## سرویس‌های بیرونی

| اتصال | کد/رفتار مشاهده‌شده | تست/وضعیت |
|---|---|---|
| PostgreSQL | `pg.Pool`; `DATABASE_URL`, `DB_POOL_MAX`; connect timeout 10s. | کد/driver موجود؛ DB واقعی در این extraction وصل نشد. |
| SQLite | `node:sqlite`; migrationها در حافظه برای تولید ERD اجرا شدند. | schema قابل اجرا در محیط محلی؛ DB تولیدی نیست. |
| MeliPayamak | panel/console REST؛ timeout 12s; normalized phone; error mapping/log/dedupe. | mock provider tests در مخزن؛ اتصال/تحویل واقعی نامعلوم. |
| Zarinpal | v4 request/verify, authority check, server amount, 15s timeout, sandbox gate. | آزمون شبیه‌سازی موجود؛ live/sandbox owner account در این دور استفاده نشد. |
| OpenAI-compatible | optional model, catalog context, secret API key, 15s timeout, builtin fallback. | کد وجود دارد؛ سرویس live، grounding سازمانی و حفظ حریم خصوصی نزد provider تست نشده. |
| Email | adapter/send call مشاهده نشد؛ فیلد `NotifyInput.email` به‌تنهایی integration نیست. | در کد مشهود پیاده نشده. |

## نقاط حساس و یافته‌ها

- **HIGH / confirmed — No tenant isolation:** Multi-office shared DB/storage is not safe/implemented; isolate each office in a separate installation/database/key set. (شواهد: docs/ARCHITECTURE.md, core schema has no tenant_id/RLS and app queries are office-global).
- **MEDIUM / confirmed — Rate limiting is process-local:** Multiple API processes do not share rate-limit state; deployment documentation assumes one API process or requires an external limiter. (شواهد: apps/api/src/http/app.ts: bounded process-local throttle comment, apps/api/src/http/middleware.ts: in-memory counters).
- **MEDIUM / confirmed — No live update channel for other queue users:** A different employee's page can show stale queue until refresh/next fetch; HTTP atomic claim remains authoritative. (شواهد: apps/web/src/pages/staff/Queue.tsx: load() after own claim; no socket/SSE dependency or server route found).
- **MEDIUM / confirmed — Only table-declared FKs are drawn as schema relationships:** Fields such as audit actor identifiers and file owner IDs may be application-level references without declared FK; graph marks only declared relationships. (شواهد: 44-table schema compiled from apps/api/migrations/*.sql).
- **MEDIUM / confirmed — External production connections are not proven by this snapshot:** MeliPayamak, Zarinpal, OpenAI-compatible and PostgreSQL live operation require explicit sandbox/production tests by operator. (شواهد: provider adapters exist; no production credentials/network call are part of this map).
- **LOW / confirmed — Large page modules concentrate UI responsibilities:** Changes can affect multiple views in each large module; consider extracting components/hooks only after targeted regression tests. (شواهد: apps/web/src/pages/admin/CatalogAdmin.tsx; PeopleAdmin.tsx; FinanceAdmin.tsx; Operations.tsx; apps/web/src/pages/staff/StaffPages.tsx; apps/web/src/pages/customer/CustomerPages.tsx).
- **MEDIUM / confirmed — No active CI workflow file in .github/workflows was tracked:** Local build/test success is not an automatically enforced GitHub check in this snapshot. (شواهد: git ls-files has no .github/workflows; docs/CI-WORKFLOW.example.yml is an example only).
- **MEDIUM / confirmed — Static CMS/promo-code features were not present in observed code:** The public Home page is code-composed and catalog service discount fields exist; scheduled banner CMS/preview, FAQ CMS and coupon campaign are not evidenced. (شواهد: main.tsx/Home.tsx; routes and settings definitions; no banner/FAQ management route/entity or coupon-code module found).
- **LOW / static-analysis — No cycle in resolved static import graph:** Tarjan SCC detected 0 cyclic component(s). Dynamic imports, computed module names and unresolved aliases are outside this result. (شواهد: 502 resolved local import edges across 179 tracked files).

## محدودیت‌های بررسی

- پوشش درخت فایل برای تمام 179 فایل Git-tracked ثبت شده، اما همه خطوط همه فایل‌ها را line-by-line manual review نکردم؛ برای جزئیات هر فایل، گره inventory و import/SQL evidence را باز کنید.
- migration SQL در SQLite اجرا شد، نه PostgreSQL server؛ SQLite موفقیت syntax/semantics تمام dialectهای PostgreSQL را تضمین نمی‌کند.
- static import parser، aliasهای پیچیده، computed paths و reflection را نمی‌بیند؛ unmatched browser-callها جداگانه برچسب دارند.
- route permission analysis بر اساس literal middleware و static code است؛ تست نفوذ exhaustively تمام شاخه‌های auth و custom roles انجام نشد.
- branch history در تاریخ snapshot: `ab145955a23fe547f700803b7432eb26fa356ad4`. فایل‌های جدید خروجی در فهرست ۱۷۹ فایل مبنا شمرده نشده‌اند.
- اتصال واقعی PostgreSQL، پیامک، درگاه، LLM، ارسال email، دامنه/TLS، systemd/Nginx، APK و backup خارج سرور از این فایل/کد به‌تنهایی اثبات نمی‌شوند.

## مشاهده و بازتولید

- فایل اصلی: `Pishkan-Architecture-Map.html` — مستقل، آفلاین، RTL.
- داده: `Pishkan-Architecture-Data.json` — همه node/edgeها، schemas، routeها، flows و evidence.
- گزارش: `Pishkan-Architecture-Report.md` — همین گزارش.
- ساخت مجدد در ریشه repository: `python3 tools/generate_pishkan_architecture.py` (Python 3 استاندارد؛ برای اجرای generator هیچ dependency خارجی لازم نیست).
