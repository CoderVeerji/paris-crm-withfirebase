// MIS Report — per-person accountability scorecard: is period mein kitni leads milin, kitni
// kaam hui, kitne followups due the, kitne complete hue — sab ek "score %" ke saath.
// Existing daily pre-agg (`stats_daily/{day}.dash[uid]`) se hi banta hai — koi naya data-pipeline
// nahi, koi extra likhna nahi. Cost: sirf `days.length` reads, TEAM SIZE se farak nahi padta
// (ek hi din ka doc sab members ke liye ek saath padha jaata hai). [[dash-preagg-dual-copy]]
// `fresh` bucket = "leads mili" (naya lead is uid ko us din assign/created hua),
// `sched` bucket = "followup due tha" (us din ke liye schedule tha).
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { daysBetween, istDay } from './stats';

// Poora saal (365) bhi ek MIS view load pe sirf 365 reads hai — is admin-only, kabhi-kabhi khulne
// waali screen ke liye trivial cost hai (daily 50k budget ke saamne kuch bhi nahi), isliye yearly
// bhi seedha support karne layak cap rakha hai.
const MIS_DAY_CAP = 400;
const MIS_TTL = 45 * 60 * 1000; // dashboardStats.js jaisa hi 45-min localStorage cache pattern

function misCacheKey(teamRole, members, from, to) {
  return `pc_mis_${teamRole}_${members.map((m) => m.id).sort().join('.')}_${from}_${to}`;
}

function mkAcc() { return { hits: {}, wst: {}, work: new Set(), pend: new Set() }; }
function merge(acc, src) {
  for (const [id, n] of Object.entries(src.hits || {})) {
    acc.hits[id] = (acc.hits[id] || 0) + n; acc.work.add(id);
    if (src.wst && src.wst[id]) acc.wst[id] = src.wst[id];
  }
  for (const id of (src.pids || [])) acc.pend.add(id);
}
function shape(acc) {
  for (const id of acc.work) acc.pend.delete(id); // kisi bhi din worked -> pending nahi
  const worked = acc.work.size; const pending = acc.pend.size; const total = worked + pending;
  return {
    total, worked, pending,
    score: total > 0 ? Math.round((worked / total) * 100) : null,
    workedIds: [...acc.work], pendingIds: [...acc.pend],
  };
}

// Ek hi "overall" number — leads + followups dono mila ke, count ke hisaab se weighted
// (sirf dono % ka average nahi — warna 3 mein se 3 (100%) ek banda 300 mein se 250 (83%) wale
// se "behtar" dikhta, jab ki asal mein zyada kaam hua doosre ne). Ek nazar mein judge karne
// layak — meeting mein "kiska report kaisa hai" dekhna ho to yahi dekho.
function overallScore(leads, followups) {
  const total = leads.total + followups.total;
  if (total === 0) return null;
  return Math.round(((leads.worked + followups.worked) / total) * 100);
}

/**
 * @param teamRole 'ldr' | 'sales'
 * @param members  [{id, full_name}] — jin logon ki row chahiye
 * @param force    true = cache ignore karo (Refresh button)
 * @returns { rows: [{uid, name, leads, followups}], team: {leads, followups}, capped, days }
 */
export async function misReport({ teamRole, members, from, to, force = false }) {
  const key = misCacheKey(teamRole, members, from, to);
  if (!force) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const { at, v } = JSON.parse(raw);
        if (Date.now() - at < MIS_TTL) return v;
      }
    } catch { /* private mode — bas fetch kar lo */ }
  }
  const v = await misReportUncached({ teamRole, members, from, to });
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* ignore */ }
  return v;
}

async function misReportUncached({ teamRole, members, from, to }) {
  const today = istDay();
  const days = daysBetween(from, to).filter((d) => d <= today);
  if (days.length === 0) return { rows: [], team: null, capped: false, days: 0 };
  if (days.length > MIS_DAY_CAP) return { rows: [], team: null, capped: true, days: days.length };

  const perUid = {}; // uid -> { leads: acc, followups: acc }
  const U = (uid) => (perUid[uid] || (perUid[uid] = { leads: mkAcc(), followups: mkAcc() }));
  let missingDays = 0;

  const snaps = await Promise.all(days.map((d) => getDoc(doc(db, 'stats_daily', d))));
  snaps.forEach((s) => {
    if (!s.exists() || !s.data().dash) { missingDays++; return; }
    const dash = s.data().dash;
    members.forEach((m) => {
      const dd = dash[m.id]; if (!dd) return;
      merge(U(m.id).leads, dd.fresh || {});
      merge(U(m.id).followups, dd.sched || {});
    });
  });

  const teamLeads = mkAcc(); const teamFu = mkAcc();
  const rows = members.map((m) => {
    const acc = perUid[m.id] || { leads: mkAcc(), followups: mkAcc() };
    // team total ke liye bhi union karo (ek hi lead do logon ke under nahi aati, safe hai)
    acc.leads.work.forEach((id) => teamLeads.work.add(id));
    acc.leads.pend.forEach((id) => teamLeads.pend.add(id));
    acc.followups.work.forEach((id) => teamFu.work.add(id));
    acc.followups.pend.forEach((id) => teamFu.pend.add(id));
    const l = shape(acc.leads); const f = shape(acc.followups);
    return { uid: m.id, name: m.full_name || m.id, leads: l, followups: f, overall: overallScore(l, f) };
  }).sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101) || (b.leads.total + b.followups.total) - (a.leads.total + a.followups.total));
  // sabse kam score (sabse zyada dhyaan chahiye) upar — meeting mein seedha unhi se shuru karo

  const teamL = shape(teamLeads); const teamF = shape(teamFu);
  return {
    rows,
    team: { leads: teamL, followups: teamF, overall: overallScore(teamL, teamF) },
    capped: missingDays > 0,
    days: days.length,
  };
}
