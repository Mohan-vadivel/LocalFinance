import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, get, post } from './api';

// ---------- Shapes from the API ----------
export interface Profile {
  id: string;
  name: string;
  role: string;
  roleName: string;
  language: string;
  permissions: string[];
  branches: { id: string; name: string }[];
  tenant: { id: string; name: string } | null;
}
export interface MyRoute { id: string; name: string; location: string; locationId: string; branchId: string; collectsToday: boolean; customerCount: number }
export interface DayLoan {
  id: string;
  number: string;
  principal: number;
  frequency: string;
  instalmentAmount: number;
  dueNow: number;
  dueToday: number;
  arrears: number;
  penalty: number;
  outstanding: number;
  daysPastDue: number;
  lastPayments: { date: string; amount: number; mode: string; receiptNo: string }[];
}
export type PinStatus = 'PAID' | 'PARTIAL' | 'MISSED' | 'NOTHING_DUE' | 'PENDING';
export interface DayCustomer {
  id: string;
  code: string;
  name: string;
  phone: string;
  address: string;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  routeSeq: number | null;
  status: string;
  dueNow: number;
  paidToday: number;
  pin: PinStatus;
  lastVisit: { outcome: string; promiseDate: string | null } | null;
  /** Hour of day (0 to 23, IST) this customer usually pays at; null when not known. */
  usualHour?: number | null;
  /** The customer's own language for messages (en or ta). */
  language?: string;
  /** Open promise-to-pay date (YYYY-MM-DD), if any. */
  promiseDate?: string | null;
  loans: DayLoan[];
}
export interface RouteDay { route: { id: string; name: string; location: string }; date: string; customers: DayCustomer[] }

// ---------- Offline queue ----------
export interface QueuedCollection {
  kind: 'collection';
  clientRef: string;
  loanId: string;
  amount: number;
  mode: 'CASH' | 'UPI' | 'CARD' | 'BANK';
  upiRef?: string | null;
  note?: string | null;
  collectedAt: string;
  lat?: number | null;
  lng?: number | null;
  /** For the phone's own screens only. */
  customerId: string;
  customerName: string;
  routeId?: string;
}
export interface QueuedVisit {
  kind: 'visit';
  clientRef: string;
  customerId: string;
  loanId?: string | null;
  outcome: 'NOT_HOME' | 'REFUSED' | 'PROMISED' | 'PAID' | 'PARTIAL';
  promiseDate?: string | null;
  note?: string | null;
  visitedAt: string;
  lat?: number | null;
  lng?: number | null;
  customerName: string;
  routeId?: string;
}
export type QueueItem = QueuedCollection | QueuedVisit;
export interface FailedItem { item: QueueItem; error: string }
export interface SyncedItem { clientRef: string; receiptNo?: string; customerName: string; amount?: number; at: string }

const K = { queue: 'lf.queue', failed: 'lf.failed', synced: 'lf.synced', lastSync: 'lf.lastSync', routes: 'lf.routes', profile: 'lf.profile', day: (id: string) => `lf.day.${id}` };

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
const write = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v));

type Listener = () => void;
const listeners = new Set<Listener>();
export const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const changed = () => listeners.forEach((l) => l());

export const getQueue = () => read<QueueItem[]>(K.queue, []);
export const getFailed = () => read<FailedItem[]>(K.failed, []);
export const getSynced = () => read<SyncedItem[]>(K.synced, []);
export const getLastSync = () => read<string | null>(K.lastSync, null);
export async function dismissFailed(clientRef: string) {
  await write(K.failed, (await getFailed()).filter((f) => f.item.clientRef !== clientRef));
  changed();
}

/** Puts a rejected item back in the queue with the same clientRef (so the office never counts it twice) and sends it. */
export async function retryFailed(clientRef: string) {
  const failed = await getFailed();
  const f = failed.find((x) => x.item.clientRef === clientRef);
  if (!f) return null;
  await write(K.failed, failed.filter((x) => x !== f));
  const q = await getQueue();
  if (!q.some((i) => i.clientRef === clientRef)) q.push(f.item);
  await write(K.queue, q);
  changed();
  return sync();
}

