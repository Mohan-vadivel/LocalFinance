import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatINR } from '@localfinance/shared';
import { ApiError } from './api';
import type { PinStatus } from './store';

// ---------- Design tokens ----------
/** Colours. Light neutral surfaces, a teal brand and strong ink for reading outdoors. */
export const C = {
  bg: '#f3f6f5',
  panel: '#ffffff',
  surface: '#eaf0ee',
  ink: '#0f1a1a',
  ink2: '#33403f',
  muted: '#566463',
  line: '#dfe6e4',
  lineStrong: '#c5d0cd',
  brand: '#0f766e',
  brandDark: '#0b4f4a',
  brandInk: '#073b37',
  brandSoft: '#ddf1ed',
  onBrand: '#ffffff',
  onBrandMuted: '#c7ebe4',
  danger: '#b42318',
  dangerSoft: '#fdecea',
  warn: '#b54708',
  warnSoft: '#fef3e2',
  ok: '#067647',
  okSoft: '#e3f5ea',
  grey: '#8a96a3',
};

/** Spacing scale (dp). */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
/** Corner radii (dp). */
export const R = { sm: 10, md: 12, lg: 16, pill: 999 };
const shadow = '0px 1px 2px rgba(16, 40, 36, 0.06), 0px 2px 8px rgba(16, 40, 36, 0.05)';

export const PIN_COLORS: Record<PinStatus, string> = { PAID: '#067647', PARTIAL: '#d97706', MISSED: '#b42318', NOTHING_DUE: '#8a96a3', PENDING: '#0f766e' };
export const money = (p: number | null | undefined) => (p == null ? '-' : formatINR(p));
export const toPaise = (rupees: string) => Math.round(Number(rupees.replace(/,/g, '') || 0) * 100);
export const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const dateIN = (d?: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '-');

/** `#rrggbb` with an alpha (0..1), for soft tinted backgrounds. */
export function tint(hex: string, alpha: number) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex + a : hex;
}
/** Darkens `#rrggbb` (0..1) so a status colour stays readable as text on its own tint. */
export function shade(hex: string, amount: number) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

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
/** The top app bar: back button, a large title (wraps to two lines for long Tamil titles) and optional actions. */
export function Header({ title, subtitle, right, back = true, eyebrow }: { title: string; subtitle?: string; right?: ReactNode; back?: boolean; eyebrow?: string }) {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const canBack = back && !!nav && nav.stack.length > 1;
  return (
    <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
      {canBack ? (
        <Pressable onPress={nav.pop} hitSlop={8} style={({ pressed }) => [s.back, pressed && { backgroundColor: C.surface }]} accessibilityRole="button" accessibilityLabel="Back" android_ripple={{ color: C.line, borderless: true }}>
          <Text style={s.backText}>‹</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1, paddingLeft: canBack ? 0 : SP.xs }}>
        {eyebrow ? <Text style={s.eyebrow} numberOfLines={1}>{eyebrow}</Text> : null}
        <Text style={s.title} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Screen({ title, children, right, scroll = true, back = true, subtitle }: { title: string; children: ReactNode; right?: ReactNode; scroll?: boolean; back?: boolean; subtitle?: string }) {
  const body = scroll ? <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>;
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <Header title={title} subtitle={subtitle} right={right} back={back} />
      {body}
    </SafeAreaView>
  );
}

/** A rounded surface. With `onPress` it becomes a tappable list item with press feedback. */
export function Card({ children, style, onPress, tone, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'default' | 'brand' | 'soft'; accessibilityLabel?: string }) {
  const toneStyle = tone === 'brand' ? s.cardBrand : tone === 'soft' ? s.cardSoft : null;
  if (!onPress) return <View style={[s.card, toneStyle, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: C.surface }}
      style={({ pressed }) => [s.card, toneStyle, pressed && { backgroundColor: tone === 'brand' ? C.brandDark : '#f6f9f8', transform: [{ scale: 0.995 }] }, style]}
    >
      {children}
    </Pressable>
  );
}

