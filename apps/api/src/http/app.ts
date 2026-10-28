import { automationRouter } from '../routes/automation.js';
import { payrollRouter } from '../routes/payroll.js';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';
import { resolveSession } from '../modules/auth/service.js';
import { errorHandler, notFoundHandler, requestId, rateLimit } from './middleware.js';
import { forbidden } from './errors.js';
import { getBool } from '../modules/settings/service.js';
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
import { assistantRouter } from '../routes/assistant.js';
import { dashboardRouter } from '../routes/dashboard.js';
import { systemRouter } from '../routes/system.js';

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

  const csp = await getBool('security.content_security_policy').catch(() => false);
  const customCsp = await import('../modules/settings/service.js')
    .then((m) => m.getString('security.content_security_policy'))
    .catch(() => '');

  app.use(helmet({
    contentSecurityPolicy: customCsp
      ? { directives: { defaultSrc: ["'self'"], ...(JSON.parse(customCsp) as object) } }
      : {
          useDefaults: true,
          directives: {
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
          },
        },
    crossOriginEmbedderPolicy: false,
    hsts: env.isProd && (await getBool('security.hsts').catch(() => true))
      ? { maxAge: 15552000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

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
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-request-id');
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

  // attach session (cookie or bearer)
  app.use(async (req, _res, next) => {
    try {
      const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
      const token = bearer || (req.cookies?.[env.sessionCookie] as string | undefined) || '';
      if (token) {
        const ctx = await resolveSession(token, { ip: req.ip, userAgent: req.header('user-agent') });
        if (ctx) req.auth = ctx;
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
  app.use(['/api/assistant','/api/v1/assistant'],assistantRouter);
  app.use(['/api/dashboard','/api/v1/dashboard'],dashboardRouter);
  app.use(['/api/system','/api/v1/system'],systemRouter);

  /* -------------------------- static web application ----------------------- */
  const webDist = path.resolve(process.cwd(), 'apps/web/dist');
  const fallbackDist = path.resolve(process.cwd(), 'dist/web');
  const dist = fs.existsSync(webDist) ? webDist : fs.existsSync(fallbackDist) ? fallbackDist : null;
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
