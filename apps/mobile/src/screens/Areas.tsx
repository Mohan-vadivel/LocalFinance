import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { get } from '../api';
import { useSession } from '../session';
import { AmountPair, C, Card, Chevron, ErrorText, Loading, Notice, Row, SP, Screen, Section, money, s, useNav } from '../ui';

// =====================================================================
// Area tracking for managers: each area with its routes, customers and today's money
// =====================================================================
interface AreaRow {
  id: string;
  name: string;
  active: boolean;
  branchId: string;
  branchName: string;
  routeCount: number;
  customerCount: number;
  activeLoans: number;
  collectedToday: number;
  dueToday: number;
  overdue: number;
}
interface AreaSummary {
  date: string;
  areas: AreaRow[];
  totals: { routeCount: number; customerCount: number; activeLoans: number; collectedToday: number; dueToday: number; overdue: number };
}

export function Areas() {
  const { t } = useTranslation();
  const nav = useNav();
  const { profile } = useSession();
  const [d, setD] = useState<AreaSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setD(await get<AreaSummary>('/structure/areas-summary'));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const several = (profile?.branches.length ?? 0) > 1;

  return (
    <Screen title={t('areas.menu')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <ErrorText error={error} />
        {!d && !error && <Loading />}
        {d && (
          <>
            <Card tone="brand" style={{ padding: SP.xl - 4 }}>
              <AmountPair onBrand main={{ label: t('areas.collectedToday'), value: money(d.totals.collectedToday) }} side={{ label: t('areas.dueToday'), value: money(d.totals.dueToday) }} />
            </Card>
            {!d.areas.length && <Notice tone="info" text={t('areas.none')} />}
            <Section title={t('areas.menu')} />
            {d.areas.map((a) => (
              <Card key={a.id} onPress={() => nav.open('AreaDetail', { areaId: a.id, name: a.name })} accessibilityLabel={a.name}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.sm }}>
                  <Text style={{ fontWeight: '800', fontSize: 17, color: C.ink, flex: 1, minWidth: 0 }}>{a.name}</Text>
                  <Chevron />
                </View>
                {several && <Text style={s.muted}>{a.branchName}</Text>}
                {!a.active && <Notice tone="info" text={t('structure.inactive')} />}
                <Row label={t('areas.routes')} value={String(a.routeCount)} />
                <Row label={t('areas.customers')} value={String(a.customerCount)} />
                <Row label={t('areas.activeLoans')} value={String(a.activeLoans)} />
                <Row label={t('areas.collectedToday')} value={money(a.collectedToday)} strong />
                <Row label={t('areas.dueToday')} value={money(a.dueToday)} />
                <Row label={t('areas.overdue')} value={money(a.overdue)} tone={a.overdue > 0 ? C.danger : undefined} />
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// =====================================================================
// One area: its routes and its customers
// =====================================================================
interface AreaRoute { id: string; name: string; active: boolean; customerCount: number }
interface AreaCustomer { id: string; code: string; name: string; routeName?: string }

export function AreaDetail({ areaId, name }: { areaId: string; name: string }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [routes, setRoutes] = useState<AreaRoute[] | null>(null);
  const [customers, setCustomers] = useState<{ total: number; rows: AreaCustomer[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [r, c] = await Promise.all([get<AreaRoute[]>('/routes', { locationId: areaId }), get<{ total: number; rows: AreaCustomer[] }>('/customers', { locationId: areaId })]);
      setRoutes(r);
      setCustomers(c);
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, [areaId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title={name} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <ErrorText error={error} />
        {!routes && !error && <Loading />}
        {routes && (
          <>
            <Section title={t('areas.routes')} />
            {!routes.length && <Notice tone="warn" text={t('areas.noRoutes')} />}
            {routes.map((r) => (
              <Card key={r.id} onPress={() => nav.open('RouteDay', { routeId: r.id, name: r.name })} accessibilityLabel={r.name}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink, flex: 1, minWidth: 0 }}>{r.name}</Text>
                  <Chevron />
                </View>
                <Text style={s.muted}>{t('areas.customers')}: {r.customerCount}{r.active ? '' : ` · ${t('common.inactive')}`}</Text>
              </Card>
            ))}
          </>
        )}
        {customers && (
          <>
            <Section title={t('areas.customers')} />
            {!customers.rows.length && <Notice tone="warn" text={t('areas.noCustomers')} />}
            {customers.total > customers.rows.length && <Text style={s.muted}>{t('areas.showing', { count: customers.rows.length, total: customers.total })}</Text>}
            {customers.rows.map((c) => (
              <Card key={c.id} onPress={() => nav.open('Customer', { customerId: c.id })} accessibilityLabel={c.name}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: C.ink, flex: 1, minWidth: 0 }}>{c.name}</Text>
                  <Chevron />
                </View>
                <Text style={s.muted}>{c.code}{c.routeName ? ` · ${c.routeName}` : ''}</Text>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