/** True while the item is on the phone only: queued and not part of a send that is running now. */
export async function isUnsent(clientRef: string) {
  return !inFlight.has(clientRef) && (await getQueue()).some((i) => i.clientRef === clientRef);
}

/**
 * Takes an unsent item back off the queue (the "Undo" after saving) and puts the customer on the cached route as
 * it was before. Returns false when it has already gone (or is going) to the office.
 */
export async function removeQueued(clientRef: string) {
  if (!(await isUnsent(clientRef))) return false;
  const q = await getQueue();
  const item = q.find((i) => i.clientRef === clientRef)!;
  const rest = q.filter((i) => i.clientRef !== clientRef);
  await write(K.queue, rest);
  const before = snapshots.get(clientRef);
  if (item.routeId && before) {
    const day = await read<RouteDay | null>(K.day(item.routeId), null);
    const at = day?.customers.findIndex((x) => x.id === item.customerId) ?? -1;
    if (day && at >= 0) {
      // Restore the copy from before this item, then re-apply anything saved for the customer after it.
      const c: DayCustomer = JSON.parse(JSON.stringify(before));
      for (const later of rest.slice(q.indexOf(item)).filter((i) => i.customerId === item.customerId)) applyLocal(c, later);
      day.customers[at] = c;
      await write(K.day(item.routeId), day);
    }
  }
  snapshots.delete(clientRef);
  changed();
  return true;
}

/** The customer as it was on the cached route before each item was saved, for Undo (kept in memory only). */
const snapshots = new Map<string, DayCustomer>();
/** clientRefs in the send that is running now; these can no longer be undone. */
const inFlight = new Set<string>();

/** Saves on the phone first, updates the cached route so the pin changes at once, then tries to send. */
export async function enqueue(item: QueueItem) {
  const q = await getQueue();
  q.push(item);
  await write(K.queue, q);
  if (item.routeId) {
    const day = await read<RouteDay | null>(K.day(item.routeId), null);
    if (day) {
      const c = day.customers.find((x) => x.id === item.customerId);
      if (c) {
        snapshots.set(item.clientRef, JSON.parse(JSON.stringify(c)));
        applyLocal(c, item);
      }
      await write(K.day(item.routeId), day);
    }
  }
  changed();
  return sync();
}

function applyLocal(c: DayCustomer, item: QueueItem) {
  if (item.kind === 'collection') {
    c.paidToday += item.amount;
    const l = c.loans.find((x) => x.id === item.loanId);
    if (l) {
      l.dueNow = Math.max(0, l.dueNow - item.amount);
      l.outstanding = Math.max(0, l.outstanding - item.amount);
      l.lastPayments = [{ date: item.collectedAt.slice(0, 10), amount: item.amount, mode: item.mode, receiptNo: '…' }, ...l.lastPayments];
    }
    c.dueNow = c.loans.reduce((s, x) => s + x.dueNow, 0);
    c.pin = c.dueNow === 0 ? 'PAID' : 'PARTIAL';
  } else {
    c.lastVisit = { outcome: item.outcome, promiseDate: item.promiseDate ?? null };
    if (c.paidToday === 0) c.pin = 'MISSED';
  }
}

let syncing: Promise<{ sent: number; failed: number; offline: boolean }> | null = null;

