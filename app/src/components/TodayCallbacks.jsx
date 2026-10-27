// Leads / Follow-ups screen ke SABSE upar: aaj ke callbacks (LDR / Sales apne) — time ke hisaab se rows. Har row: clock + time, naam, stage,
// Call + WhatsApp. Guzra hua laal, agla aane wala highlight ("AGLA"). Row dabao -> lead khulti hai.
import { useCallback, useEffect, useState } from 'react';
import { useT, fill } from '../i18n';
import { useAuth } from '../auth';
import { useConfig } from '../config';
import { fetchTodayCallbacks, fmtTime } from '../lib/todayCallbacks';
import { fmtStatus } from '../lib/format';
import { markCalling } from '../lib/callLog';
import { waLink } from '../lib/waMessage';
import WaIcon from './WaIcon';

const SHOW = 6;

export default function TodayCallbacks({ role, uid, refreshKey, onOpen }) {
  const { t } = useT();
  const { user } = useAuth();
  const cfg = useConfig();
  const [items, setItems] = useState(null);
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
  const nextId = (items.find((i) => !i.past) || {}).id;
  const over = items.filter((i) => i.past).length;
  const shown = items.slice(0, SHOW);

  return (
    <div className="tcb" role="region" aria-label={t('tcTitle')}>
      <div className="tcb-head">
        <b><i className="fas fa-bell" /> {t('tcTitle')}</b>
        <span>{fill(t('tcCount'), { n: items.length })}{over ? ` · ${fill(t('tcOver'), { n: over })}` : ''}</span>
      </div>
      <div className="tcb-list">
        {shown.map((i) => {
          const l = i.lead;
          const dial = l.phone_raw || l.phone || '';
          const wa = (l.phone_digits || '').replace(/\D/g, '');
          const waHref = waLink(wa, cfg.settings?.Whatsapp_Template, { name: l.name, user: user.full_name, company: cfg.settings?.Company_Name });
          return (
            <div key={i.id} className={`tcb-row ${i.past ? 'past' : ''} ${i.id === nextId ? 'next' : ''}`} onClick={() => onOpen?.(l)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(l); }}>
              <div className="tcb-when">
                <i className="fas fa-clock" />
                <b>{i.hasTime ? fmtTime(i.at) : t('tcToday')}</b>
                {i.id === nextId && <em className="tcb-flag">{t('tcNext')}</em>}
              </div>
              <div className="tcb-who">
                <span className="tcb-name">{i.name}</span>
                <span className="tcb-sub">{fmtStatus(i.stage)}{l.phone ? ` · ${l.phone}` : ''}</span>
              </div>
              <div className="tcb-act" onClick={(e) => e.stopPropagation()}>
                {dial && <a className="btn act-call" href={`tel:${dial}`} onClick={() => markCalling(l.id)} aria-label={t('call')}><i className="fas fa-phone" /></a>}
                {wa && <a className="btn act-wa" href={waHref} target="_blank" rel="noreferrer" aria-label="WhatsApp"><WaIcon /></a>}
              </div>
            </div>
          );
        })}
      </div>
      {items.length > SHOW && <p className="tcb-more">{fill(t('tcMoreRows'), { n: items.length - SHOW })}</p>}
    </div>
  );
}
