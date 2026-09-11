import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { useConfig, splitList, userName } from '../config';
import { useT, fill } from '../i18n';
import { fmtMoney } from '../lib/format';
import { getCohortMonths, istDay } from '../lib/stats';
import { sourceQuality, mecaFromActivity, ldrDownstream, companySlice } from '../lib/dashboardStats';
import { downloadCsv } from '../lib/csv';

const cnt = async (...w) => (await getCountFromServer(query(collection(db, 'leads'), ...w))).data().count;
const MONTH_OPTS = [3, 6, 12];
const POS_STAGES = ['hot lead', 'visit customer', 'video call', 'visit done'];
// asli funnel = har stage pichhle ka subset. Total -> Qualified -> Order Done.
const mkFunnel = ({ total, qualified, orders }, t) => [
  { label: t('anKpiTotal'), value: total, color: 'var(--navy-accent)' },
  { label: t('anKpiQualLdr'), value: qualified, color: '#0d7d6f' },
  { label: t('anKpiOrderDone'), value: orders, color: 'var(--success)' },
];
// donut = abhi kaun kahan (mutually-exclusive current state)
const mkPipeline = ({ fresh, working, qualified, positive, orders, lost }, t) => [
  { label: t('anKpiFreshNew'), value: fresh, color: 'var(--navy-accent)' },
  { label: t('anKpiLdrWorking'), value: working, color: '#7c8b9a' },
  { label: t('anKpiQualSales'), value: qualified, color: '#0d7d6f' },
  { label: t('anKpiPositive'), value: positive, color: 'var(--warning)' },
  { label: t('anKpiOrderDone'), value: orders, color: 'var(--success)' },
  { label: t('anKpiLostDead'), value: lost, color: 'var(--danger)' },
].filter((s) => s.value > 0);