type BtnKind = 'primary' | 'plain' | 'danger' | 'tonal' | 'outline' | 'ghost';
/**
 * Buttons. `primary` is filled brand (the main action on a screen), `plain`/`tonal` is a soft brand fill for
 * secondary actions, `outline` a bordered neutral button, `danger` a filled red one. At least 48dp tall.
 */
export function Btn({ title, onPress, kind = 'primary', disabled, busy, small, style, big, textStyle, accessibilityLabel }: { title: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; big?: boolean; textStyle?: StyleProp<TextStyle>; accessibilityLabel?: string }) {
  const palette: Record<BtnKind, { bg: string; fg: string; border: string; pressed: string }> = {
    primary: { bg: C.brand, fg: C.onBrand, border: C.brand, pressed: C.brandDark },
    danger: { bg: C.danger, fg: '#fff', border: C.danger, pressed: '#8f1c13' },
    plain: { bg: C.brandSoft, fg: C.brandInk, border: C.brandSoft, pressed: '#c9e8e1' },
    tonal: { bg: C.brandSoft, fg: C.brandInk, border: C.brandSoft, pressed: '#c9e8e1' },
    outline: { bg: C.panel, fg: C.ink, border: C.lineStrong, pressed: C.surface },
    ghost: { bg: 'transparent', fg: C.brand, border: 'transparent', pressed: C.brandSoft },
  };
  const p = palette[kind];
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        big && s.btnBig,
        { backgroundColor: pressed ? p.pressed : p.bg, borderColor: p.border },
        kind === 'primary' && !off && { boxShadow: '0px 2px 6px rgba(15, 118, 110, 0.28)' },
        off && { opacity: disabled && !busy ? 0.45 : 0.7 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={p.fg} /> : <Text style={[s.btnText, small && s.btnTextSmall, big && s.btnTextBig, { color: p.fg }, textStyle]}>{title}</Text>}
    </Pressable>
  );
}

/** A labelled text box. `prefix` shows a fixed symbol (such as ₹) in front; `large` is for amounts. */
export function Field({ label, prefix, large, hint, ...props }: TextInputProps & { label: string; prefix?: string; large?: boolean; hint?: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: SP.lg }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputWrap, focus && s.inputFocus, props.multiline && { alignItems: 'flex-start' }]}>
        {prefix ? <Text style={[s.prefix, large && s.inputLargeText]}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor="#8b9796"
          {...props}
          onFocus={(e) => {
            setFocus(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            props.onBlur?.(e);
          }}
          style={[s.input, large && s.inputLargeText, props.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 14 }, props.style as StyleProp<TextStyle>]}
        />
      </View>
      {hint ? <Text style={[s.muted, { marginTop: SP.xs, fontSize: 13 }]}>{hint}</Text> : null}
    </View>
  );
}

/**
 * A row of choice chips (used instead of drop-downs; easier with a thumb). `segmented` shows them as one
 * full-width switch with equal parts, for two or three options.
 */
