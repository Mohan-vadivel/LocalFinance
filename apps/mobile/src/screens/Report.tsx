import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { addDays, periodRange, type SummaryPeriod } from '@localfinance/shared';
import { get } from '../api';
import { getQueue, subscribe } from '../store';
import { Amount, Btn, C, Card, Chips, ErrorText, IconButton, Loading, Notice, Row, SP, Screen, Stat, StatRow, dateIN, money, s, todayIST } from '../ui';

interface Totals { total: number; cash: number; upi: number; bank: number; count: number }
interface Summary {
  from: string;
  to: string;
  mine: boolean;
  totals: Totals & { customers: number };
  previousTotal: number;
  byDay: (Totals & { date: string })[];
  byRoute: (Totals & { routeId: string | null; route: string })[];
  byAgent: (Totals & { agentId: string; agent: string })[];
}

/** Daily, weekly and monthly collection totals with the cash and UPI split. */
export default function CollectionReport() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<SummaryPeriod>('DAY');
  const [date, setDate] = useState(todayIST());
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState(0);
  const range = periodRange(period, date);
  const atCurrent = range.to >= todayIST();

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await get<Summary>(`/reports/collection-summary?period=${period}&date=${date}`));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, [period, date]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useEffect(() => {
    const count = () => void getQueue().then((q) => setPending(q.filter((i) => i.kind === 'collection').length));
    count();
    return subscribe(count);
  }, []);

  const label = range.from === range.to ? dateIN(range.from) : `${dateIN(range.from)} – ${dateIN(range.to)}`;
  return (
    <Screen title={t('collSummary.title')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <Chips<SummaryPeriod>
          segmented
          value={period}
          onChange={setPeriod}
          items={[
            { key: 'DAY', label: t('collSummary.daily') },
            { key: 'WEEK', label: t('collSummary.weekly') },
            { key: 'MONTH', label: t('collSummary.monthly') },
          ]}
        />
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.sm }}>
          <IconButton icon="chevron-back" label={t('collSummary.prev')} color={C.brandInk} onPress={() => setDate(addDays(range.from, -1))} />
          <Text style={{ flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 16, color: C.ink }}>{label}</Text>
          <IconButton icon="chevron-forward" label={t('collSummary.next')} color={atCurrent ? C.lineStrong : C.brandInk} onPress={() => !atCurrent && setDate(addDays(range.to, 1))} />
        </Card>
        {!atCurrent && <Btn small kind="outline" title={t('collSummary.current')} onPress={() => setDate(todayIST())} style={{ alignSelf: 'center', marginBottom: SP.md }} />}
        <ErrorText error={error} />
        {pending > 0 && atCurrent && <Notice tone="warn" text={`${t('mobile.pendingSync')}: ${pending}`} />}
        {!data && !error && <Loading />}
        {data && (
          <>
            {data.mine && <Notice tone="info" text={t('collSummary.onlyMine')} />}
            <Card tone="brand" style={{ padding: SP.xl - 4 }}>
              <Amount onBrand size="xl" label={t('report.collected')} value={money(data.totals.total)} />
              <View style={{ flexDirection: 'row', columnGap: SP.xl, rowGap: SP.sm, marginTop: SP.md, flexWrap: 'wrap' }}>
                <Amount onBrand size="md" label={t('common.modes.CASH')} value={money(data.totals.cash)} />
                <Amount onBrand size="md" label={t('common.modes.UPI')} value={money(data.totals.upi)} />
                {data.totals.bank > 0 && <Amount onBrand size="md" label={t('common.modes.BANK')} value={money(data.totals.bank)} />}
              </View>
            </Card>
            <StatRow>
              <Stat label={t('collSummary.receipts')} value={String(data.totals.count)} />
              <Stat label={t('collSummary.customersPaid')} value={String(data.totals.customers)} />
            </StatRow>
            <Card>
              <Row label={t('collSummary.previousPeriod')} value={money(data.previousTotal)} strong />
            </Card>
            {data.totals.count === 0 && <Text style={[s.muted, { textAlign: 'center', marginBottom: SP.md }]}>{t('collSummary.nothing')}</Text>}
            {period !== 'DAY' && (
              <Card>
                <Text style={s.h2}>{t('collSummary.byDay')}</Text>
                {data.byDay.map((d) => (
                  <Line key={d.date} name={dateIN(d.date)} t={d} />
                ))}
              </Card>
            )}
            {data.byAgent.length > 0 && (
              <Card>
                <Text style={s.h2}>{t('collSummary.byAgent')}</Text>
                {data.byAgent.map((a) => (
                  <Line key={a.agentId} name={a.agent} t={a} />
                ))}
              </Card>
            )}
            {data.byRoute.length > 0 && (
              <Card>
                <Text style={s.h2}>{t('collSummary.byRoute')}</Text>
                {data.byRoute.map((r) => (
                  <Line key={r.routeId ?? '-'} name={r.route} t={r} />
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** One row: name and total, with the cash and UPI amounts under it. */
function Line({ name, t: v }: { name: string; t: Totals }) {
  const { t } = useTranslation();
  return (
    <View style={{ borderTopWidth: 1, borderColor: C.line, paddingVertical: SP.md, opacity: v.count ? 1 : 0.5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SP.md }}>
        <Text style={{ fontWeight: '700', fontSize: 16, color: C.ink, flexShrink: 1, minWidth: 0 }}>{name}</Text>
        <Text style={{ fontWeight: '800', fontSize: 17, color: C.ink }}>{money(v.total)}</Text>
      </View>
      <Text style={[s.muted, { marginTop: 2 }]}>
        {t('common.modes.CASH')} {money(v.cash)} · {t('common.modes.UPI')} {money(v.upi)}
        {v.bank ? ` · ${t('common.modes.BANK')} ${money(v.bank)}` : ''} · {t('collSummary.receipts')} {v.count}
      </Text>
    </View>
  );
}

