import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError, forbidden, tooMany, unauthorized } from './errors.js';
import type { AuthContext } from '../modules/auth/types.js';
import { hasPermission } from '../lib/permissions.js';

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
const buckets = new Map<string, Bucket>();

export function resetRateLimits() {
  buckets.clear();
}

/** In-memory fixed-window limiter. Suitable for a single node deployment. */
export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string; message?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.path}:${options.key ? options.key(req) : req.ip ?? 'unknown'}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return next(tooMany(options.message ?? `تعداد درخواست بیش از حد مجاز است. ${retry} ثانیه دیگر تلاش کنید.`));
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
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
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
