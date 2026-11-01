export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'برای دسترسی باید وارد شوید.', details?: unknown) =>
  new HttpError(401, message, 'unauthorized', details);
export const forbidden = (message = 'شما اجازه انجام این عملیات را ندارید.', details?: unknown) =>
  new HttpError(403, message, 'forbidden', details);
export const notFound = (message = 'مورد درخواستی یافت نشد.', details?: unknown) =>
  new HttpError(404, message, 'not_found', details);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, message, 'conflict', details);
export const tooMany = (message = 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.', details?: unknown) =>
  new HttpError(429, message, 'rate_limited', details);
export const unavailable = (message = 'سرویس موقتاً در دسترس نیست.', details?: unknown) =>
  new HttpError(503, message, 'unavailable', details);
