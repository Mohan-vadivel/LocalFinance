import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { toQR } from 'toqr';
import { get } from '../api';
import { useSession } from '../session';
import { Btn, C, Card, ErrorText, Loading, Notice, Row, SP, Screen, dateIN, money, s, useNav } from '../ui';

interface PlanInfo {
  plan: string;
  planExpiresOn: string | null;
  daysLeft: number | null;
  expiringSoon: boolean;
  yearlyPrice: number;
  upiId: string | null;
  upiName: string;
  upiLink: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
}

/**
 * A QR code from plain Views: each row's runs of dark modules become one View, so a UPI link (about 33×33 modules)
 * needs a few hundred Views. White border so any UPI app can scan it from the screen.
 */
function QrCode({ text, size }: { text: string; size: number }) {
  const rows = useMemo(() => {
    const cells = toQR(text);
    const n = Math.sqrt(cells.length) | 0;
    const out: { y: number; runs: { x: number; w: number }[] }[] = [];
    for (let y = 0; y < n; y++) {
      const runs: { x: number; w: number }[] = [];
      for (let x = 0; x < n; x++) {
        if (!cells[y * n + x]) continue;
        const last = runs[runs.length - 1];
        if (last && last.x + last.w === x) last.w++;
        else runs.push({ x, w: 1 });
      }
      out.push({ y, runs });
    }
    return { n, out };
  }, [text]);
  const m = Math.floor(size / (rows.n + 8));
  return (
    <View style={{ width: m * (rows.n + 8), height: m * (rows.n + 8), backgroundColor: '#fff', padding: m * 4, borderRadius: 8 }} accessibilityRole="image">
      {rows.out.map((r) => (
        <View key={r.y} style={{ height: m, width: rows.n * m }}>
          {r.runs.map((run) => (
            <View key={run.x} style={{ position: 'absolute', left: run.x * m, width: run.w * m, height: m, backgroundColor: '#000' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** The owner's plan: days left, the renewal price and how to pay by UPI. Payment is checked by hand by the platform team. */
export default function Plan() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const nav = useNav();
  const [data, setData] = useState<PlanInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [noApp, setNoApp] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const owner = profile?.role === 'TENANT_ADMIN';
  const load = useCallback(async () => {
    if (!owner) return;
    setRefreshing(true);
    try {
      setData(await get<PlanInfo>('/plan'));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, [owner]);
  useEffect(() => {
    void load();
  }, [load]);

  const payInApp = async () => {
    if (!data?.upiLink) return;
    setNoApp(false);
    // Android hands upi:// links to the chosen UPI app; with none installed the open fails.
    await Linking.openURL(data.upiLink).catch(() => setNoApp(true));
  };

  if (!owner) {
    return (
      <Screen title={t('plan.title')}>
        <Notice tone="warn" text={t('errors.forbidden')} />
      </Screen>
    );
  }
  const left = data?.daysLeft ?? null;
  return (
    <Screen title={t('plan.title')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <ErrorText error={error} />
        {!data && !error ? (
          <Loading />
        ) : data ? (
          <>
            {data.expiringSoon && left !== null && (
              <Notice
                tone={left < 0 ? 'danger' : 'warn'}
                text={left < 0 ? t('plan.expiredBanner', { date: dateIN(data.planExpiresOn) }) : t('plan.expiringBanner', { days: left, date: dateIN(data.planExpiresOn) })}
              />
            )}
            <Card>
              <Row label={t('plan.plan')} value={data.plan} />
              <Row label={t('plan.expiresOn')} value={data.planExpiresOn ? dateIN(data.planExpiresOn) : t('plan.notSet')} divider />
              <Row
                label={t('plan.daysLeft')}
                value={left === null ? '-' : left < 0 ? t('plan.expired') : String(left)}
                strong
                divider
                tone={left === null ? undefined : left < 0 ? C.danger : left < 15 ? C.warn : C.ok}
              />
              <Row label={t('plan.price')} value={data.yearlyPrice ? money(data.yearlyPrice) : '-'} strong divider />
            </Card>
            <Card>
              <Text style={s.h2}>{t('plan.howToPay')}</Text>
              {data.upiLink && data.upiId ? (
                <>
                  <View style={{ alignItems: 'center', marginBottom: SP.md }}>
                    <QrCode text={data.upiLink} size={240} />
                  </View>
                  <Text style={s.label}>{t('plan.upiId')}</Text>
                  <Text selectable style={[s.big, { fontSize: 20, marginBottom: 2 }]}>
                    {data.upiId}
                  </Text>
                  <Text style={[s.muted, { marginBottom: SP.md }]}>{data.upiName}</Text>
                  <Btn big title={`${t('plan.payByUpi')}${data.yearlyPrice ? ` · ${money(data.yearlyPrice)}` : ''}`} onPress={() => void payInApp()} />
                  {noApp && <Notice tone="warn" text={t('plan.noUpiApp')} />}
                  <Text style={s.muted}>{t('plan.payHelp')}</Text>
                </>
              ) : (
                <Notice tone="info" text={t('plan.noUpi')} />
              )}
            </Card>
            <Btn kind="outline" title={t('nav.support')} onPress={() => nav.push('Support')} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
