// Reports -> "Lead distribution": date range + (optional) Sales person filter. Har din kis Sales ko kitni leads mili,
// kitni ab bhi pending (Sales ne chhua nahi), kitni worked. Screen par dikhta hai + CSV.
import { useMemo, useState } from 'react';
import { useT, fill } from '../i18n';
import { useConfig, salesUsers } from '../config';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { downloadCsv } from '../lib/csv';
import { istDay } from '../lib/stats';
import { spanDays } from '../lib/reports';
import { fetchLeadDist, LEAD_DIST_MAX_DAYS } from '../lib/leadDist';
import Select from './Select';

const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function LeadDistReport() {
  const { t } = useT();
  const cfg = useConfig();
  const today = istDay();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);

  const people = useMemo(() => salesUsers(cfg), [cfg]);
  const span = spanDays(from, to);
  const bad = from > to || span > LEAD_DIST_MAX_DAYS;

  async function run() {
    setBusy(true);
    try { setData(await fetchLeadDist(from, to, cfg)); } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); } finally { setBusy(false); }
  }

  const rows = useMemo(() => (data ? data.rows.filter((r) => !person || r.uid === person) : []), [data, person]);
  const tot = rows.reduce((s, r) => ({ received: s.received + r.received, pending: s.pending + r.pending, worked: s.worked + r.worked }), { received: 0, pending: 0, worked: 0 });
  // person-wise total (filter ke baad) — kis ke paas kitna pending
  const byPerson = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { const x = m.get(r.uid) || { name: r.name, received: 0, pending: 0, worked: 0 }; x.received += r.received; x.pending += r.pending; x.worked += r.worked; m.set(r.uid, x); });
    return [...m.values()].sort((a, b) => b.pending - a.pending || b.received - a.received);
  }, [rows]);

  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <div>
      <p className="bld-intro">{t('ldIntro')}</p>
      <div className="rp-range">
        <div className="dfilter-dates">
          <label>{t('dDateFrom')}<input type="date" className="form-control" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{t('dDateTo')}<input type="date" className="form-control" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 8 }}>
          <Select className="form-control" value={person} onChange={(e) => setPerson(e.target.value)} aria-label={t('ldPerson')}>
            <option value="">{t('ldAllPeople')}</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        </div>
        <p className={`rp-note ${bad ? 'bad' : ''}`}>
          <i className={`fas ${bad ? 'fa-triangle-exclamation' : 'fa-circle-info'}`} /> {bad ? fill(t('rpMaxDays'), { n: LEAD_DIST_MAX_DAYS, s: span }) : t('ldPendingTip')}
        </p>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy || bad} onClick={run}>
        <i className="fas fa-chart-simple" /> {busy ? t('rpBuilding') : t('ldRun')}
      </button>

      {data && (
        <>
          {data.capped && <div className="alert alert-warn" style={{ marginTop: 10 }}>{t('rpTooManyLeads')}</div>}
          <div className="stat-grid" style={{ marginTop: 14 }}>
            <div className="stat-card"><div className="val">{tot.received.toLocaleString('en-IN')}</div><div className="label">{t('ldReceived')}</div></div>
            <div className="stat-card tone-wip"><div className="val" style={{ color: 'var(--warning)' }}>{tot.pending.toLocaleString('en-IN')}</div><div className="label">{t('ldPending')}</div></div>
            <div className="stat-card tone-good"><div className="val" style={{ color: 'var(--success)' }}>{tot.worked.toLocaleString('en-IN')}</div><div className="label">{t('ldWorked')}</div></div>
          </div>

          {byPerson.length > 0 && (
            <div className="tablewrap" style={{ marginTop: 8 }}>
              <table className="meca-t">
                <thead><tr><th>{t('ldPerson')}</th><th>{t('ldReceived')}</th><th>{t('ldPending')}</th><th>{t('ldWorked')}</th><th>{t('ldPendingPct')}</th></tr></thead>
                <tbody>{byPerson.map((p) => (
                  <tr key={p.name}><td className="nm">{p.name}</td><td>{p.received}</td><td className="hl">{p.pending}</td><td>{p.worked}</td><td>{pct(p.pending, p.received)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '14px 0 8px' }}>
            <button className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 12.5 }} disabled={!rows.length}
              onClick={() => downloadCsv(`lead-distribution-${from}_${to}.csv`, ['Date', 'Sales person', 'Leads received', 'Pending (not touched yet)', 'Worked', 'Pending %'],
                rows.map((r) => [r.day, r.name, r.received, r.pending, r.worked, pct(r.pending, r.received)]))}>
              <i className="fas fa-file-csv" /> {t('exportCsv')}
            </button>
          </div>
          <div className="tablewrap">
            <table className="meca-t">
              <thead><tr><th>{t('ldDate')}</th><th>{t('ldPerson')}</th><th>{t('ldReceived')}</th><th>{t('ldPending')}</th><th>{t('ldWorked')}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.day}|${r.uid}`}><td>{r.day}</td><td className="nm">{r.name}</td><td>{r.received}</td><td className="hl">{r.pending}</td><td>{r.worked}</td></tr>
                ))}
                {!rows.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('noData')}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
