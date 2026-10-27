import Constants from 'expo-constants';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, Text, View } from 'react-native';
import { LANGUAGES, LEGAL_SECTIONS, type LegalPage } from '@localfinance/shared';
import { BASE, get, post } from '../api';
import { useDialog } from '../Dialog';
import { askBiometric, biometricReady, getBiometricLock, getPrintAsk, onDevicePrefs, setBiometricLock, setPrintAsk } from '../device';
import { setLanguage } from '../i18n';
import { useSession } from '../session';
import { getFailed, sync } from '../store';
import { Avatar, Btn, C, Chips, ErrorText, Field, Icon, Notice, R, SP, Screen, Sheet, SheetOption, s, useNav, type IconName } from '../ui';
import { useSyncState } from './Home';

// =====================================================================
// Settings, grouped the way Android's own settings are: a profile card, then labelled groups of rows.
// =====================================================================
export default function Settings() {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const { profile, logout } = useSession();
  const st = useSyncState();
  const [open, setOpen] = useState<'password' | 'switch' | null>(null);
  const [lockOn, setLockOn] = useState(false);
  const [lockAvailable, setLockAvailable] = useState(false);
  const [printAsk, setPrintAskState] = useState(false);
  const [lockError, setLockError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [others, setOthers] = useState<{ tenantId: string; name: string }[]>([]);

  useEffect(() => {
    const read = () => {
      void getBiometricLock().then(setLockOn);
      void getPrintAsk().then(setPrintAskState);
    };
    read();
    void biometricReady().then(setLockAvailable);
    // Other businesses this phone number has an account in (none when offline).
    get<{ tenantId: string; name: string }[]>('/auth/businesses').then(setOthers).catch(() => setOthers([]));
    return onDevicePrefs(read);
  }, []);

  const toggleLock = async (on: boolean) => {
    setLockError('');
    // Turning it on asks once, so nobody switches on a lock they cannot open.
    if (on && !(await askBiometric(t('mobile.settings.biometricConfirm'), t('common.cancel')))) return setLockError(t('mobile.lock.failed'));
    await setBiometricLock(on);
  };
  const [langOpen, setLangOpen] = useState(false);
  const [langDraft, setLangDraft] = useState(i18n.language);
  const [langBusy, setLangBusy] = useState(false);
  // Saved on the phone and on the account, so the web and the next login use it too.
  const saveLang = async () => {
    setLangBusy(true);
    await setLanguage(langDraft);
    await post('/auth/language', { language: langDraft }).catch(() => undefined);
    setLangBusy(false);
    setLangOpen(false);
    void dialog.alert({ tone: 'success', title: t('common.saved'), timer: 1400 });
  };
  const dialog = useDialog();
  const askLogout = async () => {
    if (await dialog.confirm({ tone: 'warning', icon: 'log-out-outline', title: t('mobile.confirm.logoutTitle'), text: t('mobile.confirm.logoutText'), confirmText: t('common.logout') })) await logout();
  };
  const runSync = async () => {
    setSyncing(true);
    await sync();
    setSyncing(false);
  };
  const lastSync = st.lastSync ? new Date(st.lastSync).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
  const version = Constants.expoConfig?.version ?? '-';
  const branches = profile?.branches?.length ? profile.branches.map((b) => b.name).join(', ') : t('mobile.settings.allBranches');
  const isOwner = profile?.role === 'TENANT_ADMIN';

  return (
    <Screen title={t('mobile.settings.title')}>
      {/* Profile */}
      <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: SP.md }]}>
        <Avatar name={profile?.name ?? '?'} size={60} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>{profile?.name ?? ''}</Text>
          {profile?.phone ? <Text style={{ fontSize: 15, color: C.ink2, fontWeight: '600' }}>{profile.phone}</Text> : null}
          <Text style={s.muted}>{profile?.roleName ?? ''}</Text>
        </View>
      </View>
      <Group title={t('mobile.settings.profile')}>
        <Item icon="business-outline" title={t('mobile.settings.business')} subtitle={profile?.tenant?.name ?? '-'} />
        <Item icon="git-branch-outline" title={t('mobile.settings.branches')} subtitle={branches} />
      </Group>

      <Group title={t('mobile.settings.account')}>
        {/* Language: one row showing the current language; it opens a list, and Save applies the choice. */}
        <Item icon="language-outline" title={t('common.language')} subtitle={LANGUAGES.find((l) => l.code === i18n.language)?.nativeName ?? i18n.language} onPress={() => { setLangDraft(i18n.language); setLangOpen(true); }} />
        <Item icon="key-outline" title={t('auth.changePassword')} onPress={() => setOpen(open === 'password' ? null : 'password')} expanded={open === 'password'} />
        {open === 'password' && <ChangePassword />}
        {others.length > 0 && (
          <>
            <Item icon="swap-horizontal-outline" title={t('mobile.settings.switchBusiness')} subtitle={others.map((o) => o.name).join(', ')} onPress={() => setOpen(open === 'switch' ? null : 'switch')} expanded={open === 'switch'} />
            {open === 'switch' && <SwitchBusiness others={others} />}
          </>
        )}
      </Group>

      {lockAvailable && (
        <Group title={t('mobile.settings.security')}>
          <Item icon="finger-print-outline" title={t('mobile.settings.biometric')} subtitle={t('mobile.settings.biometricHelp')} toggle={{ value: lockOn, onChange: (v) => void toggleLock(v) }} />
          {lockError ? <View style={{ paddingHorizontal: SP.lg }}><Notice tone="warn" text={lockError} /></View> : null}
        </Group>
      )}

      <Sheet
        visible={langOpen}
        onClose={() => setLangOpen(false)}
        title={t('common.language')}
        footer={<Btn title={t('common.save')} onPress={() => void saveLang()} busy={langBusy} style={{ marginBottom: 0 }} />}
      >
        {LANGUAGES.map((l) => (
          <SheetOption key={l.code} label={l.nativeName} sub={l.name} on={langDraft === l.code} onPress={() => setLangDraft(l.code)} />
        ))}
      </Sheet>

      <Group title={t('mobile.settings.printer')}>
        <Item icon="print-outline" title={t('mobile.settings.printAsk')} subtitle={t('mobile.settings.printAskHelp')} toggle={{ value: printAsk, onChange: (v) => void setPrintAsk(v) }} />
      </Group>

      <Group title={t('mobile.settings.app')}>
        <Item
          icon="sync-outline"
          title={t('mobile.syncNow')}
          subtitle={st.pending ? `${t('mobile.pendingSync')}: ${st.pending}` : lastSync ? t('mobile.settings.lastSynced', { time: lastSync }) : t('mobile.allSynced')}
          onPress={() => void runSync()}
          busy={syncing}
        />
        <Item icon="server-outline" title={t('mobile.serverAddress')} subtitle={BASE} />
        <Item icon="information-circle-outline" title={t('mobile.settings.version')} subtitle={version} />
      </Group>

      <Group title={t('mobile.settings.help')}>
        <Item icon="help-buoy-outline" title={t('mobile.settings.support')} subtitle={t('mobile.settings.supportHelp')} onPress={() => nav.push('Support')} />
        {isOwner && <Item icon="ribbon-outline" title={t('mobile.settings.plan')} subtitle={t('mobile.settings.planHelp')} onPress={() => nav.push('Plan')} />}
      </Group>

      <Group title={t('mobile.settings.legal')}>
        <Item icon="document-text-outline" title={t('legal.terms.title')} onPress={() => nav.push('Terms')} />
        <Item icon="shield-checkmark-outline" title={t('legal.privacy.title')} onPress={() => nav.push('Privacy')} />
      </Group>

      <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
        {st.pending > 0 && <Text style={{ color: C.danger, fontSize: 13, fontWeight: '600', paddingHorizontal: SP.lg, paddingTop: SP.md }}>{t('mobile.logoutPending', { count: st.pending })}</Text>}
        <Item icon="log-out-outline" title={t('common.logout')} danger disabled={st.pending > 0} onPress={() => void askLogout()} />
      </View>
    </Screen>
  );
}