function Bars({ data, fmt = (v) => v.toLocaleString('en-IN'), color = 'var(--navy-accent)', note }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p style={{ fontSize: 12, color: 'var(--muted)' }}>—</p>;
  return (
    <div className="bars">
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <span className="bar-label" title={d.label}>{d.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color || color }} />
            {note && d.note != null && <span className="bar-note">{d.note}</span>}
          </div>
          <span className="bar-val">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* Donut — pipeline health */
function Donut({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <p style={{ fontSize: 12, color: 'var(--muted)' }}>—</p>;
  const R = 54; const SW = 22; const C = 2 * Math.PI * R; const GAP = data.filter((d) => d.value).length > 1 ? 3 : 0;
  let off = 0;
  const segs = data.filter((d) => d.value).map((d) => {
    const frac = d.value / total; const len = Math.max(0, frac * C - GAP);
    const s = { ...d, dash: `${len} ${C - len}`, off: -off, pct: Math.round(frac * 100) };
    off += frac * C; return s;
  });
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" width="130" height="130" role="img" aria-label="pipeline">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line)" strokeWidth={SW} />
        {segs.map((s) => (
          <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth={SW}
            strokeDasharray={s.dash} strokeDashoffset={s.off} transform="rotate(-90 70 70)"><title>{s.label}: {s.value} ({s.pct}%)</title></circle>
        ))}
        <text x="70" y="66" textAnchor="middle" className="donut-c-v">{total.toLocaleString('en-IN')}</text>
        <text x="70" y="82" textAnchor="middle" className="donut-c-l">total</text>
      </svg>
      <div className="donut-legend">
        {segs.map((s) => (
          <div key={s.label} className="donut-leg-row">
            <span className="donut-dot" style={{ background: s.color }} />
            <span className="donut-leg-l">{s.label}</span>
            <span className="donut-leg-v">{s.value.toLocaleString('en-IN')} · {s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Funnel — tapered bars */
function Funnel({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="funnel">
      {data.map((d, i) => {
        const w = 40 + (d.value / max) * 60;
        const drop = i > 0 && data[i - 1].value ? Math.round((1 - d.value / data[i - 1].value) * 100) : 0;
        return (
          <div className="fn-row" key={d.label}>
            <div className="fn-bar" style={{ width: `${w}%`, background: d.color }}>
              <span>{d.label}</span><b>{d.value.toLocaleString('en-IN')}</b>
            </div>
            {i > 0 && drop > 0 && <span className="fn-drop">▼ {drop}% drop</span>}
          </div>
        );
      })}
    </div>
  );
}

/* Line — trend chart (responsive, gridlines) */
function Line({ data, fmt = (v) => v.toLocaleString('en-IN'), color = 'var(--success)' }) {
  if (data.length < 2) return <p style={{ fontSize: 12, color: 'var(--muted)' }}>—</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 620; const H = 200; const L = 52; const R = 10; const T = 12; const B = 26;
  const iw = W - L - R; const ih = H - T - B;
  const x = (i) => L + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => T + ih - (v / max) * ih;
  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{fmt(v)}</text>
        </g>
      ))}
      <path d={`${path} L${pts[pts.length - 1][0]} ${y(0)} L${pts[0][0]} ${y(0)} Z`} fill={`color-mix(in srgb, ${color} 12%, transparent)`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill={color} />)}
      {data.map((d, i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text>)}
    </svg>
  );
}

// analytics date-range presets
const AN_RANGES = [
  { k: 'm', tk: 'anRThisMonth' }, { k: '30', tk: 'anR30' }, { k: '90', tk: 'anR90' }, { k: 'all', tk: 'rAll' },
];
function anRangeFor(k) {
  const today = istDay();
  const d = (n) => istDay(Date.now() - n * 86400000);
  if (k === 'm') return [today.slice(0, 8) + '01', today];
  if (k === '30') return [d(29), today];
  if (k === '90') return [d(89), today];
  return ['2026-04-01', today];
}

export default function Analytics() {
  const { t } = useT();
  const cfg = useConfig();
  const [nMonths, setNMonths] = useState(6);
  const [months, setMonths] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [sources, setSources] = useState(null);
  const [perf, setPerf] = useState(null);
  const [ldrRep, setLdrRep] = useState(null);
  const [expLdr, setExpLdr] = useState(null);

  const [rangeKey, setRangeKey] = useState('all');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const custom = cFrom && cTo;
  const [from, to] = custom ? [cFrom, cTo].sort() : anRangeFor(rangeKey);
  const allTime = !custom && rangeKey === 'all';

  const roleByUid = useMemo(() => {
    const m = {};
    (cfg.users || []).forEach((u) => { m[u.id] = u.role; });
    return m;
  }, [cfg.users]);

  useEffect(() => { setMonths(null); getCohortMonths(nMonths).then(setMonths).catch(() => setMonths([])); }, [nMonths]);

  useEffect(() => {
    if (!cfg.ready) return;
    let alive = true;
    setKpi(null); setFunnel(null); setPipeline(null); setSources(null);
    (async () => {
      try {
        const stages = splitList(cfg.settings?.Lead_Sources);
        const at14 = new Date(Date.now() - 14 * 86400000);
        const atRisk = await cnt(where('next_followup', '<', at14)).catch(() => 0);

        if (allTime) {
          // all-time — count() everything. LDR statuses: fresh/new/call back/qualified/dead/lost.
          // Sales statuses (sales_status): hot lead/visit customer/video call/order done/lost/...
          const [total, qualified, orders, ldrLost, salesLost, fresh, positive] = await Promise.all([
            cnt(), cnt(where('status', '==', 'qualified')), cnt(where('sales_status', '==', 'order done')),
            cnt(where('status', 'in', ['dead', 'lost'])),                    // LDR ne lost kiya
            cnt(where('sales_status', 'in', ['lost', 'dead'])).catch(() => 0), // Sales ne lost kiya
            cnt(where('status', 'in', ['fresh', 'new'])),
            cnt(where('sales_status', 'in', POS_STAGES)).catch(() => 0),
          ]);
          if (!alive) return;
          const lost = ldrLost + salesLost;
          const working = Math.max(0, total - fresh - qualified - ldrLost);
          const qActive = Math.max(0, qualified - positive - orders - salesLost);
          setKpi({ total, qualified, orders, lost, atRisk }); // revenue = cohort se (revTotal fallback)
          setFunnel(mkFunnel({ total, qualified, orders }, t));
          setPipeline(mkPipeline({ fresh, working, qualified: qActive, positive, orders, lost }, t));
          sourceQuality(stages).then((r) => alive && setSources(r)).catch(() => alive && setSources([]));
        } else {
          // date range — ek bounded slice se sab
          const sl = await companySlice(from, to);
          if (!alive) return;
          if (sl.capped) { setKpi({ ...sl, atRisk, capped: true }); setFunnel(null); setPipeline(null); setSources([]); return; }
          setKpi({ total: sl.total, qualified: sl.qualified, orders: sl.orders, lost: sl.lost, atRisk, revenue: sl.revenue });
          setFunnel(mkFunnel({ total: sl.total, qualified: sl.qualified, orders: sl.orders }, t));
          setPipeline(mkPipeline({
            fresh: sl.fresh, working: Math.max(0, sl.total - sl.fresh - sl.qualified - sl.lost),
            qualified: Math.max(0, sl.qualified - sl.positive - sl.orders), positive: sl.positive, orders: sl.orders, lost: sl.lost,
          }, t));
          setSources(Object.entries(sl.bySource).map(([source, total]) => ({
            source, total, qualified: sl.bySourceQ?.[source] || 0,
            pct: total ? Math.round(((sl.bySourceQ?.[source] || 0) / total) * 100) : 0,
          })).sort((a, b) => b.total - a.total));
        }
      } catch { if (alive) setKpi(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.ready, from, to, allTime]);

  // Top performers — pichhle 30 din ki activity se
  useEffect(() => {
    if (!cfg.ready) return;
    const to = istDay();
    const from = istDay(Date.now() - 29 * 86400000);
    mecaFromActivity(from, to).then((r) => setPerf(r.rows)).catch(() => setPerf([]));
    ldrDownstream((uid) => userName(cfg, uid)).then(setLdrRep).catch(() => setLdrRep([]));
  }, [cfg.ready]);

  const revTotal = kpi && kpi.revenue != null ? kpi.revenue : (months ? months.reduce((s, m) => s + (m.totals?.revenue || 0), 0) : 0);
  const qualRate = kpi && kpi.total ? Math.round((kpi.qualified / kpi.total) * 100) : 0;
  const closeRate = kpi && kpi.qualified ? Math.round((kpi.orders / kpi.qualified) * 100) : 0;
  const rangeLbl = allTime ? t('rAll') : from === to ? from : `${from} → ${to}`;

  // sirf asal workers — admin / md / tl leaderboards mein nahi
  const topLdr = useMemo(() => (perf || []).filter((r) => roleByUid[r.uid] === 'ldr')
    .sort((a, b) => b.qualified - a.qualified).slice(0, 5), [perf, roleByUid]);
  const topSales = useMemo(() => (perf || []).filter((r) => roleByUid[r.uid] === 'sales')
    .sort((a, b) => b.closed - a.closed || b.revenue - a.revenue).slice(0, 5), [perf, roleByUid]);
  const ldrRepRows = useMemo(() => (ldrRep || []).filter((r) => roleByUid[r.id] === 'ldr'), [ldrRep, roleByUid]);

  const insights = useMemo(() => {
    const out = [];
    if (kpi && kpi.atRisk > 0) out.push({ type: 'warn', text: fill(t('anInsAtRisk'), { n: kpi.atRisk.toLocaleString('en-IN') }) });
    if (sources && sources.length) {
      const worst = [...sources].filter((s) => s.total >= 20).sort((a, b) => a.pct - b.pct)[0];
      const best = [...sources].filter((s) => s.total >= 20).sort((a, b) => b.pct - a.pct)[0];
      if (worst) out.push({ type: 'bad', text: fill(t('anInsWorstSrc'), { s: worst.source, p: worst.pct }) });
      if (best && best.source !== worst?.source) out.push({ type: 'good', text: fill(t('anInsBestSrc'), { s: best.source, p: best.pct }) });
    }
    if (kpi && closeRate < 15 && kpi.qualified > 20) out.push({ type: 'bad', text: fill(t('anInsCloseLow'), { p: closeRate }) });
    return out;
  }, [kpi, sources, closeRate, t]);

  function exportCsv() {
    if (!sources) return;
    downloadCsv('source-performance.csv', ['Source', 'Total leads', 'Qualified', '% qualified'],
      sources.map((s) => [s.source, s.total, s.qualified, s.pct]));
  }

  const KPI = kpi && kpi !== false && !kpi.capped ? [
    { ic: 'fa-users', g: 'var(--navy-primary)', v: kpi.total.toLocaleString('en-IN'), l: t('anTotal') },
    { ic: 'fa-check-circle', g: '#0074d9', v: `${qualRate}%`, l: t('anQualRate') },
    { ic: 'fa-trophy', g: 'var(--success)', v: kpi.orders.toLocaleString('en-IN'), l: t('anOrders') },
    { ic: 'fa-percent', g: 'var(--warning)', v: `${closeRate}%`, l: t('anCloseRate') },
    { ic: 'fa-indian-rupee-sign', g: 'var(--success)', v: fmtMoney(revTotal), l: t('anRevenue') },
    { ic: 'fa-triangle-exclamation', g: 'var(--danger)', v: kpi.atRisk.toLocaleString('en-IN'), l: t('anAtRisk') },
  ] : [];

  return (
    <div>
      {/* date-range filter */}
      <div className="dfilter">
        <div className="dfilter-head"><i className="fas fa-filter" /> {t('dFilters')} <span style={{ fontWeight: 500, color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>· {rangeLbl}</span></div>
        <div className="tdash-bar">
          <div className="chips">
            {AN_RANGES.map((r) => <button key={r.k} className={`chip ${!custom && rangeKey === r.k ? 'active' : ''}`} onClick={() => { setRangeKey(r.k); setCFrom(''); setCTo(''); }}>{t(r.tk)}</button>)}
          </div>
        </div>
        <div className="dfilter-dates">
          <label>{t('dDateFrom')}<input type="date" className="form-control" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} /></label>
          <label>{t('dDateTo')}<input type="date" className="form-control" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} /></label>
          {custom && <button type="button" className="chip" onClick={() => { setCFrom(''); setCTo(''); }}><i className="fas fa-xmark" /> {t('dClear')}</button>}
        </div>
      </div>

      {kpi?.capped && <div className="alert alert-warn">{t('daRangeTooBig')}</div>}

      {/* KPI cards — icon + value (purane system jaisa) */}
      <div className="an-kpi-grid">
        {kpi == null ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 110 }} />)
          : kpi === false ? <div className="alert alert-error">{t('loadFail')}</div>
            : KPI.map((k) => (
              <div className="an-kpi" key={k.l}>
                <div className="an-kpi-ic" style={{ background: `linear-gradient(135deg, ${k.g}, color-mix(in srgb, ${k.g} 55%, #000))` }}><i className={`fas ${k.ic}`} /></div>
                <div className="an-kpi-v">{k.v}</div>
                <div className="an-kpi-l">{k.l}</div>
              </div>
            ))}
      </div>

      {insights.length > 0 && (
        <div className="section">
          <h3><i className="fas fa-lightbulb" style={{ color: 'var(--warning)' }} /> {t('anInsights')}</h3>
          {insights.map((ins, i) => (
            <div key={i} className={`ins-row ins-${ins.type}`}>{ins.text}</div>
          ))}
        </div>
      )}

      <div className="section">
        <h3><i className="fas fa-chart-pie" /> {t('anPipelineNow')}</h3>
        {pipeline == null ? <div className="skeleton" style={{ height: 140 }} /> : <Donut data={pipeline} />}
      </div>

      <div className="section">
        <h3><i className="fas fa-filter" /> {t('anFunnelDrop')}</h3>
        {funnel == null ? <div className="skeleton" style={{ height: 120 }} /> : <Funnel data={funnel} />}
      </div>

      <div className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0 }}><i className="fas fa-bullhorn" /> {t('anSource')}</h3>
          <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 12 }} disabled={!sources?.length} onClick={exportCsv}><i className="fas fa-file-csv" /> CSV</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {sources == null ? <div className="skeleton" style={{ height: 120 }} />
            : <Bars data={sources.slice(0, 8).map((s) => ({ label: s.source, value: s.total, note: `${s.pct}%`, color: s.pct > 30 ? 'var(--success)' : 'var(--navy-accent)' }))} note />}
        </div>
      </div>

      <div className="section">
        <div className="chips" style={{ marginBottom: 12 }}>
          {MONTH_OPTS.map((n) => (
            <button key={n} className={`chip ${nMonths === n ? 'active' : ''}`} onClick={() => setNMonths(n)}>{fill(t('anLastNMonths'), { n })}</button>
          ))}
        </div>
        <h3><i className="fas fa-chart-line" /> {t('anRevTrend')}</h3>
        {months == null ? <div className="skeleton" style={{ height: 120 }} />
          : months.length === 0 ? <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('anNoStats')}</p>
            : <Line data={months.map((m) => ({ label: m.month.slice(5), value: m.totals?.revenue || 0 }))} fmt={fmtMoney} />}
        {months && months.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}><i className="fas fa-seedling" /> {t('anLeadsTrend')}</h3>
            <Bars data={months.map((m) => ({ label: m.month.slice(5), value: m.totals?.fresh || 0 }))} />
          </>
        )}
      </div>

      <div className="section">
        <h3><i className="fas fa-user-tie" /> {t('anTopLdr')} <span className="sec-sub">{t('anLast30')}</span></h3>
        {perf == null ? <div className="skeleton" style={{ height: 100 }} />
          : <Bars data={topLdr.map((r) => ({ label: r.name || r.uid, value: r.qualified }))} color="var(--navy-accent)" />}
        <h3 style={{ marginTop: 16 }}><i className="fas fa-user-check" /> {t('anTopSales')} <span className="sec-sub">{t('anLast30')}</span></h3>
        {perf == null ? <div className="skeleton" style={{ height: 100 }} />
          : <Bars data={topSales.map((r) => ({ label: r.name || r.uid, value: r.closed }))} color="var(--success)" />}
      </div>

      {/* LDR Performance Report — kisne qualify ki, kis Sales ko gayi, downstream orders */}
      <div className="section">
        <h3><i className="fas fa-user-tie" style={{ color: 'var(--navy-accent)' }} /> {t('anLdrReport')}</h3>
        <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '-4px 0 10px' }}>{t('anLdrReportHint')}</p>
        {ldrRep == null ? <div className="skeleton" style={{ height: 140 }} /> : ldrRepRows.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>{t('noData')}</p>
        ) : (
          <div className="tablewrap">
            <table className="meca-t">
              <thead>
                <tr>
                  <th style={{ width: 20 }} />
                  <th>{t('anLdrName')}</th><th>{t('daAssigned')}</th><th>{t('cQualified')}</th><th>{t('anQualifyRate')}</th>
                  <th>{t('anSentTo')}</th><th>{t('anOrdersDown')}</th><th>{t('anDownRate')}</th>
                </tr>
              </thead>
              <tbody>
                {ldrRepRows.map((r) => [
                    <tr key={r.id} className="tdash-row" style={{ cursor: 'pointer' }} onClick={() => setExpLdr(expLdr === r.id ? null : r.id)}>
                      <td style={{ textAlign: 'center' }}><i className={`fas ${expLdr === r.id ? 'fa-chevron-down' : 'fa-chevron-right'}`} style={{ fontSize: 10, color: 'var(--muted)' }} /></td>
                      <td className="nm">{r.name}</td>
                      <td>{r.assigned.toLocaleString('en-IN')}</td>
                      <td style={{ fontWeight: 700, color: 'var(--navy-accent)' }}>{r.qualified}</td>
                      <td><span className={`an-rate ${r.rate >= 30 ? 'good' : r.rate >= 15 ? 'warn' : 'bad'}`}>{r.rate}%</span></td>
                      <td style={{ fontSize: 11.5, whiteSpace: 'normal' }}>{r.topDestinations || '—'}</td>
                      <td style={{ fontWeight: 700, color: 'var(--success)' }}>{r.orders}</td>
                      <td><span className={`an-rate ${r.downstreamRate >= 15 ? 'good' : r.downstreamRate >= 5 ? 'warn' : 'bad'}`}>{r.downstreamRate}%</span></td>
                    </tr>,
                    expLdr === r.id && (
                      <tr key={`${r.id}-x`}>
                        <td />
                        <td colSpan={7} style={{ background: 'var(--card-2)', padding: 8 }}>
                          {r.dest.length === 0 ? <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: 6 }}>{t('anNoSent')}</div> : (
                            <table className="meca-t" style={{ margin: 0 }}>
                              <thead><tr><th>{t('anSalesRep')}</th><th>{t('anSent')}</th><th>{t('anWon')}</th><th>Lost</th><th>{t('anActive')}</th><th>{t('crWinRate')}</th></tr></thead>
                              <tbody>
                                {r.dest.map((d) => (
                                  <tr key={d.id}>
                                    <td className="nm">{d.name}</td>
                                    <td>{d.sent}</td>
                                    <td style={{ color: 'var(--success)', fontWeight: 700 }}>{d.won}</td>
                                    <td style={{ color: 'var(--danger)' }}>{d.lost}</td>
                                    <td style={{ color: 'var(--navy-accent)' }}>{d.active}</td>
                                    <td><span className={`an-rate ${d.winRate >= 15 ? 'good' : d.winRate >= 5 ? 'warn' : 'bad'}`}>{d.winRate}%</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
