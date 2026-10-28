/**
 * Thin API client.
 *
 * All requests use relative URLs so the same build works when the SPA is served
 * by the API (production), by the Vite dev proxy, or inside the Android WebView.
 */

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiFailure extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
  }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; query?: Record<string, unknown> };

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

async function request<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const isForm = body instanceof FormData;

  const response = await fetch(buildUrl(path, query), {
    method,
    credentials: 'same-origin',
    headers: {
      ...(isForm ? {} : { 'content-type': 'application/json' }),
      ...(headers as Record<string, string> | undefined),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    ...rest,
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiFailure(response.status, { code: 'http_error', message: `خطای سرور (${response.status})` });
    return (await response.blob()) as T;
  }

  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new ApiFailure(response.status, json.error ?? { code: 'error', message: 'خطای نامشخص' });
  }
  return json as T;
}

export interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File, query?: Record<string, unknown>) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', path, { body: form, query });
  },

  /** Unwrap `{ok,data,meta}` list responses. */
  async list<T>(path: string, query?: Record<string, unknown>): Promise<ListResult<T>> {
    const res = await request<{ data: T[]; meta?: { total?: number; page?: number; pageSize?: number } }>('GET', path, { query });
    return {
      data: res.data ?? [],
      total: res.meta?.total ?? res.data?.length ?? 0,
      page: res.meta?.page ?? 1,
      pageSize: res.meta?.pageSize ?? (res.data?.length || 20),
    };
  },
};
