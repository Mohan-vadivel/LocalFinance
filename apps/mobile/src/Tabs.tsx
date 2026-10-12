import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from './session';
import { C, Icon, MenuCtx, SP, useNav, type IconName } from './ui';

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
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line, paddingBottom: Math.max(insets.bottom, SP.xs), paddingTop: SP.xs, boxShadow: '0px -1px 4px rgba(16, 40, 36, 0.06)' }}
    >
      {tabs.filter((x) => x.show).map((x) => (
        <Pressable
          key={x.key}
          onPress={x.onPress}
          accessibilityRole="tab"
          accessibilityState={{ selected: x.active }}
          accessibilityLabel={x.label}
          android_ripple={{ color: C.surface, borderless: true }}
          style={({ pressed }) => [{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 }, pressed && { opacity: 0.7 }]}
        >
          {/* The active tab gets a soft pill behind its icon, as on Android's own navigation bars. */}
          <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: x.active ? C.brandSoft : 'transparent' }}>
            <Icon name={x.active ? x.iconOn : x.icon} size={22} color={x.active ? C.brand : C.ink2} />
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 12, fontWeight: x.active ? '800' : '600', color: x.active ? C.brandInk : C.muted, paddingHorizontal: 2 }}>{x.label}</Text>
        </Pressable>
      ))}
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
