import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { ActivityIndicator, Surface, Text } from 'react-native-paper';
import { ApiError } from './api';
import { getQueue, subscribe } from './store';
import { Btn, C, Card, ErrorText, Icon, MAX_W, Notice, R, SP, s, shade, useNav, type IconName } from './ui';

// The standard screen states: empty, loading (and slow), error, no internet, no search results, permission
// denied, session ended, form problems and success. Text lives under `states.*` in the language files.

const statusOf = (e: unknown) => (e as { status?: number } | null)?.status;

/** Plain card shown for a state that fills its place on screen: an icon, a title, a line of help and actions. */
function StateCard({ icon, iconColor = C.brand, iconBg = C.brandSoft, title, text, children }: { icon: IconName; iconColor?: string; iconBg?: string; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: SP.xl, paddingHorizontal: SP.lg, gap: SP.sm }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center', marginBottom: SP.xs }}>
        <Icon name={icon} size={34} color={iconColor} />
      </View>
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: C.ink, textAlign: 'center' }}>{title}</Text>
      {text ? <View style={{ alignSelf: 'stretch' }}>{typeof text === 'string' ? <Text style={{ fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 21 }}>{text}</Text> : text}</View> : null}
      {children ? <View style={{ alignSelf: 'stretch', marginTop: SP.sm, gap: SP.xs }}>{children}</View> : null}
    </Card>
  );
}

// ---------- Empty ----------
/** No data yet (not an error, and not a search that found nothing): an icon, a title, a line of help and an optional action. */
export function EmptyState({ icon = 'file-tray-outline', title, help, action }: { icon?: IconName; title: string; help?: string; action?: { title: string; onPress: () => void } }) {
  return (
    <StateCard icon={icon} title={title} text={help}>
      {action ? <Btn kind="tonal" title={action.title} onPress={action.onPress} /> : null}
    </StateCard>
  );
}

// ---------- Loading and slow loading ----------
/**
 * True once `loading` has been true for `ms` (8 seconds by default). `keepWaiting` starts the wait again, so the
 * "taking longer" message comes back after another `ms` if the load is still going.
 */
export function useSlowLoad(loading: boolean, ms = 8000) {
  const [slow, setSlow] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(timer);
  }, [loading, ms, round]);
  return { slow, keepWaiting: () => setRound((r) => r + 1) };
}

/**
 * A centred spinner with "Loading…". With `slow`, the text changes and "Keep waiting" and "Cancel" are offered.
 * Cancel only leaves the screen; the request itself is not aborted.
 */
export function LoadingState({ slow, onKeepWaiting, onCancel }: { slow?: boolean; onKeepWaiting?: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ alignItems: 'center', paddingVertical: SP.xl * 2, paddingHorizontal: SP.lg, gap: SP.md }} accessibilityLiveRegion="polite">
      <ActivityIndicator animating size="large" color={C.brand} />
      <Text style={{ color: C.ink2, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{slow ? t('states.slow.title') : t('common.loading')}</Text>
      {slow ? <Text style={[s.muted, { textAlign: 'center' }]}>{t('states.slow.help')}</Text> : null}
      {slow ? (
        <View style={{ alignSelf: 'stretch', marginTop: SP.sm }}>
          {onKeepWaiting ? <Btn kind="tonal" title={t('states.actions.keepWaiting')} onPress={onKeepWaiting} /> : null}
          {onCancel ? <Btn kind="outline" title={t('common.cancel')} onPress={onCancel} style={{ marginBottom: 0 }} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const Bar = ({ w, h, round }: { w: number | `${number}%`; h: number; round?: boolean }) => (
  <View style={{ width: w, height: h, borderRadius: round ? h / 2 : 6, backgroundColor: C.surface }} />
);

/** Grey placeholder cards in the shape of a list row, so the list does not jump when the data arrives. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t('states.loading.skeleton')} accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 14 }}>
          <Bar w={40} h={40} round />
          <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
            <Bar w="60%" h={14} />
            <Bar w="90%" h={11} />
          </View>
          <Bar w={56} h={14} />
        </Card>
      ))}
    </View>
  );
}

// ---------- Errors ----------
/** The reason to show: the server's message when the error has a known code, otherwise a plain sentence. */
function useReason() {
  const { t, i18n } = useTranslation();
  return (e: unknown) => {
    const code = (e as ApiError | null)?.code;
    return code && code !== 'errors.validation' && i18n.exists(code) ? t(code) : t('states.error.generic');
  };
}

/** Something failed and the screen has nothing to show: an icon, a plain title, the reason and "Try again". */
export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const reason = useReason();
  return (
    <StateCard icon="alert-circle-outline" iconColor={C.danger} iconBg={C.dangerSoft} title={t('states.error.title')} text={reason(error)}>
      {onRetry ? <Btn title={t('states.actions.tryAgain')} onPress={onRetry} /> : null}
    </StateCard>
  );
}

/** Pending entries on the phone, kept current as the queue changes. */
function usePendingCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const read = () => void getQueue().then((q) => setN(q.length));
    read();
    return subscribe(read);
  }, []);
  return n;
}

/** No connection: the data is safe on the phone, saved entries will sync later, and "Try again". */
export function NoInternet({ onRetry, pending }: { onRetry?: () => void; pending?: number }) {
  const { t } = useTranslation();
  const counted = usePendingCount();
  const n = pending ?? counted;
  return (
    <StateCard icon="cloud-offline-outline" iconColor={C.warn} iconBg={C.warnSoft} title={t('states.offline.title')} text={t('states.offline.safe')}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: n ? C.warn : C.ok, textAlign: 'center' }}>
        {n ? t('states.offline.pending', { count: n }) : t('states.offline.nonePending')}
      </Text>
      {onRetry ? <Btn title={t('states.actions.tryAgain')} onPress={onRetry} /> : null}
    </StateCard>
  );
}

