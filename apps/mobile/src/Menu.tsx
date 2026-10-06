import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, BackHandler, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LANGUAGES } from '@localfinance/shared';
import { BASE, post } from './api';
import { setLanguage } from './i18n';
import { useSyncState } from './screens/Home';
import { useSession } from './session';
import { sync } from './store';
import { Avatar, C, Icon, MenuCtx, R, SP, useLayout, useNav, type IconName } from './ui';

interface Item { key: string; icon: IconName; label: string; onPress: () => void; show?: boolean; active?: boolean; badge?: string }

/**
 * The side menu (drawer). Every place in the app is reached from here, and the settings that used to sit on a
 * separate screen (language, sync, log out) are here too. Slides in from the left over a dimmed backdrop.
 */
export function MenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(anim, { toValue: open ? 1 : 0, duration: open ? 220 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
      if (!open) setMounted(false);
    });
  }, [open, anim]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);
  return (
    <MenuCtx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {mounted && <Drawer anim={anim} close={() => setOpen(false)} />}
    </MenuCtx.Provider>
  );
}

function Drawer({ anim, close }: { anim: Animated.Value; close: () => void }) {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const { width } = useLayout();
  const { profile, can, logout } = useSession();
  const st = useSyncState();
  const [syncing, setSyncing] = useState(false);
  const w = Math.min(320, Math.round(width * 0.86));
  const top = nav.stack[nav.stack.length - 1];
  // "Request loan" opens the search screen in loan mode, so it gets its own highlight.
  const current = top?.name === 'Search' && top.params?.forLoan ? 'LoanRequest' : top?.name;

  const go = (name: string, params?: Record<string, unknown>) => {
    close();
    if (name === 'Home') nav.reset('Home');
    else nav.open(name, params);
  };
  const changeLang = async (code: string) => {
    await setLanguage(code);
    await post('/auth/language', { language: code }).catch(() => undefined);
  };
  const runSync = async () => {
    setSyncing(true);
    await sync();
    setSyncing(false);
  };

  const work: Item[] = [
    { key: 'Home', icon: 'home-outline', label: t('mobile.home'), onPress: () => go('Home') },
    { key: 'Search', icon: 'search-outline', label: t('mobile.search'), onPress: () => go('Search'), show: can('customer.view', 'collection.record') },
    { key: 'AddCustomer', icon: 'person-add-outline', label: t('mobile.addCustomer'), onPress: () => go('AddCustomer'), show: can('customer.create') },
    { key: 'LoanRequest', icon: 'cash-outline', label: t('mobile.requestLoan'), onPress: () => go('Search', { forLoan: true }), show: can('loan.request') },
    { key: 'MyRequests', icon: 'document-text-outline', label: t('mobile.myRequests'), onPress: () => go('MyRequests'), show: can('loan.request') },
    { key: 'Daybook', icon: 'book-outline', label: t('nav.daybook'), onPress: () => go('Daybook'), show: can('daybook.request', 'daybook.approve') },
  ];
  const reports: Item[] = [
    { key: 'Summary', icon: 'today-outline', label: t('mobile.daySummary'), onPress: () => go('Summary') },
    { key: 'CollectionReport', icon: 'bar-chart-outline', label: t('collSummary.title'), onPress: () => go('CollectionReport') },
    { key: 'Manager', icon: 'people-outline', label: t('mobile.managerView'), onPress: () => go('Manager'), show: can('report.view', 'route.manage') },
  ];
  const account: Item[] = [
    { key: 'Settings', icon: 'person-circle-outline', label: t('mobile.accountSettings'), onPress: () => go('Settings') },
    { key: 'sync', icon: 'sync-outline', label: syncing ? '…' : t('mobile.syncNow'), onPress: () => void runSync(), badge: st.pending ? String(st.pending) : undefined },
  ];
  const isActive = (i: Item) => i.key === current;

  const syncTone = st.failed > 0 ? C.danger : st.pending ? C.warn : C.ok;
  const syncText = st.pending ? `${t('mobile.pendingSync')}: ${st.pending}` : t('mobile.allSynced');

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7, 30, 28, 0.45)', opacity: anim }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel={t('mobile.closeMenu')} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: w,
          backgroundColor: C.panel,
          borderTopRightRadius: R.lg + 4,
          borderBottomRightRadius: R.lg + 4,
          overflow: 'hidden',
          boxShadow: '4px 0px 24px rgba(7, 30, 28, 0.22)',
          transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-w - 24, 0] }) }],
        }}
      >
        {/* Profile header on the brand colour, with the sync state under the name. */}
        <View style={{ backgroundColor: C.brand, paddingTop: insets.top + SP.lg, paddingBottom: SP.lg, paddingHorizontal: SP.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
            <View style={{ borderRadius: 30, backgroundColor: '#ffffff' }}>
              <Avatar name={profile?.name ?? '?'} size={52} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: C.onBrand, fontSize: 18, fontWeight: '800' }} numberOfLines={2}>{profile?.name}</Text>
              <Text style={{ color: C.onBrandMuted, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>{t(`roles.${profile?.role}`)}</Text>
            </View>
            <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('mobile.closeMenu')} style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
              <Icon name="close" size={24} color={C.onBrand} />
            </Pressable>
          </View>
          <Text style={{ color: C.onBrandMuted, fontSize: 13, fontWeight: '600', marginTop: SP.md }} numberOfLines={1}>{profile?.tenant?.name ?? t('common.appName')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: SP.sm, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: R.pill, paddingVertical: 5, paddingHorizontal: 10 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: syncTone === C.ok ? '#6ee7b7' : syncTone === C.warn ? '#fcd34d' : '#fca5a5' }} />
            <Text style={{ color: C.onBrand, fontSize: 13, fontWeight: '700' }}>{syncText}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingVertical: SP.sm, paddingBottom: SP.lg }}>
          <Group title={t('mobile.menuWork')} items={work} isActive={isActive} />
          <Group title={t('nav.reports')} items={reports} isActive={isActive} />
          <Group title={t('mobile.menuAccount')} items={account} isActive={isActive} />

          <Text style={groupTitle}>{t('common.language')}</Text>
          <View style={{ flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.lg, marginBottom: SP.md }}>
            {LANGUAGES.map((l) => {
              const on = i18n.language === l.code;
              return (
                <Pressable key={l.code} onPress={() => void changeLang(l.code)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={({ pressed }) => [{ flex: 1, minHeight: 44, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: on ? C.brand : C.lineStrong, backgroundColor: on ? C.brandSoft : C.panel }, pressed && { opacity: 0.8 }]}>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: on ? C.brandInk : C.ink2 }}>{l.nativeName}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: 1, backgroundColor: C.line, marginHorizontal: SP.lg, marginVertical: SP.sm }} />
          {st.pending > 0 && <Text style={{ color: C.danger, fontSize: 13, fontWeight: '600', paddingHorizontal: SP.lg, marginBottom: SP.xs }}>{t('mobile.logoutPending', { count: st.pending })}</Text>}
          <MenuRow
            item={{ key: 'logout', icon: 'log-out-outline', label: t('common.logout'), onPress: () => { close(); void logout(); } }}
            danger
            disabled={st.pending > 0}
          />
          <Text style={{ color: C.muted, fontSize: 12, paddingHorizontal: SP.lg, marginTop: SP.md }} numberOfLines={1}>{t('mobile.serverAddress')}: {BASE}</Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const groupTitle = { color: C.muted, fontSize: 12, fontWeight: '800' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const, paddingHorizontal: SP.lg, marginTop: SP.md, marginBottom: SP.xs };

function Group({ title, items, isActive }: { title: string; items: Item[]; isActive: (i: Item) => boolean }) {
  const shown = items.filter((i) => i.show !== false);
  if (!shown.length) return null;
  return (
    <View>
      <Text style={groupTitle}>{title}</Text>
      {shown.map((i) => <MenuRow key={i.key + i.label} item={i} active={isActive(i)} />)}
    </View>
  );
}

function MenuRow({ item, active, danger, disabled }: { item: Item; active?: boolean; danger?: boolean; disabled?: boolean }) {
  const fg = danger ? C.danger : active ? C.brandInk : C.ink;
  return (
    <Pressable
      onPress={item.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      android_ripple={{ color: C.surface }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 48, marginHorizontal: SP.sm, paddingHorizontal: SP.md, borderRadius: R.md },
        active && { backgroundColor: C.brandSoft },
        pressed && !active && { backgroundColor: C.bg },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Icon name={item.icon} size={22} color={danger ? C.danger : active ? C.brand : C.ink2} />
      <Text style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: active ? '800' : '600', color: fg }}>{item.label}</Text>
      {item.badge ? (
        <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.warn, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{item.badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
