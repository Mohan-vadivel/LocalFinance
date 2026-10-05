import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { formatINR, smartVisitOrder, type VisitPlanItem } from '@localfinance/shared';
import type { DayCustomer, RouteDay } from './store';
import { todayIST } from './ui';

// =====================================================================
// Smart visit order (runs on the phone, offline, from the cached route day)
// =====================================================================
export type VisitOrder = 'route' | 'smart';
const ORDER_KEY = 'lf.visitOrder';
type Listener = (o: VisitOrder) => void;
const orderListeners = new Set<Listener>();
let orderNow: VisitOrder | null = null;

/** The agent's chosen order for route lists, remembered on this phone. */
export async function getVisitOrder(): Promise<VisitOrder> {
  if (orderNow) return orderNow;
  try {
    orderNow = (await AsyncStorage.getItem(ORDER_KEY)) === 'smart' ? 'smart' : 'route';
  } catch {
    orderNow = 'route';
  }
  return orderNow;
}
export async function setVisitOrder(o: VisitOrder) {
  orderNow = o;
  orderListeners.forEach((l) => l(o));
  try {
    await AsyncStorage.setItem(ORDER_KEY, o);
  } catch {
    /* kept in memory for this session */
  }
}
export const onVisitOrder = (l: Listener) => {
  orderListeners.add(l);
  return () => void orderListeners.delete(l);
};

/** Where the phone last was, only when location is already allowed. Never asks and never waits for a GPS fix. */
let lastHere: { lat: number; lng: number } | null = null;
export async function lastKnownHere() {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return lastHere;
    const p = await Location.getLastKnownPositionAsync();
    if (p) lastHere = { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    /* no position: order without distance */
  }
  return lastHere;
}

/** Hour of the day in India (0 to 23). */
const hourIST = () => new Date(Date.now() + 330 * 60_000).getUTCHours();

export interface Ordered {
  list: DayCustomer[];
  /** Why each customer is where it is (smart order only). */
  reasons: Record<string, VisitPlanItem['reasons']>;
}

/** The route's customers in the chosen order. Route order is the day as downloaded. */
export function orderDay(day: RouteDay, order: VisitOrder, here: { lat: number; lng: number } | null = lastHere): Ordered {
  if (order === 'route') return { list: day.customers, reasons: {} };
  const plan = smartVisitOrder(
    day.customers.map((c) => ({
      id: c.id,
      lat: c.lat,
      lng: c.lng,
      pin: c.pin,
      dueNow: c.dueNow,
      daysPastDue: c.loans.reduce((m, l) => Math.max(m, l.daysPastDue), 0),
      promiseDate: c.promiseDate ?? null,
      usualHour: c.usualHour ?? null,
    })),
    { today: todayIST(), hour: hourIST(), here },
  );
  const byId = new Map(day.customers.map((c) => [c.id, c]));
  return { list: plan.map((p) => byId.get(p.id)!).filter(Boolean), reasons: Object.fromEntries(plan.map((p) => [p.id, p.reasons])) };
}

/** The first customer not visited yet in the chosen order (skipping the one on screen). */
export const nextInOrder = (day: RouteDay, order: VisitOrder, skipId?: string) => orderDay(day, order).list.find((c) => c.pin === 'PENDING' && c.id !== skipId) ?? null;

// =====================================================================
// Text helpers
// =====================================================================
/** Alert values: money fields (in paise) become rupees for the sentence. */
export const alertValues = (v: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' && /amount|usual|yesterday/.test(k) ? formatINR(x, { decimals: false }) : x]));

/** A 10-digit Indian mobile number from what is saved (drops +91, spaces and dashes). */
export function mobile10(phone: string) {
  const d = phone.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}
