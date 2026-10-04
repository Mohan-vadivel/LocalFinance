import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatINR } from '@localfinance/shared';
import { ApiError } from './api';
import type { PinStatus } from './store';

export const C = {
  bg: '#f6f7f9',
  panel: '#ffffff',
  ink: '#17202a',
  muted: '#5d6b79',
  line: '#e2e6ea',
  brand: '#0f766e',
  brandDark: '#0b3b37',
  brandSoft: '#e6f4f2',
  danger: '#b42318',
  dangerSoft: '#fdecea',
  warn: '#b54708',
  warnSoft: '#fef3e2',
  ok: '#067647',
  okSoft: '#e7f6ec',
};

export const PIN_COLORS: Record<PinStatus, string> = { PAID: '#067647', PARTIAL: '#d97706', MISSED: '#b42318', NOTHING_DUE: '#8a96a3', PENDING: '#0f766e' };
export const money = (p: number | null | undefined) => (p == null ? '-' : formatINR(p));
export const toPaise = (rupees: string) => Math.round(Number(rupees.replace(/,/g, '') || 0) * 100);
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const dateIN = (d?: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '-');

// ---------- Navigation: a small stack, with the Android back button popping it ----------
export type Route = { name: string; params?: Record<string, unknown> };
interface Nav {
  stack: Route[];
  push: (name: string, params?: Record<string, unknown>) => void;
  pop: () => void;
  replace: (name: string, params?: Record<string, unknown>) => void;
  reset: (name: string) => void;
}
const NavCtx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavCtx);

export function NavProvider({ initial, children }: { initial: string; children: (top: Route) => ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: initial }]);
  const nav: Nav = {
    stack,
    push: (name, params) => setStack((s) => [...s, { name, params }]),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (name, params) => setStack((s) => [...s.slice(0, -1), { name, params }]),
    reset: (name) => setStack([{ name }]),
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        setStack((s) => s.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);
  return <NavCtx.Provider value={nav}>{children(stack[stack.length - 1])}</NavCtx.Provider>;
}

// ---------- Layout ----------
export function Screen({ title, children, right, scroll = true, back = true }: { title: string; children: ReactNode; right?: ReactNode; scroll?: boolean; back?: boolean }) {
  const nav = useNav();
  const body = scroll ? <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>;
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        {back && nav.stack.length > 1 ? (
          <Pressable onPress={nav.pop} hitSlop={12} style={s.back} accessibilityRole="button" accessibilityLabel="Back">
            <Text style={s.backText}>‹</Text>
          </Pressable>
        ) : null}
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {right}
      </View>
      {body}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Btn({ title, onPress, kind = 'primary', disabled, busy, small, style }: { title: string; onPress: () => void; kind?: 'primary' | 'plain' | 'danger'; disabled?: boolean; busy?: boolean; small?: boolean; style?: ViewStyle }) {
  const bg = kind === 'primary' ? C.brand : kind === 'danger' ? C.danger : C.panel;
  const fg = kind === 'plain' ? C.ink : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg, borderColor: kind === 'plain' ? C.line : bg, opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={C.muted} {...props} style={[s.input, props.multiline && { minHeight: 64, textAlignVertical: 'top' }, props.style]} />
    </View>
  );
}

/** A row of choice chips (used instead of drop-downs; easier with a thumb). */
export function Chips<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <View style={s.chips}>
      {items.map((i) => (
        <Pressable key={i.key} onPress={() => onChange(i.key)} style={[s.chip, value === i.key && s.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: value === i.key }}>
          <Text style={[s.chipText, value === i.key && { color: '#fff' }]}>{i.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.muted}>{label}</Text>
      <Text style={[s.value, strong && { fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[s.badge, { backgroundColor: color }]}>
      <Text style={s.badgeText}>{text}</Text>
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  if (!error) return null;
  const e = error as ApiError;
  const text = e.code && i18n.exists(e.code) && e.code !== 'errors.validation' ? t(e.code) : e.message ?? String(error);
  return <Text style={s.error}>{text}</Text>;
}

export function Notice({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' | 'danger' }) {
  const bg = { ok: C.okSoft, warn: C.warnSoft, danger: C.dangerSoft }[tone];
  const fg = { ok: C.ok, warn: C.warn, danger: C.danger }[tone];
  return <Text style={[s.notice, { backgroundColor: bg, color: fg }]}>{text}</Text>;
}

export const Loading = () => <ActivityIndicator style={{ margin: 24 }} color={C.brand} />;

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.brandDark, paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  back: { paddingHorizontal: 6 },
  backText: { color: '#fff', fontSize: 30, lineHeight: 30 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 },
  body: { padding: 12, paddingBottom: 40 },
  card: { backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 12 },
  btn: { borderRadius: 8, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 10, marginBottom: 0 },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 13, color: C.muted, fontWeight: '600', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { fontSize: 14, color: C.ink, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  muted: { color: C.muted, fontSize: 14 },
  value: { color: C.ink, fontSize: 15, flexShrink: 1, textAlign: 'right' },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink, marginBottom: 8 },
  big: { fontSize: 24, fontWeight: '700', color: C.ink },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  error: { backgroundColor: C.dangerSoft, color: C.danger, padding: 10, borderRadius: 8, marginBottom: 12 },
  notice: { padding: 10, borderRadius: 8, marginBottom: 12 },
  seq: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  seqText: { color: '#fff', fontWeight: '700' },
});
