import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Appbar, Button, Card as PaperCard, Chip, IconButton as PaperIconButton, SegmentedButtons, Searchbar, Surface, Text, TextInput as PaperTextInput, TouchableRipple } from 'react-native-paper';
import { formatINR } from '@localfinance/shared';
import { ApiError } from './api';
import type { PinStatus } from './store';

// ---------- Design tokens ----------
/** Colours. Light neutral surfaces, a teal brand and strong ink for reading outdoors. Also the Paper theme (theme.ts). */
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
/** Widest a column of content gets on tablets (dp); wider screens centre it. */
export const MAX_W = 720;
/** Wider cap for screens that switch to two columns on a landscape tablet. */
export const MAX_W_WIDE = 1080;

/**
 * Screen-size flags. `narrow` is a small phone (under 360dp), `compact` any phone under 400dp where rows should
 * stack, `tablet` 600dp and up, `wide` a landscape tablet (960dp and up) with room for two columns.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  return { width, height, narrow: width < 360, compact: width < 400, tablet: width >= 600, wide: width >= 960 };
}

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
  /** Opens a top-level screen from the side menu: it becomes the only screen, with the menu button in its header. */
  open: (name: string, params?: Record<string, unknown>) => void;
}
const NavCtx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavCtx);

export function NavProvider({ initial, children }: { initial: string; children: (top: Route, depth: number) => ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: initial }]);
  const nav: Nav = {
    stack,
    push: (name, params) => setStack((s) => [...s, { name, params }]),
    pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    replace: (name, params) => setStack((s) => [...s.slice(0, -1), { name, params }]),
    reset: (name) => setStack([{ name }]),
    open: (name, params) => setStack([{ name, params }]),
  };
  const top = stack[stack.length - 1];
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        setStack((s) => s.slice(0, -1));
        return true;
      }
      // Back on a screen opened from the menu goes home rather than closing the app.
      if (top.name !== initial) {
        setStack([{ name: initial }]);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, top.name, initial]);
  return <NavCtx.Provider value={nav}>{children(stack[stack.length - 1], stack.length)}</NavCtx.Provider>;
}

/** True while the bottom tab bar is showing; screens then leave the bottom safe area to the bar. */
export const TabBarCtx = createContext(false);
/** The bottom safe-area edge for a full screen: none while the tab bar sits below it. */
export const useScreenEdges = (): ('bottom' | 'left' | 'right')[] => (useContext(TabBarCtx) ? ['left', 'right'] : ['bottom', 'left', 'right']);

/** Opens the side menu; provided by `MenuProvider` in Menu.tsx. */
export const MenuCtx = createContext<{ open: () => void }>({ open: () => undefined });

export type IconName = ComponentProps<typeof Ionicons>['name'];
/** An outline icon from the Ionicons set bundled with Expo. */
export const Icon = ({ name, size = 22, color = C.ink }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color} />;

/** A round icon-only button (Paper IconButton, 48dp target) for headers and rows. */
export function IconButton({ icon, onPress, label, color = C.ink }: { icon: IconName; onPress: () => void; label: string; color?: string }) {
  return (
    <PaperIconButton
      icon={({ size }) => <Icon name={icon} size={size} color={color} />}
      size={24}
      iconColor={color}
      onPress={onPress}
      accessibilityLabel={label}
      style={{ margin: 0 }}
    />
  );
}

// ---------- Layout ----------
/**
 * The top app bar (Paper Appbar): back arrow, or the menu button on a top-level screen, then the title. The title
 * block wraps to as many lines as a long Tamil or Telugu title needs, which a fixed Appbar title would cut off.
 */
