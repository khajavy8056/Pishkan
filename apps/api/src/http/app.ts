import { automationRouter } from '../routes/automation.js';
import { payrollRouter } from '../routes/payroll.js';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { resolveSession } from '../modules/auth/service.js';
import { errorHandler, notFoundHandler, requestId, rateLimit } from './middleware.js';
import { forbidden } from './errors.js';
import { getBool, getString } from '../modules/settings/service.js';
import { healthRouter } from '../routes/health.js';
import { publicRouter } from '../routes/public.js';
import { authRouter } from '../routes/auth.js';
import { catalogRouter } from '../routes/catalog.js';
import { requestsRouter } from '../routes/requests.js';
import { customersRouter } from '../routes/customers.js';
import { staffRouter } from '../routes/staff.js';
import { shiftsRouter } from '../routes/shifts.js';
import { accountingRouter } from '../routes/accounting.js';
import { messagesRouter } from '../routes/messages.js';
import { settingsRouter } from '../routes/settings.js';
import { filesRouter } from '../routes/files.js';
import { documentsRouter } from '../routes/documents.js';
import { assistantRouter } from '../routes/assistant.js';
import { dashboardRouter } from '../routes/dashboard.js';
import { systemRouter } from '../routes/system.js';
import { paymentsRouter } from '../routes/payments.js';
import { walletRouter } from '../routes/wallet.js';
import { monitoringRouter } from '../routes/monitoring.js';
import { discountsRouter } from '../routes/discounts.js';
import { referralsRouter } from '../routes/referrals.js';
import { supportRouter } from '../routes/support.js';
import { pushRouter } from '../routes/push.js';
import { mobileRouter } from '../routes/mobile.js';
import { blogRouter, blogSeoRouter, publicBlogRouter } from '../routes/blog.js';
import { recordRequest } from '../modules/monitoring/metrics.js';
import { logEvent, setMinimumLevel } from '../modules/logging/service.js';

function rateLimitConfig() {
  const configured = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300);
  return { windowMs: 60_000, max: Number.isSafeInteger(configured) && configured > 0 ? configured : 300 };
}

/** Reject cross-site state-changing requests made with cookie auth. */
function originGuard(req: Request, _res: Response, next: NextFunction) {
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!mutating) return next();
  const origin = req.header('origin');
  if (!origin) return next(); // native apps / server-to-server
  try {
    const host = new URL(origin).host;
    const allowed = new Set([
      ...env.corsOrigins.map((o) => { try { return new URL(o).host; } catch { return ''; } }),
      req.header('host') ?? '',
    ]);
    if (allowed.has(host)) return next();
  } catch { /* invalid origin header */ }
  return next(forbidden('درخواست از مبدأ نامعتبر رد شد.'));
}

