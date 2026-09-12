import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { fmtMoney } from '../lib/format';
import { getDailyStat, istDay, overdueByUser, sendTestPush } from '../lib/stats';
import { updateUser } from '../lib/admin';
import { toast } from '../toast';
import { buildText, buildImage, shareOrSave, clockStr, dur } from '../lib/monitorReport';

const RELOAD_MS = 90_000;
const OD_CACHE_MS = 240_000;
const LIVE_MIN = 10;     // app open in last 10 min      -> "LIVE" tag (no top card)
const WORK_FRESH_MIN = 45; // worked a lead < 45 min ago  -> "working"
const STALL_HRS = 4;    // no work 4h+ (or nothing all day past 11am) -> "stalled"

const tsMs = (v) => {
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  const d = new Date(v); return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};
const teamOf = (role) => (role === 'sales' ? 'sales' : 'ldr');
const istMidnightMs = () => {
  const d = new Date(Date.now() + 5.5 * 3600000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 5.5 * 3600000;
};
const istHour = () => new Date(Date.now() + 5.5 * 3600000).getUTCHours();

/** present + presence(last_seen) + real work(last_worked_at, today only) se state */
function deriveState({ seenMs, workMs, present, todayStart, hour, loginMs }) {
  if (!present) return 'absent';
  const seenMin = seenMs ? (Date.now() - seenMs) / 60000 : Infinity;
  // abhi-abhi (last LIVE_MIN) app use kar raha hai -> "Stuck 4h+" mein galat lagega, chahe
  // uski last lead-work purani ho. Live ho to "Not working" mein dikhao, "Stuck" nahi.
  const isLiveNow = seenMin < LIVE_MIN;
  const workedToday = workMs >= todayStart;
  const workMin = workedToday ? (Date.now() - workMs) / 60000 : Infinity;
  if (workMin < WORK_FRESH_MIN) return 'working';
  if (workMin < STALL_HRS * 60) return 'idle';          // aaj kaam kiya, thoda ruke (<4h)
  if (workedToday) return isLiveNow ? 'idle' : 'stalled'; // aaj kaam kiya phir 4h+ se ruke
  // aaj abhi tak kuch nahi kiya:
  if (hour < 11) return seenMin < 8 ? 'idle' : 'offline'; // subah — abhi shuru nahi
  // din chadh gaya, aaj 0 kaam — par "kab se" 0 kaam ye dekhna zaroori hai. `loginMs` (session
  // start, ek baar set hota hai app khulne par) se pata chalta hai banda AAJ kab active hua —
  // `seenMs` yahan kaam nahi aayega kyunki wo har 2 min heartbeat se refresh hota rehta hai
  // (tab khuli rakhne se hamesha "abhi" dikhega). Abhi-abhi aaya ho (<4h) to seedha "stalled"
  // mat bolo — bas "idle" (thoda time do). Isi wajah se "34 min pehle active" waala bhi galat
  // se 4h+ Stuck mein aa raha tha.
  const arrivedToday = loginMs >= todayStart ? loginMs : 0;
  const arrivedMin = arrivedToday ? (Date.now() - arrivedToday) / 60000 : Infinity;
  return (isLiveNow || arrivedMin < STALL_HRS * 60) ? 'idle' : 'stalled';
}
const STATE_LEGACY = { working: 'online', idle: 'idle', stalled: 'never', absent: 'offline', offline: 'offline' };
const ST_CLS = { working: 'on', idle: 'idle', stalled: 'stall', offline: 'off', absent: 'off', never: 'stall' };

const TILE = [
  { k: 'working', lbl: 'lmTWorking', icon: 'fa-bolt', tone: 'ok' },
  { k: 'idle', lbl: 'lmTNotWorking', icon: 'fa-pause', tone: 'warn' },
  { k: 'stalled', lbl: 'lmTStalled', icon: 'fa-triangle-exclamation', tone: 'bad' },
  { k: 'pushoff', lbl: 'lmPushOff', icon: 'fa-bell-slash', tone: 'warn' },
  { k: 'absent', lbl: 'lmTAbsent', icon: 'fa-user-xmark', tone: 'mut' },
];

export default function LiveMonitor() {
  const { t } = useT();
  const { user } = useAuth();
  const actor = { uid: user.id, name: user.full_name };
  const isAdmin = user.role === 'admin';

  const [rows, setRows] = useState(null);
  const [ts, setTs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(null);
  const [team, setTeam] = useState('');
  const [q, setQ] = useState('');
  const odCache = useRef({ at: 0, data: {} });

  const load = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    setBusy(true);
    try {
      const [usersSnap, stat] = await Promise.all([getDocs(collection(db, 'users')), getDailyStat(istDay())]);
      const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((u) => ['sales', 'ldr'].includes(u.role) && (u.status || 'active') === 'active');

      let overdue = odCache.current.data;
      if (Date.now() - odCache.current.at > OD_CACHE_MS) {
        overdue = await overdueByUser(users);
        odCache.current = { at: Date.now(), data: overdue };
      }

      const byUser = (stat && stat.by_user) || {};
      const todayStart = istMidnightMs();
      const hour = istHour();

      const list = users.map((u) => {
        const s = byUser[u.id] || { calls: 0, qualified: 0, closed: 0, revenue: 0 };
        const loginMs = tsMs(u.last_login);
        const seenMs = Math.max(tsMs(u.last_seen), loginMs);
        const workMs = tsMs(u.last_worked_at);
        const present = (u.attendance || 'Present') === 'Present';
        const state = deriveState({ seenMs, workMs, present, todayStart, hour, loginMs });
        const live = present && seenMs && (Date.now() - seenMs) / 60000 < LIVE_MIN;
        const push = (u.fcm_tokens || []).length > 0;
        const result = u.role === 'sales' ? (s.closed || 0) : (s.qualified || 0);
        const od = overdue[u.id] || 0;
        const worked = (s.calls || 0) + result;
        const workedTodayTs = workMs >= todayStart ? workMs : 0;

        const flags = [];
        if (state === 'stalled') {
          flags.push(workedTodayTs
            ? fill(t('lmFStalled'), { a: agoShort(workedTodayTs, t) })
            : t('lmFNoWorkToday'));
        }
        if (present && !u.last_login) flags.push(t('lmFlagNever'));
        if (present && !push) flags.push(t('lmFlagPushOff'));
        if (state === 'idle' && worked === 0) flags.push(t('lmFlagIdleNoWork'));
        if (od >= 15) flags.push(fill(t('lmFlagOverdue'), { n: od }));

        return {
          id: u.id, name: u.full_name || u.email || '—', role: u.role, team: teamOf(u.role),
          state, live, status: STATE_LEGACY[state] || 'offline',
          present, push, devices: (u.fcm_tokens || []).length,
          seenMs, workedTodayTs, lastAct: seenMs,
          sessionMs: live && tsMs(u.last_login) ? Date.now() - tsMs(u.last_login) : 0,
          calls: s.calls || 0, result, revenue: s.revenue || 0, overdue: od, worked, flags,
        };
      });

      const rank = (r) => {
        if (r.state === 'stalled') return 0;
        if (r.flags.length) return 1;
        if (r.state === 'idle') return 2;
        if (r.state === 'absent') return 5;
        if (r.state === 'working') return 3;
        return 4;
      };
      list.sort((a, b) => rank(a) - rank(b) || b.overdue - a.overdue || b.worked - a.worked);
      setRows(list);
      setTs(new Date());
    } catch (e) {
      console.error('monitor load', e);
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    const iv = setInterval(load, RELOAD_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const sum = useMemo(() => {
    const r = rows || [];
    return {
      total: r.length,
      live: r.filter((x) => x.live).length,
      working: r.filter((x) => x.state === 'working').length,
      idle: r.filter((x) => x.state === 'idle').length,
      stalled: r.filter((x) => x.state === 'stalled').length,
      pushoff: r.filter((x) => x.present && !x.push).length,
      absent: r.filter((x) => x.state === 'absent').length,
      present: r.filter((x) => x.present).length,
      attn: r.filter((x) => x.flags.length && x.state !== 'absent').length,
    };
  }, [rows]);

  const FILT = {
    live: (r) => r.live,
    working: (r) => r.state === 'working',
    idle: (r) => r.state === 'idle',
    stalled: (r) => r.state === 'stalled',
    pushoff: (r) => r.present && !r.push,
    absent: (r) => r.state === 'absent',
  };
  const TILE_LBL = Object.fromEntries(TILE.map((x) => [x.k, x.lbl]));

  const teamStats = (l) => ({
    total: l.length,
    working: l.filter((x) => x.state === 'working').length,
    stalled: l.filter((x) => x.state === 'stalled').length,
    absent: l.filter((x) => x.state === 'absent').length,
  });

  const groups = useMemo(() => {
    const src = rows || [];
    const kw = q.trim().toLowerCase();
    // Absent log default list me nahi — sirf jab "Absent" card / filter chuna ho
    const match = (r) => (r.state !== 'absent' || filter === 'absent')
      && (!filter || FILT[filter](r)) && (!kw || r.name.toLowerCase().includes(kw));
    const defs = [
      { key: 'ldr', label: t('mecaLdrTeam') },
      { key: 'sales', label: t('mecaSalesTeam') },
    ].filter((g) => !team || team === g.key);
    return defs.map((g) => {
      const all = src.filter((r) => r.team === g.key);
      return { ...g, rows: all.filter(match), stats: teamStats(all) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, team, q, t]);

  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);

  const fullGroups = () => ['ldr', 'sales'].map((k) => ({
    key: k, label: k === 'ldr' ? t('mecaLdrTeam') : t('mecaSalesTeam'),
    rows: (rows || []).filter((r) => r.team === k), stats: teamStats((rows || []).filter((r) => r.team === k)),
  }));

  async function exportImage() {
    if (!rows) return;
    try {
      const blob = await buildImage(fullGroups(), { ...sum, online: sum.live, pushOff: (rows || []).filter((r) => !r.push).length, overdue: (rows || []).reduce((a, r) => a + r.overdue, 0) });
      const res = await shareOrSave(blob, `team-status-${istDay()}.png`);
      if (res === 'saved') toast(t('lmImgSaved'));
    } catch (e) { console.error(e); toast(t('loadFail'), 'err'); }
  }
  async function copyText() {
    if (!rows) return;
    try { await navigator.clipboard.writeText(buildText(fullGroups(), { ...sum, online: sum.live, pushOff: (rows || []).filter((r) => !r.push).length, overdue: (rows || []).reduce((a, r) => a + r.overdue, 0) })); toast(t('lmCopied')); }
    catch { toast(t('loadFail'), 'err'); }
  }
  async function poke(r) {
    try { await sendTestPush(r.id); toast(t('lmPushSent')); }
    catch (e) { console.error(e); toast(t('loadFail'), 'err'); }
  }
  async function toggleAttendance(r) {
    setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, present: !x.present } : x)));
    try { await updateUser(r.id, { attendance: r.present ? 'Absent' : 'Present' }, { full_name: r.name, attendance: r.present ? 'Present' : 'Absent' }, actor); }
    catch (e) { console.error(e); toast(t('loadFail'), 'err'); load(); }
  }

  const workLine = (r) => {
    if (r.state === 'absent') return t('lmAbsent');
    if (r.workedTodayTs) {
      return fill(t('lmLastWorked'), { c: clockStr(r.workedTodayTs), a: agoShort(r.workedTodayTs, t) });
    }
    return t('lmNoWorkYet');
  };
  const seenLine = (r) => {
    if (r.live) return fill(t('lmLiveActive'), { t: dur(r.sessionMs) });
    if (!r.seenMs) return t('lmStNever');
    return fill(t('lmAppSeen'), { a: agoShort(r.seenMs, t) });
  };

  if (rows == null) return <div className="skeleton" style={{ height: 340 }} />;

  return (
    <div className="lm">
      <div className="lm-top">
        <div className="lm-live">
          <span className="lm-pulse" />
          {ts && `${t('lmUpdated')} ${ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
          {busy && ' · …'}
        </div>
        <div className="lm-actions">
          <button type="button" className="chip" onClick={load} disabled={busy}><i className="fas fa-rotate" /> {t('lmRefresh')}</button>
          <button type="button" className="chip" onClick={copyText}><i className="fas fa-comment-dots" /> {t('lmCopyMsg')}</button>
          <button type="button" className="chip lm-img" onClick={exportImage}><i className="fas fa-image" /> {t('lmExportImg')}</button>
        </div>
      </div>

      <div className="lm-tiles">
        {TILE.map((x) => {
          const tone = (x.k === 'stalled' || x.k === 'pushoff' || x.k === 'idle') && !sum[x.k] ? 'mut'
            : x.k === 'absent' && !sum.absent ? 'mut' : x.tone;
          return (
            <button type="button" key={x.k}
              className={`lm-tile tone-${tone} ${filter === x.k ? 'on' : ''}`}
              onClick={() => setFilter((f) => (f === x.k ? null : x.k))}>
              <i className={`fas ${x.icon}`} />
              <div className="lm-tile-n">{sum[x.k]}</div>
              <div className="lm-tile-l">{t(x.lbl)}</div>
            </button>
          );
        })}
      </div>

      <p className="lm-legend">{fill(t('lmLegend2'), { p: sum.present, n: sum.total })}</p>

      <div className="lm-filters">
        <div className="searchwrap">
          <i className="fas fa-magnifying-glass" />
          <input className="form-control" placeholder={t('lmSearchName')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="lf-seg">
          {[['', t('cAll')], ['ldr', t('mecaLdrTeam')], ['sales', t('mecaSalesTeam')]].map(([v, lbl]) => (
            <button key={v || 'all'} type="button" className={team === v ? 'on' : ''} onClick={() => setTeam(v)}>{lbl}</button>
          ))}
        </div>
      </div>

      {filter ? (
        <div className="pickbar">
          <i className="fas fa-filter" />
          <b>{shownCount}</b>
          <span>{t(TILE_LBL[filter])}</span>
          <button type="button" onClick={() => setFilter(null)}><i className="fas fa-xmark" /> {t('dClear')}</button>
        </div>
      ) : !q && !team && sum.stalled > 0 ? (
        <button type="button" className="lm-alert" onClick={() => setFilter('stalled')}>
          <i className="fas fa-triangle-exclamation" /> {fill(t('lmStalledAlert'), { n: sum.stalled })}
        </button>
      ) : !q && !team && sum.attn > 0 ? (
        <div className="lm-alert soft"><i className="fas fa-circle-info" /> {fill(t('lmNeedAttention'), { n: sum.attn })}</div>
      ) : !q && !team ? (
        <div className="lm-ok"><i className="fas fa-circle-check" /> {t('lmAllGood')}</div>
      ) : null}

      {shownCount === 0 && <div className="empty"><i className="fas fa-inbox" /> {t('lmNoMatch')}</div>}

      {groups.map((g) => (g.rows.length === 0 ? null : (
        <div className="lm-group" key={g.key}>
          <div className="lm-ghead">
            <span className="lm-gname">{g.label}</span>
            <span className="lm-gstat">
              <b className="o">{g.stats.working}</b> {t('lmTWorking')} · <b className="r">{g.stats.stalled}</b> {t('lmTStalled')} · <b className="a">{g.stats.absent}</b> {t('lmTAbsent')}
            </span>
          </div>
          <div className="lm-list">
            {g.rows.map((r) => (
              <div className={`lm-card s-${ST_CLS[r.state]} ${r.state === 'stalled' ? 'flagged' : ''}`} key={r.id}>
                <div className="lm-card-main">
                  <div className="lm-name">
                    <span className={`lm-dot ${ST_CLS[r.state]}`} />
                    {r.name}
                    <em>{r.role}</em>
                    {r.live && <span className="lm-att p">{t('lmLiveTag')}</span>}
                    {!r.present && <span className="lm-att a">{t('lmAbsent')}</span>}
                    {r.present && !r.push && <span className="lm-att o"><i className="fas fa-bell-slash" /> {t('lmPushOffShort')}</span>}
                  </div>
                  <div className="lm-line">
                    <span className={`lm-st ${ST_CLS[r.state]}`}><i className="fas fa-bolt" /> {workLine(r)}</span>
                    <span className="lm-push"><i className="fas fa-mobile-screen" /> {seenLine(r)}</span>
                  </div>
                  <div className="lm-work">
                    <span className="lm-work-lbl">{t('rToday')}:</span>
                    <span><i className="fas fa-phone" /> {r.calls} {t('lmCalls')}</span>
                    <span><i className="fas fa-circle-check" /> {r.result} {r.role === 'sales' ? t('lmOrders') : t('lmQualified')}</span>
                    {r.revenue > 0 && <span><i className="fas fa-sack-dollar" /> {fmtMoney(r.revenue)}</span>}
                    {r.overdue > 0 && <span className="over"><i className="fas fa-clock" /> {r.overdue} {t('lmOverdue')}</span>}
                  </div>
                  {r.flags.length > 0 && (
                    <div className="lm-flags">{r.flags.map((f) => <span key={f}>{f}</span>)}</div>
                  )}
                </div>
                {isAdmin && (
                  <div className="lm-do">
                    <button type="button" title={t('lmTestPush')} onClick={() => poke(r)}><i className="fas fa-paper-plane" /></button>
                    <button type="button" className={r.present ? '' : 'on'} title={r.present ? t('lmMarkAbsent') : t('lmMarkPresent')} onClick={() => toggleAttendance(r)}>
                      <i className={`fas ${r.present ? 'fa-user-xmark' : 'fa-user-check'}`} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )))}

      <p className="lm-foot">{t('lmAutoNote2')}</p>
    </div>
  );
}

function agoShort(ms, t) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return t('lmAgoNow');
  if (m < 60) return fill(t('lmAgoMin'), { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return fill(t('lmAgoHr'), { n: h });
  return fill(t('lmAgoDay'), { n: Math.floor(h / 24) });
}
