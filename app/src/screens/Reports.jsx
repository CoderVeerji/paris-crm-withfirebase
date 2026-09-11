import { useMemo, useState } from 'react';
import { useT, fill } from '../i18n';
import { useConfig } from '../config';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { downloadCsv, downloadXlsx } from '../lib/csv';
import { istDay } from '../lib/stats';
import { REPORTS, buildReport, spanDays } from '../lib/reports';
import { buildDailyLeadsReportHtml } from '../lib/dailyLeadsReport';

const ICON = {
  leads_created: 'fa-users', leads_worked: 'fa-comments', leads_qualified: 'fa-user-check',
  activity: 'fa-clipboard-list', orders: 'fa-sack-dollar', team_perf: 'fa-ranking-star',
  daily_leads: 'fa-table-list', reinq_archive: 'fa-arrow-rotate-left', pipeline_now: 'fa-diagram-project',
};
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function Reports() {
  const { t } = useT();
  const cfg = useConfig();
  const today = istDay();
  const [key, setKey] = useState('leads_created');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);

  const def = REPORTS.find((r) => r.key === key);
  const isSnapshot = def.kind === 'snapshot';
  const span = spanDays(from, to);
  const overLimit = !isSnapshot && def.maxDays && span > def.maxDays;
  const badRange = !isSnapshot && from > to;

  const quick = useMemo(() => [
    { tk: 'rThisMonth', f: `${today.slice(0, 7)}-01`, t: today },
    { tk: 'rLast30', f: addDays(today, -29), t: today },
    { tk: 'rLast90', f: addDays(today, -89), t: today },
  ], [today]);

  async function download() {
    setBusy(true);
    try {
      const res = await buildReport(key, from, to, cfg);
      const { headers, rows, capped, note, multiSheet, sheets } = res;
      const stamp = isSnapshot ? today : `${from}_${to}`;
      if (multiSheet) {
        const n = sheets.reduce((a, s) => a + s.rows.filter((r) => Array.isArray(r) && r.length).length, 0);
        if (!n) { toast(t('rpEmpty'), 'err'); return; }
        downloadXlsx(`${key}-${stamp}`, sheets);
        if (note && note.startsWith('stats_daily_missing:')) toast(fill(t('rpStatsGap'), { n: note.split(':')[1] }), 'err');
        else toast(fill(t('rpDone'), { n }));
        return;
      }
      if (!rows.length) { toast(capped ? t('rpTooManyLeads') : t('rpEmpty'), 'err'); return; }
      downloadCsv(`${key}-${stamp}.csv`, headers, rows);
      if (capped) toast(fill(t('rpCapped'), { n: rows.length }), 'err');
      else if (note && note.startsWith('stats_daily_missing:')) toast(fill(t('rpStatsGap'), { n: note.split(':')[1] }), 'err');
      else toast(fill(t('rpDone'), { n: rows.length }));
    } catch (e) {
      console.error(e);
      toast(e.code === 'failed-precondition' ? t('indexNeeded') : friendlyError(e, t), 'err');
    } finally { setBusy(false); }
  }

  async function openReport() {
    setBusy(true);
    try {
      const res = await buildReport('daily_leads', from, to, cfg);
      if (res.capped) { toast(t('rpTooManyLeads'), 'err'); return; }
      const html = buildDailyLeadsReportHtml({ sheets: res.sheets, from, to });
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const w = window.open(url, '_blank');
      if (!w) { toast(t('rpPopupBlocked'), 'err'); URL.revokeObjectURL(url); return; }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (res.note && res.note.startsWith('stats_daily_missing:')) toast(fill(t('rpStatsGap'), { n: res.note.split(':')[1] }), 'err');
    } catch (e) {
      console.error(e);
      toast(friendlyError(e, t), 'err');
    } finally { setBusy(false); }
  }

  return (
    <div className="section">
      <p className="bld-intro">{t('rpIntro')}</p>

      <div className="rp-grid">
        {REPORTS.map((r) => (
          <button type="button" key={r.key} className={`rp-card ${key === r.key ? 'on' : ''}`} onClick={() => setKey(r.key)}>
            <i className={`fas ${ICON[r.key]}`} />
            <div>
              <b>{t(r.tk)}</b>
              <span>{t(`${r.tk}D`)}</span>
            </div>
          </button>
        ))}
      </div>

      {!isSnapshot ? (
        <div className="rp-range">
          <div className="rp-chips">
            {quick.map((q) => (
              <button type="button" key={q.tk} className={`chip ${from === q.f && to === q.t ? 'on' : ''}`}
                onClick={() => { setFrom(q.f); setTo(q.t); }}>{t(q.tk)}</button>
            ))}
          </div>
          <div className="dfilter-dates">
            <label>{t('dDateFrom')}<input type="date" className="form-control" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>{t('dDateTo')}<input type="date" className="form-control" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <p className={`rp-note ${overLimit ? 'bad' : ''}`}>
            <i className={`fas ${overLimit ? 'fa-triangle-exclamation' : 'fa-circle-info'}`} />{' '}
            {overLimit
              ? fill(t('rpMaxDays'), { n: def.maxDays, s: span })
              : fill(t('rpSpanOk'), { s: span, n: def.maxDays || '—' })}
          </p>
        </div>
      ) : (
        <p className="rp-note"><i className="fas fa-circle-info" /> {t('rpSnapshotNote')}</p>
      )}

      {key === 'daily_leads' && (
        <button className="btn btn-block" style={{ marginBottom: 8, background: 'var(--ink, #16202b)', color: '#fff' }}
          disabled={busy || overLimit || badRange} onClick={openReport}>
          <i className="fas fa-chart-column" /> {busy ? t('rpBuilding') : t('rpOpenReport')}
        </button>
      )}
      <button className="btn btn-primary btn-block" disabled={busy || overLimit || badRange} onClick={download}>
        <i className="fas fa-file-arrow-down" /> {busy ? t('rpBuilding') : t('rpDownload')}
      </button>

      <p className="rp-limit">{t('rpLimitNote')}</p>
    </div>
  );
}
