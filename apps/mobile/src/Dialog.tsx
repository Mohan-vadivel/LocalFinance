import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, ScrollView, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Btn, C, Icon, R, SP, tint, type IconName } from './ui';

/** The look of a popup: its icon and the colour of the main button. */
export type DialogTone = 'question' | 'warning' | 'danger' | 'success' | 'info';

export interface DialogOptions {
  title: string;
  text?: string;
  tone?: DialogTone;
  /** A large figure under the title, such as the amount being collected. */
  amount?: string;
  /** Label and value lines under the text (customer, loan, mode…). */
  details?: { label: string; value: string }[];
  icon?: IconName;
  /** The main button. Defaults to "Confirm" (or "OK" for a message). */
  confirmText?: string;
  /** The second button; `false` shows only the main button. Defaults to "Cancel". */
  cancelText?: string | false;
  /** Closes the popup by itself after this many milliseconds (success messages). */
  timer?: number;
}

interface Dialog {
  /** Asks a question; resolves true when the main button is pressed and false on cancel, back or a tap outside. */
  confirm: (o: DialogOptions) => Promise<boolean>;
  /** Shows a message with one button (success, a problem, information). */
  alert: (o: DialogOptions) => Promise<void>;
}

const DialogCtx = createContext<Dialog>({ confirm: async () => true, alert: async () => undefined });
/** The app's popup: SweetAlert-style confirm and message boxes, used for every "are you sure" in the app. */
export const useDialog = () => useContext(DialogCtx);

const LOOK: Record<DialogTone, { icon: IconName; color: string; button: 'primary' | 'danger' }> = {
  question: { icon: 'help', color: C.brand, button: 'primary' },
  warning: { icon: 'alert', color: '#d97706', button: 'primary' },
  danger: { icon: 'trash-outline', color: C.danger, button: 'danger' },
  success: { icon: 'checkmark', color: C.ok, button: 'primary' },
  info: { icon: 'information', color: '#2563eb', button: 'primary' },
};

interface Open extends DialogOptions {
  resolve: (ok: boolean) => void;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  // One popup at a time; a second request waits for the first to close.
  const [queue, setQueue] = useState<Open[]>([]);
  const ask = useCallback((o: DialogOptions) => new Promise<boolean>((resolve) => setQueue((q) => [...q, { ...o, resolve }])), []);
  const api = useRef<Dialog>({
    confirm: (o) => ask(o),
    alert: (o) => ask({ cancelText: false, ...o }).then(() => undefined),
  }).current;
  const current = queue[0];
  const close = (ok: boolean) => {
    current?.resolve(ok);
    setQueue((q) => q.slice(1));
  };
  return (
    <DialogCtx.Provider value={api}>
      {children}
      {current ? <Popup key={queue.length + current.title} o={current} onClose={close} /> : null}
    </DialogCtx.Provider>
  );
}

function Popup({ o, onClose }: { o: Open; onClose: (ok: boolean) => void }) {
  const { t } = useTranslation();
  const tone = o.tone ?? 'question';
  const look = LOOK[tone];
  const single = o.cancelText === false;
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
  }, [pop]);
  useEffect(() => {
    if (!o.timer) return;
    const h = setTimeout(() => onClose(true), o.timer);
    return () => clearTimeout(h);
  }, [o.timer, onClose]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  // The icon draws in a moment after the card, as SweetAlert does.
  const iconScale = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.4, 1.12, 1], extrapolate: 'clamp' });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onClose(false)} statusBarTranslucent navigationBarTranslucent>
      <Pressable onPress={() => onClose(false)} style={{ flex: 1, backgroundColor: 'rgba(7, 30, 28, 0.5)', justifyContent: 'center', alignItems: 'center', padding: SP.xl }} accessibilityLabel={t('common.close')}>
        <Animated.View style={{ width: '100%', maxWidth: 380, maxHeight: '90%', opacity: pop, transform: [{ scale }] }}>
          {/* Taps on the card itself do not close it. */}
          <Pressable onPress={() => undefined} accessible={false} style={{ backgroundColor: C.panel, borderRadius: R.lg + 6, paddingTop: SP.xl, paddingHorizontal: SP.lg, paddingBottom: SP.lg, boxShadow: '0px 12px 40px rgba(7, 30, 28, 0.28)' }}>
            <ScrollView contentContainerStyle={{ alignItems: 'center' }} bounces={false}>
              <Animated.View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: tint(look.color, 0.25), backgroundColor: tint(look.color, 0.08), alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg, transform: [{ scale: iconScale }] }}>
                <Icon name={o.icon ?? look.icon} size={44} color={look.color} />
              </Animated.View>
              <Text accessibilityRole="header" style={{ fontSize: 21, lineHeight: 27, fontWeight: '800', color: C.ink, textAlign: 'center' }}>{o.title}</Text>
              {o.amount ? <Text style={{ fontSize: 32, lineHeight: 40, fontWeight: '800', color: C.ink, marginTop: SP.sm, fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>{o.amount}</Text> : null}
              {o.text ? <Text style={{ fontSize: 15, lineHeight: 22, color: C.muted, textAlign: 'center', marginTop: SP.sm }}>{o.text}</Text> : null}
              {o.details?.length ? (
                <View style={{ alignSelf: 'stretch', backgroundColor: C.bg, borderRadius: R.md, paddingHorizontal: SP.md, paddingVertical: SP.sm, marginTop: SP.md }}>
                  {o.details.map((d, i) => (
                    <View key={d.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SP.md, paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
                      <Text style={{ color: C.muted, fontSize: 14, flexShrink: 1 }}>{d.label}</Text>
                      <Text style={{ color: C.ink, fontSize: 15, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{d.value}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap-reverse', gap: SP.sm, marginTop: SP.lg }}>
              {!single && <Btn kind="outline" title={o.cancelText || t('common.cancel')} onPress={() => onClose(false)} style={{ flexGrow: 1, flexBasis: 120, marginBottom: 0 }} />}
              <Btn
                kind={look.button}
                title={o.confirmText ?? (single ? t('common.ok') : t('common.confirm'))}
                onPress={() => onClose(true)}
                style={{ flexGrow: 1, flexBasis: 120, marginBottom: 0 }}
              />
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
