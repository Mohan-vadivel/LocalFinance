import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';
import { useSession } from './session';
import { C, Icon, MenuCtx, R, SP, useLayout, useNav, type IconName } from './ui';

interface Tab { key: string; icon: IconName; iconOn: IconName; label: string; onPress: () => void; show: boolean; active: boolean }

/**
 * The bottom navigation bar: the four places used most in the field, one thumb-tap away, and "More" for the rest
 * (the side menu). Shown on top-level screens only; screens opened from them have a back button instead.
 * Hidden while the keyboard is open so it never covers a form.
 */
export function TabBar() {
  const { t } = useTranslation();
  const nav = useNav();
  const menu = useContext(MenuCtx);
  const { can } = useSession();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOpen();
  const { narrow } = useLayout();
  const top = nav.stack[nav.stack.length - 1];
  if (keyboard) return null;
  const at = (name: string) => top?.name === name && !(name === 'Search' && top.params?.forLoan);
  const go = (name: string) => (name === 'Home' ? nav.reset('Home') : nav.open(name));
  const tabs: Tab[] = [
    { key: 'Home', icon: 'wallet-outline', iconOn: 'wallet', label: t('mobile.tabs.collect'), onPress: () => go('Home'), show: true, active: at('Home') },
    { key: 'Search', icon: 'people-outline', iconOn: 'people', label: t('mobile.tabs.customers'), onPress: () => go('Search'), show: can('customer.view', 'collection.record'), active: at('Search') },
    { key: 'Daybook', icon: 'book-outline', iconOn: 'book', label: t('mobile.tabs.daybook'), onPress: () => go('Daybook'), show: can('daybook.request', 'daybook.approve'), active: at('Daybook') },
    { key: 'CollectionReport', icon: 'bar-chart-outline', iconOn: 'bar-chart', label: t('mobile.tabs.reports'), onPress: () => go('CollectionReport'), show: true, active: at('CollectionReport') },
    { key: 'More', icon: 'grid-outline', iconOn: 'grid', label: t('mobile.tabs.more'), onPress: menu.open, show: true, active: false },
  ];
  return (
    // A floating, rounded bar: the active tab is a filled pill with its icon and label, the others stay quiet.
    <View style={{ backgroundColor: C.bg, paddingHorizontal: SP.md, paddingTop: SP.xs, paddingBottom: Math.max(insets.bottom, SP.sm) }}>
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', gap: 4, padding: 6, backgroundColor: C.panel, borderRadius: R.lg + 10, borderWidth: 1, borderColor: C.line, boxShadow: '0px 6px 20px rgba(7, 30, 28, 0.12)' }}
      >
        {tabs.filter((x) => x.show).map((x) => (
          <Pressable
            key={x.key}
            onPress={x.onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: x.active }}
            accessibilityLabel={x.label}
            android_ripple={{ color: C.surface, borderless: false }}
            style={({ pressed }) => [
              { flex: 1, minWidth: 0, minHeight: 54, borderRadius: R.lg + 4, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, gap: 2, overflow: 'hidden' },
              x.active && { backgroundColor: C.brand, boxShadow: '0px 3px 8px rgba(15, 118, 110, 0.3)' },
              pressed && !x.active && { backgroundColor: C.surface },
            ]}
          >
            <Icon name={x.active ? x.iconOn : x.icon} size={22} color={x.active ? C.onBrand : C.ink2} />
            {/* Up to two short lines, so "Customers" and long Tamil labels are never cut on a 320dp phone. */}
            <Text variant="labelMedium" numberOfLines={2} style={{ fontSize: narrow ? 10 : 11, lineHeight: narrow ? 13 : 14, textAlign: 'center', fontWeight: x.active ? '800' : '600', color: x.active ? C.onBrand : C.ink2, paddingHorizontal: 2 }}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const a = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return open;
}
