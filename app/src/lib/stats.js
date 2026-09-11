import {
  doc, getDoc, getDocs, setDoc, onSnapshot, serverTimestamp,
  collection, query, where, orderBy, limit, getCountFromServer,
} from 'firebase/firestore';
import { db } from '../firebase';

const IST = 5.5 * 3600 * 1000;
export function istDay(ms = Date.now()) { return new Date(ms + IST).toISOString().slice(0, 10); }
export function daysBetween(from, to) {
  const out = [];
  let c = Date.parse(from + 'T00:00:00Z');
  const e = Date.parse(to + 'T00:00:00Z');
  while (c <= e) { out.push(new Date(c).toISOString().slice(0, 10)); c += 86400000; }
  return out;
}

/** ek din ka stats doc */
export async function getDailyStat(dayStr) {
  const s = await getDoc(doc(db, 'stats_daily', dayStr));
  return s.exists() ? s.data() : null;
}

/** date-range ke saare daily docs merge — by_user + totals + (naye) pre-computed reports.
 *  Cost: 1 read PER DIN (mahina = 30 reads). Pehle dashboard yahi cheezein live queries se
 *  nikalta tha — 1,650+ reads per load. Bhaari hisaab raat mein ek baar server par ho jaata hai. */
export async function getRangeStats(fromDay, toDay, team = 'all') {
  const days = daysBetween(fromDay, toDay);
  const snaps = await Promise.all(days.map((d) => getDoc(doc(db, 'stats_daily', d))));
  const byUser = {};
  const totals = { calls: 0, qualified: 0, closed: 0, revenue: 0, lost: 0, fresh_created: 0 };
  const reports = {
    fresh: { total: 0, worked: 0, by_status: {}, by_source: {}, by_source_qualified: {} },
    reinquiry: { total: 0, worked: 0, pending: 0, by_status: {} },
    followups: { due: 0, done: 0, pending: 0, by_status: {}, exact: true },
  };
  const mergeBy = (dst, src) => { for (const [k, v] of Object.entries(src || {})) dst[k] = (dst[k] || 0) + v; };
  let have = 0;
  snaps.forEach((s) => {
    if (!s.exists()) return;
    have++;
    const d = s.data();
    for (const k of Object.keys(totals)) totals[k] += (d.totals && d.totals[k]) || 0;
    for (const [uid, u] of Object.entries(d.by_user || {})) {
      if (!byUser[uid]) byUser[uid] = { name: u.name, role: u.role, calls: 0, qualified: 0, closed: 0, revenue: 0, lost: 0 };
      byUser[uid].calls += u.calls || 0;
      byUser[uid].qualified += u.qualified || 0;
      byUser[uid].closed += u.closed || 0;
      byUser[uid].revenue += u.revenue || 0;
      byUser[uid].lost += u.lost || 0;
      if (u.name) byUser[uid].name = u.name;
      if (u.role) byUser[uid].role = u.role;
    }
    // naye pre-computed reports (raat ki aggregation se) — sirf jod dete hain.
    // team='ldr'/'sales' ho to us team ka bucket, warna poori company ka.
    const r = team === 'all' ? d.reports : (d.reports_by_team && d.reports_by_team[team]);
    if (r) {
      reports.fresh.total += r.fresh?.total || 0;
      reports.fresh.worked += r.fresh?.worked || 0;
      mergeBy(reports.fresh.by_status, r.fresh?.by_status);
      mergeBy(reports.fresh.by_source, r.fresh?.by_source);
      mergeBy(reports.fresh.by_source_qualified, r.fresh?.by_source_qualified);
      reports.reinquiry.total += r.reinquiry?.total || 0;
      reports.reinquiry.worked += r.reinquiry?.worked || 0;
      reports.reinquiry.pending += r.reinquiry?.pending || 0;
      mergeBy(reports.reinquiry.by_status, r.reinquiry?.by_status);
      reports.followups.due += r.followups?.due || 0;
      reports.followups.done += r.followups?.done || 0;
      reports.followups.pending += r.followups?.pending || 0;
      mergeBy(reports.followups.by_status, r.followups?.by_status);
      if (r.followups?.exact === false) reports.followups.exact = false;
    }
  });
  return { byUser, totals, reports, daysWithData: have, daysAsked: days.length };
}

