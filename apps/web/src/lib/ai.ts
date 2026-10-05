import { useEffect, useState } from 'react';
import { get } from './api';
import { useAuth } from './auth';
import { dateIN, money } from './format';

/** GET /ai/status: `enabled` = the server has a Claude key and the business switched AI on. */
export interface AiStatus {
  configured: boolean;
  enabled: boolean;
  switchedOn: boolean;
}

// One request shared by every screen; refreshAiStatus() after the switch changes.
let cache: { tenant: string; promise: Promise<AiStatus> } | null = null;
const listeners = new Set<() => void>();

function load(tenant: string, fresh = false) {
  if (fresh || !cache || cache.tenant !== tenant) {
    const promise = get<AiStatus>('/ai/status');
    cache = { tenant, promise };
    promise.catch(() => {
      if (cache?.promise === promise) cache = null;
    });
  }
  return cache.promise;
}

export function refreshAiStatus() {
  cache = null;
  listeners.forEach((l) => l());
}

/** AI status for this business; null while loading (or when the status cannot be read, treated as off). */
export function useAiStatus(): AiStatus | null {
  const { profile } = useAuth();
  const tenant = profile?.tenant?.id ?? '';
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (!tenant) return;
    let live = true;
    load(tenant)
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus({ configured: false, enabled: false, switchedOn: false }));
    return () => {
      live = false;
    };
  }, [tenant, tick]);
  return status;
}

/** Alert values for the translated text: money (paise) as rupees, dates as DD-MM-YYYY. */
export function alertValues(values: Record<string, string | number>) {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      typeof v === 'number' && /amount|usual|yesterday/i.test(k) ? money(v) : k === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? dateIN(v) : v,
    ]),
  );
}

/** The UI language as the AI endpoints want it. */
export const aiLang = (lng: string): 'en' | 'ta' => (lng.startsWith('ta') ? 'ta' : 'en');