/** The user's role cannot see this (API 403): a lock, the reason and a way back. */
export function PermissionDenied({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const back = onBack ?? (() => (nav && nav.stack.length > 1 ? nav.pop() : nav?.reset('Home')));
  return (
    <StateCard icon="lock-closed-outline" iconColor={C.muted} iconBg={C.surface} title={t('errors.forbidden')} text={t('states.denied.advice')}>
      <Btn kind="outline" title={t('states.actions.goBack')} onPress={back} />
    </StateCard>
  );
}

/**
 * Picks the right state for a failed request: no connection (status 0, or `offline`), no permission (403), or a
 * generic error. Use it in place of a list or a screen body that has nothing else to show.
 */
export function FailureState({ error, offline, onRetry, onBack }: { error?: unknown; offline?: boolean; onRetry?: () => void; onBack?: () => void }) {
  if (offline || statusOf(error) === 0) return <NoInternet onRetry={onRetry} />;
  if (statusOf(error) === 403) return <PermissionDenied onBack={onBack} />;
  return <ErrorState error={error} onRetry={onRetry} />;
}

/**
 * An error from a button press on a form or card: a 403 shows the permission state, anything else the usual red
 * message (the server's own text is kept, since it explains what to fix).
 */
export function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  if (statusOf(error) === 403) return <PermissionDenied />;
  return <ErrorText error={error} />;
}

// ---------- Search ----------
/** A search that found nothing: the text searched for, a tip, and "Clear search". */
export function NoSearchResults({ query, onClear }: { query: string; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <StateCard icon="search-outline" iconColor={C.warn} iconBg={C.warnSoft} title={t('states.noResults.title', { query })} text={t('states.noResults.tip')}>
      <Btn kind="outline" title={t('states.actions.clearSearch')} onPress={onClear} />
    </StateCard>
  );
}

// ---------- Session ----------
/** On the login screen after the session ended: why we are here, and whether entries are still waiting on the phone. */
export function SessionEndedNotice({ unsent }: { unsent: number }) {
  const { t } = useTranslation();
  return (
    <>
      <Notice tone="warn" text={t('states.session.notice')} />
      {unsent > 0 ? <Notice tone="warn" text={t('states.session.unsent', { count: unsent })} /> : null}
    </>
  );
}

// ---------- Forms ----------
export interface Problem {
  /** The form box this problem is about (its message also shows under that box). */
  field?: string;
  text: string;
}

/** A summary card at the top of a form, listing each problem. Show it after the user has tried to save. */
export function FormProblems({ problems }: { problems: Problem[] }) {
  const { t } = useTranslation();
  if (!problems.length) return null;
  return (
    <Surface elevation={0} accessibilityRole="alert" style={{ backgroundColor: C.dangerSoft, borderRadius: R.md, borderLeftWidth: 4, borderLeftColor: C.danger, padding: SP.md, paddingLeft: 14, marginBottom: SP.md, gap: 4 }}>
      <Text style={{ color: C.danger, fontWeight: '800', fontSize: 15 }}>{t('errors.checkFields')}</Text>
      {problems.map((p) => (
        <Text key={p.text} style={{ color: shade(C.danger, 0.1), fontSize: 15, fontWeight: '600', lineHeight: 21 }}>
          {'• '}
          {p.text}
        </Text>
      ))}
    </Surface>
  );
}

/** The message for a form box, if its problem is shown. */
export const fieldError = (problems: Problem[], field: string) => problems.find((p) => p.field === field)?.text;

/** "Name is required", and similar: the same wording for every form. */
export function useRequired() {
  const { t } = useTranslation();
  return (label: string) => t('states.form.required', { field: label });
}

// ---------- Success ----------
/**
 * A full-screen confirmation: a green check in a circle, a short line, and the next actions. Place it in a
 * `Screen` with `scroll={false}`, so it fills the space below the header.
 */
export function SuccessState({ title, text, children }: { title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: SP.xl, gap: SP.md, width: '100%', maxWidth: MAX_W, alignSelf: 'center' }} accessibilityLiveRegion="polite">
      <View style={{ alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: C.ok, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm, boxShadow: '0px 6px 16px rgba(6, 118, 71, 0.3)' }}>
        <Icon name="checkmark" size={56} color="#ffffff" />
      </View>
      <Text accessibilityRole="header" style={{ fontSize: 26, lineHeight: 32, fontWeight: '800', color: C.ink, textAlign: 'center' }}>{title}</Text>
      {text}
      {children ? <View style={{ marginTop: SP.lg, gap: SP.sm, alignSelf: 'stretch' }}>{children}</View> : null}
    </View>
  );
}
