import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useConfig, userName } from '../config';
import { downloadCsv } from '../lib/csv';

const IST_MS = 5.5 * 3600 * 1000;
const dayKey = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const STEP = 12; // ek baar me kitne cards

/** "2026-09-08" -> "08 Sep" / "Aaj" / "Kal" */
function dateLabel(dk, t) {
  if (dk === '__nd__') return t('sumNoDate');
  const today = dayKey(Date.now());
  const yst = dayKey(Date.now() - 86400000);
  const tom = dayKey(Date.now() + 86400000);
  if (dk === today) return t('rToday');
  if (dk === yst) return t('rYst');
  if (dk === tom) return t('sumTomorrow');
  const d = new Date(`${dk}T12:00:00+05:30`);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/**
 * Leads ka simple summary — sirf CARDS, koi table nahi. Do view: person-wise ya date-wise.
 * Card pe click -> neeche wali list usi ki ho jaati hai (onSelect se parent ko batate hain).
 *
 * @param leads       array | undefined (bounded set — parent fetch karta hai)
 * @param loading     bool
 * @param capped      bool
 * @param dateField   string | string[] — kis Timestamp par group (array = pehla jo mile)
 * @param side        'ldr' | 'sales' — kis owner par group
 * @param onSelect    (sel|null) => void   sel = { type, key, label, ids:Set, count }
 */
export default function LeadsSummary({ leads, loading, capped, dateField, side, onSelect }) {
  const { t } = useT();
  const cfg = useConfig();
  const [mode, setMode] = useState('person');
  const [person, setPerson] = useState('');
  const [shownN, setShownN] = useState(STEP);
  const [pick, setPick] = useState('');

  const uidField = side === 'sales' ? 'sales_uid' : 'ldr_uid';
  const nameField = side === 'sales' ? 'sales_name' : 'ldr_name';
  const dFields = Array.isArray(dateField) ? dateField : [dateField];
  const rows = leads || [];

  const dateMs = (l) => {
    for (const f of dFields) { const d = l[f]?.toDate?.(); if (d) return d.getTime(); }
    return null;
  };
  const nameOf = (uid, l) => (uid ? (userName(cfg, uid) || l?.[nameField] || t('pvUnknown')) : t('pvUnassigned'));

  // person dropdown — poore set ke log (filter lagne se pehle)
  const allPeople = useMemo(() => {
    const m = new Map();
    for (const l of rows) {
      const uid = l[uidField] || '';
      const pk = uid || '__none__';
      if (!m.has(pk)) m.set(pk, nameOf(uid, l));
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, uidField, nameField, cfg.users, t]);

  // filter ke baad ki leads (sirf person — date drill-down "By date" card click se hota hai)
  const kept = useMemo(() => rows.filter((l) => {
    const pk = l[uidField] || '__none__';
    return !person || pk === person;
  }), [rows, person, uidField]);

  // group -> cards
  const cards = useMemo(() => {
    const g = new Map();
    for (const l of kept) {
      const ms = dateMs(l);
      const dk = ms ? dayKey(ms) : '__nd__';
      const uid = l[uidField] || '';
      const pk = uid || '__none__';
      const key = mode === 'person' ? pk : dk;
      const label = mode === 'person' ? nameOf(uid, l) : dateLabel(dk, t);
      if (!g.has(key)) g.set(key, { key, label, raw: key, ids: new Set(), sub: new Set() });
      const c = g.get(key);
      c.ids.add(l.id);
      c.sub.add(mode === 'person' ? dk : pk);
    }
    const arr = [...g.values()];
    if (mode === 'person') arr.sort((a, b) => b.ids.size - a.ids.size);
    else {
      arr.sort((a, b) => {
        if (a.raw === '__nd__') return 1;
        if (b.raw === '__nd__') return -1;
        return a.raw < b.raw ? 1 : -1; // naye pehle
      });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, mode, uidField, nameField, cfg.users, t]);

  const grand = kept.length;
  const visible = cards.slice(0, shownN);

  // mode / filter / data badla -> selection saaf
  useEffect(() => {
    setShownN(STEP); setPick('');
    onSelect?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, person, leads]);

  function tap(c) {
    if (pick === c.key) { setPick(''); onSelect?.(null); return; }
    setPick(c.key);
    onSelect?.({ type: mode, key: c.key, label: c.label, ids: c.ids, count: c.ids.size });
  }

  function exportCsv() {
    const head = [mode === 'person' ? t('sumByPerson') : t('pvDate'), t('leads'), mode === 'person' ? t('pvDays') : t('pvPeople')];
    downloadCsv(`summary-${Date.now()}.csv`, head, cards.map((c) => [c.label, c.ids.size, c.sub.size]));
  }

  if (loading) return <div className="skeleton" style={{ height: 132, marginBottom: 14 }} />;
  if (!rows.length) return null;

  return (
    <div className="sum">
      <div className="sum-top">
        <div className="sum-seg">
          {[['person', 'fa-user-group', 'sumByPerson'], ['date', 'fa-calendar-day', 'sumByDate']].map(([m, ic, tk]) => (
            <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              <i className={`fas ${ic}`} /> {t(tk)}
            </button>
          ))}
        </div>
        <span className="sum-total"><b>{grand}</b> {t('leads')}</span>
        <button type="button" className="chip sum-csv" onClick={exportCsv}><i className="fas fa-file-csv" /> CSV</button>
      </div>

      {allPeople.length > 1 && (
        <div className="sum-filters">
          <select className="form-control" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{t('lfAllPeople')}</option>
            {allPeople.map(([pk, n]) => <option key={pk} value={pk}>{n}</option>)}
          </select>
          {person && (
            <button type="button" className="chip" onClick={() => setPerson('')}>
              <i className="fas fa-xmark" /> {t('dClear')}
            </button>
          )}
        </div>
      )}

      {capped && <div className="alert alert-warn" style={{ marginTop: 8 }}>{t('pvCapped')}</div>}

      {cards.length === 0 ? (
        <div className="sum-empty">{t('pvEmpty')}</div>
      ) : (
        <>
          <div className="sum-grid">
            {visible.map((c) => (
              <button type="button" key={c.key} className={`sum-card ${pick === c.key ? 'on' : ''}`} onClick={() => tap(c)}>
                <span className="sc-name">{c.label}</span>
                <span className="sc-n">{c.ids.size}</span>
                <span className="sc-sub">{c.sub.size} {mode === 'person' ? t('pvDays') : t('pvPeople')}</span>
                <span className="sc-bar"><i style={{ width: `${grand ? Math.round((c.ids.size / grand) * 100) : 0}%` }} /></span>
              </button>
            ))}
          </div>
          {cards.length > visible.length && (
            <button type="button" className="sum-more" onClick={() => setShownN((n) => n + STEP)}>
              <i className="fas fa-chevron-down" /> {t('loadMore')} ({cards.length - visible.length})
            </button>
          )}
        </>
      )}
    </div>
  );
}
