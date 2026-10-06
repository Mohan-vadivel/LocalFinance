import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, get, post } from '../api';
import { useSession } from '../session';
import { Badge, Btn, C, Card, Chips, ErrorText, Field, Loading, Notice, Row, SP, Screen, Section, dateIN, money, s, toPaise, todayIST } from '../ui';

interface Category { id: string; name: string; kind: string; active: boolean }
type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
interface Req {
  id: string;
  branchName?: string;
  date: string;
  direction: 'IN' | 'OUT';
  categoryName?: string;
  amount: number;
  mode: string;
  particulars: string;
  status: Status;
  requestedById: string;
  requestedByName?: string;
  decidedByName?: string;
  reason: string | null;
  responsibleName?: string;
}
const TONE: Record<Status, string> = { PENDING: C.warn, APPROVED: C.ok, REJECTED: C.danger };

/**
 * Day book from the phone. Staff enter money they paid or received (fuel, a small bill); it waits for the branch
 * manager, who approves or rejects it here or on the web. A rejected entry shows why and who must answer for it.
 */
export default function Daybook() {
  const { t } = useTranslation();
  const { can, profile } = useSession();
  const approver = can('daybook.approve');
  const [tab, setTab] = useState<Status>('PENDING');
  const [rows, setRows] = useState<Req[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      // Decided entries: the last 30 days. Waiting ones: all, so none are missed.
      setRows(await get<Req[]>('/daybook/requests', { status: tab, ...(tab === 'PENDING' ? {} : { from: dateBack(30) }) }));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Screen title={approver ? t('daybook.requests') : t('daybook.myEntries')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        {msg ? <Notice text={msg} /> : null}
        {adding ? (
          <EntryForm
            approver={approver}
            branches={profile?.branches ?? []}
            onCancel={() => setAdding(false)}
            onDone={(pending) => {
              setAdding(false);
              setMsg(pending ? t('daybook.sentForApproval') : t('common.saved'));
              void load();
            }}
          />
        ) : (
          <Btn big title={t('daybook.newEntry')} onPress={() => { setMsg(''); setAdding(true); }} style={{ marginBottom: SP.md }} />
        )}
        <Chips segmented value={tab} onChange={setTab} items={(['PENDING', 'APPROVED', 'REJECTED'] as const).map((k) => ({ key: k, label: t(`daybook.statuses.${k}`) }))} />
        <ErrorText error={error} />
        {!rows && !error && <Loading />}
        {rows?.length === 0 && <Notice tone="info" text={tab === 'PENDING' ? t('daybook.nothingWaiting') : t('common.noData')} />}
        {tab === 'REJECTED' && rows && rows.length > 0 && <RejectedTotals rows={rows} />}
        {(rows ?? []).map((r) => (
          <RequestCard key={r.id} r={r} canDecide={approver && r.status === 'PENDING' && r.requestedById !== profile?.id} onDecided={() => void load()} />
        ))}
      </ScrollView>
    </Screen>
  );
}

const dateBack = (days: number) => new Date(Date.now() + 330 * 60_000 - days * 86_400_000).toISOString().slice(0, 10);

function RejectedTotals({ rows }: { rows: Req[] }) {
  const { t } = useTranslation();
  const by = new Map<string, { count: number; amount: number }>();
  for (const r of rows) {
    const k = r.responsibleName ?? '-';
    const v = by.get(k) ?? { count: 0, amount: 0 };
    v.count += 1;
    v.amount += r.amount;
    by.set(k, v);
  }
  return (
    <Card>
      <Text style={s.h2}>{t('daybook.rejectedTotals')}</Text>
      {[...by.entries()].map(([name, v], i) => (
        <Row key={name} divider={i > 0} label={`${name} (${v.count})`} value={money(v.amount)} strong tone={C.danger} />
      ))}
    </Card>
  );
}

function RequestCard({ r, canDecide, onDecided }: { r: Req; canDecide: boolean; onDecided: () => void }) {
  const { t } = useTranslation();
  const [rejecting, setRejecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await post(path, body);
      onDecided();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SP.sm }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, flex: 1, minWidth: 0 }}>{r.categoryName ?? '-'}</Text>
        <Text style={{ fontSize: 18, fontWeight: '800', color: r.direction === 'IN' ? C.ok : C.ink }}>{r.direction === 'IN' ? '+' : '−'}{money(r.amount)}</Text>
      </View>
      <Text style={[s.muted, { marginTop: 2 }]}>{dateIN(r.date)} · {t(`common.modes.${r.mode}`)}{r.branchName ? ` · ${r.branchName}` : ''}</Text>
      <Text style={{ color: C.ink, fontSize: 15, marginVertical: SP.sm }}>{r.particulars}</Text>
      <Row label={t('daybook.enteredBy')} value={r.requestedByName ?? '-'} />
      {r.decidedByName && <Row label={t('daybook.decidedBy')} value={r.decidedByName} divider />}
      {r.status === 'REJECTED' && (
        <>
          <Row label={t('daybook.responsible')} value={r.responsibleName ?? '-'} divider strong tone={C.danger} />
          {r.reason && <Notice tone="danger" text={`${t('daybook.reason')}: ${r.reason}`} />}
        </>
      )}
      <View style={{ marginTop: SP.sm }}>
        <Badge text={t(`daybook.statuses.${r.status}`)} color={TONE[r.status]} />
      </View>
      <ErrorText error={error} />
      {canDecide && !rejecting && !confirming && (
        <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.md }}>
          <Btn small title={t('daybook.approve')} onPress={() => setConfirming(true)} style={{ flexGrow: 1 }} />
          <Btn small kind="outline" title={t('daybook.reject')} onPress={() => setRejecting(true)} style={{ flexGrow: 1 }} />
        </View>
      )}
      {/* Asks inline (Alert does nothing on the web build). */}
      {confirming && (
        <View style={{ marginTop: SP.md }}>
          <Notice tone="info" text={t('daybook.confirmApprove', { amount: money(r.amount), name: r.requestedByName ?? '' })} />
          <View style={{ flexDirection: 'row', gap: SP.sm }}>
            <Btn small title={t('daybook.approve')} busy={busy} onPress={() => void act(`/daybook/requests/${r.id}/approve`, {})} style={{ flexGrow: 1 }} />
            <Btn small kind="outline" title={t('common.cancel')} onPress={() => setConfirming(false)} style={{ flexGrow: 1 }} />
          </View>
        </View>
      )}
      {rejecting && (
        <View style={{ marginTop: SP.md }}>
          <Field label={t('daybook.reason')} value={reason} onChangeText={setReason} autoFocus />
          <Text style={[s.muted, { marginBottom: SP.sm }]}>{t('daybook.responsible')}: {r.requestedByName}</Text>
          <View style={{ flexDirection: 'row', gap: SP.sm }}>
            <Btn small kind="danger" title={t('daybook.reject')} busy={busy} disabled={reason.trim().length < 3} onPress={() => void act(`/daybook/requests/${r.id}/reject`, { reason: reason.trim() })} style={{ flexGrow: 1 }} />
            <Btn small kind="outline" title={t('common.cancel')} onPress={() => setRejecting(false)} style={{ flexGrow: 1 }} />
          </View>
        </View>
      )}
    </Card>
  );
}

