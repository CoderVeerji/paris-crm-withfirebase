// Leads / Follow-ups ke SABSE upar: aaj ke callbacks (LDR / Sales apne) — chhoti, slim rows. AGLA (jo abhi aane wala hai) sabse pehle, phir uske baad ke;
// jo time nikal chuka wo ek line mein collapsed ("2 ka time nikal gaya"). Har row: time, naam, stage, Call + WhatsApp. Row dabao -> lead khulti hai.
import { useCallback, useEffect, useState } from 'react';
import { useT, fill } from '../i18n';
import { useAuth } from '../auth';
import { useConfig } from '../config';
import { fetchTodayCallbacks, fmtTime } from '../lib/todayCallbacks';
import { fmtStatus } from '../lib/format';
import { markCalling } from '../lib/callLog';
import { waLink } from '../lib/waMessage';
import WaIcon from './WaIcon';

const SHOW = 3;

export default function TodayCallbacks({ role, uid, refreshKey, onOpen }) {
  const { t } = useT();
  const { user } = useAuth();
  const cfg = useConfig();
  const [items, setItems] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => fetchTodayCallbacks({ role, uid }).then(setItems).catch(() => setItems([])), [role, uid]);

  useEffect(() => { load(); }, [load, refreshKey]);
  // 3 min mein ek baar + tab wapas visible hone par — "agla" / "guzar chuka" status taaza rahe
  useEffect(() => {
    const iv = setInterval(load, 3 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  if (!items || items.length === 0) return null;
  const upcoming = items.filter((i) => !i.past);          // time ke hisaab se (sabse nazdeek pehle)
  const past = items.filter((i) => i.past);
  const nextId = upcoming[0]?.id;
  const visibleUp = showAll ? upcoming : upcoming.slice(0, SHOW);

  const Row = ({ i }) => {
    const l = i.lead;
    const dial = l.phone_raw || l.phone || '';
    const wa = (l.phone_digits || '').replace(/\D/g, '');
    const waHref = waLink(wa, cfg.settings?.Whatsapp_Template, { name: l.name, user: user.full_name, company: cfg.settings?.Company_Name });
    return (
      <div className={`tcb-row ${i.past ? 'past' : ''} ${i.id === nextId ? 'next' : ''}`} onClick={() => onOpen?.(l)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(l); }}>
        <span className="tcb-when"><i className="fas fa-clock" /> <b>{i.hasTime ? fmtTime(i.at) : t('tcToday')}</b></span>
        <span className="tcb-who">
          <span className="tcb-name">{i.name}</span>
          <span className="tcb-sub">{fmtStatus(i.stage)}</span>
        </span>
        {i.id === nextId && <em className="tcb-flag">{t('tcNext')}</em>}
        <span className="tcb-act" onClick={(e) => e.stopPropagation()}>
          {dial && <a className="btn act-call" href={`tel:${dial}`} onClick={() => markCalling(l.id)} aria-label={t('call')}><i className="fas fa-phone" /></a>}
          {wa && <a className="btn act-wa" href={waHref} target="_blank" rel="noreferrer" aria-label="WhatsApp"><WaIcon /></a>}
        </span>
      </div>
    );
  };

  return (
    <div className="tcb" role="region" aria-label={t('tcTitle')}>
      <div className="tcb-head">
        <b><i className="fas fa-bell" /> {t('tcTitle')}</b>
        <span>{fill(t('tcCount'), { n: items.length })}</span>
      </div>
      <div className="tcb-list">
        {visibleUp.map((i) => <Row key={i.id} i={i} />)}
        {((!showAll && upcoming.length > SHOW) || past.length > 0) && (
          <div className="tcb-foot">
            {!showAll && upcoming.length > SHOW && (
              <button type="button" className="tcb-toggle" onClick={() => setShowAll(true)}>{fill(t('tcMoreRows'), { n: upcoming.length - SHOW })}</button>
            )}
            {past.length > 0 && (
              <button type="button" className="tcb-toggle past" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
                <i className="fas fa-triangle-exclamation" /> {fill(t('tcOver'), { n: past.length })} <i className={`fas fa-chevron-${showPast ? 'up' : 'down'}`} />
              </button>
            )}
          </div>
        )}
        {showPast && past.map((i) => <Row key={i.id} i={i} />)}
      </div>
    </div>
  );
}