export async function getCohortMonths(nMonths = 6) {
  const snap = await getDocs(query(collection(db, 'stats_cohort'), orderBy('month', 'desc'), limit(nMonths)));
  return snap.docs.map((d) => d.data()).reverse();
}

export async function getLatestWeekly() {
  const snap = await getDocs(query(collection(db, 'reports_weekly'), orderBy('week_start', 'desc'), limit(1)));
  return snap.empty ? null : snap.docs[0].data();
}
export async function listWeekly(n = 60) {
  const snap = await getDocs(query(collection(db, 'reports_weekly'), orderBy('week_start', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** live count — kisi query ka */
export async function countWhere(colName, wheres) {
  let q = collection(db, colName);
  q = query(q, ...wheres);
  const s = await getCountFromServer(q);
  return s.data().count;
}

/** admin task doc likho + result ka wait karo (Cloud Function trigger karta hai).
 *  onProgress({done,total}) live update deta hai. */
function runAdminTask(id, extra = {}, onProgress, timeoutMs = 540000) {
  const ref = doc(db, 'admin_tasks', id);
  return setDoc(ref, { ...extra, status: 'pending', progress: null, result: null, error: null, requested_at: serverTimestamp() })
    .then(() => new Promise((resolve, reject) => {
      const started = Date.now();
      let sawServer = false;
      const unsub = onSnapshot(ref, (s) => {
        const d = s.data();
        if (!d) return;
        if (d.requested_at == null) return; // local echo, serverTimestamp pending
        sawServer = true;
        if (d.progress && onProgress) onProgress(d.progress);
        if (d.status === 'done') { unsub(); clearInterval(iv); resolve(d.result || {}); }
        else if (d.status === 'error') { unsub(); clearInterval(iv); reject(new Error(d.error || 'task failed')); }
      }, (e) => { unsub(); clearInterval(iv); reject(e); });
      const iv = setInterval(() => {
        if (Date.now() - started > timeoutMs) { clearInterval(iv); unsub(); reject(new Error(sawServer ? 'still running — check back in a minute' : 'function did not respond — deploy / permission issue?')); }
      }, 5000);
    }));
}
export const backfillStats = (from, to, onProgress) => runAdminTask('backfill', { from, to }, onProgress);
/** sel = { week_num, year } (kisi purane week ke liye) ya undefined (aakhri poora week) */
export const runWeekly = (sel, onProgress) => runAdminTask(
  'weekly',
  sel && sel.week_num ? { week_num: sel.week_num, year: sel.year } : {},
  onProgress,
);
export const rescoreLeads = (onProgress) => runAdminTask('rescore', {}, onProgress);
/** Aaj ka dashboard pre-agg (stats_daily.dash) turant refresh — admin-only (server par ~2-3s). */
export const refreshTodayAgg = () => runAdminTask('agg_today', {}, null, 60000);
/** Kisi bhi user ko ek test push bhejo — bina lead banaye push turant test karne ke liye. */
export const sendTestPush = (targetUid) => runAdminTask('test_push', { target_uid: targetUid }, null, 20000);
/** User ka login email badlo (Auth + doc dono — Cloud Function). */
export const changeUserEmail = (uid, email) => runAdminTask('user_email', { target_uid: uid, new_email: email }, null, 30000);
/** User ko permanently delete karo (Auth + doc). force=true -> leads assigned hote hue bhi delete. */
export const deleteUserAccount = (uid, force = false) => runAdminTask('user_delete', { target_uid: uid, force }, null, 30000);

/** per-user overdue followup counts */
export async function overdueByUser(users) {
  const out = {};
  await Promise.all(users.map(async (u) => {
    const field = u.role === 'sales' ? 'sales_uid' : 'ldr_uid';
    try {
      out[u.id] = await countWhere('leads', [where(field, '==', u.id), where('next_followup', '<', new Date())]);
    } catch { out[u.id] = 0; }
  }));
  return out;
}
