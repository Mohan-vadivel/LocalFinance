import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permission, TenantSettings } from '@localfinance/shared';
import { get, post, setOnUnauthorized, setSupportTenant, tokens } from './api';
import { setLanguage } from './i18n';

export interface Profile {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  language: string;
  role: string;
  roleName: string;
  permissions: Permission[];
  approvalLimit: number;
  branches: { id: string; name: string; code: string }[];
  tenant: { id: string; name: string; status: string; logoUrl: string | null; settings: TenantSettings } | null;
  readOnly?: boolean;
}

interface AuthState {
  profile: Profile | null;
  loading: boolean;
  login: (login: string, password: string, tenantId?: string) => Promise<{ chooseTenant?: { tenantId: string; name: string }[] }>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (...perms: Permission[]) => boolean;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!tokens.access) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const p = await get<Profile>('/auth/me');
      setProfile(p);
      if (!localStorage.getItem('lf.lang')) setLanguage(p.language);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      tokens.clear();
      setProfile(null);
    });
    void reload();
  }, [reload]);

  const login = async (loginId: string, password: string, tenantId?: string) => {
    const r = await post<{ accessToken?: string; refreshToken?: string; profile?: Profile; chooseTenant?: { tenantId: string; name: string }[] }>('/auth/login', { login: loginId, password, tenantId });
    if (r.chooseTenant) return { chooseTenant: r.chooseTenant };
    tokens.set(r.accessToken!, r.refreshToken!);
    setSupportTenant(null);
    setProfile(r.profile!);
    setLanguage(r.profile!.language);
    return {};
  };

  const logout = async () => {
    if (tokens.refresh) await post('/auth/logout', { refreshToken: tokens.refresh }).catch(() => undefined);
    tokens.clear();
    setSupportTenant(null);
    setProfile(null);
  };

  const can = (...perms: Permission[]) => !!profile && perms.some((p) => profile.permissions.includes(p));

  return <Ctx.Provider value={{ profile, loading, login, logout, reload, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
