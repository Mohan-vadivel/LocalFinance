import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Share, Text, View } from 'react-native';
import { LANGUAGES, addDays, formatINR, translate } from '@localfinance/shared';
import { ApiError, post } from '../api';
import { useSession } from '../session';
import { mobile10 } from '../smart';
import type { DayCustomer } from '../store';
import { Badge, Btn, C, Card, Chips, ErrorText, Field, Loading, Notice, SP, dateIN, s, todayIST } from '../ui';

interface Draft { text: string; phone: string; language: 'en' | 'ta'; source: 'ai' | 'rules' }
type Tone = 'gentle' | 'firm';

/**
 * The same plain reminder the server writes when AI is off, made on the phone from the route copy when there is no
 * connection. Arrears and penalty are what is pending; with nothing pending, the next instalment (today, or tomorrow
 * on a daily loan) is a gentle reminder.
 */
function localDraft(c: DayCustomer, lang: 'en' | 'ta', business: string): Draft {
  const overdue = c.loans.reduce((sum, l) => sum + l.arrears + l.penalty, 0);
  const days = c.loans.reduce((m, l) => Math.max(m, l.daysPastDue), 0);
  const today = c.loans.find((l) => l.dueToday > 0);
  const daily = c.loans.find((l) => l.frequency === 'DAILY' && l.instalmentAmount > 0);
  const next = today ? { date: todayIST(), amount: today.dueToday } : daily ? { date: addDays(todayIST(), 1), amount: daily.instalmentAmount } : null;
  const rs = (p: number) => formatINR(p, { decimals: false });
  const vars = { name: c.name, amount: rs(overdue), days, business, nextDate: next ? dateIN(next.date) : '', nextAmount: next ? rs(next.amount) : '' };
  const key = overdue > 0 ? 'ai.reminder.overdue' : next ? 'ai.reminder.upcoming' : 'ai.reminder.none';
  return { text: translate(lang, key, vars), phone: c.phone, language: lang, source: 'rules' };
}

/** Payment reminder: a draft from the office (written by AI when it is on), editable, sent by WhatsApp, SMS or share. */
export function Reminder({ customer, onDone }: { customer: DayCustomer; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const [tone, setTone] = useState<Tone>('gentle');
  // Unset until the first draft: the office uses the customer's own language.
  const [lang, setLang] = useState<'en' | 'ta' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (language: 'en' | 'ta' | null, tn: Tone) => {
      setBusy(true);
      setError(null);
      try {
        const d = await post<Draft>(`/ai/customers/${customer.id}/reminder`, { ...(language ? { language } : {}), tone: tn });
        setOffline(false);
        setDraft(d);
        setText(d.text);
        setLang(d.language);
      } catch (e) {
        const l = language ?? (customer.language === 'ta' || customer.language === 'en' ? customer.language : i18n.language === 'ta' ? 'ta' : 'en');
        if (!(e instanceof ApiError && e.status === 0)) setError(e);
        else setOffline(true);
        const d = localDraft(customer, l, profile?.tenant?.name ?? t('common.appName'));
        setDraft(d);
        setText(d.text);
        setLang(l);
      } finally {
        setBusy(false);
      }
    },
    [customer, i18n.language, profile?.tenant?.name, t],
  );
  useEffect(() => {
    void load(null, 'gentle');
    // Only once on open; later changes come from the switches.
  }, []);

  const phone = mobile10(draft?.phone || customer.phone);
  const body = encodeURIComponent(text);
  const whatsapp = () => void Linking.openURL(`whatsapp://send?phone=91${phone}&text=${body}`).catch(() => Linking.openURL(`https://wa.me/91${phone}?text=${body}`).catch(() => undefined));
  const sms = () => void Linking.openURL(`sms:+91${phone}?body=${body}`).catch(() => undefined);
  const share = () => void Share.share({ message: text }).catch(() => undefined);

  return (
    <Card style={{ borderColor: C.brand, borderWidth: 1.5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs, flexWrap: 'wrap' }}>
        <Text style={[s.h2, { marginBottom: 0, flexShrink: 1 }]}>{t('ai.reminder.title')}</Text>
        {draft?.source === 'ai' && <Badge text={t('ai.reminder.byAi')} color={C.brand} />}
      </View>
      <Text style={[s.muted, { marginBottom: SP.md }]}>{t('ai.reminder.intro')}</Text>
      <Text style={s.label}>{t('ai.reminder.language')}</Text>
      <Chips
        segmented
        value={lang ?? ''}
        onChange={(l) => void load(l as 'en' | 'ta', tone)}
        items={LANGUAGES.map((l) => ({ key: l.code, label: l.nativeName }))}
      />
      {!offline && (
        <Chips
          segmented
          value={tone}
          onChange={(tn) => {
            setTone(tn);
            void load(lang, tn);
          }}
          items={[{ key: 'gentle', label: t('ai.reminder.gentle') }, { key: 'firm', label: t('ai.reminder.firm') }]}
        />
      )}
      {offline && <Notice tone="warn" text={t('ai.mobile.reminderOffline')} />}
      <ErrorText error={error} />
      {busy && !draft ? (
        <Loading />
      ) : (
        <Field label={t('ai.mobile.message')} value={text} onChangeText={setText} multiline editable={!busy} style={{ minHeight: 130, fontSize: 16, lineHeight: 22 }} />
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm }}>
        <Btn title={t('ai.reminder.whatsapp')} onPress={whatsapp} disabled={!text.trim() || busy} style={{ flexGrow: 1, flexBasis: 130, marginBottom: 0, backgroundColor: '#128c4a', borderColor: '#128c4a' }} />
        <Btn kind="tonal" title={t('ai.reminder.sms')} onPress={sms} disabled={!text.trim() || busy} style={{ flexGrow: 1, flexBasis: 90, marginBottom: 0 }} />
        <Btn kind="tonal" title={t('ai.mobile.share')} onPress={share} disabled={!text.trim() || busy} style={{ flexGrow: 1, flexBasis: 90, marginBottom: 0 }} />
      </View>
      {!offline && <Btn kind="outline" title={t('ai.reminder.regenerate')} onPress={() => void load(lang, tone)} busy={busy} style={{ marginBottom: 0, marginTop: SP.xs }} />}
      <Btn kind="ghost" title={t('common.close')} onPress={onDone} style={{ marginBottom: 0 }} />
    </Card>
  );
}
