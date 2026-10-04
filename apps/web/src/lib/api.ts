const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

const store = {
  get access() {
    return localStorage.getItem('lf.access');
  },
  get refresh() {
    return localStorage.getItem('lf.refresh');
  },
  set(access: string, refresh: string) {
    localStorage.setItem('lf.access', access);
    localStorage.setItem('lf.refresh', refresh);
  },
  clear() {
    localStorage.removeItem('lf.access');
    localStorage.removeItem('lf.refresh');
  },
};
export const tokens = store;

/** Error from the API, carrying the i18n key in `code` and per-field messages. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const rt = store.refresh;
  if (!rt) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
    .then(async (r) => {
      if (!r.ok) return false;
      const d = await r.json();
      store.set(d.accessToken, d.refreshToken);
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export let onUnauthorized: () => void = () => undefined;
export const setOnUnauthorized = (fn: () => void) => (onUnauthorized = fn);
export let supportTenant: string | null = sessionStorage.getItem('lf.supportTenant');
export const setSupportTenant = (id: string | null) => {
  supportTenant = id;
  if (id) sessionStorage.setItem('lf.supportTenant', id);
  else sessionStorage.removeItem('lf.supportTenant');
};

export async function api<T = unknown>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (store.access) headers.authorization = `Bearer ${store.access}`;
  if (supportTenant) headers['x-tenant-id'] = supportTenant;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Cannot reach the server', 'errors.network');
  }
  if (res.status === 401 && retry && path !== '/auth/login' && (await refresh())) return api<T>(method, path, body, false);
  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.message ?? res.statusText, data?.code, data?.fields);
  return data as T;
}

export const get = <T = unknown>(path: string, params?: Record<string, string | number | undefined | null>) => {
  const qs = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '') : [];
  return api<T>('GET', path + (qs.length ? '?' + new URLSearchParams(qs.map(([k, v]) => [k, String(v)])).toString() : ''));
};
export const post = <T = unknown>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T = unknown>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});
export const patch = <T = unknown>(path: string, body?: unknown) => api<T>('PATCH', path, body ?? {});
export const del = <T = unknown>(path: string) => api<T>('DELETE', path);

/** Opens a private file in a new tab (files need the login token). */
export async function openFile(url: string) {
  const res = await fetch(BASE + url, { headers: { authorization: `Bearer ${store.access}` } });
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), '_blank');
}

export async function upload(file: File, meta: Record<string, string>) {
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(meta).forEach(([k, v]) => fd.append(k, v));
  return api<{ id: string; url: string; fileName: string }>('POST', '/files', fd);
}