/** A titled group of rows on one card. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: SP.md }}>
      <Text style={{ color: C.brandInk, fontSize: 13, fontWeight: '800', letterSpacing: 0.4, marginBottom: SP.xs, marginLeft: SP.xs }}>{title}</Text>
      <View style={[s.card, { padding: 0, marginBottom: 0, overflow: 'hidden', paddingBottom: 2 }]}>{children}</View>
    </View>
  );
}

/** One settings row: icon, title and subtitle, and a chevron, a switch or nothing on the right. */
function Item({
  icon,
  title,
  subtitle,
  onPress,
  toggle,
  danger,
  disabled,
  expanded,
  busy,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  danger?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  busy?: boolean;
}) {
  const press = toggle ? () => toggle.onChange(!toggle.value) : onPress;
  const body = (
    <>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: danger ? C.dangerSoft : C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={danger ? C.danger : C.brandInk} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: danger ? C.danger : C.ink }}>{busy ? '…' : title}</Text>
        {subtitle ? <Text style={[s.muted, { marginTop: 2 }]} selectable={!press}>{subtitle}</Text> : null}
      </View>
      {toggle ? (
        <Switch value={toggle.value} onValueChange={toggle.onChange} trackColor={{ true: C.brand, false: C.lineStrong }} thumbColor="#ffffff" accessibilityLabel={title} />
      ) : onPress && !danger ? (
        <Icon name={expanded ? 'chevron-up' : 'chevron-forward'} size={20} color={C.muted} />
      ) : null}
    </>
  );
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SP.md, minHeight: 64, paddingHorizontal: SP.lg, paddingVertical: SP.md };
  if (!press) return <View style={row}>{body}</View>;
  return (
    <Pressable
      onPress={press}
      disabled={disabled || busy}
      accessibilityRole={toggle ? 'switch' : 'button'}
      accessibilityState={toggle ? { checked: toggle.value, disabled: !!disabled } : { disabled: !!disabled, expanded }}
      android_ripple={{ color: C.surface }}
      style={({ pressed }) => [row, pressed && { backgroundColor: C.bg }, disabled && { opacity: 0.45 }]}
    >
      {body}
    </Pressable>
  );
}

