// Leads screen ke upar: aaj ke time-wale callbacks (LDR / Sales apne). Chip = clock icon + time + naam. Guzar chuka = laal,
// agla aane wala = highlight ("Agla"). Chip dabao -> lead khulti hai.
import { useCallback, useEffect, useState } from 'react';
import { useT, fill } from '../i18n';
import { fetchTodayCallbacks, fmtTime } from '../lib/todayCallbacks';

const SHOW = 8;

export default function TodayCallbacks({ role, uid, refreshKey, onOpen }) {
  const { t } = useT();
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
      <div className="tcb-row">
        {shown.map((i) => (
          <button type="button" key={i.id} className={`tcb-chip ${i.past ? 'past' : ''} ${i.id === nextId ? 'next' : ''}`} onClick={() => onOpen?.(i.lead)}>
            <span className="tcb-time"><i className="fas fa-clock" /> {i.hasTime ? fmtTime(i.at) : t('tcToday')}</span>
            <span className="tcb-name">{i.name}</span>
            {i.id === nextId && <em className="tcb-flag">{t('tcNext')}</em>}
          </button>
        ))}
        {items.length > SHOW && <span className="tcb-more">+{items.length - SHOW}</span>}
      </div>
    </div>
  );
}