export async function createApp(): Promise<Express> {
  const app = express();
  app.set('trust proxy', env.trustProxy ? 1 : false);
  app.disable('x-powered-by');

  const customCsp = await import('../modules/settings/service.js')
    .then((m) => m.getString('security.content_security_policy'))
    .catch(() => '');
  const customDirectives = customCsp ? JSON.parse(customCsp) as Record<string, unknown> : null;
  const customUpgrade = customDirectives && ('upgrade-insecure-requests' in customDirectives || 'upgradeInsecureRequests' in customDirectives);
  const hsts = env.isProd && (await getBool('security.hsts').catch(() => true))
    ? { maxAge: 15552000, includeSubDomains: true }
    : false as const;

  // Helmet defaults to upgrade-insecure-requests. On an HTTP LAN origin this
  // upgrades the SPA's own JS/CSS to HTTPS, but the local Windows server does
  // not speak TLS. Keep the upgrade on HTTPS, including trusted TLS proxies.
  // An explicitly configured CSP directive still takes precedence.
  const securityHeaders = (secure: boolean) => helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: customDirectives
        ? { defaultSrc: ["'self'"], ...(!secure && !customUpgrade ? { 'upgrade-insecure-requests': null } : {}), ...customDirectives }
        : {
            'default-src': ["'self'"],
            'img-src': ["'self'", 'data:', 'blob:'],
            'script-src': ["'self'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'font-src': ["'self'", 'data:'],
            'connect-src': ["'self'"],
            'frame-ancestors': ["'self'"],
            'object-src': ["'none'"],
            'base-uri': ["'self'"],
            'form-action': ["'self'"],
            ...(!secure ? { 'upgrade-insecure-requests': null } : {}),
          },
    },
    crossOriginEmbedderPolicy: false,
    hsts,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
  const secureHeaders = securityHeaders(true);
  const httpHeaders = securityHeaders(false);
  app.use((req, res, next) => (req.secure ? secureHeaders : httpHeaders)(req, res, next));

  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!req.path.startsWith('/api/health')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestId);

  // CORS for split-origin deployments (web on :5173, api on :3000 in development)
  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin && env.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-request-id, idempotency-key');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use(originGuard);

  // Bounded process-local API throttle. Deployment docs require a single API
  // process; shared/distributed deployments need an external limiter.
  const { windowMs, max } = rateLimitConfig();
  app.use('/api', rateLimit({ windowMs, max, includePath: false }));

  // Real API telemetry: every call feeds the monitoring counters and the
  // structured log. Query strings are never logged (they may contain tokens).
  const logLevelMinimum = await getString('monitoring.log_level').catch(() => 'INFO');
  setMinimumLevel(logLevelMinimum);
  app.use('/api', (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - started;
      recordRequest({ durationMs, status: res.statusCode, path: req.path });
      if (req.path.startsWith('/api/health')) return;
      if (res.statusCode >= 500) return; // errorHandler records the details
      const isDenied = res.statusCode === 401 || res.statusCode === 403;
      void logEvent({
        level: isDenied ? 'SECURITY' : res.statusCode >= 400 ? 'WARNING' : 'DEBUG',
        category: isDenied ? 'security' : 'api',
        action: isDenied ? 'api.unauthorized' : 'api.request',
        result: isDenied ? 'denied' : res.statusCode >= 400 ? 'failure' : 'success',
        actorId: req.auth?.user.id, actorName: req.auth?.user.fullName, actorRole: req.auth?.user.roleCode,
        ip: req.ip, requestId: req.requestId, durationMs,
        message: `${req.method} ${req.path} → ${res.statusCode}`,
        details: { status: res.statusCode, method: req.method, path: req.path },
      });
    });
    next();
  });

  // attach session (cookie or bearer)
  app.use(async (req, _res, next) => {
    try {
      const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
      const token = bearer || (req.cookies?.[env.sessionCookie] as string | undefined) || '';
      if (token) {
        const ctx = await resolveSession(token, { ip: req.ip, userAgent: req.header('user-agent') });
        if (ctx) {
          req.auth = ctx;
          // Presence heartbeat for fair automatic assignment: at most one
          // write per user per minute, never allowed to fail the request.
          if (ctx.user.kind !== 'customer') {
            const userId = ctx.user.id;
            const now = new Date();
            const staleBefore = new Date(now.getTime() - 60_000).toISOString();
            void import('../db/index.js')
              .then(({ run }) => run(
                'UPDATE users SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)',
                [now.toISOString(), userId, staleBefore],
              ))
              .catch(() => undefined);
          }
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  /* ------------------------------- API routes ------------------------------ */
  app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
  app.use(['/api/health','/api/v1/health'],healthRouter);
  app.use(['/api/public','/api/v1/public'],publicRouter);
  app.use(['/api/auth','/api/v1/auth'],authRouter);
  app.use(['/api/catalog','/api/v1/catalog'],catalogRouter);
  app.use(['/api/automation','/api/v1/automation'],automationRouter);
  app.use(['/api/requests','/api/v1/requests'],requestsRouter);
  app.use(['/api/customers','/api/v1/customers'],customersRouter);
  app.use(['/api/staff','/api/v1/staff'],staffRouter);
  app.use(['/api/shifts','/api/v1/shifts'],shiftsRouter);
  app.use(['/api/accounting','/api/v1/accounting'],accountingRouter);
  app.use(['/api/payroll','/api/v1/payroll'],payrollRouter);
  app.use(['/api/messages','/api/v1/messages'],messagesRouter);
  app.use(['/api/settings','/api/v1/settings'],settingsRouter);
  app.use(['/api/files','/api/v1/files'],filesRouter);
  app.use(['/api/documents','/api/v1/documents'],documentsRouter);
  app.use(['/api/assistant','/api/v1/assistant'],assistantRouter);
  app.use(['/api/dashboard','/api/v1/dashboard'],dashboardRouter);
  app.use(['/api/system','/api/v1/system'],systemRouter);
  app.use(['/api/payments','/api/v1/payments'],paymentsRouter);
  app.use(['/api/wallet','/api/v1/wallet'],walletRouter);
  app.use(['/api/monitoring','/api/v1/monitoring'],monitoringRouter);
  app.use(['/api/discount-codes','/api/v1/discount-codes'],discountsRouter);
  app.use(['/api/referrals','/api/v1/referrals'],referralsRouter);
  app.use(['/api/support','/api/v1/support'],supportRouter);
  app.use(['/api/push','/api/v1/push'],pushRouter);
  app.use(['/api/app','/api/v1/app'],mobileRouter);
  app.use(['/api/blog','/api/v1/blog'],blogRouter);
  app.use(['/api/public/blog','/api/v1/public/blog'],publicBlogRouter);
  app.use(blogSeoRouter);

  /* -------------------------- static web application ----------------------- */
  // The SPA can be served from several layouts: a repo checkout started from the
  // repository root, a packaged install started from elsewhere, or a deploy that
  // copies the build to dist/web. Resolve against both the working directory and
  // this module's own location so the API never loses the UI because of `cd`.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), 'dist/web'),
    path.resolve(moduleDir, '../../../web/dist'),
    path.resolve(moduleDir, '../../web/dist'),
    path.resolve(moduleDir, '../../../../web/dist'),
  ];
  const dist = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ?? null;
  const uploadsPublic = path.join(env.uploadDir, 'public');

  if (fs.existsSync(uploadsPublic)) {
    app.use('/uploads/public', express.static(uploadsPublic, { maxAge: '7d', fallthrough: true }));
  }

  if (dist) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.status(200).json({
        ok: true,
        message: 'Pishkan API is running. Build the web app (npm run build) to serve the UI from this server.',
        docs: '/api/health',
      });
    });
  }

  app.use('/api', notFoundHandler);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
