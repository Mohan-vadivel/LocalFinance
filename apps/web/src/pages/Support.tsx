import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CirclePlay, Clock, Mail, Phone, Plus, Trash2 } from 'lucide-react';
import { HELP_VIDEO_LANGUAGES, LANGUAGES, type HelpVideo, type PlatformSettings } from '@localfinance/shared';
import { ErrorBox, Field, Loading, useToast } from '../components/ui';
import { get, put } from '../lib/api';
import { toPaise, toRupeesInput } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface SupportInfo { supportPhone: string | null; supportEmail: string | null; supportHours: string | null; helpVideos: HelpVideo[] }

const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.nativeName ?? code;

/** Support contacts and help videos for every user; videos in the current language come first. */
export default function Support() {
  const { t, i18n } = useTranslation();
  const { data, error } = useLoad(() => get<SupportInfo>('/support'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const lang = i18n.language === 'ta' ? 'ta' : 'en';
  const videos = data.helpVideos.filter((v) => v.language === lang);
  const others = data.helpVideos.filter((v) => v.language !== lang);
  const nothing = !data.supportPhone && !data.supportEmail;
  return (
    <div>
      <div className="page-head">
        <h1>{t('support.title')}</h1>
      </div>
      <div className="card">
        <p style={{ marginTop: 0 }}>{nothing ? t('support.notSet') : t('support.intro')}</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {data.supportPhone && (
            <a className="btn primary" href={`tel:${data.supportPhone.replace(/[^\d+]/g, '')}`}>
              <Phone />
              {t('support.call')} {data.supportPhone}
            </a>
          )}
          {data.supportEmail && (
            <a className="btn" href={`mailto:${data.supportEmail}`}>
              <Mail />
              {t('support.email')} {data.supportEmail}
            </a>
          )}
        </div>
        {data.supportHours && (
          <p className="muted row" style={{ marginBottom: 0 }}>
            <Clock aria-hidden style={{ width: 15, height: 15 }} />
            {t('support.hours')}: {data.supportHours}
          </p>
        )}
      </div>
      <div className="card">
        <h3>{t('support.videos')}</h3>
        {!videos.length && <p className="muted">{t('support.noVideos')}</p>}
        <VideoList videos={videos} />
        {others.length > 0 && (
          <>
            <h4 className="muted">{t('support.otherLanguages')}</h4>
            <VideoList videos={others} />
          </>
        )}
      </div>
    </div>
  );
}

function VideoList({ videos }: { videos: HelpVideo[] }) {
  const { t } = useTranslation();
  return (
    <ul className="alert-list">
      {videos.map((v) => (
        <li key={v.url + v.title}>
          <CirclePlay aria-hidden style={{ width: 18, height: 18, color: 'var(--danger)', flexShrink: 0 }} />
          <div className="txt">
            <a href={v.url} target="_blank" rel="noreferrer">
              {v.title}
            </a>
            <div className="muted" style={{ fontSize: 12 }}>
              {langName(v.language)} · {t('support.watch')}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The Super Admin's settings for the whole platform: support contacts, help videos and how businesses pay to renew. */
export function PlatformSettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<PlatformSettings>('/platform/settings'), []);
  const [f, setF] = useState<(Omit<PlatformSettings, 'yearlyPrice'> & { yearlyPrice: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  useEffect(() => {
    if (data) setF({ ...data, yearlyPrice: toRupeesInput(data.yearlyPrice) });
  }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!f) return <Loading />;
  const setVideo = (i: number, patch: Partial<HelpVideo>) => setF({ ...f, helpVideos: f.helpVideos.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const blank = (s: string | null) => (s?.trim() ? s.trim() : null);
      await put('/platform/settings', {
        ...f,
        supportPhone: blank(f.supportPhone),
        supportEmail: blank(f.supportEmail),
        supportHours: blank(f.supportHours),
        upiId: blank(f.upiId),
        yearlyPrice: toPaise(f.yearlyPrice),
      });
      toast(t('common.saved'));
      void reload();
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="page-head">
        <h1>{t('platform.title')}</h1>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          {busy ? t('common.loading') : t('common.save')}
        </button>
      </div>
      <ErrorBox error={saveError} />
      <div className="card">
        <h3>{t('nav.support')}</h3>
        <div className="form">
          <Field label={t('platform.supportPhone')}><input value={f.supportPhone ?? ''} onChange={(e) => setF({ ...f, supportPhone: e.target.value })} /></Field>
          <Field label={t('platform.supportEmail')}><input type="email" value={f.supportEmail ?? ''} onChange={(e) => setF({ ...f, supportEmail: e.target.value })} /></Field>
          <Field label={t('platform.supportHours')} full><input maxLength={200} placeholder={t('platform.supportHoursHint')} value={f.supportHours ?? ''} onChange={(e) => setF({ ...f, supportHours: e.target.value })} /></Field>
        </div>
      </div>
      <div className="card">
        <h3>{t('platform.renewal')}</h3>
        <div className="form">
          <Field label={t('plan.upiId')}><input placeholder="name@bank" value={f.upiId ?? ''} onChange={(e) => setF({ ...f, upiId: e.target.value })} /></Field>
          <Field label={t('platform.upiName')}><input value={f.upiName} onChange={(e) => setF({ ...f, upiName: e.target.value })} /></Field>
          <Field label={t('platform.yearlyPrice')}><input type="number" min="0" value={f.yearlyPrice} onChange={(e) => setF({ ...f, yearlyPrice: e.target.value })} /></Field>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2 style={{ fontSize: 16 }}>{t('support.videos')}</h2>
          <button className="btn small" onClick={() => setF({ ...f, helpVideos: [...f.helpVideos, { title: '', language: 'en', url: '' }] })}>
            <Plus />
            {t('platform.addVideo')}
          </button>
        </div>
        {!f.helpVideos.length && <p className="muted">{t('support.noVideos')}</p>}
        {f.helpVideos.map((v, i) => (
          <div key={i} className="form" style={{ alignItems: 'end', marginBottom: 8 }}>
            <Field label={t('platform.videoTitle')}><input value={v.title} onChange={(e) => setVideo(i, { title: e.target.value })} /></Field>
            <Field label={t('common.language')}>
              <select value={v.language} onChange={(e) => setVideo(i, { language: e.target.value as HelpVideo['language'] })}>
                {HELP_VIDEO_LANGUAGES.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
              </select>
            </Field>
            <Field label={t('platform.videoUrl')}><input placeholder="https://www.youtube.com/watch?v=" value={v.url} onChange={(e) => setVideo(i, { url: e.target.value })} /></Field>
            <div>
              <button className="btn small" onClick={() => setF({ ...f, helpVideos: f.helpVideos.filter((_, j) => j !== i) })} aria-label={t('common.delete')}>
                <Trash2 />
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
