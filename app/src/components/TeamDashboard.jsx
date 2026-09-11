import { useEffect, useMemo, useRef, useState } from 'react';
import { useT, fill } from '../i18n';
import { useConfig, salesUsers, workerUsers, splitList, userName } from '../config';
import { RANGE_PRESETS, rangeFor } from '../lib/daterange';
import { fmtStatus, fmtDate, isPast } from '../lib/format';
import { fetchDashLeadsAll } from '../lib/dashboardLeads';
import { downloadCsv } from '../lib/csv';
import {
  sourceQuality, stateVolume, teamWorkloadReport, getDashRange, bustDashCache,
} from '../lib/dashboardStats';
import { istDay as istToday, refreshTodayAgg } from '../lib/stats';
import DashExpand from './DashExpand';

const STATUS_BADGE = {
  fresh: 'bg-fresh', new: 'bg-fresh', qualified: 'bg-qualified',
  'call back': 'bg-callback', callback: 'bg-callback', 'no answer': 'bg-callback',
  dead: 'bg-lost', lost: 'bg-lost', 'order done': 'bg-order', 'order won': 'bg-order',
};
const stClass = (s) => [STATUS_BADGE[String(s || '').toLowerCase()] || 'bg-default'];

// LDR ke 5 fixed cards (purane system jaisa): Total / Pending / Call Back / Qualified / Lost
const CB_RE = /call ?back|no ans|follow/;
const LOST_RE = /lost|dead|not interest/;
function ldrCards(b) {
  if (b.capped || b.byStatus == null) return null;
  let cb = 0; let ql = 0; let ls = 0; let other = 0;
  for (const [s, n] of Object.entries(b.byStatus)) {
    if (s === 'qualified') ql += n;
    else if (CB_RE.test(s)) cb += n;
    else if (LOST_RE.test(s)) ls += n;
    else other += n;
  }
  return { cb, ql: ql + other, ls }; // "other" ko qualified mein jodo (purane system jaisa)
}

const SALES_ICON = {
  qualified: 'fa-star', 'call back': 'fa-phone-volume', followup: 'fa-arrows-rotate',
  'hot lead': 'fa-fire', 'video call': 'fa-video', 'visit customer': 'fa-store',
  'order done': 'fa-trophy', lost: 'fa-ban',
};
function salesStageList(cfg) {
  const custom = (cfg.stages || []).filter((s) => s.role === 'both' || s.role === 'sales').map((s) => s.name.toLowerCase());
  const list = custom.length ? custom : ['hot lead', 'video call', 'visit customer', 'order done', 'call back', 'lost'];
  return ['qualified', ...list.filter((s) => s !== 'qualified')];
}

const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

/* "Active Now / 22m ago / 3h ago / 5d ago" — purane system jaisa */
function relTime(ts) {
  if (!ts) return { text: '—', color: 'var(--muted)' };
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return { text: '—', color: 'var(--muted)' };
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 5) return { text: 'Active Now', color: 'var(--success)' };
  if (mins < 60) return { text: `${mins}m ago`, color: 'var(--warning)' };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { text: `${hrs}h ago`, color: 'var(--danger)' };
  return { text: `${Math.floor(hrs / 24)}d ago`, color: 'var(--danger)' };
}

