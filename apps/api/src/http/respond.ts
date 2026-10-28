import type { Request } from 'express';

export function pagination(req: Request, defaults: { pageSize?: number } = {}) {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? defaults.pageSize ?? 20) || 20));
  return { page, pageSize };
}

export function ok(res: any, data: unknown, meta?: unknown) {
  return res.json({ ok: true, data, ...(meta ? { meta } : {}) });
}

export function created(res: any, data: unknown) {
  return res.status(201).json({ ok: true, data });
}

export function dateRange(req: Request): { from?: string; to?: string } {
  return {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
  };
}