/** Change password, as before: the server ends every session afterwards, so the phone logs out too. */
function ChangePassword() {
  const { t } = useTranslation();
  const { logout } = useSession();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useDialog();
  const changePassword = async () => {
    if (!(await dialog.confirm({ tone: 'warning', icon: 'key-outline', title: t('mobile.confirm.passwordTitle'), text: t('mobile.settings.passwordHelp'), confirmText: t('common.save') }))) return;
    setBusy(true);
    setError(null);
    try {
      await post('/auth/password', pw);
      setMsg(t('common.saved'));
      // The server ends all sessions after a password change.
      await logout();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ paddingHorizontal: SP.lg, paddingBottom: SP.md }}>
      <Text style={[s.muted, { marginBottom: SP.md }]}>{t('mobile.settings.passwordHelp')}</Text>
      <Field label={t('auth.currentPassword')} value={pw.currentPassword} onChangeText={(v) => setPw({ ...pw, currentPassword: v })} secureTextEntry />
      <Field label={t('auth.newPassword')} value={pw.newPassword} onChangeText={(v) => setPw({ ...pw, newPassword: v })} secureTextEntry />
      <ErrorText error={error} />
      {msg ? <Notice text={msg} /> : null}
      <Btn kind="tonal" title={t('common.save')} onPress={() => void changePassword()} busy={busy} disabled={pw.newPassword.length < 8 || pw.currentPassword.length < 6} style={{ marginBottom: 0 }} />
    </View>
  );
}

/**
 * Switch business without logging out: pick one of the other businesses this phone number has an account in and
 * enter that account's password. Nothing waiting to sync may be left behind, since it belongs to this business.
 */
function SwitchBusiness({ others }: { others: { tenantId: string; name: string }[] }) {
  const { t } = useTranslation();
  const { switchTenant } = useSession();
  const st = useSyncState();
  const [failed, setFailed] = useState(0);
  const [chosen, setChosen] = useState(others[0].tenantId);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    void getFailed().then((f) => setFailed(f.length));
  }, [st.pending, st.failed]);
  const target = others.find((o) => o.tenantId === chosen) ?? others[0];
  const blocked = st.pending > 0 || failed > 0;
  const dialog = useDialog();
  const go = async () => {
    if (!(await dialog.confirm({ icon: 'swap-horizontal', title: t('mobile.confirm.switchTitle'), text: t('mobile.settings.switchTo', { name: target.name }), confirmText: t('common.confirm') }))) return;
    setBusy(true);
    setError(null);
    try {
      await switchTenant(target.tenantId, password);
    } catch (e) {
      setError(e instanceof Error && e.message === 'pending' ? new Error(t('mobile.settings.switchPending')) : e);
      setBusy(false);
    }
  };
  return (
    <View style={{ paddingHorizontal: SP.lg, paddingBottom: SP.md }}>
      <Text style={[s.muted, { marginBottom: SP.md }]}>{t('mobile.settings.switchHelp')}</Text>
      {blocked && <Notice tone="warn" text={t('mobile.settings.switchPending')} />}
      {others.length > 1 && <Chips value={chosen} onChange={setChosen} items={others.map((o) => ({ key: o.tenantId, label: o.name }))} />}
      <Field label={t('mobile.settings.passwordFor', { name: target.name })} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
      <ErrorText error={error} />
      <Btn title={t('mobile.settings.switchTo', { name: target.name })} onPress={() => void go()} busy={busy} disabled={blocked || password.length < 6} style={{ marginBottom: 0 }} />
    </View>
  );
}

// =====================================================================
// Terms and conditions / Privacy policy: plain in-app pages, text from the language files.
// DRAFT: both texts still need review by a lawyer (see packages/shared/src/legal.ts).
// =====================================================================
export function Legal({ page }: { page: LegalPage }) {
  const { t } = useTranslation();
  return (
    <Screen title={t(`legal.${page}.title`)}>
      <View style={[s.card, { borderRadius: R.lg }]}>
        <Text style={[s.muted, { marginBottom: SP.md }]}>{t('legal.updated')}</Text>
        <Text style={{ fontSize: 16, lineHeight: 24, color: C.ink }}>{t(`legal.${page}.intro`)}</Text>
        {LEGAL_SECTIONS[page].map((k, i) => (
          <View key={k} style={{ marginTop: SP.lg }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, marginBottom: SP.xs }}>{`${i + 1}. ${t(`legal.${page}.${k}.title`)}`}</Text>
            <Text style={{ fontSize: 15, lineHeight: 23, color: C.ink2 }}>{t(`legal.${page}.${k}.body`)}</Text>
          </View>
        ))}
        <Text style={[s.muted, { marginTop: SP.xl }]}>{t('legal.seeAlso')}</Text>
      </View>
    </Screen>
  );
}
