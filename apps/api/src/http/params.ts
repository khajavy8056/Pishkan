import type { Request } from 'express';

/**
 * Express 5 types allow `string | string[]` for params; every route in this app
 * uses single-value params, so normalise once here.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
