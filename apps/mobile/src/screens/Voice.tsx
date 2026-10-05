import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseSpokenEntry, type SpokenEntry } from '@localfinance/shared';
import type { DayCustomer } from '../store';
import { Avatar, Btn, C, Field, Icon, Notice, PIN_COLORS, R, SP, money, s } from '../ui';

/**
 * "Speak": the agent says (or types) a name and an amount, e.g. "Murugan 500" or "முருகன் ஐநூறு", using the
 * keyboard's microphone. Matched against this route's customers on the phone, so it works offline. Nothing is
 * saved here: "Collect" opens the customer with the amount filled in, and the usual confirm step follows.
 */
export function VoiceSheet({ visible, customers, onClose, onCollect }: { visible: boolean; customers: DayCustomer[]; onClose: () => void; onCollect: (c: DayCustomer, amount: number | null) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [res, setRes] = useState<SpokenEntry<DayCustomer> | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const run = () => {
    if (!text.trim()) return;
    const r = parseSpokenEntry(text, customers);
    setRes(r);
    // One clear match is chosen at once; with several the agent picks.
    const [a, b] = r.matches;
    setPicked(a && (!b || (a.score === 1 && b.score < 1)) ? a.customer.id : null);
  };
  const reset = () => {
    setText('');
    setRes(null);
    setPicked(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const chosen = res?.matches.find((m) => m.customer.id === picked)?.customer ?? null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(7, 30, 28, 0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <View style={{ backgroundColor: C.panel, borderTopLeftRadius: R.lg + 4, borderTopRightRadius: R.lg + 4, maxHeight: '88%', width: '100%', maxWidth: 720, alignSelf: 'center', boxShadow: '0px -4px 24px rgba(7, 30, 28, 0.2)' }}>
          <ScrollView contentContainerStyle={{ padding: SP.lg, paddingBottom: SP.lg + insets.bottom }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.sm }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="mic" size={24} color={C.brand} />
              </View>
              <Text style={[s.h2, { flex: 1, minWidth: 0, marginBottom: 0 }]}>{t('ai.voice.title')}</Text>
              <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')} style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: C.surface }]}>
                <Icon name="close" size={24} color={C.ink2} />
              </Pressable>
            </View>
            <Text style={[s.muted, { marginBottom: SP.lg, lineHeight: 20 }]}>{t('ai.voice.hint')}</Text>
            <Field
              label={t('ai.voice.placeholder')}
              value={text}
              onChangeText={(v) => {
                setText(v);
                setRes(null);
              }}
              placeholder={t('ai.voice.placeholder')}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={run}
              style={{ fontSize: 20, fontWeight: '700' }}
            />
            {!res && <Btn big title={t('ai.mobile.find')} onPress={run} disabled={!text.trim()} />}
            {res && (
              <>
                <Text style={{ color: C.ink2, fontSize: 15, fontWeight: '600', marginBottom: SP.md }}>
                  {t('ai.voice.heard', { text: [res.heard, res.amount != null ? money(res.amount) : ''].filter(Boolean).join(' · ') || text.trim() })}
                </Text>
                {res.matches.length === 0 && <Notice tone="warn" text={t('ai.voice.noMatch')} />}
                {res.matches.length > 0 && res.amount == null && <Notice tone="warn" text={t('ai.voice.noAmount')} />}
                {res.matches.length > 1 && <Text style={s.label}>{t('ai.voice.pick')}</Text>}
                {res.matches.length > 0 && (
                  <View style={{ gap: SP.sm, marginBottom: SP.md }}>
                    {res.matches.map(({ customer: c }) => {
                      const on = c.id === picked;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => setPicked(c.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={c.name}
                          style={({ pressed }) => [
                            { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md, borderRadius: R.md, borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandSoft : C.panel },
                            pressed && !on && { backgroundColor: C.bg },
                          ]}
                        >
                          <Avatar name={c.name} color={PIN_COLORS[c.pin]} size={40} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink }}>{c.name}</Text>
                            <Text style={s.muted} numberOfLines={1}>{c.code}{c.routeSeq ? ` · #${c.routeSeq}` : ''} · {t(`mobile.pins.${c.pin}`)}</Text>
                          </View>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: c.dueNow ? C.ink : C.muted }}>{money(c.dueNow)}</Text>
                          {on && <Icon name="checkmark-circle" size={22} color={C.brand} />}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {chosen && (
                  <Btn
                    big
                    title={res.amount != null ? t('ai.voice.collect', { amount: money(res.amount) }) : t('ai.mobile.openCustomer')}
                    onPress={() => {
                      const amount = res.amount;
                      reset();
                      onCollect(chosen, amount);
                    }}
                  />
                )}
                <Btn kind="outline" title={t('ai.voice.tryAgain')} onPress={reset} style={{ marginBottom: 0 }} />
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