/* ---- ek row-group (4 hain: Fresh / Re-Inquiry / Scheduled / Overdue) ---- */
function RowGroup({ num, icon, iconColor, title, sub, b, teamRole, stages, onCard, open, t, countMode, setCountMode }) {
  const loading = b == null;
  const errored = b === false;
  const capped = b && b !== false && b.capped;
  const ok = b && b !== false;
  const hasToggle = (num === 2 || num === 5) && ok && !capped && b.worked > 0;
  const calls = hasToggle && countMode === 'calls';
  const multiCalled = hasToggle && b.contacts > b.worked;
  const ldr = teamRole !== 'sales' && ok && !capped ? ldrCards(b) : null;
  // sales breakdown: config stages ke order me + koi bhi extra byStatus key (jaise 'lost'/'dead')
  const salesRows = (() => {
    if (!(teamRole === 'sales' && ok && !capped)) return [];
    const bs = b.byStatus || {};
    const seen = new Set(stages);
    const rows = stages.map((s) => ({ s, n: bs[s] || 0 }));
    Object.keys(bs).forEach((s) => { if (!seen.has(s)) rows.push({ s, n: bs[s] }); });
    return rows.filter((r) => r.n > 0);
  })();

  return (
    <div className={`section rg rg-${num}`}>
      <h3>
        <span className="rg-num" style={{ background: iconColor }}><i className={`fas ${icon}`} /></span>
        {title}
        {sub && <span className="sec-sub">{sub}</span>}
        {hasToggle && (
          <span className="rg-toggle">
            <button type="button" className={countMode !== 'calls' ? 'on' : ''} onClick={() => setCountMode('unique')}>{t('daModeUnique')}</button>
            <button type="button" className={countMode === 'calls' ? 'on' : ''} onClick={() => setCountMode('calls')}>{t('daModeCalls')}</button>
          </span>
        )}
      </h3>
      {loading ? <div className="skeleton" style={{ height: 88 }} /> : errored ? (
        <div className="rep-note"><i className="fas fa-circle-info" /> —</div>
      ) : (
        <>
          <div className="rg-cards">
            <button type="button" className={`stat-card clickable ${open === `${num}-total` ? 'on' : ''}`} onClick={() => onCard(`${num}-total`, title, 'total')}>
              <div className="val">{b.total.toLocaleString('en-IN')}</div><div className="label">{num === 4 ? 'Total Overdue' : 'Total'}</div>
            </button>
            {hasToggle && (
              <button type="button" className={`stat-card clickable ${open === `${num}-worked` ? 'on' : ''}`}
                onClick={() => onCard(`${num}-worked`, `${title} · ${calls ? t('daContacts') : t('daContacted')}`, calls ? 'calls' : 'worked')}>
                <div className="val" style={{ color: 'var(--navy-accent)' }}>{(calls ? b.contacts : b.worked).toLocaleString('en-IN')}</div>
                <div className="label"><i className={`fas ${calls ? 'fa-phone' : 'fa-user-check'}`} /> {calls ? t('daContacts') : t('daContacted')}</div>
              </button>
            )}
            {num !== 4 && (
              <button type="button" className={`stat-card clickable tone-wip ${open === `${num}-pending` ? 'on' : ''}`}
                onClick={() => onCard(`${num}-pending`, title, 'pending')} disabled={capped}>
                <div className="val" style={{ color: 'var(--warning)' }}>{capped ? '—' : b.pending}</div>
                <div className="label">{num === 1 ? 'Pending (Untouched)' : num === 5 ? 'Still Working' : num === 2 ? 'Not Worked Yet' : 'Pending'}</div>
              </button>
            )}
            {num === 4 && (
              <button type="button" className={`stat-card clickable tone-lost ${open === '4-never' ? 'on' : ''}`}
                onClick={() => onCard('4-never', title, 'pending')} disabled={capped}>
                <div className="val" style={{ color: 'var(--danger)' }}>{capped ? '—' : b.pending}</div>
                <div className="label">Never Closed Out</div>
              </button>
            )}
            {ldr && (
              <>
                <button type="button" className={`stat-card clickable ${open === `${num}-cb` ? 'on' : ''}`} onClick={() => onCard(`${num}-cb`, `${title} · Call Back`, 'cb')}>
                  <div className="val">{ldr.cb}</div><div className="label"><i className="fas fa-phone-volume" /> Call Back</div>
                </button>
                <button type="button" className={`stat-card clickable tone-good ${open === `${num}-ql` ? 'on' : ''}`} onClick={() => onCard(`${num}-ql`, `${title} · Qualified`, 'ql')}>
                  <div className="val" style={{ color: 'var(--success)' }}>{ldr.ql}</div><div className="label"><i className="fas fa-circle-check" /> Qualified</div>
                </button>
                <button type="button" className={`stat-card clickable tone-lost ${open === `${num}-ls` ? 'on' : ''}`} onClick={() => onCard(`${num}-ls`, `${title} · Lost`, 'ls')}>
                  <div className="val">{ldr.ls}</div><div className="label"><i className="fas fa-ban" /> Lost / Dead</div>
                </button>
              </>
            )}
            {salesRows.map((r) => (
              <button type="button" key={r.s} className={`stat-card clickable tone-${r.s === 'order done' ? 'win' : r.s === 'lost' ? 'lost' : r.s === 'qualified' ? 'fresh' : 'wip'} ${open === `${num}-${r.s}` ? 'on' : ''}`}
                onClick={() => onCard(`${num}-${r.s}`, `${title} · ${cap(r.s)}`, r.s)}>
                <div className="val">{r.n}</div><div className="label"><i className={`fas ${SALES_ICON[r.s] || 'fa-flag'}`} /> {cap(r.s)}</div>
              </button>
            ))}
          </div>
          {capped && <div className="rep-note"><i className="fas fa-circle-info" /> {t('daRangeTooBig')}</div>}
          {!capped && b.building && <div className="rep-note"><i className="fas fa-circle-info" /> {t('daDetailBuilding')}</div>}
          {multiCalled && (
            <div className="rep-note" style={{ color: 'var(--muted)' }}>
              <i className="fas fa-circle-info" /> {fill(t('daUniqueNote'), { u: b.worked, c: b.contacts })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Purane GROW system jaisa dashboard — 4 row-group (Fresh Work / Re-Inquiry / Scheduled / Overdue)
 *  har team ke liye, familiar cards + labels. Har card click karo -> neeche us bucket ki leads list.
 *  Cost-safe: har row-group ek hi bounded query (cap 500) + client tally, 30-min cache. */
export default function TeamDashboard({ mode, role, uid, team = '', onOpenLead }) {
  const { t } = useT();
  const cfg = useConfig();
  const isAdmin = mode === 'admin';
  const focus = role === 'md' ? 'md' : role === 'tl' ? 'tl' : 'admin';
  const tlLocked = role === 'tl' && (team === 'ldr' || team === 'sales');

  const [teamRole, setTeamRole] = useState(tlLocked ? team : isAdmin ? 'ldr' : role);
  const [memberUid, setMemberUid] = useState(isAdmin ? '' : uid);
  const [rangeKey, setRangeKey] = useState('today');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const custom = cFrom && cTo;
  const [from, to] = custom ? [cFrom, cTo].sort() : rangeFor(rangeKey);
  const allTime = !custom && rangeKey === 'all';
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [crSort, setCrSort] = useState({ key: 'name', dir: 'asc' });
  const [countMode, setCountMode] = useState('unique'); // Scheduled/Off-Sched: 'unique' leads ya 'calls'

  const [b1, setB1] = useState(null);
  const [b2, setB2] = useState(null);
  const [b3, setB3] = useState(null);
  const [b5, setB5] = useState(null); // off-schedule calls
  const [workload, setWorkload] = useState(null);
  const [sources, setSources] = useState([]);
  const [states, setStates] = useState([]);
  const [openCard, setOpenCard] = useState(null); // { key, title, sel }

  // sirf asal workers — admin / md / tl dashboard ke per-person breakdown mein nahi
  const members = workerUsers(cfg).filter((u) => (teamRole === 'sales' ? u.role === 'sales' : u.role === 'ldr'));
  const memberIds = useMemo(() => members.map((u) => u.id), [members]);
  const stages = useMemo(() => salesStageList(cfg), [cfg.stages]);

  useEffect(() => {
    if (!cfg.ready) return;
    let alive = true;
    setB1(null); setB2(null); setB3(null); setB5(null); setWorkload(null);
    setSources([]); setStates([]); setOpenCard(null);
    const args = { teamRole, memberUid: memberUid || null, memberIds };

    // 4 section cards — RANGE ke liye nightly pre-computed `stats_daily` se (+ aaj LIVE).
    // Har load ~4000 reads ki jagah ~7-10. Card click par drill-down LIVE query karega.
    getDashRange({ ...args, from, to }).then((r) => {
      if (!alive) return;
      setB1(r.fresh); setB3(r.reinq); setB2(r.sched); setB5(r.offsched);
    }).catch(() => { if (alive) { setB1(false); setB2(false); setB3(false); setB5(false); } });

    if (isAdmin) {
      teamWorkloadReport({ teamRole, members, from, to, resultStatus: teamRole === 'sales' ? 'order done' : 'qualified' })
        .then((r) => alive && setWorkload(r)).catch(() => alive && setWorkload([]));
      sourceQuality(splitList(cfg.settings?.Lead_Sources)).then((r) => alive && setSources(r)).catch(() => {});
      stateVolume(splitList(cfg.settings?.State_List)).then((r) => alive && setStates(r)).catch(() => {});
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.ready, teamRole, memberUid, from, to, nonce]);

  useEffect(() => { if (refreshing) { const id = setTimeout(() => setRefreshing(false), 600); return () => clearTimeout(id); } }, [refreshing]);
  async function refresh() {
    setRefreshing(true);
    // range me aaj shaamil hai + admin -> server par aaj ka pre-agg turant refresh (warna ~90 min purana)
    if (isAdmin && to >= istToday()) { try { await refreshTodayAgg(); } catch { /* non-admin / busy — chhodo */ } }
    bustDashCache(); setNonce((n) => n + 1);
  }

  function pickRange(k) { setRangeKey(k); setCFrom(''); setCTo(''); }

  // card -> leads-list filter. Ab CHAARO sections ki list wahi pre-computed lead-id list se aati
  // hai jo getDashRange ne card ke liye use ki — isse card ka number aur niche ki list BILKUL
  // barabar. (Pehle card pre-agg se, list live query se aati thi — 1008 vs 200 ka farak.)
  function cardFilter(num, sel) {
    const b = num === 1 ? b1 : num === 3 ? b3 : num === 2 ? b2 : b5;
    if (!b || b === false) return { kind: 'ids', ids: [] };
    const work = b.leadIds || [];
    const pend = b.pendingIds || [];
    let ids; let bucketSel = sel;
    if (sel === 'total') { ids = [...work, ...pend]; bucketSel = 'total'; }
    else if (sel === 'pending' || sel === 'never') { ids = pend; bucketSel = 'total'; }
    else if (sel === 'worked' || sel === 'calls') { ids = work; bucketSel = 'total'; }
    else { ids = work; } // cb / ql / ls / exact sales-stage — status filter fetchDashLeadsAll me
    return {
      kind: 'ids', ids, bucketSel, teamRole,
      // card ne jis status se gina (wst — us range ka), drill-down bhi wahi use kare -> exact match
      statusMap: b.statusMap || null,
      // "Calls" card: har lead pe kitni baar call — badge + sort (list me lead unique hi rehta hai)
      touchCounts: sel === 'calls' ? (b.touchCounts || {}) : null,
    };
  }
  const actRef = useRef(null);
  function onCard(key, title, sel) {
    setOpenCard((cur) => {
      if (cur?.key === key) return null;
      // member-drill (calling report) apni jagah khulta hai; baaki cards niche wali table filter karte hain + scroll
      if (!key.startsWith('m-')) setTimeout(() => actRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      return { key, title, sel: sel === 'pending' && key.endsWith('-never') ? 'never' : sel, num: +key[0] };
    });
  }
  const cardOpen = openCard && !openCard.key.startsWith('m-');
  const dateLabel = allTime ? t('rAll') : from === to ? from : `${from} → ${to}`;

  const sortedWorkload = useMemo(() => {
    if (!workload) return [];
    const { key, dir } = crSort;
    const val = (r) => (key === 'name' ? (r.name || '').toLowerCase()
      : key === 'win' ? (r.worked ? r.result / r.worked : 0)
        : key === 'lastActive' ? (r.lastActive ? new Date(r.lastActive).getTime() : 0)
          : r[key] || 0);
    return [...workload].sort((a, b) => {
      const x = val(a); const y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return dir === 'asc' ? c : -c;
    });
  }, [workload, crSort]);

  return (
    <div className={`tdash focus-${focus}`}>
      {/* ---- filters ---- */}
      <div className="dfilter">
        <div className="dfilter-head"><i className="fas fa-filter" /> {t('dFilters')}</div>
        {isAdmin && !tlLocked && (
          <div className="ls-tabs" style={{ marginBottom: 10 }}>
            <button className={teamRole === 'ldr' ? 'on' : ''} onClick={() => { setTeamRole('ldr'); setMemberUid(''); }}>{t('mecaLdrTeam')}</button>
            <button className={teamRole === 'sales' ? 'on' : ''} onClick={() => { setTeamRole('sales'); setMemberUid(''); }}>{t('mecaSalesTeam')}</button>
          </div>
        )}
        <div className="tdash-bar">
          <div className="chips">
            {RANGE_PRESETS.map((q) => <button key={q.k} className={`chip ${!custom && rangeKey === q.k ? 'active' : ''}`} onClick={() => pickRange(q.k)}>{t(q.tk)}</button>)}
          </div>
          <button type="button" className={`tdash-refresh ${refreshing ? 'spin' : ''}`} onClick={refresh} title={t('dRefresh')} aria-label={t('dRefresh')}>
            <i className="fas fa-rotate" />
          </button>
        </div>
        <div className="dfilter-dates">
          <label>{t('dDateFrom')}<input type="date" className="form-control" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} /></label>
          <label>{t('dDateTo')}<input type="date" className="form-control" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} /></label>
          {custom && <button type="button" className="chip" onClick={() => { setCFrom(''); setCTo(''); }}><i className="fas fa-xmark" /> {t('dClear')}</button>}
        </div>
        {isAdmin && (
          <select className="form-control" style={{ marginTop: 10 }} value={memberUid} onChange={(e) => setMemberUid(e.target.value)}>
            <option value="">{t('dWholeTeam')}</option>
            {members.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}
      </div>

      {/* niche scroll karo tab bhi upar dikhe — kiska / kaunsi range ka data ---- */}
      <div className={`dash-ctxbar ${memberUid ? 'is-person' : ''}`}>
        <span className="dcb-who">
          <i className={`fas ${memberUid ? 'fa-user' : 'fa-users'}`} />
          {memberUid ? (userName(cfg, memberUid) || t('dWholeTeam')) : `${teamRole === 'sales' ? t('mecaSalesTeam') : t('mecaLdrTeam')} — ${t('dWholeTeam')}`}
        </span>
        <span className="dcb-range"><i className="fas fa-calendar-day" /> {dateLabel}</span>
      </div>

      {/* ---- Source Quality + Regions — sabse upar, 2-col (purane system jaisa) ---- */}
      {isAdmin && (sources.length > 0 || states.length > 0) && (
        <div className="dash-dist">
          <div className="section">
            <h3><i className="fas fa-bullhorn" style={{ color: '#e65100' }} /> {t('daSourceQuality')}<span className="sec-sub">{t('daCompanyWide')}</span></h3>
            {sources.length === 0 ? <p style={{ fontSize: 12, color: 'var(--muted)' }}>—</p> : sources.slice(0, 6).map((s) => (
              <div className="prog-row" key={s.source}>
                <div className="prog-top"><span>{s.source} · {s.total}</span><span style={{ color: s.pct > 30 ? 'var(--success)' : 'var(--danger)' }}>{s.pct}% qualified</span></div>
                <div className="prog-bg"><div className="prog-fill" style={{ width: `${s.pct}%`, background: s.pct > 30 ? 'var(--success)' : 'var(--danger)' }} /></div>
              </div>
            ))}
          </div>
          <div className="section">
            <h3><i className="fas fa-location-dot" style={{ color: 'var(--navy-accent)' }} /> {t('daRegions')}<span className="sec-sub">{t('daCompanyWide')}</span></h3>
            {states.length === 0 ? <p style={{ fontSize: 12, color: 'var(--muted)' }}>—</p> : (() => {
              const mx = Math.max(1, ...states.slice(0, 6).map((s) => s.total));
              return states.slice(0, 6).map((s) => (
                <div className="prog-row" key={s.state}>
                  <div className="prog-top"><span>{s.state} · {s.total}</span></div>
                  <div className="prog-bg"><div className="prog-fill" style={{ width: `${(s.total / mx) * 100}%`, background: 'var(--navy-accent)' }} /></div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ---- 4 row-groups (purane system jaisa) ---- */}
      <RowGroup num={1} icon="fa-star" iconColor="var(--navy-accent)"
        title={teamRole === 'sales' ? t('rgFreshSales') : t('rgFresh')} sub={t('daInRange') + ': ' + dateLabel}
        b={b1} teamRole={teamRole} stages={stages} onCard={onCard} open={openCard?.key} t={t} />

      <RowGroup num={3} icon="fa-fire" iconColor="var(--danger)"
        title={t('rgReinq')} sub={t('daInRange') + ': ' + dateLabel}
        b={b3} teamRole={teamRole} stages={stages} onCard={onCard} open={openCard?.key} t={t} />

      <RowGroup num={2} icon="fa-clock" iconColor="#e65100"
        title={teamRole === 'sales' ? t('rgSchedSales') : t('rgSched')} sub={t('daInRange') + ': ' + dateLabel}
        b={b2} teamRole={teamRole} stages={stages} onCard={onCard} open={openCard?.key} t={t}
        countMode={countMode} setCountMode={setCountMode} />

      <RowGroup num={5} icon="fa-triangle-exclamation" iconColor="var(--warning)"
        title={t('rgOffSched')} sub={t('daInRange') + ': ' + dateLabel}
        b={b5} teamRole={teamRole} stages={stages} onCard={onCard} open={openCard?.key} t={t}
        countMode={countMode} setCountMode={setCountMode} />

      {/* ---- Calling Report (admin) ---- */}
      {isAdmin && (
        <div className="section s-workload">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}><i className="fas fa-phone-volume" style={{ color: 'var(--navy-accent)' }} /> {t('daCallingReport')} — {teamRole === 'sales' ? t('mecaSalesTeam') : t('mecaLdrTeam')}
              <span className="sec-sub">{dateLabel}</span></h3>
            <div style={{ display: 'flex', gap: 6 }}>
              {(crSort.key !== 'name' || crSort.dir !== 'asc') && (
                <button type="button" className="chip" onClick={() => setCrSort({ key: 'name', dir: 'asc' })}><i className="fas fa-rotate-left" /> {t('dhReset') || 'Reset'}</button>
              )}
              <button type="button" className="chip" onClick={() => downloadCsv(`calling-report-${teamRole}-${from}_${to}.csv`,
                ['Name', 'Assigned (book)', 'Worked', 'Contacted', teamRole === 'sales' ? 'Orders' : 'Qualified', 'Win %', 'Last active'],
                (workload || []).map((r) => [r.name, r.assigned, r.worked, r.contacted, r.result, r.worked ? Math.round((r.result / r.worked) * 100) : 0, relTime(r.lastActive).text]))}>
                <i className="fas fa-file-csv" /> CSV
              </button>
            </div>
          </div>
          <div className="tablewrap" style={{ marginTop: 10 }}>
            <table className="meca-t cr-t">
              <thead>
                <tr>
                  {[['name', t('uName')], ['assigned', t('crTarget')], ['worked', t('crWorked')], ['contacted', t('crContacted')],
                    ['result', teamRole === 'sales' ? 'Order Done' : t('cQualified')], ['win', t('crWinRate')], ['lastActive', t('daLastActive')]].map(([k, lbl]) => (
                      <th key={k} onClick={() => setCrSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        {lbl} {crSort.key === k && <i className={`fas fa-caret-${crSort.dir === 'desc' ? 'down' : 'up'}`} />}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {workload == null ? (
                  <tr><td colSpan={7}><div className="skeleton" style={{ height: 50 }} /></td></tr>
                ) : workload.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('noData')}</td></tr>
                ) : sortedWorkload.map((r) => {
                  const win = r.worked ? Math.round((r.result / r.worked) * 100) : 0;
                  const la = relTime(r.lastActive);
                  return (
                    <tr key={r.uid} className="tdash-row" onClick={() => onCard(`m-${r.uid}`, r.name, 'total')} style={{ cursor: 'pointer' }}>
                      <td className="nm">{r.name}</td>
                      <td style={{ color: 'var(--muted)' }}>{r.assigned.toLocaleString('en-IN')}</td>
                      <td style={{ fontWeight: 700, color: r.worked > 0 ? 'var(--success)' : 'var(--muted)' }}>{r.worked}</td>
                      <td><span className="status-badge bg-fresh" style={{ fontSize: 10 }}>{r.contacted} <i className="fas fa-phone" /></span></td>
                      <td className="hl">{r.result}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="prog-bg" style={{ width: 44, minWidth: 44, marginTop: 0 }}><div className="prog-fill" style={{ width: `${win}%`, background: win > 30 ? 'var(--success)' : 'var(--warning)' }} /></div>
                          <span style={{ fontSize: 11, fontWeight: 700 }}>{win}%</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 11, fontWeight: 700, color: la.color }}>{la.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {openCard?.key?.startsWith('m-') && (
            <DashExpand title={openCard.title} teamRole={teamRole} memberUid={openCard.key.slice(2)} memberIds={null}
              filter={{ kind: 'all' }} onOpenLead={onOpenLead} onClose={() => setOpenCard(null)} />
          )}
        </div>
      )}

      {/* ---- Detailed Actionable Leads — purane system jaisi table; card click → yahan filter + scroll ---- */}
      <div className="section s-actionable" ref={actRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}><i className="fas fa-list" style={{ color: 'var(--navy-accent)' }} /> {t('daActionable')}
            {cardOpen && <span style={{ color: 'var(--danger)', fontSize: 12, marginLeft: 8 }}>({openCard.title})</span>}</h3>
          {cardOpen && (
            <button type="button" className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => setOpenCard(null)}><i className="fas fa-xmark" /> {t('dClear')}</button>
          )}
        </div>
        <ActionableTable
          key={cardOpen ? openCard.key : 'default'}
          teamRole={teamRole}
          memberUid={memberUid || null}
          memberIds={memberUid ? null : memberIds}
          filter={cardOpen ? cardFilter(openCard.num, openCard.sel) : { kind: 'followup_range', from, to }}
          cfg={cfg} t={t}
          onOpenLead={onOpenLead}
        />
      </div>
    </div>
  );
}

/* purane system jaisi table: Lead/Customer | Current Stage | Next Follow-up | Last Updated | Assigned To | Quick Actions.
 * Poora bucket ek saath fetch (cap 900) + client-side pagination — cursor+post-filter wali tooti hui
 * pagination (pages 2/6/0) fix. Empty page par bhi Prev button rehta hai. */
const PER = 15;
function ActionableTable({ teamRole, memberUid, memberIds, filter, cfg, t, onOpenLead }) {
  const [all, setAll] = useState(null);
  const [capped, setCapped] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    let alive = true;
    setAll(null); setPage(0);
    // 'ids' = pre-computed lead-list (card se) — poori list dikhao (card count se match ho)
    const cap = filter.kind === 'ids' ? 6000 : filter.kind === 'overdue' ? 3000 : 900;
    fetchDashLeadsAll({ teamRole, memberUid, memberIds, filter, cap })
      .then((r) => { if (alive) { setAll(r.rows); setCapped(r.capped); } })
      .catch(() => alive && setAll([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamRole, memberUid, (memberIds || []).join(','), JSON.stringify(filter)]);

  const nameOf = (uid) => (uid ? (userName(cfg, uid) || '—') : t('acUnassigned'));
  if (all == null) return <div className="skeleton" style={{ height: 120 }} />;
  const totalPages = Math.max(1, Math.ceil(all.length / PER));
  const pg = Math.min(page, totalPages - 1);
  const rows = all.slice(pg * PER, pg * PER + PER);
  return (
    <>
      {capped && <div className="rep-note"><i className="fas fa-circle-info" /> {t('daRangeTooBig')}</div>}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{fill(t('dhShowing'), { n: all.length })}</div>
      {all.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}><i className="fas fa-mug-hot" /> {t('dAllClear')}</div>
      ) : (
      <div className="tablewrap">
        <table className="meca-t ac-t">
          <thead>
            <tr><th style={{ width: 34, textAlign: 'center' }}>#</th><th>{t('uName')}</th><th>{t('acStage')}</th><th>{t('acNextFu')}</th><th>{t('acUpdated')}</th><th>{t('acAssigned')}</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const stg = teamRole === 'sales' ? (l.sales_status || l.status) : l.status;
              const [bg] = stClass(stg);
              const updOk = l.last_action_at && new Date(l.last_action_at.toDate ? l.last_action_at.toDate() : l.last_action_at) >= new Date(Date.now() - 86400000);
              return (
                <tr key={l.id}>
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{pg * PER + i + 1}</td>
                  <td className="nm"><b>{l.name || t('noName')}</b><br /><span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>{l.phone || l.phone_raw}</span></td>
                  <td>
                    <span className={`status-badge ${bg}`}>{fmtStatus(stg)}</span>
                    {l._touches > 1 && <span className="status-badge bg-default" style={{ marginLeft: 4, fontSize: 10 }}><i className="fas fa-phone" /> {l._touches}×</span>}
                  </td>
                  <td>{l.next_followup ? <b style={{ color: isPast(l.next_followup) ? 'var(--danger)' : '#e65100', fontSize: 12 }}>{fmtDate(l.next_followup)}</b> : '-'}</td>
                  <td>{l.last_action_at
                    ? <span style={{ fontSize: 11.5, fontWeight: updOk ? 700 : 400, color: updOk ? 'var(--success)' : 'var(--muted)' }}>{fmtDate(l.last_action_at)}{updOk ? ' ✓' : ''}</span>
                    : <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{t('daNever')}</span>}</td>
                  <td style={{ fontSize: 11 }}>
                    <span style={{ display: 'block', color: 'var(--muted)' }}>LDR: <b>{nameOf(l.ldr_uid)}</b></span>
                    <span style={{ display: 'block', color: 'var(--navy-accent)' }}>Sales: <b>{nameOf(l.sales_uid)}</b></span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button type="button" className="btn btn-primary" style={{ padding: '6px 10px', fontSize: 11.5, whiteSpace: 'nowrap' }} onClick={() => onOpenLead(l)}><i className="fas fa-bolt" /> {t('acAction')}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {all.length > PER && (
        <div className="pager">
          <button type="button" className="btn btn-ghost" disabled={pg === 0} onClick={() => setPage(pg - 1)}><i className="fas fa-chevron-left" /> {t('prevPage')}</button>
          <span className="pager-page">{pg + 1} / {totalPages} · {all.length}</span>
          <button type="button" className="btn btn-ghost" disabled={pg >= totalPages - 1} onClick={() => setPage(pg + 1)}>{t('nextPage')} <i className="fas fa-chevron-right" /></button>
        </div>
      )}
    </>
  );
}