export function Chips<T extends string>({ value, onChange, items, segmented }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[]; segmented?: boolean }) {
  if (segmented) {
    return (
      <View style={s.segment} accessibilityRole="radiogroup">
        {items.map((i) => {
          const on = value === i.key;
          return (
            <Pressable key={i.key} onPress={() => onChange(i.key)} style={[s.segmentItem, on && s.segmentOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Text style={[s.segmentText, on && { color: C.brandInk }]}>{i.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={s.chips}>
      {items.map((i) => {
        const on = value === i.key;
        return (
          <Pressable key={i.key} onPress={() => onChange(i.key)} style={({ pressed }) => [s.chip, on && s.chipOn, pressed && !on && { backgroundColor: C.surface }]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Text style={[s.chipText, on && { color: C.onBrand }]}>{i.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Label on the left, value on the right; long Tamil labels wrap instead of being cut. */
export function Row({ label, value, strong, divider, tone }: { label: string; value: ReactNode; strong?: boolean; divider?: boolean; tone?: string }) {
  return (
    <View style={[s.row, divider && s.rowDivider]}>
      <Text style={[s.rowLabel, strong && { color: C.ink, fontWeight: '600' }]}>{label}</Text>
      <Text style={[s.value, strong && s.valueStrong, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

/** A soft tinted status pill with a dot in the status colour. `solid` fills it instead. */
export function Badge({ text, color, solid }: { text: string; color: string; solid?: boolean }) {
  return (
    <View style={[s.badge, { backgroundColor: solid ? color : tint(color, 0.14) }]}>
      {!solid && <View style={[s.badgeDot, { backgroundColor: color }]} />}
      <Text style={[s.badgeText, { color: solid ? '#fff' : shade(color, 0.28) }]}>{text}</Text>
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  if (!error) return null;
  const e = error as ApiError;
  const text = e.code && i18n.exists(e.code) && e.code !== 'errors.validation' ? t(e.code) : e.message ?? String(error);
  return <Notice tone="danger" text={text} />;
}

export function Notice({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' | 'danger' | 'info' }) {
  const bg = { ok: C.okSoft, warn: C.warnSoft, danger: C.dangerSoft, info: C.brandSoft }[tone];
  const fg = { ok: C.ok, warn: C.warn, danger: C.danger, info: C.brandInk }[tone];
  return (
    <View style={[s.notice, { backgroundColor: bg, borderLeftColor: fg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Text style={[s.noticeText, { color: shade(fg, 0.1) }]}>{text}</Text>
    </View>
  );
}

export const Loading = () => <ActivityIndicator style={{ margin: 32 }} size="large" color={C.brand} />;

/** A small heading above a group of cards. */
export function Section({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionText}>{title}</Text>
      {right}
    </View>
  );
}

/** A label with a large money figure under it. `onBrand` is for use inside a brand-coloured card. */
export function Amount({ label, value, size = 'lg', onBrand, align = 'left', tone }: { label: string; value: string; size?: 'md' | 'lg' | 'xl'; onBrand?: boolean; align?: 'left' | 'right'; tone?: string }) {
  const fs = { md: 20, lg: 26, xl: 34 }[size];
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start', flexShrink: 1 }}>
      <Text style={[s.amountLabel, onBrand && { color: C.onBrandMuted }, { textAlign: align }]}>{label}</Text>
      <Text style={[s.amount, { fontSize: fs, lineHeight: Math.round(fs * 1.2) }, onBrand && { color: C.onBrand }, tone ? { color: tone } : null]} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** A compact figure tile for a row of stats. */
export function Stat({ label, value, tone, style }: { label: string; value: string; tone?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.stat, style]}>
      <Text style={[s.statValue, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

/** A thin progress bar (0..1). */
export function Progress({ value, color = C.brand, track = C.surface, height = 8 }: { value: number; color?: string; track?: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={{ height, backgroundColor: track, borderRadius: height / 2, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <View style={{ height, width: `${pct * 100}%`, backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

/** A round initial (for customers and staff). */
export function Avatar({ name, color = C.brand, size = 44, label }: { name: string; color?: string; size?: number; label?: string }) {
  const text = label ?? (name.split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0] ?? '').filter(Boolean).slice(0, 2).join('').toUpperCase() || '?');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint(color, 0.14), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: shade(color, 0.2), fontWeight: '800', fontSize: size * 0.38 }}>{text}</Text>
    </View>
  );
}

/** A right-pointing chevron for tappable rows. */
export const Chevron = ({ color = C.muted }: { color?: string }) => <Text style={{ color, fontSize: 26, lineHeight: 28, marginLeft: SP.xs }}>›</Text>;

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, paddingHorizontal: SP.md, paddingBottom: SP.md, gap: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, boxShadow: '0px 1px 3px rgba(16, 40, 36, 0.06)', zIndex: 2 },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  backText: { color: C.ink, fontSize: 36, lineHeight: 40, marginTop: -4, fontWeight: '300' },
  eyebrow: { color: C.muted, fontSize: 13, fontWeight: '600' },
  title: { color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  subtitle: { color: C.muted, fontSize: 14, marginTop: 2 },
  body: { padding: SP.lg, paddingBottom: 48 },
  card: { backgroundColor: C.panel, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: SP.lg, marginBottom: SP.md, boxShadow: shadow },
  cardBrand: { backgroundColor: C.brand, borderColor: C.brand, boxShadow: '0px 4px 14px rgba(15, 118, 110, 0.25)' },
  cardSoft: { backgroundColor: C.surface, borderColor: C.surface, boxShadow: 'none' },
  btn: { minHeight: 52, borderRadius: R.md, borderWidth: 1, paddingVertical: 12, paddingHorizontal: SP.lg, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  btnSmall: { minHeight: 48, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 0, borderRadius: R.md },
  btnBig: { minHeight: 60, borderRadius: R.lg },
  btnText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  btnTextSmall: { fontSize: 14 },
  btnTextBig: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 14, color: C.ink2, fontWeight: '600', marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: C.lineStrong, borderRadius: R.md, backgroundColor: C.panel, paddingHorizontal: 14 },
  inputFocus: { borderColor: C.brand, boxShadow: '0px 0px 0px 3px rgba(15, 118, 110, 0.15)' },
  input: { flex: 1, minWidth: 0, minHeight: 52, paddingVertical: 10, fontSize: 17, color: C.ink },
  inputLargeText: { fontSize: 28, fontWeight: '800', color: C.ink },
  prefix: { fontSize: 17, color: C.muted, fontWeight: '700', marginRight: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.lg },
  chip: { minHeight: 44, justifyContent: 'center', borderWidth: 1.5, borderColor: C.lineStrong, borderRadius: R.pill, paddingVertical: 8, paddingHorizontal: SP.lg, backgroundColor: C.panel },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { fontSize: 15, color: C.ink, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: R.md, padding: SP.xs, gap: SP.xs, marginBottom: SP.lg },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.sm, paddingVertical: 6 },
  segmentOn: { backgroundColor: C.panel, boxShadow: '0px 1px 3px rgba(16, 40, 36, 0.14)' },
  segmentText: { fontSize: 15, fontWeight: '700', color: C.muted, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, gap: SP.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.line, marginTop: SP.xs, paddingTop: SP.md },
  rowLabel: { color: C.muted, fontSize: 15, flexShrink: 1 },
  muted: { color: C.muted, fontSize: 14 },
  value: { color: C.ink, fontSize: 16, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  valueStrong: { fontWeight: '800', fontSize: 17 },
  h2: { fontSize: 18, fontWeight: '800', color: C.ink, marginBottom: SP.md },
  big: { fontSize: 26, fontWeight: '800', color: C.ink },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', flexShrink: 1 },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  error: { backgroundColor: C.dangerSoft, color: C.danger, padding: SP.md, borderRadius: R.md, marginBottom: SP.md, fontSize: 15, fontWeight: '600', overflow: 'hidden' },
  notice: { padding: SP.md, paddingLeft: 14, borderRadius: R.md, marginBottom: SP.md, borderLeftWidth: 4 },
  noticeText: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  seq: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  seqText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.sm, marginBottom: SP.sm, gap: SP.sm },
  sectionText: { fontSize: 16, fontWeight: '800', color: C.ink2, flexShrink: 1 },
  amountLabel: { color: C.muted, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  amount: { color: C.ink, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stat: { flex: 1, backgroundColor: C.panel, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingVertical: SP.md, paddingHorizontal: SP.md, minWidth: 0 },
  statValue: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13, color: C.muted, fontWeight: '600', marginTop: 2 },
});
