import * as Location from 'expo-location';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { clearSession, get, getDeviceId, loadSession, logoutRemote, post, saveSession, setOnLoggedOut } from './api';
import { setLanguage } from './i18n';
import { cachedProfile, clearBusinessCache, getFailed, getQueue, saveProfile, sync, type Profile } from './store';

interface Session {
  profile: Profile | null;
  ready: boolean;
  login: (login: string, password: string, tenantId?: string) => Promise<{ chooseTenant?: { tenantId: string; name: string }[] }>;
  logout: () => Promise<void>;
  /** Moves to the same person's account in another business; needs that account's password. */
  switchTenant: (tenantId: string, password: string) => Promise<void>;
  can: (...perms: string[]) => boolean;
}
const Ctx = createContext<Session>(null as unknown as Session);
export const useSession = () => useContext(Ctx);

/** Current GPS position, or null when permission is refused or no fix comes in time. */
export async function getPosition(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), 15000)),
    ]);
    if (!p) {
      const last = await Location.getLastKnownPositionAsync();
      return last ? { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? null } : null;
    }
    return { lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)), accuracy: p.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOnLoggedOut(() => {
      setProfile(null);
      void saveProfile(null);
    });
    void (async () => {
      if (await loadSession()) {
        // Show the last known profile at once so the app opens without a connection.
        const cached = await cachedProfile();
        if (cached) setProfile(cached);
        try {
          const p = await get<Profile>('/auth/me');
          setProfile(p);
          await saveProfile(p);
        } catch {
          /* offline: keep the cached profile */
        }
      }
      setReady(true);
    })();
  }, []);

  // While the app is open: send waiting collections and share the agent's location every few minutes.
  useEffect(() => {
    if (!profile) return;
    const tick = async () => {
      void sync();
      if (profile.role === 'COLLECTION_AGENT') {
        const pos = await getPosition();
        if (pos) await post('/auth/ping', { lat: pos.lat, lng: pos.lng }).catch(() => undefined);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 5 * 60_000);
    const sub = AppState.addEventListener('change', (st) => st === 'active' && void sync());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [profile]);

  const login = async (loginId: string, password: string, tenantId?: string) => {
    const r = await post<{ accessToken?: string; refreshToken?: string; profile?: Profile; chooseTenant?: { tenantId: string; name: string }[] }>('/auth/login', {
      login: loginId,
      password,
      tenantId,
      deviceId: await getDeviceId(),
    });
    if (r.chooseTenant) return { chooseTenant: r.chooseTenant };
    await saveSession(r.accessToken!, r.refreshToken!);
    await saveProfile(r.profile!);
    await setLanguage(r.profile!.language);
    setProfile(r.profile!);
    return {};
  };

  const switchTenant = async (tenantId: string, password: string) => {
    // Entries still on the phone belong to this business; they must reach it before the phone moves on.
    if ((await getQueue()).length || (await getFailed()).length) throw new Error('pending');
    const r = await post<{ accessToken: string; refreshToken: string; profile: Profile }>('/auth/switch', { tenantId, password, deviceId: await getDeviceId() });
    // End this business's session on the server, then forget its copies on the phone.
    await logoutRemote();
    await clearBusinessCache();
    await saveSession(r.accessToken, r.refreshToken);
    await saveProfile(r.profile);
    await setLanguage(r.profile.language);
    setProfile(r.profile);
  };

  const logout = async () => {
    await logoutRemote();
    await clearSession();
    await saveProfile(null);
    setProfile(null);
  };

  const can = (...perms: string[]) => !!profile && perms.some((p) => profile.permissions.includes(p));
  return <Ctx.Provider value={{ profile, ready, login, logout, switchTenant, can }}>{children}</Ctx.Provider>;
}
