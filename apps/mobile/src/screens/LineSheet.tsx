import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { get } from '../api';
import { DEFAULT_COLUMNS, SHEET_COLUMNS, columnLabel, lineSheetHtml, printLineSheet, shareLineSheet, type SheetColumn, type SheetOptions } from '../print';
import { useSession } from '../session';
import { myRoutes, routeDay, type RouteDay as Day } from '../store';
import { Btn, C, Card, Chips, ErrorText, Icon, Loading, Notice, R, SP, Screen, s } from '../ui';

interface RouteItem { id: string; name: string; location?: string | { name: string } }

/**
 * Line sheet: one route's customers as a PDF made on this phone, to download, share or print. Uses the same route-day
 * data as the route screen, so it follows the same rights: managers and officers pick any route they can see, an
 * agent only their own routes.
 */
export default function LineSheet({ routeId: fixed }: { routeId?: string }) {
  const { t } = useTranslation();
  const { profile, can } = useSession();
  const [routes, setRoutes] = useState<RouteItem[] | null>(fixed ? [] : null);
  const [routeId, setRouteId] = useState<string | undefined>(fixed);
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [opt, setOpt] = useState<SheetOptions>({ columns: DEFAULT_COLUMNS, groupByArea: false, landscape: false, order: 'route' });
  const [busy, setBusy] = useState<'share' | 'print' | null>(null);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState(false);
  const seesAll = can('report.view', 'route.manage');

  useEffect(() => {
    if (fixed) return;
    // Staff who see reports pick from every route in their branches; an agent from their own routes.
    const load = seesAll ? get<RouteItem[]>('/routes').then((data) => ({ data, error: null as unknown })) : myRoutes().then((r) => ({ data: (r.data ?? []) as RouteItem[], error: r.error ?? null }));
    load
      .then((r) => {
        setRoutes(r.data);
        setError(r.error);
        if (r.data.length) setRouteId((cur) => cur ?? r.data[0].id);
      })
      .catch((e) => {
        setRoutes([]);
        setError(e);
      });
  }, [fixed, seesAll]);

  useEffect(() => {
    if (!routeId) return;
    setDay(null);
    void routeDay(routeId).then((r) => {
      setDay(r.data);
      setError(r.error ?? null);
    });
  }, [routeId]);

  const html = useMemo(() => (day ? lineSheetHtml(day, opt, { business: profile?.tenant?.name ?? t('common.appName'), printedBy: profile?.name ?? '' }, t) : ''), [day, opt, profile, t]);
  const toggle = (c: SheetColumn) => setOpt((o) => ({ ...o, columns: o.columns.includes(c) ? o.columns.filter((x) => x !== c) : [...o.columns, c] }));

  const run = async (what: 'share' | 'print') => {
    if (!day) return;
    setBusy(what);
    setMsg('');
    try {
      if (what === 'share') await shareLineSheet(html, opt.landscape, `${t('mobile.sheet.title')} · ${day.route.name}`);
      else await printLineSheet(html, opt.landscape);
    } catch {
      setMsg(t('mobile.sheet.failed'));
    }
    setBusy(null);
  };

  return (
    <Screen title={t('mobile.sheet.title')} subtitle={day ? `${day.route.name} · ${t('mobile.sheet.customers', { count: day.customers.length })}` : undefined}>
      <Text style={[s.muted, { marginBottom: SP.md }]}>{t('mobile.sheet.help')}</Text>
      <ErrorText error={error} />
      {!fixed && (
        <Card>
          <Text style={s.label}>{t('mobile.sheet.route')}</Text>
          {routes === null ? <Loading /> : routes.length === 0 ? <Notice tone="info" text={t('mobile.sheet.noRoutes')} /> : <Chips value={routeId ?? ''} onChange={setRouteId} items={routes.map((r) => ({ key: r.id, label: r.name }))} />}
        </Card>
      )}
      <Card>
        <Text style={s.label}>{t('mobile.sheet.columns')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.lg }}>
          {SHEET_COLUMNS.map((c) => {
            const on = opt.columns.includes(c);
            return (
              <Pressable
                key={c}
                onPress={() => toggle(c)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={({ pressed }) => [
                  { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderRadius: R.pill, borderWidth: 1.5, paddingHorizontal: 14, borderColor: on ? C.brand : C.lineStrong, backgroundColor: on ? C.brandSoft : C.panel },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Icon name={on ? 'checkbox' : 'square-outline'} size={18} color={on ? C.brand : C.muted} />
                <Text style={{ fontSize: 15, fontWeight: '600', color: on ? C.brandInk : C.ink }}>{c === 'seq' ? t('mobile.sheet.cols.seq') : columnLabel(c, t)}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.label}>{t('common.location')}</Text>
        <Chips segmented value={opt.groupByArea ? 'area' : 'none'} onChange={(v) => setOpt({ ...opt, groupByArea: v === 'area' })} items={[{ key: 'none', label: t('mobile.sheet.groupNone') }, { key: 'area', label: t('mobile.sheet.groupByArea') }]} />
        <Text style={s.label}>{t('mobile.sheet.layout')}</Text>
        <Chips segmented value={opt.landscape ? 'l' : 'p'} onChange={(v) => setOpt({ ...opt, landscape: v === 'l' })} items={[{ key: 'p', label: t('mobile.sheet.portrait') }, { key: 'l', label: t('mobile.sheet.landscape') }]} />
        <Text style={s.label}>{t('mobile.sheet.order')}</Text>
        <Chips segmented value={opt.order} onChange={(v) => setOpt({ ...opt, order: v })} items={[{ key: 'route', label: t('mobile.sheet.routeOrder') }, { key: 'name', label: t('mobile.sheet.byName') }]} />
      </Card>
      {routeId && !day && !error && <Loading />}
      {msg ? <Notice tone="danger" text={msg} /> : null}
      {day && (
        <>
          <Btn big title={t('mobile.sheet.share')} onPress={() => void run('share')} busy={busy === 'share'} disabled={!opt.columns.length || !!busy} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
            <Btn kind="tonal" title={t('mobile.sheet.print')} onPress={() => void run('print')} busy={busy === 'print'} disabled={!opt.columns.length || !!busy} style={{ flexGrow: 1, flexBasis: 140 }} />
            <Btn kind="outline" title={t('mobile.sheet.preview')} onPress={() => setPreview(!preview)} style={{ flexGrow: 1, flexBasis: 140 }} />
          </View>
          {preview && (
            <View style={{ height: 460, borderRadius: R.md, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', marginTop: SP.sm }}>
              <WebView originWhitelist={['*']} source={{ html }} style={{ flex: 1 }} />
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
