import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000';

/** Error from the API; `code` is an i18n key when the server sent one. Status 0 means no connection. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

let access: string | null = null;
let refreshToken: string | null = null;
let deviceId: string | null = null;
let onLoggedOut: () => void = () => undefined;
export const setOnLoggedOut = (fn: () => void) => (onLoggedOut = fn);

export async function loadSession() {
  access = await SecureStore.getItemAsync('lf.access');
  refreshToken = await SecureStore.getItemAsync('lf.refresh');
  return !!access;
}

export async function saveSession(a: string, r: string) {
  access = a;
  refreshToken = r;
  await SecureStore.setItemAsync('lf.access', a);
  await SecureStore.setItemAsync('lf.refresh', r);
}

export async function clearSession() {
  access = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync('lf.access');
  await SecureStore.deleteItemAsync('lf.refresh');
}

/** A stable id for this phone; agents are bound to the phone they first log in on. */
export async function getDeviceId() {
  if (deviceId) return deviceId;
  deviceId = await SecureStore.getItemAsync('lf.device');
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await SecureStore.setItemAsync('lf.device', deviceId);
  }
  return deviceId;
}

export const newRef = () => Crypto.randomUUID();

let refreshing: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  if (!refreshToken) return Promise.resolve(false);
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) })
    .then(async (r) => {
      if (!r.ok) return false;
      const d = await r.json();
      await saveSession(d.accessToken, d.refreshToken);
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { 'x-device-id': await getDeviceId() };
  if (access) headers.authorization = `Bearer ${access}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  } catch {
    throw new ApiError(0, 'No internet connection', 'errors.network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && retry && path !== '/auth/login') {
    if (await refresh()) return api<T>(method, path, body, false);
    await clearSession();
    onLoggedOut();
  }
  const text = await res.text();
  let data: { message?: string; code?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, data?.message ?? res.statusText, data?.code);
  return data as T;
}

export const get = <T = unknown>(path: string, params?: Record<string, string | number | undefined | null>) => {
  const qs = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '') : [];
  return api<T>('GET', path + (qs.length ? '?' + qs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : ''));
};
export const post = <T = unknown>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T = unknown>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {});

/** Ends this phone's session on the server too (best effort). */
export async function logoutRemote() {
  if (refreshToken) await post('/auth/logout', { refreshToken }).catch(() => undefined);
}
