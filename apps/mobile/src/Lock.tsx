import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LOCK_AFTER_MS, askBiometric, biometricReady, getBiometricLock } from './device';
import { useSyncState } from './screens/Home';
import { useSession } from './session';
import { Btn, C, Icon, Loading, Notice, SP } from './ui';

/**
 * Fingerprint / face unlock. When it is on, nothing of the logged-in app is drawn until the phone's owner proves it is
 * them: on opening the app, and on coming back after it sat in the background for a few minutes. The phone's own
 * PIN or pattern works as the fallback. Logging out from here is the way back to the password login.
 */
export function AppLock({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { logout } = useSession();
  const st = useSyncState();
  // 'checking' until the setting is read, so no data shows for a moment before the lock.
  const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setAsking(true);
    setFailed(false);
    const ok = await askBiometric(t('mobile.lock.prompt'), t('common.cancel'));
    setAsking(false);
    if (ok) setState('open');
    else setFailed(true);
  }, [t]);

  // Locks only when the switch is on and the phone still has a fingerprint or face enrolled.
  const shouldLock = useCallback(async () => (await getBiometricLock()) && (await biometricReady()), []);

  useEffect(() => {
    void shouldLock().then((on) => {
      setState(on ? 'locked' : 'open');
      if (on) void unlock();
    });
  }, [shouldLock, unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') leftAt.current = Date.now();
      else if (next === 'active' && leftAt.current != null) {
        const away = Date.now() - leftAt.current;
        leftAt.current = null;
        if (away >= LOCK_AFTER_MS) {
          void shouldLock().then((on) => {
            if (!on) return;
            setState('locked');
            void unlock();
          });
        }
      }
    });
    return () => sub.remove();
  }, [shouldLock, unlock]);

  if (state === 'open') return <>{children}</>;
  if (state === 'checking') return <Loading />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl, gap: SP.md }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="finger-print" size={56} color={C.brand} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink, textAlign: 'center' }}>{t('mobile.lock.title')}</Text>
        <Text style={{ fontSize: 15, color: C.muted, textAlign: 'center', marginBottom: SP.md }}>{t('mobile.lock.help')}</Text>
        {failed && <Notice tone="warn" text={t('mobile.lock.failed')} />}
        <Btn big title={t('mobile.lock.unlock')} onPress={() => void unlock()} busy={asking} style={{ alignSelf: 'stretch' }} />
        {st.pending > 0 && <Text style={{ color: C.danger, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{t('mobile.logoutPending', { count: st.pending })}</Text>}
        <Btn kind="ghost" title={t('mobile.lock.usePassword')} onPress={() => void logout()} disabled={st.pending > 0} style={{ alignSelf: 'stretch' }} />
      </View>
    </SafeAreaView>
  );
}