export function Header({ title, subtitle, right, back = true, eyebrow }: { title: string; subtitle?: string; right?: ReactNode; back?: boolean; eyebrow?: string }) {
  const { t } = useTranslation();
  const nav = useNav();
  const menu = useContext(MenuCtx);
  const insets = useSafeAreaInsets();
  const canBack = back && !!nav && nav.stack.length > 1;
  // A screen at the bottom of the stack (home, or one opened from the menu) shows the menu button instead.
  const showMenu = !!nav && nav.stack.length === 1;
  const leading = canBack || showMenu;
  return (
    <Appbar.Header mode="small" elevated={false} statusBarHeight={insets.top + SP.sm} style={s.header}>
      <View style={s.headerInner}>
        {canBack ? <Appbar.BackAction onPress={nav.pop} color={C.ink} size={24} accessibilityLabel={t('common.back')} style={s.appbarAction} /> : null}
        {showMenu ? <Appbar.Action icon="menu" onPress={menu.open} color={C.ink} size={24} accessibilityLabel={t('mobile.openMenu')} style={s.appbarAction} /> : null}
        <View style={[s.titleBlock, !leading && { paddingLeft: SP.xs }]}>
          {eyebrow ? <Text variant="labelMedium" style={s.eyebrow}>{eyebrow}</Text> : null}
          <Text variant="titleLarge" style={s.title}>{title}</Text>
          {subtitle ? <Text variant="bodyMedium" style={s.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={s.headerRight}>{right}</View> : null}
      </View>
    </Appbar.Header>
  );
}

export function Screen({ title, children, right, scroll = true, back = true, subtitle }: { title: string; children: ReactNode; right?: ReactNode; scroll?: boolean; back?: boolean; subtitle?: string }) {
  const edges = useScreenEdges();
  const body = scroll ? <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>;
  return (
    <SafeAreaView style={s.safe} edges={edges}>
      <Header title={title} subtitle={subtitle} right={right} back={back} />
      {body}
    </SafeAreaView>
  );
}

/**
 * A rounded surface (Paper Card, elevation 1). With `onPress` it becomes a tappable list item with the Paper ripple.
 */
export function Card({ children, style, onPress, tone, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'default' | 'brand' | 'soft'; accessibilityLabel?: string }) {
  const toneStyle = tone === 'brand' ? s.cardBrand : tone === 'soft' ? s.cardSoft : null;
  return (
    <PaperCard mode="elevated" elevation={1} onPress={onPress} accessibilityLabel={accessibilityLabel} style={[s.card, toneStyle, style]}>
      {children}
    </PaperCard>
  );
}

type BtnKind = 'primary' | 'plain' | 'danger' | 'tonal' | 'outline' | 'ghost' | 'light';
/**
 * Buttons on Paper Button. `primary` is filled brand (the main action on a screen), `plain`/`tonal` a soft brand
 * fill for secondary actions, `outline` a bordered neutral button, `danger` a filled red one, `ghost` a text button,
 * `light` a white button for use on a brand-coloured card. At least 48dp tall.
 *
 * Paper's Button clamps its label to one line, so a long label (a Tamil or Telugu sentence, or a name) would be cut
 * off. Labels longer than a word or two render with the same Paper surface, ripple and metrics, but wrap onto as many
 * lines as they need.
 */
export function Btn({ title, onPress, kind = 'primary', disabled, busy, small, style, big, textStyle, accessibilityLabel, icon }: { title: string; onPress: () => void; kind?: BtnKind; disabled?: boolean; busy?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; big?: boolean; textStyle?: StyleProp<TextStyle>; accessibilityLabel?: string; icon?: IconName }) {
  const v = BTN[kind];
  const off = disabled || busy;
  const minH = big ? 60 : small ? 48 : 52;
  const fontSize = big ? 18 : small ? 14 : 16;
  const weight: TextStyle['fontWeight'] = big ? '800' : '700';
  const iconEl = icon ? ({ size, color }: { size: number; color: string }) => <Icon name={icon} size={size} color={color} /> : undefined;
  const label: TextStyle = { fontSize, fontWeight: weight, color: v.fg, textAlign: 'center' };
  const dim = off ? { opacity: disabled && !busy ? 0.45 : 0.7 } : null;

  // Paper's one-line label only for very short words; characters in Indian scripts are wide, so longer ones wrap.
  if (title.length <= 6) {
    return (
      <Button
        mode={v.mode}
        onPress={onPress}
        disabled={off}
        loading={!!busy}
        icon={iconEl}
        buttonColor={v.bg}
        textColor={v.fg}
        theme={{ colors: { surfaceDisabled: v.bg, onSurfaceDisabled: v.fg } }}
        contentStyle={{ minHeight: minH, paddingHorizontal: 8 }}
        labelStyle={[label, textStyle]}
        accessibilityLabel={accessibilityLabel}
        style={[s.btn, big && s.btnBig, small && s.btnSmall, v.mode === 'outlined' && { borderColor: v.border }, dim, style]}
      >
        {title}
      </Button>
    );
  }
  // Long label: the same surface and ripple as Paper's Button, with a wrapping label.
  return (
    <Surface elevation={v.mode === 'contained' && !off ? 1 : 0} style={[s.btn, big && s.btnBig, small && s.btnSmall, { backgroundColor: v.bg, borderWidth: v.mode === 'outlined' ? 1 : 0, borderColor: v.border }, dim, style]}>
      <TouchableRipple
        onPress={onPress}
        disabled={off}
        borderless={false}
        rippleColor={v.fg === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)'}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !!off, busy: !!busy }}
        style={{ flex: 1, minHeight: minH, justifyContent: 'center', paddingVertical: 12, paddingHorizontal: SP.lg, borderRadius: big ? R.lg : R.md }}
      >
        <View style={s.btnRow}>
          {busy ? <ActivityIndicator color={v.fg} /> : iconEl ? iconEl({ size: big ? 24 : small ? 19 : 21, color: v.fg }) : null}
          <Text style={[label, { flexShrink: 1 }, textStyle]}>{title}</Text>
        </View>
      </TouchableRipple>
    </Surface>
  );
}
const BTN: Record<BtnKind, { mode: 'contained' | 'contained-tonal' | 'outlined' | 'text'; bg: string; fg: string; border: string }> = {
  primary: { mode: 'contained', bg: C.brand, fg: C.onBrand, border: C.brand },
  danger: { mode: 'contained', bg: C.danger, fg: '#fff', border: C.danger },
  plain: { mode: 'contained-tonal', bg: C.brandSoft, fg: C.brandInk, border: C.brandSoft },
  tonal: { mode: 'contained-tonal', bg: C.brandSoft, fg: C.brandInk, border: C.brandSoft },
  outline: { mode: 'outlined', bg: C.panel, fg: C.ink, border: C.lineStrong },
  ghost: { mode: 'text', bg: 'transparent', fg: C.brand, border: 'transparent' },
  light: { mode: 'contained', bg: '#ffffff', fg: C.brandInk, border: '#ffffff' },
};

/**
 * A labelled text box on Paper's outlined TextInput. The label stays above the box, so long Tamil and Telugu labels
 * wrap instead of being cut as a floating label would. `prefix` shows a fixed symbol (such as ₹) inside the box;
 * `large` is for amounts.
 */
export function Field({ label, prefix, large, hint, style, multiline, ...props }: TextInputProps & { label: string; prefix?: string; large?: boolean; hint?: string }) {
  return (
    <View style={{ marginBottom: SP.lg }}>
      <Text variant="labelLarge" style={s.label}>{label}</Text>
      <PaperTextInput
        mode="outlined"
        outlineColor={C.lineStrong}
        activeOutlineColor={C.brand}
        outlineStyle={{ borderRadius: R.md, borderWidth: 1.5 }}
        textColor={C.ink}
        placeholderTextColor="#8b9796"
        left={prefix ? <PaperTextInput.Affix text={prefix} textStyle={[s.prefix, large && { fontSize: 28, fontWeight: '800' }]} /> : undefined}
        multiline={multiline}
        {...(props as ComponentProps<typeof PaperTextInput>)}
        style={[s.input, large && s.inputLargeText, multiline && { minHeight: 96, textAlignVertical: 'top' }, style as StyleProp<TextStyle>]}
      />
      {hint ? <Text variant="bodyMedium" style={[s.muted, { marginTop: SP.xs, fontSize: 13 }]}>{hint}</Text> : null}
    </View>
  );
}

/**
 * A rounded search box on Paper Searchbar, with a magnifier and a clear button. With `onPress` (and no `onChangeText`)
 * it is a button that looks like a search box, for opening the search screen from the home screen. A placeholder
 * cannot wrap, so give a short one on small phones and the full wording as `label` (read out by TalkBack).
 */
export function SearchBar({ value = '', onChangeText, onPress, placeholder, label, onSubmit, autoFocus, style }: { value?: string; onChangeText?: (v: string) => void; onPress?: () => void; placeholder: string; label?: string; onSubmit?: () => void; autoFocus?: boolean; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  if (onPress && !onChangeText) {
    return (
      <Pressable onPress={onPress} accessibilityRole="search" accessibilityLabel={placeholder} style={({ pressed }) => [s.searchPress, pressed && { opacity: 0.85 }, style]}>
        <View pointerEvents="none">
          <Searchbar value="" placeholder={placeholder} editable={false} icon="magnify" iconColor={C.brand} elevation={0} style={s.search} inputStyle={s.searchInput} placeholderTextColor={C.muted} />
        </View>
      </Pressable>
    );
  }
  return (
    <Searchbar
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      accessibilityLabel={label ?? placeholder}
      returnKeyType="search"
      onSubmitEditing={onSubmit}
      autoFocus={autoFocus}
      autoCorrect={false}
      icon="magnify"
      iconColor={C.brand}
      clearIcon="close-circle"
      clearAccessibilityLabel={t('mobile.clearSearch')}
      onClearIconPress={() => onChangeText?.('')}
      elevation={0}
      style={[s.search, style]}
      inputStyle={s.searchInput}
    />
  );
}

/** A friendly empty or "nothing found" state: a soft round icon, a line of text and an optional action. */
export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={30} color={C.brand} />
      </View>
      <Text variant="titleMedium" style={s.emptyTitle}>{title}</Text>
      {text ? <Text variant="bodyMedium" style={s.emptyText}>{text}</Text> : null}
      {action}
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
      <SegmentedButtons
        value={value}
        onValueChange={(v) => onChange(v as T)}
        style={s.segment}
        buttons={items.map((i) => {
          const on = value === i.key;
          return {
            value: i.key,
            label: i.label,
            accessibilityLabel: i.label,
            checked: on,
            showSelectedCheck: false,
            style: [s.segmentItem, on && s.segmentOn],
            labelStyle: [s.segmentText, on && { color: C.brandInk }],
            checkedColor: C.brandInk,
            uncheckedColor: C.muted,
          };
        })}
      />
    );
  }
  return (
    <View style={s.chips} accessibilityRole="radiogroup">
      {items.map((i) => {
        const on = value === i.key;
        return (
          <Chip
            key={i.key}
            mode="outlined"
            selected={on}
            showSelectedCheck={false}
            onPress={() => onChange(i.key)}
            accessibilityLabel={i.label}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[s.chip, on && s.chipOn]}
            textStyle={[s.chipText, on && { color: C.onBrand }]}
          >
            {i.label}
          </Chip>
        );
      })}
    </View>
  );
}