function EntryForm({ approver, branches, onCancel, onDone }: { approver: boolean; branches: { id: string; name: string }[]; onCancel: () => void; onDone: (pending: boolean) => void }) {
  const { t } = useTranslation();
  const [cats, setCats] = useState<Category[] | null>(null);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [direction, setDirection] = useState<'OUT' | 'IN'>('OUT');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'CASH' | 'UPI'>('CASH');
  const [particulars, setParticulars] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    get<Category[]>('/daybook/categories').then(setCats).catch(setError);
  }, []);
  const kinds = direction === 'IN' ? ['INCOME'] : ['EXPENSE'];
  const options = (cats ?? []).filter((c) => c.active && kinds.includes(c.kind));
  const ok = !!branchId && !!categoryId && toPaise(amount) > 0 && particulars.trim().length >= 2;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ pending?: boolean }>('/daybook/entries', { branchId, date: todayIST(), direction, categoryId, amount: toPaise(amount), mode, particulars: particulars.trim(), billUrl: null });
      onDone(!!r?.pending);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? new Error(t('common.offline')) : e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text style={s.h2}>{t('daybook.newEntry')}</Text>
      {!approver && <Notice tone="info" text={t('daybook.needsApproval')} />}
      {branches.length > 1 && (
        <>
          <Section title={t('common.branch')} />
          <Chips value={branchId} onChange={setBranchId} items={branches.map((b) => ({ key: b.id, label: b.name }))} />
        </>
      )}
      <Chips segmented value={direction} onChange={(v) => { setDirection(v); setCategoryId(''); }} items={[{ key: 'OUT', label: t('daybook.out') }, { key: 'IN', label: t('daybook.in') }]} />
      <Section title={t('daybook.category')} />
      {!cats && !error ? <Loading /> : <Chips value={categoryId} onChange={setCategoryId} items={options.map((c) => ({ key: c.id, label: c.name }))} />}
      <Field label={t('common.amount')} prefix="₹" large keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <Chips segmented value={mode} onChange={setMode} items={[{ key: 'CASH', label: t('common.modes.CASH') }, { key: 'UPI', label: t('common.modes.UPI') }]} />
      <Field label={t('daybook.particulars')} value={particulars} onChangeText={setParticulars} />
      <ErrorText error={error} />
      <View style={{ flexDirection: 'row', gap: SP.sm }}>
        <Btn title={approver ? t('common.save') : t('daybook.send')} onPress={() => void save()} busy={busy} disabled={!ok} style={{ flexGrow: 1 }} />
        <Btn kind="outline" title={t('common.cancel')} onPress={onCancel} style={{ flexGrow: 1 }} />
      </View>
    </Card>
  );
}
