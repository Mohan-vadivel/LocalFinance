import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarClock, Copy, LifeBuoy, TriangleAlert } from 'lucide-react';
import { QrCode } from '../components/QrCode';
import { ErrorBox, Loading, Stat, useToast } from '../components/ui';
import { get } from '../lib/api';
import { dateIN, money } from '../lib/format';
import { useLoad } from '../lib/hooks';

export interface PlanInfo {
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

/** Warning on the owner's dashboard when fewer than 15 days of the plan are left. */
export function PlanBanner() {
  const { t } = useTranslation();
  const { data } = useLoad(() => get<PlanInfo>('/plan'), []);
  if (!data?.expiringSoon || data.daysLeft === null) return null;
  return (
    <div className="warn-box" role="status">
      <TriangleAlert aria-hidden />
      <div style={{ flex: 1 }}>
        {data.daysLeft < 0
          ? t('plan.expiredBanner', { date: dateIN(data.planExpiresOn) })
          : t('plan.expiringBanner', { days: data.daysLeft, date: dateIN(data.planExpiresOn) })}
      </div>
      <Link className="btn small" to="/plan">
        {t('plan.renew')}
      </Link>
    </div>
  );
}

/** The owner's plan, days left and how to pay for a renewal by UPI. Payment is checked by hand by the platform team. */
export default function Plan() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error } = useLoad(() => get<PlanInfo>('/plan'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const left = data.daysLeft;
  const copy = (text: string) =>
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast(t('plan.copied')))
      .catch(() => undefined);
  return (
    <div>
      <div className="page-head">
        <h1>{t('plan.title')}</h1>
      </div>
      <PlanBanner />
      <div className="grid k3" style={{ marginBottom: 16 }}>
        <Stat label={t('plan.plan')} value={data.plan} />
        <Stat icon={<CalendarClock />} label={t('plan.expiresOn')} value={data.planExpiresOn ? dateIN(data.planExpiresOn) : t('plan.notSet')} />
        <Stat
          tone={left === null ? undefined : left < 0 ? 'danger' : left < 15 ? 'warn' : 'ok'}
          label={t('plan.daysLeft')}
          value={left === null ? '-' : left < 0 ? t('plan.expired') : left}
        />
      </div>
      <div className="card">
        <h3>{t('plan.howToPay')}</h3>
        <div className="row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          {data.upiLink && <QrCode text={data.upiLink} size={220} label={`${t('plan.upiId')} ${data.upiId}`} />}
          <div style={{ flex: 1, minWidth: 240, display: 'grid', gap: 12 }}>
            <div>
              <div className="muted">{t('plan.price')}</div>
              <div style={{ fontSize: 24, fontWeight: 650 }}>{data.yearlyPrice ? money(data.yearlyPrice) : '-'}</div>
            </div>
            {data.upiId ? (
              <>
                <div>
                  <div className="muted">{t('plan.upiId')}</div>
                  <div className="row">
                    <strong style={{ fontSize: 18 }}>{data.upiId}</strong>
                    <button className="btn small" onClick={() => copy(data.upiId!)}>
                      <Copy />
                      {t('plan.copy')}
                    </button>
                  </div>
                  <div className="muted">{data.upiName}</div>
                </div>
                <p style={{ margin: 0 }}>{t('plan.payHelp')}</p>
              </>
            ) : (
              <p style={{ margin: 0 }}>{t('plan.noUpi')}</p>
            )}
            <div className="row">
              <LifeBuoy aria-hidden style={{ width: 16, height: 16 }} />
              <span>
                {[data.supportPhone, data.supportEmail].filter(Boolean).join(' · ') || t('support.notSet')}
              </span>
              <Link to="/support">{t('nav.support')}</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