/** Label on the left, value on the right; long Tamil labels wrap instead of being cut. */
export function Row({ label, value, strong, divider, tone }: { label: string; value: ReactNode; strong?: boolean; divider?: boolean; tone?: string }) {
  return (
    <View style={[s.row, divider && s.rowDivider]}>
      <Text variant="bodyLarge" style={[s.rowLabel, strong && { color: C.ink, fontWeight: '600' }]}>{label}</Text>
      <Text variant="bodyLarge" style={[s.value, strong && s.valueStrong, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

/** A soft tinted status pill with a dot in the status colour. `solid` fills it instead. */
export function Badge({ text, color, solid }: { text: string; color: string; solid?: boolean }) {
  return (
    <View style={[s.badge, { backgroundColor: solid ? color : tint(color, 0.14) }]}>
      {!solid && <View style={[s.badgeDot, { backgroundColor: color }]} />}
      <Text variant="labelMedium" style={[s.badgeText, { color: solid ? '#fff' : shade(color, 0.28) }]}>{text}</Text>
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

/** A tinted message box with a coloured edge (Paper Surface). Danger notices are announced by TalkBack. */
export function Notice({ text, tone = 'ok' }: { text: string; tone?: 'ok' | 'warn' | 'danger' | 'info' }) {
  const bg = { ok: C.okSoft, warn: C.warnSoft, danger: C.dangerSoft, info: C.brandSoft }[tone];
  const fg = { ok: C.ok, warn: C.warn, danger: C.danger, info: C.brandInk }[tone];
  return (
    <Surface elevation={0} style={[s.notice, { backgroundColor: bg, borderLeftColor: fg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Text variant="bodyLarge" style={[s.noticeText, { color: shade(fg, 0.1) }]}>{text}</Text>
    </Surface>
  );
}

export const Loading = () => <ActivityIndicator animating size="large" color={C.brand} style={{ margin: 32 }} />;

/** A small heading above a group of cards. */
export function Section({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={s.section}>
      <Text variant="labelLarge" style={s.sectionText}>{title}</Text>
      {right}
    </View>
  );
}

/** A label with a large money figure under it. `onBrand` is for use inside a brand-coloured card. */
export function Amount({ label, value, size = 'lg', onBrand, align = 'left', tone }: { label: string; value: string; size?: 'md' | 'lg' | 'xl'; onBrand?: boolean; align?: 'left' | 'right'; tone?: string }) {
  const fs = { md: 20, lg: 26, xl: 34 }[size];
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start', flexShrink: 1 }}>
      <Text variant="labelLarge" style={[s.amountLabel, onBrand && { color: C.onBrandMuted }, { textAlign: align }]}>{label}</Text>
      <Text style={[s.amount, { fontSize: fs, lineHeight: Math.round(fs * 1.2) }, onBrand && { color: C.onBrand }, tone ? { color: tone } : null]} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Two amounts side by side (the main figure on the left, a smaller one on the right). On a small phone, or with a
 * long Tamil label, the right one moves under the left one instead of squeezing the figures.
 */
export function AmountPair({ main, side, onBrand }: { main: { label: string; value: string }; side: { label: string; value: string }; onBrand?: boolean }) {
  const { compact } = useLayout();
  return (
    <View style={s.amountPair}>
      <Amount onBrand={onBrand} size="xl" label={main.label} value={main.value} />
      {/* Left-aligned on a phone under 400dp, where it is likely to sit under the main figure. */}
      <Amount onBrand={onBrand} size="md" align={compact ? 'left' : 'right'} label={side.label} value={side.value} />
    </View>
  );
}

/** A row of `Stat` tiles; on a small phone they wrap onto a second line rather than breaking their labels. */
export function StatRow({ children }: { children: ReactNode }) {
  return <View style={s.statRow}>{children}</View>;
}

/** A compact figure tile for a row of stats (a Paper Surface with a hairline edge). */
export function Stat({ label, value, tone, style }: { label: string; value: string; tone?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Surface elevation={0} style={[s.stat, style]}>
      <Text style={[s.statValue, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text variant="bodyMedium" style={s.statLabel}>{label}</Text>
    </Surface>
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
export const Chevron = ({ color = C.muted }: { color?: string }) => (
  <View style={{ marginLeft: SP.xs }}>
    <Icon name="chevron-forward" size={20} color={color} />
  </View>
);

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { height: 'auto', minHeight: 64, backgroundColor: C.panel, paddingHorizontal: SP.md, paddingBottom: SP.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, boxShadow: '0px 1px 3px rgba(16, 40, 36, 0.06)', zIndex: 2 },
  headerInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, width: '100%', maxWidth: MAX_W + (SP.lg - SP.md) * 2, alignSelf: 'center' },
  appbarAction: { margin: 0, marginRight: SP.xs },
  titleBlock: { flex: 1, minWidth: 0, justifyContent: 'center', paddingVertical: SP.xs },
  headerRight: { flexShrink: 0, alignSelf: 'center' },
  backText: { color: C.ink, fontSize: 36, lineHeight: 40, marginTop: -4, fontWeight: '300' },
  eyebrow: { color: C.muted, fontSize: 13, fontWeight: '600' },
  title: { color: C.ink, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  subtitle: { color: C.muted, fontSize: 14, marginTop: 2 },
  body: { padding: SP.lg, paddingBottom: 48, width: '100%', maxWidth: MAX_W + SP.lg * 2, alignSelf: 'center' },
  card: { backgroundColor: C.panel, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: SP.lg, marginBottom: SP.md, boxShadow: shadow },
  cardBrand: { backgroundColor: C.brand, borderColor: C.brand, boxShadow: '0px 4px 14px rgba(15, 118, 110, 0.25)' },
  cardSoft: { backgroundColor: C.surface, borderColor: C.surface, boxShadow: 'none' },
  btn: { minHeight: 52, borderRadius: R.md, marginBottom: SP.sm },
  btnSmall: { minHeight: 48, marginBottom: 0, borderRadius: R.md },
  btnBig: { minHeight: 60, borderRadius: R.lg },
  btnText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, maxWidth: '100%' },
  search: { minHeight: 54, borderRadius: R.pill, borderWidth: 1.5, borderColor: C.lineStrong, backgroundColor: C.panel, marginBottom: SP.md },
  searchPress: { marginBottom: 0 },
  searchText: { flex: 1, minWidth: 0, fontSize: 16, color: C.ink },
  searchInput: { fontSize: 16, color: C.ink, minHeight: 50 },
  searchClear: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.lg, gap: SP.sm },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: C.ink, textAlign: 'center' },
  emptyText: { fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 21 },
  btnTextSmall: { fontSize: 14 },
  btnTextBig: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 14, color: C.ink2, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: C.panel, fontSize: 17, color: C.ink, minHeight: 56 },
  inputFocus: { borderColor: C.brand },
  inputLargeText: { fontSize: 28, fontWeight: '800', color: C.ink },
  prefix: { fontSize: 17, color: C.muted, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.lg },
  chip: { height: 48, flexDirection: 'column', justifyContent: 'center', borderWidth: 1.5, borderColor: C.lineStrong, borderRadius: R.pill, backgroundColor: C.panel },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { fontSize: 15, color: C.ink, fontWeight: '600', lineHeight: 20, marginVertical: 0, textAlignVertical: 'center' },
  segment: { backgroundColor: C.surface, borderRadius: R.md, marginBottom: SP.lg },
  segmentItem: { flex: 1, minHeight: 46, borderRadius: R.sm, borderWidth: 0 },
  segmentOn: { backgroundColor: C.panel },
  segmentText: { fontSize: 15, fontWeight: '700', color: C.muted, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, gap: SP.md },
  rowDivider: { borderTopWidth: 1, borderTopColor: C.line, marginTop: SP.xs, paddingTop: SP.md },
  rowLabel: { color: C.muted, fontSize: 15, flexShrink: 1, flexGrow: 1, flexBasis: 0, minWidth: 0 },
  muted: { color: C.muted, fontSize: 14 },
  value: { color: C.ink, fontSize: 16, fontWeight: '500', flexShrink: 0, maxWidth: '62%', textAlign: 'right' },
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
  amountPair: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', columnGap: SP.md, rowGap: SP.sm },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.md },
  stat: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 104, backgroundColor: C.panel, borderRadius: R.md, borderWidth: 1, borderColor: C.line, paddingVertical: SP.md, paddingHorizontal: SP.md },
  statValue: { fontSize: 20, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13, color: C.muted, fontWeight: '600', marginTop: 2 },
});
