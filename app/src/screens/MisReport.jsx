import { useEffect, useMemo, useState } from 'react';
import { useConfig } from '../config';
import { useT, fill } from '../i18n';
import { misReport } from '../lib/misReport';
import { fetchDashLeadsAll } from '../lib/dashboardLeads';
import { weekOptions, weekRange, weekLabel, weekId, istToday } from '../lib/weeks';
import { fmtStatus } from '../lib/format';
import { toast } from '../toast';
import Sheet from '../components/Sheet';
import LeadSheet from '../components/LeadSheet';
import { LeadCard } from './Leads';

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** last 12 calendar months, newest first — {id:'2026-09', label:'Sep 2026', from, to} */
function monthOptions() {
  const today = istToday();
  const out = [];
  let y = Number(today.slice(0, 4)); let m = Number(today.slice(5, 7)); // 1-12
  for (let i = 0; i < 12; i++) {
    const id = `${y}-${String(m).padStart(2, '0')}`;
    const from = `${id}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const toFull = `${id}-${String(lastDay).padStart(2, '0')}`;
    const to = toFull > today ? today : toFull;
    out.push({ id, label: `${MONTHS_EN[m - 1]} ${y}`, from, to });
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

/** last 3 calendar years, newest first — {id:'2026', label:'2026', from, to} */
function yearOptions() {
  const today = istToday();
  const curY = Number(today.slice(0, 4));
  const out = [];
  for (let y = curY; y >= curY - 2; y--) {
    const toFull = `${y}-12-31`;
    out.push({ id: String(y), label: String(y), from: `${y}-01-01`, to: toFull > today ? today : toFull });
  }
  return out;
}

// score -> tone (existing app-wide tone-* classes: good/wip/lost)
const scoreTone = (s) => (s == null ? '' : s >= 90 ? 'tone-good' : s >= 70 ? 'tone-wip' : 'tone-lost');
const scoreColor = (s) => (s == null ? 'var(--muted)' : s >= 90 ? 'var(--success)' : s >= 70 ? 'var(--warning)' : 'var(--danger)');
// display-mode toggle (DATA hamesha poori dikhti hai — ye sirf number ka FORMAT badalta hai):
// 'positive' -> "90%" (achieved), 'negative' -> "-10%" (100 se kitni kami/shortfall)
function scoreLabel(score, mode) {
  if (score == null) return '—';
  return mode === 'negative' ? `${score - 100}%` : `${score}%`;
}

/** Ek metric-block (Leads ya Followups) ke 3 clickable number + score — reused row+team ke liye. */
function MetricBlock({ label, m, onPick, scoreMode }) {
  const { t } = useT();
  if (!m) return null;
  return (
    <div className="mis-metric">
      <div className="mis-metric-lbl">{label}</div>
      <div className="mis-metric-nums">
        <button type="button" className="mis-num" onClick={() => onPick('total')}>
          <b>{m.total}</b><span>{t('misTotal')}</span>
        </button>
        <button type="button" className="mis-num" onClick={() => onPick('worked')}>
          <b style={{ color: 'var(--success)' }}>{m.worked}</b><span>{t('misDone')}</span>
        </button>
        <button type="button" className="mis-num" onClick={() => onPick('pending')} disabled={m.pending === 0}>
          <b style={{ color: m.pending > 0 ? 'var(--danger)' : 'var(--muted)' }}>{m.pending}</b><span>{t('misPending')}</span>
        </button>
        <div className={`mis-score ${scoreTone(m.score)}`}>
          <b style={{ color: scoreColor(m.score) }}>{scoreLabel(m.score, scoreMode)}</b><span>{t('misScore')}</span>
        </div>
      </div>
    </div>
  );
}

/** MIS Report — team ki weekly/monthly/yearly accountability scorecard: kitni leads milin/kaam
 *  hui, kitne followups due the/complete hue, sab % score ke saath. Har number click karke
 *  pehle STAGE-WISE breakdown dikhta hai (ek hi fetch se — "kitne follow up the, kitne visit
 *  the"), phir ek stage pe click karne se wahi (already-fetched) leads list ban jaati hai — koi
 *  dusra fetch nahi lagta. Existing daily pre-agg se banta hai — koi naya data-pipeline nahi. */
export default function MisReport() {
  const cfg = useConfig();
  const { t } = useT();
  const [teamRole, setTeamRole] = useState('ldr');
  const [periodType, setPeriodType] = useState('week');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  // Sirf DISPLAY format — koi row kabhi hide nahi hoti, data hamesha poora dikhta hai.
  // 'positive' -> score "90%" (achieved), 'negative' -> "-10%" (100 se kitni kami).
  const [scoreMode, setScoreMode] = useState('positive');
  const weeks = useMemo(() => weekOptions(), []);
  const months = useMemo(() => monthOptions(), []);
  const years = useMemo(() => yearOptions(), []);
  const [weekSel, setWeekSel] = useState(() => weekId(weeks[0]));
  const [monthSel, setMonthSel] = useState(() => months[0].id);
  const [yearSel, setYearSel] = useState(() => years[0].id);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  // drill-down: ek fetch -> stage-breakdown -> stage click -> filtered list (sab isi state se)
  const [drill, setDrill] = useState(null); // { title, ids }
  const [drillRows, setDrillRows] = useState(null); // saari fetched leads (unfiltered)
  const [drillStage, setDrillStage] = useState(null); // chuna hua stage (null = sirf breakdown, list nahi)
  const [openLead, setOpenLead] = useState(null);

  const period = useMemo(() => {
    if (periodType === 'week') {
      const w = weeks.find((x) => weekId(x) === weekSel) || weeks[0];
      return { from: w.start, to: w.dataEnd > istToday() ? istToday() : w.dataEnd, label: weekLabel(w) };
    }
    if (periodType === 'year') {
      const y = years.find((x) => x.id === yearSel) || years[0];
      return { from: y.from, to: y.to, label: y.label };
    }
    const m = months.find((x) => x.id === monthSel) || months[0];
    return { from: m.from, to: m.to, label: m.label };
  }, [periodType, weekSel, monthSel, yearSel, weeks, months, years]);

  const members = useMemo(
    () => cfg.users.filter((u) => u.role === teamRole && (u.status || 'active') === 'active'),
    [cfg.users, teamRole],
  );

  async function load(force = false) {
    setBusy(true);
    try {
      const r = await misReport({ teamRole, members, from: period.from, to: period.to, force });
      setData(r);
    } catch (e) { console.error(e); toast(t('loadFail'), 'err'); setData({ rows: [], team: null, capped: false }); }
    finally { setBusy(false); }
  }
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [teamRole, period.from, period.to, members.length]);

  const shownRows = data ? data.rows : []; // hamesha SAARI rows — mode sirf number ka format badalta hai

  async function openDrill(title, ids) {
    setDrill({ title, ids });
    setDrillRows(null);
    setDrillStage(null); // null = "All" (poori list turant dikhti hai)
    if (!ids.length) { setDrillRows([]); return; }
    try {
      const r = await fetchDashLeadsAll({ teamRole, filter: { kind: 'ids', ids }, cap: 900 });
      setDrillRows(r.rows);
    } catch (e) { console.error(e); setDrillRows([]); }
  }

  function pickFor(m, sel, nameForTitle) {
    if (!m) return;
    const ids = sel === 'total' ? [...m.workedIds, ...m.pendingIds] : sel === 'worked' ? m.workedIds : m.pendingIds;
    openDrill(nameForTitle, ids);
  }

  // fetched batch se stage-wise breakdown — koi extra read nahi, sirf client-side group
  const drillBreakdown = useMemo(() => {
    if (!drillRows) return [];
    const by = {};
    drillRows.forEach((l) => {
      const st = String((teamRole === 'sales' ? l.sales_status : l.status) || 'other').toLowerCase().trim() || 'other';
      by[st] = (by[st] || 0) + 1;
    });
    return Object.entries(by).sort((a, b) => b[1] - a[1]);
  }, [drillRows, teamRole]);

  // drillStage null = "All" — poori list turant dikhti hai; ek stage chuno to sirf usi tak.
  const drillFiltered = useMemo(() => {
    if (!drillRows) return [];
    if (!drillStage) return drillRows;
    return drillRows.filter((l) => {
      const st = String((teamRole === 'sales' ? l.sales_status : l.status) || 'other').toLowerCase().trim() || 'other';
      return st === drillStage;
    });
  }, [drillRows, drillStage, teamRole]);

  if (!cfg.users.length) return <div className="skeleton" style={{ height: 320 }} />;

  return (
    <div className="mis">
      <div className="ls-tabs" style={{ marginBottom: 10 }}>
        <button className={teamRole === 'ldr' ? 'on' : ''} onClick={() => setTeamRole('ldr')}>{t('mecaLdrTeam')}</button>
        <button className={teamRole === 'sales' ? 'on' : ''} onClick={() => setTeamRole('sales')}>{t('mecaSalesTeam')}</button>
      </div>

      <div className="wk-bar">
        <div className="lf-seg">
          <button type="button" className={periodType === 'week' ? 'on' : ''} onClick={() => setPeriodType('week')}>{t('misWeek')}</button>
          <button type="button" className={periodType === 'month' ? 'on' : ''} onClick={() => setPeriodType('month')}>{t('misMonth')}</button>
          <button type="button" className={periodType === 'year' ? 'on' : ''} onClick={() => setPeriodType('year')}>{t('misYear')}</button>
        </div>
        {periodType === 'week' ? (
          <select className="form-control" value={weekSel} onChange={(e) => setWeekSel(e.target.value)}>
            {weeks.map((w) => <option key={weekId(w)} value={weekId(w)}>{weekLabel(w)}</option>)}
          </select>
        ) : periodType === 'year' ? (
          <select className="form-control" value={yearSel} onChange={(e) => setYearSel(e.target.value)}>
            {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
          </select>
        ) : (
          <select className="form-control" value={monthSel} onChange={(e) => setMonthSel(e.target.value)}>
            {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <button type="button" className="chip" disabled={busy} onClick={() => load(true)}>
          <i className="fas fa-rotate" /> {t('lmRefresh')}
        </button>
      </div>
      <p className="wk-range">{period.from} → {period.to}</p>

      <div className="wk-bar" style={{ marginTop: -2 }}>
        <div className="lf-seg">
          <button type="button" className={viewMode === 'cards' ? 'on' : ''} onClick={() => setViewMode('cards')}><i className="fas fa-grip" /> {t('misCards')}</button>
          <button type="button" className={viewMode === 'table' ? 'on' : ''} onClick={() => setViewMode('table')}><i className="fas fa-table" /> {t('misTable')}</button>
        </div>
        <div className="lf-seg">
          <button type="button" className={scoreMode === 'negative' ? 'on' : ''} onClick={() => setScoreMode('negative')} style={scoreMode === 'negative' ? { color: 'var(--danger)' } : undefined}>🔴 {t('misNegative')}</button>
          <button type="button" className={scoreMode === 'positive' ? 'on' : ''} onClick={() => setScoreMode('positive')} style={scoreMode === 'positive' ? { color: 'var(--success)' } : undefined}>🟢 {t('misPositive')}</button>
        </div>
      </div>
      <p className="wk-range" style={{ marginTop: -6 }}>{t('misScoreModeNote')}</p>

      {data == null ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : data.capped ? (
        <div className="rep-note"><i className="fas fa-circle-info" /> {t('daRangeTooBig')}</div>
      ) : (
        <>
          {data.team && (
            <div className="mis-card mis-team">
              <div className="mis-card-name">
                <span><i className="fas fa-users" /> {t('misTeamTotal')}</span>
                <span className={`mis-overall ${scoreTone(data.team.overall)}`} style={{ color: scoreColor(data.team.overall) }}>
                  {scoreLabel(data.team.overall, scoreMode)} <em>{t('misOverall')}</em>
                </span>
              </div>
              <MetricBlock label={t('misLeadsReceived')} m={data.team.leads} scoreMode={scoreMode} onPick={(sel) => pickFor(data.team.leads, sel, `${t('misTeamTotal')} · ${t('misLeadsReceived')}`)} />
              <MetricBlock label={t('misFollowups')} m={data.team.followups} scoreMode={scoreMode} onPick={(sel) => pickFor(data.team.followups, sel, `${t('misTeamTotal')} · ${t('misFollowups')}`)} />
            </div>
          )}

          {shownRows.length === 0 && <div className="empty"><i className="fas fa-inbox" /> {t('wkNoActivity')}</div>}

          {viewMode === 'cards' ? (
            <div className="wk-people">
              {shownRows.map((r) => (
                <div className="mis-card" key={r.uid}>
                  <div className="mis-card-name">
                    <span>{r.name}</span>
                    <span className={`mis-overall ${scoreTone(r.overall)}`} style={{ color: scoreColor(r.overall) }}>
                      {scoreLabel(r.overall, scoreMode)} <em>{t('misOverall')}</em>
                    </span>
                  </div>
                  <MetricBlock label={t('misLeadsReceived')} m={r.leads} scoreMode={scoreMode} onPick={(sel) => pickFor(r.leads, sel, `${r.name} · ${t('misLeadsReceived')}`)} />
                  <MetricBlock label={t('misFollowups')} m={r.followups} scoreMode={scoreMode} onPick={(sel) => pickFor(r.followups, sel, `${r.name} · ${t('misFollowups')}`)} />
                </div>
              ))}
            </div>
          ) : (
            <div className="tablewrap">
              <table className="meca-t mis-t">
                <thead>
                  <tr>
                    <th rowSpan={2}>{t('uName')}</th>
                    <th rowSpan={2}>{t('misOverall')}</th>
                    <th colSpan={4} className="mis-th-group">{t('misLeadsReceived')}</th>
                    <th colSpan={4} className="mis-th-group">{t('misFollowups')}</th>
                  </tr>
                  <tr>
                    <th>{t('misTotal')}</th><th>{t('misDone')}</th><th>{t('misPending')}</th><th>{t('misScore')}</th>
                    <th>{t('misTotal')}</th><th>{t('misDone')}</th><th>{t('misPending')}</th><th>{t('misScore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((r) => (
                    <tr key={r.uid}>
                      <td className="nm">{r.name}</td>
                      <td><span className={`mis-overall-chip ${scoreTone(r.overall)}`}>{scoreLabel(r.overall, scoreMode)}</span></td>
                      <td><button type="button" className="mis-tlink" onClick={() => pickFor(r.leads, 'total', `${r.name} · ${t('misLeadsReceived')}`)}>{r.leads.total}</button></td>
                      <td className="hl">{r.leads.worked}</td>
                      <td style={r.leads.pending > 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                        <button type="button" className="mis-tlink" disabled={!r.leads.pending} onClick={() => pickFor(r.leads, 'pending', `${r.name} · ${t('misLeadsReceived')}`)}>{r.leads.pending}</button>
                      </td>
                      <td><span className={`rep-chip ${scoreTone(r.leads.score)}`}>{scoreLabel(r.leads.score, scoreMode)}</span></td>
                      <td><button type="button" className="mis-tlink" onClick={() => pickFor(r.followups, 'total', `${r.name} · ${t('misFollowups')}`)}>{r.followups.total}</button></td>
                      <td className="hl">{r.followups.worked}</td>
                      <td style={r.followups.pending > 0 ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                        <button type="button" className="mis-tlink" disabled={!r.followups.pending} onClick={() => pickFor(r.followups, 'pending', `${r.name} · ${t('misFollowups')}`)}>{r.followups.pending}</button>
                      </td>
                      <td><span className={`rep-chip ${scoreTone(r.followups.score)}`}>{scoreLabel(r.followups.score, scoreMode)}</span></td>
                    </tr>
                  ))}
                  {data.team && (
                    <tr style={{ background: 'var(--navy-primary)', color: '#fff', fontWeight: 800 }}>
                      <td className="nm" style={{ color: '#fff' }}>{t('grandTotal')}</td>
                      <td style={{ color: '#fff' }}>{scoreLabel(data.team.overall, scoreMode)}</td>
                      <td style={{ color: '#fff' }}>{data.team.leads.total}</td>
                      <td style={{ color: '#fff' }}>{data.team.leads.worked}</td>
                      <td style={{ color: '#fff' }}>{data.team.leads.pending}</td>
                      <td style={{ color: '#fff' }}>{scoreLabel(data.team.leads.score, scoreMode)}</td>
                      <td style={{ color: '#fff' }}>{data.team.followups.total}</td>
                      <td style={{ color: '#fff' }}>{data.team.followups.worked}</td>
                      <td style={{ color: '#fff' }}>{data.team.followups.pending}</td>
                      <td style={{ color: '#fff' }}>{scoreLabel(data.team.followups.score, scoreMode)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {drill && (
        <Sheet title={drill.title} subtitle={fill(t('dhShowing'), { n: drillFiltered.length })} onClose={() => setDrill(null)} wide>
          {drillRows == null ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : drillRows.length === 0 ? (
            <div className="empty"><i className="fas fa-mug-hot" /> {t('fuClear')}</div>
          ) : (
            <>
              {/* Poori list turant dikhti hai (default). Stage chips optional filter hain — ek pe
                  click karo to sirf usi stage ki leads, "All" pe wapas poori list. */}
              {drillBreakdown.length > 1 && (
                <div className="mis-stagebar">
                  <button type="button" className={`chip ${!drillStage ? 'active' : ''}`} onClick={() => setDrillStage(null)}>
                    {t('cAll')} <b>{drillRows.length}</b>
                  </button>
                  {drillBreakdown.map(([st, n]) => (
                    <button type="button" key={st} className={`chip ${drillStage === st ? 'active' : ''}`} onClick={() => setDrillStage(drillStage === st ? null : st)}>
                      {fmtStatus(st)} <b>{n}</b>
                    </button>
                  ))}
                </div>
              )}
              <div className="lead-list" style={{ marginTop: drillBreakdown.length > 1 ? 10 : 0 }}>
                {drillFiltered.map((l) => <LeadCard key={l.id} lead={l} t={t} selMode={false} selected={false} onOpen={() => setOpenLead(l)} />)}
              </div>
            </>
          )}
        </Sheet>
      )}

      {openLead && <LeadSheet lead={openLead} onClose={() => setOpenLead(null)} onSaved={() => load(true)} />}
    </div>
  );
}
