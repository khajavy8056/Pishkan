import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError, forbidden, tooMany, unauthorized } from './errors.js';
import type { AuthContext } from '../modules/auth/types.js';
import { hasPermission } from '../lib/permissions.js';
import { safeErrorText, sanitizeLogText } from '../lib/safe-log.js';
import { logEvent } from '../modules/logging/service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId?: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length < 100 ? incoming : Math.random().toString(36).slice(2, 12);
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** Require a valid session; attaches `req.auth`. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requireKind(...kinds: AuthContext['user']['kind'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!kinds.includes(req.auth.user.kind)) return next(forbidden('این بخش برای نوع حساب شما در دسترس نیست.'));
    next();
  };
}

/** Server-side permission gate. UI hiding is never enough on its own. */
export function requirePermission(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    const granted = req.auth.permissions;
    if (!perms.every((p) => hasPermission(granted, p))) {
      void logEvent({
        level: 'SECURITY', category: 'security', action: 'permission.denied', result: 'denied',
        actorId: req.auth.user.id, actorName: req.auth.user.fullName, actorRole: req.auth.user.roleCode,
        ip: req.ip, requestId: req.requestId, message: 'تلاش برای دسترسی بدون مجوز لازم.',
        details: { required: perms, method: req.method, path: req.path },
      });
      return next(forbidden(`دسترسی لازم وجود ندارد: ${perms.join(' , ')}`));
    }
    next();
  };
}

export function requireAnyPermission(...perms: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!perms.some((p) => hasPermission(req.auth!.permissions, p))) {
      return next(forbidden());
    }
    next();
  };
}

/* ------------------------------ rate limiting ------------------------------ */

interface Bucket { count: number; resetAt: number }

/** Bounded fixed-window storage; old IP/path keys cannot grow without limit. */
export function createRateLimitStore(capacity = 20_000, sweepEvery = 128) {
  const buckets = new Map<string, Bucket>();
  let operations = 0;
  return {
    take(key: string, windowMs: number, max: number, now = Date.now()) {
      operations += 1;
      if (operations % sweepEvery === 0 || buckets.size >= capacity) {
        for (const [candidate, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(candidate);
      }
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size >= capacity) {
          const oldest = buckets.keys().next().value as string | undefined;
          if (oldest !== undefined) buckets.delete(oldest);
        }
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      return {
        allowed: bucket.count <= max,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    },
    clear() { buckets.clear(); operations = 0; },
    get size() { return buckets.size; },
  };
}

const rateLimitStore = createRateLimitStore();
export function resetRateLimits() { rateLimitStore.clear(); }

/** In-memory fixed-window limiter. Safe for the documented single-process API deployment. */
export function rateLimit(options: {
  windowMs: number; max: number; key?: (req: Request) => string;
  includePath?: boolean; message?: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const identity = options.key ? options.key(req) : req.ip ?? 'unknown';
    const key = `${options.includePath === false ? 'all' : req.path}:${identity}`;
    const result = rateLimitStore.take(key, options.windowMs, options.max);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return next(tooMany(options.message ?? `تعداد درخواست بیش از حد مجاز است. ${result.retryAfterSeconds} ثانیه دیگر تلاش کنید.`));
    }
    next();
  };
}

/* -------------------------------- responses -------------------------------- */

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'مسیر درخواستی وجود ندارد.', 'not_found'));
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let message = 'خطای غیرمنتظره در سرور رخ داد.';
  let code = 'internal_error';
  let details: unknown;

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    message = 'داده‌های ارسالی معتبر نیست.';
    code = 'validation_error';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'حجم درخواست بیش از حد مجاز است.';
    code = 'payload_too_large';
  } else if (err?.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'حجم فایل بیش از حد مجاز است.';
    code = 'file_too_large';
  } else if (err?.name === 'MulterError') {
    status = 400;
    message = 'فایل ارسالی پذیرفته نشد.';
    code = 'upload_error';
  }

  if (status >= 500) {
    // req.path excludes query parameters (payment authorities/tokens may be there).
    const routePath = sanitizeLogText(req.path || '/', 300);
    console.error(sanitizeLogText(`[error] ${req.method} ${routePath} status=${status} code=${code}: ${safeErrorText(err)}`, 3200));
    void logEvent({
      level: 'ERROR', category: 'server', action: 'api.error', result: 'failure',
      actorId: req.auth?.user.id, actorName: req.auth?.user.fullName, actorRole: req.auth?.user.roleCode,
      ip: req.ip, requestId: req.requestId, errorCode: code,
      message: `خطای سرور در ${req.method} ${routePath}`,
      details: { status, code, error: safeErrorText(err, 800) },
    });
  } else if (status === 403) {
    void logEvent({
      level: 'SECURITY', category: 'security', action: 'api.forbidden', result: 'denied',
      actorId: req.auth?.user.id, actorName: req.auth?.user.fullName, actorRole: req.auth?.user.roleCode,
      ip: req.ip, requestId: req.requestId, errorCode: code,
      message: 'درخواست غیرمجاز رد شد.', details: { method: req.method, path: sanitizeLogText(req.path || '/', 200) },
    });
  }

  res.status(status).json({
    ok: false,
    error: { code, message, details, requestId: req.requestId },
  });
}

export function asyncRoute<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