/** Sends everything waiting. Each item is accepted or rejected on its own; a retried item is never counted twice. */
export function sync() {
  syncing ??= (async () => {
    const q = await getQueue();
    if (!q.length) return { sent: 0, failed: 0, offline: false };
    const collections = q.filter((i): i is QueuedCollection => i.kind === 'collection');
    const visits = q.filter((i): i is QueuedVisit => i.kind === 'visit');
    q.forEach((i) => inFlight.add(i.clientRef));
    let res: { results: { clientRef: string; status: 'OK' | 'DUPLICATE' | 'ERROR'; receiptNo?: string; error?: string }[] };
    try {
      res = await post('/collections/sync', {
        collections: collections.map(({ kind: _k, customerId: _c, customerName: _n, routeId: _r, ...c }) => c),
        visits: visits.map(({ kind: _k, customerName: _n, routeId: _r, ...v }) => v),
      });
    } catch (e) {
      return { sent: 0, failed: 0, offline: e instanceof ApiError && e.status === 0 };
    }
    const done = new Set<string>();
    const failed = await getFailed();
    const synced = await getSynced();
    for (const r of res.results) {
      const item = q.find((i) => i.clientRef === r.clientRef);
      if (!item) continue;
      done.add(r.clientRef);
      if (r.status === 'ERROR') failed.push({ item, error: r.error ?? 'Error' });
      else synced.unshift({ clientRef: r.clientRef, receiptNo: r.receiptNo, customerName: item.customerName, amount: item.kind === 'collection' ? item.amount : undefined, at: new Date().toISOString() });
    }
    // Items added while this sync was running stay in the queue.
    const now = await getQueue();
    await write(K.queue, now.filter((i) => !done.has(i.clientRef)));
    await write(K.failed, failed);
    await write(K.synced, synced.slice(0, 200));
    await write(K.lastSync, new Date().toISOString());
    changed();
    return { sent: res.results.filter((r) => r.status !== 'ERROR').length, failed: res.results.filter((r) => r.status === 'ERROR').length, offline: false };
  })().finally(() => {
    syncing = null;
    inFlight.clear();
  });
  return syncing;
}

// ---------- Cached reads (work offline with the last copy) ----------
async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T | null; offline: boolean; error?: unknown }> {
  try {
    const data = await fetcher();
    await write(key, data);
    return { data, offline: false };
  } catch (e) {
    const data = await read<T | null>(key, null);
    if (e instanceof ApiError && e.status === 0) return { data, offline: true };
    return { data, offline: false, error: e };
  }
}

export const myRoutes = () => cached(K.routes, () => get<MyRoute[]>('/routes/mine'));

/** The route's day, with anything still waiting to sync applied on top so the screen matches what the agent did. */
export async function routeDay(routeId: string) {
  const r = await cached(K.day(routeId), () => get<RouteDay>(`/routes/${routeId}/day`));
  // A fresh copy from the server does not include unsent items yet; the cached copy already does.
  if (r.data && !r.offline && !r.error) {
    const q = await getQueue();
    for (const item of q.filter((i) => i.routeId === routeId)) {
      const c = r.data.customers.find((x) => x.id === item.customerId);
      if (c) applyLocal(c, item);
    }
    await write(K.day(routeId), r.data);
  }
  return r;
}

export async function saveProfile(p: Profile | null) {
  if (p) await write(K.profile, p);
  else await AsyncStorage.multiRemove([K.profile, K.routes]);
}
export const cachedProfile = () => read<Profile | null>(K.profile, null);

/** The last downloaded copy of a route's day, read from the phone only (no network). */
export const cachedRouteDay = (routeId: string) => read<RouteDay | null>(K.day(routeId), null);
/** This agent's routes as last downloaded (no network). */
export const cachedRoutes = () => read<MyRoute[] | null>(K.routes, null).then((r) => r ?? []);

/** The first customer in route order not visited yet (skipping `skipId`, the one on screen). */
export const nextPending = (day: RouteDay, skipId?: string) => day.customers.find((c) => c.pin === 'PENDING' && c.id !== skipId) ?? null;

/** Today's copies of the agent's routes that collect today, as already on the phone. */
export async function todaysCachedDays(today: string) {
  const routes = (await cachedRoutes()).filter((r) => r.collectsToday);
  const days = await Promise.all(routes.map((r) => cachedRouteDay(r.id)));
  return { routes: routes.length, days: days.filter((d): d is RouteDay => !!d && d.date === today) };
}
