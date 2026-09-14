// Team Dashboard (admin ka rich view + LDR/Sales ka apna personal view) ke saare live aggregation
// helpers. Rule: jo data HAMESHA-BADHTA (unbounded) hai — sirf count() queries (1 read, size se
// farak nahi padta). Jo data ek chhoti range tak bounded hai — fetch karke client-side tally.
import {
  collection, query, where, getDocs, getCountFromServer, orderBy, limit as fbLimit, documentId,
  doc, getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { dayStart, dayEnd } from './daterange';
import { ownedBy } from './leadStage';
import { istDay, daysBetween } from './stats';

const cnt = async (...w) => (await getCountFromServer(query(collection(db, 'leads'), ...w))).data().count;

const CACHE_TTL = 45 * 60 * 1000; // 45 min — filter badalne / dubara khulne par dobara fetch nahi (reads bachao)
// har deploy pe dashboard cache apne aap invalid — build-time key ka hissa hai.
// localStorage use karte hain (sessionStorage nahi) — phone par log app baar-baar khol/band karte
// hain, tab-close hote hi sessionStorage mit jaata tha aur 45-min cache kabhi kaam hi nahi aata tha.
const CACHE_VER = (typeof __BUILD_TIME__ !== 'undefined' ? String(__BUILD_TIME__) : 'v1').replace(/\D/g, '').slice(-8) || 'v1';
const CK = (k) => `pc_${CACHE_VER}_${k}`;

// Ek baar per app-load — purane build ke chhoote pc_ keys (jinka CACHE_VER ab match nahi karta)
// saaf karo. localStorage sessionStorage jaisa apne-aap khaali nahi hota, har naye deploy ke baad
// purani cache entries hamesha ke liye padi rehtin agar ye safai na ho.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('pc_') && !k.startsWith(`pc_${CACHE_VER}_`)) localStorage.removeItem(k);
  }
} catch { /* private mode — kuch nahi */ }

/** Refresh button dabaya — poora dashboard cache saaf, agli fetch fresh Firestore se. */
export function bustDashCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pc_')) localStorage.removeItem(k);
    }
  } catch { /* private mode — kuch nahi */ }
}

function cached(rawKey, fn) {
  const key = CK(rawKey);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { at, v } = JSON.parse(raw);
      if (Date.now() - at < CACHE_TTL) return Promise.resolve(v);
      localStorage.removeItem(key); // expire ho chuki — turant hata do
    }
  } catch { /* private mode / quota — bas fetch kar lo */ }
  return fn().then((v) => {
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* ignore (quota/private) */ }
    return v;
  });
}

export function fieldsFor(teamRole) {
  return teamRole === 'sales'
    ? { ownerField: 'sales_uid', statusField: 'sales_status' }
    : { ownerField: 'ldr_uid', statusField: 'status' };
}

/** Ek specific member chuna ho to seedha uski uid se filter karo. "Whole team" (koi member nahi
 * chuna) ho to bhi TEAM tak hi scope rakhna zaroori hai — poori company nahi dikhani chahiye,
 * isliye us team ke saare members ki uid-list se `in` filter lagate hain (Firestore `in` max 30
 * values leta hai — is app ke team-size ke liye kaafi hai). Bina isके "Whole team" company-wide
 * (poore 2500+ leads ka) number dikha deta, jo galat hota — LDR/Sales dono ke numbers mila kar. */
function ownerScope(ownerField, memberUid, memberIds) {
  if (memberUid) return [where(ownerField, '==', memberUid)];
  if (memberIds && memberIds.length) return [where(ownerField, 'in', memberIds.slice(0, 30))];
  return [];
}

const SAFE_FETCH_CAP = 500; // isse zyada ho to sirf count() dikhao, poori list fetch mat karo

/** count() pehle (hamesha safe), tabhi detail-fetch karo jab range chhota nikle — range chahe
 * "Today" ho ya "This Month", कभी unbounded fetch nahi karta. */
async function safeRangeDetail(baseWhere, extraFilterFn) {
  const total = await cnt(...baseWhere);
  if (total === 0 || total > SAFE_FETCH_CAP) return { total, matched: total === 0 ? 0 : null };
  const snap = await getDocs(query(collection(db, 'leads'), ...baseWhere));
  let matched = 0;
  snap.forEach((d) => { if (extraFilterFn(d.data())) matched++; });
  return { total, matched };
}

/** 1) Snapshot — Total / New (range mein bani) / Old (range mein touch hui, range se pehle ki) /
 *  Worked (range mein koi bhi action) / Pending (backlog).  `total` sirf "All Time" pe dikhta hai. */
export async function snapshotStats({ teamRole, memberUid, memberIds, from, to }) {
  const { ownerField } = fieldsFor(teamRole);
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const rangeStart = dayStart(from);
  const rangeEnd = dayEnd(to);

  const [total, newR, touchedR, workedR, dueR] = await Promise.all([
    cnt(...owner),
    safeRangeDetail([...owner, where('created_at', '>=', rangeStart), where('created_at', '<=', rangeEnd)], () => true),
    safeRangeDetail([...owner, where('last_action_at', '>=', rangeStart), where('last_action_at', '<=', rangeEnd)],
      (l) => l.created_at?.toDate && l.created_at.toDate() < rangeStart),
    cnt(...owner, where('last_action_at', '>=', rangeStart), where('last_action_at', '<=', rangeEnd)),
    safeRangeDetail([...owner, where('next_followup', '>=', rangeStart), where('next_followup', '<=', rangeEnd)],
      (l) => !(l.last_action_at?.toDate && l.last_action_at.toDate() >= rangeStart)),
  ]);

  // fresh-pool (sirf team-level LDR — fresh leads ka owner nahi hota) — hamesha count()-only, unbounded-safe.
  let freshPending = 0;
  if (teamRole === 'ldr' && !memberUid) freshPending = await cnt(where('status', 'in', ['fresh', 'new']));
  else if (teamRole === 'ldr' && memberUid) freshPending = await cnt(where(ownerField, '==', memberUid), where('status', 'in', ['fresh', 'new']));

  return {
    total,
    new: newR.matched ?? newR.total,
    old: touchedR.matched,
    worked: workedR,
    pending: (dueR.matched ?? 0) + freshPending,
  };
}

/** Ek hi query se range ka poora slice — is range mein BANI leads, unhe client-side group karke
 *  status / source / state — sab ek saath. Isse Status-breakdown, Source aur Region teeno sections
 *  selected range ke hisaab se badalte hain, bina naye composite index ke.
 *  Range bada ho (All Time — 500+ leads) to `capped:true` — caller whole-book count() pe fallback kare. */
export function rangeSlice(args) {
  const { teamRole, memberUid, from, to } = args;
  return cached(`pc_slice_${teamRole}_${memberUid || 'team'}_${from}_${to}`, () => rangeSliceUncached(args));
}
async function rangeSliceUncached({ teamRole, memberUid, memberIds, from, to }) {
  const { ownerField, statusField } = fieldsFor(teamRole);
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const base = [...owner, where('created_at', '>=', dayStart(from)), where('created_at', '<=', dayEnd(to))];
  const total = await cnt(...base);
  if (total === 0) return { capped: false, total: 0, byStatus: {}, bySource: {}, byState: {} };
  if (total > SAFE_FETCH_CAP) return { capped: true, total };
  const snap = await getDocs(query(collection(db, 'leads'), ...base));
  const byStatus = {}; const bySource = {}; const bySourceQ = {}; const byState = {};
  snap.forEach((d) => {
    const l = d.data();
    const st = String(l[statusField] || l.status || 'fresh').toLowerCase().trim() || 'fresh';
    byStatus[st] = (byStatus[st] || 0) + 1;
    const src = (l.source || '').trim();
    if (src) {
      bySource[src] = (bySource[src] || 0) + 1;
      if (String(l.status || '').toLowerCase() === 'qualified') bySourceQ[src] = (bySourceQ[src] || 0) + 1;
    }
    const stt = (l.state || '').trim(); if (stt) byState[stt] = (byState[stt] || 0) + 1;
  });
  return { capped: false, total, byStatus, bySource, bySourceQ, byState };
}

/** Purane system jaisa "row-group" — ek primary filter (fresh / scheduled / re-inquiry / overdue),
 *  us range ki leads ek query se laao (cap 500), phir client-side Total / Pending / status-wise tally.
 *  Bada range (All) ho to sirf `total` count(); pending/byStatus null (`capped`).
 *
 *  Pending ka matlab kind ke hisaab se:
 *   - fresh: status abhi bhi fresh/new (kisi ne uthaya hi nahi)
 *   - scheduled / reinquiry: is range mein koi action nahi hua (last_action_at range mein nahi)
 *   - overdue: touched-in-range nahi (yani "never closed out")
 */
export async function bucketStats({ teamRole, memberUid, memberIds, kind, from, to, cap = SAFE_FETCH_CAP }) {
  const { ownerField } = fieldsFor(teamRole);
  const isSales = teamRole === 'sales';
  const isReinq = kind === 'reinquiry';
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const rs = dayStart(from); const re = dayEnd(to);
  const prim = kind === 'fresh' ? [where('created_at', '>=', rs), where('created_at', '<=', re)]
    : kind === 'scheduled' ? [where('next_followup', '>=', rs), where('next_followup', '<=', re)]
      : isReinq ? [where('is_urgent', '==', true)] // re-inquiry: is_urgent leads, range client-side (urgent_at)
        : [where('next_followup', '<', rs)]; // overdue
  const base = [...owner, ...prim];
  // "scheduled" aur "reinquiry" client-side extra filter karte hain (team-ownership / urgent_at),
  // isliye `total` bhi fetched+filtered set se aata hai — card ki ginti list se exactly match ho.
  const isSched = kind === 'scheduled';
  const clientTotal = isReinq || isSched;
  const rCap = clientTotal ? Math.max(cap, 2000) : cap;

  return cached(`pc_bkt_${kind}_${teamRole}_${memberUid || 't'}_${from}_${to}`, async () => {
    const total = await cnt(...base);
    if (total === 0) return { total: 0, pending: 0, worked: 0, byStatus: {}, capped: false };
    if (total > rCap) return { total, pending: null, worked: null, byStatus: null, capped: true };
    const snap = await getDocs(query(collection(db, 'leads'), ...base, fbLimit(rCap)));
    let pending = 0; let rTotal = 0; const byStatus = {};
    snap.forEach((d) => {
      const l = d.data();
      if (isReinq) {
        // re-inquiry us range mein hui? (naye leads pe urgent_at; purane migrated pe fallback updated_at)
        const ua = l.urgent_at?.toDate ? l.urgent_at.toDate() : (l.updated_at?.toDate ? l.updated_at.toDate() : null);
        if (!ua || ua < rs || ua > re) return;
      }
      // "Scheduled" = us team ka apna followup. Qualified/hand-off ho chuki (ya band) lead
      // dusri team ki plate pe hai — LDR ke scheduled mein sales-owned lead nahi aani chahiye.
      if (isSched && !ownedBy(l, teamRole)) return;
      rTotal += 1;
      // Sales side: sirf `sales_status` dekho — LDR ka `status` (jaise "qualified") fallback NAHI.
      // Sales ne abhi touch nahi kiya (sales_status khaali/qualified) = Pending.
      const st = isSales
        ? String(l.sales_status || '').toLowerCase().trim()
        : String(l.status || '').toLowerCase().trim();
      const ta = l.last_action_at?.toDate ? l.last_action_at.toDate() : null;
      const salesUntouched = isSales && (st === '' || st === 'qualified' || st === 'fresh' || st === 'new');
      let isPending;
      if (kind === 'fresh') isPending = salesUntouched || st === 'fresh' || st === 'new' || st === '';
      else if (kind === 'overdue') isPending = salesUntouched || !(ta && ta >= rs);
      else if (isReinq) isPending = l.reinq_open || salesUntouched || ['fresh', 'new', ''].includes(st);
      // "Scheduled" me re-inquiry ke baad owner ne kaam nahi kiya = abhi pending
      else isPending = l.reinq_open || salesUntouched || !(ta && ta >= rs && ta <= re);
      if (isPending) pending += 1;
      else byStatus[st || 'other'] = (byStatus[st || 'other'] || 0) + 1;
    });
    const outTotal = clientTotal ? rTotal : total;
    return { total: outTotal, pending, worked: outTotal - pending, byStatus, capped: false };
  });
}

/** Personal "is range mein maine kya kiya" — SIRF apni activity se (uid==me), taaki MECA/Calling
 *  Report ke saath number exactly match ho. Sales/LDR personal dashboard ke top pe dikhta hai.
 *  handled = unique leads touched, calls = total touches, orders = order-done events, revenue,
 *  qualified = qualify events. 30-min cached. */
export async function personalActivitySummary({ uid, from, to }) {
  return cached(`pc_persum_${uid}_${from}_${to}`, async () => {
    const snap = await getDocs(query(
      collection(db, 'activity'),
      where('uid', '==', uid),
      where('at', '>=', dayStart(from)), where('at', '<=', dayEnd(to)),
      orderBy('at', 'desc'), fbLimit(2000),
    ));
    const leads = new Set(); let calls = 0; let orders = 0; let revenue = 0; let qualified = 0;
    snap.forEach((d) => {
      const a = d.data();
      calls += 1;
      if (a.lead_id) leads.add(a.lead_id);
      const toS = String(a.to_status || '').toLowerCase();
      if (a.action === 'order' || toS.includes('order')) { orders += 1; revenue += a.amount || 0; }
      if (toS === 'qualified') qualified += 1;
    });
    return { handled: leads.size, calls, orders, revenue, qualified, capped: snap.size >= 2000 };
  });
}

const CLOSED_ST = ['order done', 'order won', 'lost', 'dead', 'not interested'];
const emptyBucket = () => ({ total: 0, pending: 0, worked: 0, byStatus: {}, leadIds: [], pendingIds: [], capped: false });

/** SCHEDULED FOLLOW-UPS + OFF-SCHEDULE CALLS — ek hi activity range-query se, mutually exclusive.
 *  Har lead jise is range mein chheda gaya (fresh-handoff wali chhod ke — wo RowGroup 1 mein):
 *   - scheduled  : is range tak followup DUE thi (activity pe `was_due_for`, ya lead ki next_followup
 *                  range-end tak aa chuki) — yani planned kaam
 *   - offSchedule : baaki sab — na due thi na naya handoff, bas apni marzi se call
 *  Har lead apni CURRENT status ke saath us section ke byStatus mein (order done / lost / followup…).
 *  1 activity query (limit 1200) + touched leads batched-fetch (readable na ho to skip). 30-min cached.
 */
export async function workSplitStats(args) {
  const { teamRole, memberUid, memberIds, from, to } = args;
  return cached(`pc_worksplit_${teamRole}_${memberUid || 't'}_${from}_${to}`, async () => {
   try {
    const rs = dayStart(from); const re = dayEnd(to);
    // COST GUARD — 45 din se badi range mein ye computation hazaaron reads le leta hai. Skip.
    const days = Math.round((re - rs) / 86400000);
    if (days > 45) return { scheduled: { ...emptyBucket(), capped: true }, offSchedule: { ...emptyBucket(), capped: true } };
    const inRange = (ts) => { const d = ts && ts.toDate ? ts.toDate() : null; return d && d >= rs && d <= re; };
    const uidSet = memberUid ? new Set([memberUid]) : (memberIds && memberIds.length ? new Set(memberIds) : null);
    const okUid = (u) => !uidSet || uidSet.has(u);
    const alim = memberUid ? 700 : 1000;
    const blim = memberUid ? 700 : 1400;

    // A: is range mein kaun si lead TOUCH hui (aur us touch mein followup-due tha ya nahi)
    const actParts = memberUid
      ? [collection(db, 'activity'), where('uid', '==', memberUid), where('at', '>=', rs), where('at', '<=', re), orderBy('at', 'desc'), fbLimit(alim)]
      : [collection(db, 'activity'), where('at', '>=', rs), where('at', '<=', re), orderBy('at', 'desc'), fbLimit(alim)];
    // B: kis lead ka followup IS RANGE ki date ke liye schedule hua tha. Personal view -> uid se scope
    //    (activity index: uid+scheduled_for) taaki poori team ki activity na padhni pade.
    const bParts = memberUid
      ? [collection(db, 'activity'), where('uid', '==', memberUid), where('scheduled_for', '>=', rs), where('scheduled_for', '<=', re), orderBy('scheduled_for', 'desc'), fbLimit(blim)]
      : [collection(db, 'activity'), where('scheduled_for', '>=', rs), where('scheduled_for', '<=', re), orderBy('scheduled_for', 'desc'), fbLimit(blim)];
    const [aSnap, bSnap] = await Promise.all([
      getDocs(query(...actParts)),
      getDocs(query(...bParts)).catch(async () => getDocs(query(
        collection(db, 'activity'), where('scheduled_for', '>=', rs), where('scheduled_for', '<=', re), orderBy('scheduled_for', 'desc'), fbLimit(blim),
      ))), // index abhi build ho raha ho to team-wide fallback
    ]);

    const touched = new Set();       // range mein touch hui leads
    const dueTouched = new Set();    // touch jisme was_due_for is-range mein tha (planned kaam)
    aSnap.forEach((d) => {
      const a = d.data();
      if (!a.lead_id || !okUid(a.uid)) return;
      touched.add(a.lead_id);
      if (inRange(a.was_due_for)) dueTouched.add(a.lead_id);
    });
    const schedByDate = new Set();   // followup is range ki date ke liye set hua
    bSnap.forEach((d) => {
      const a = d.data();
      if (!a.lead_id || !okUid(a.uid)) return;
      schedByDate.add(a.lead_id);
    });

    const allIds = [...new Set([...touched, ...dueTouched, ...schedByDate])];
    if (!allIds.length) return { scheduled: emptyBucket(), offSchedule: emptyBucket() };

    const leadMap = {};
    for (let i = 0; i < allIds.length; i += 30) {
      const chunk = allIds.slice(i, i + 30);
      try {
        // eslint-disable-next-line no-await-in-loop
        const s = await getDocs(query(collection(db, 'leads'), where(documentId(), 'in', chunk)));
        s.forEach((d) => { leadMap[d.id] = { id: d.id, ...d.data() }; });
      } catch {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(chunk.map(async (id) => {
          try {
            const one = await getDocs(query(collection(db, 'leads'), where(documentId(), '==', id)));
            one.forEach((d) => { leadMap[d.id] = { id: d.id, ...d.data() }; });
          } catch { /* not readable — skip */ }
        }));
      }
    }

    const isSales = teamRole === 'sales';
    const sched = emptyBucket(); const off = emptyBucket();
    for (const id of allIds) {
      const l = leadMap[id];
      if (!l) continue;
      const cr = l.created_at?.toDate?.() || null;
      const qa = l.qualified_at?.toDate?.() || null;
      const freshInRange = (cr && cr >= rs) || (qa && qa >= rs);
      const nfInRange = inRange(l.next_followup);

      // Scheduled = followup IS RANGE ke liye tha: (activity ne date is-range set ki) YA
      //            (was_due_for is-range me tha) YA (abhi bhi next_followup is-range me hai = pending)
      const isScheduled = schedByDate.has(id) || dueTouched.has(id) || nfInRange;

      const st = (isSales ? String(l.sales_status || '').toLowerCase().trim() : String(l.status || '').toLowerCase().trim()) || 'other';
      const closed = CLOSED_ST.includes(st) || ['dead', 'lost'].includes(String(l.status || '').toLowerCase().trim());

      // NO OVERLAP: har lead ya to "pending" me ya "byStatus" me — dono me nahi.
      // Isse TOTAL = pending + sum(byStatus) — jaise user chahta hai.
      if (isScheduled) {
        // (fresh + scheduled bhi ho sakti hai — wo yahan bhi aur RowGroup 1 mein bhi, alag axis)
        sched.total += 1; sched.leadIds.push(id);
        if (!touched.has(id) && !closed) {
          sched.pending += 1; sched.pendingIds.push(id); // due tha, is range me kaam nahi hua
        } else {
          sched.byStatus[st] = (sched.byStatus[st] || 0) + 1; // worked/closed — current status se
        }
      } else if (touched.has(id) && !freshInRange) {
        // Off-Schedule = touch hui par na scheduled na fresh — apni marzi se koi lead uthai
        off.total += 1; off.leadIds.push(id);
        if (!closed) {
          off.pending += 1; off.pendingIds.push(id); // abhi khula (followup/hot lead/visit… — chal raha)
        } else {
          off.byStatus[st] = (off.byStatus[st] || 0) + 1; // conclude ho gaya (order done / lost)
        }
      }
      // fresh + not-scheduled -> sirf RowGroup 1
    }
    sched.worked = sched.total - sched.pending;
    off.worked = off.total - off.pending;
    sched.capped = off.capped = aSnap.size >= alim || bSnap.size >= blim;
    return { scheduled: sched, offSchedule: off };
   } catch (e) {
    console.error('workSplitStats', e && e.message ? e.message : e);
    return { scheduled: emptyBucket(), offSchedule: emptyBucket() };
   }
  });
}

/** DASHBOARD (4 sections) — RANGE ke liye. Purane (complete) din: `stats_daily/{date}.dash`
 *  se JOD lete hain (1 read/din). Aaj: LIVE (nightly job raat 1 baje chalta hai, aaj ka doc
 *  abhi khaali). Isse har dashboard load ~4000 reads se ~7-10 reads pe aa jaata hai.
 *
 *  ⚠️ `dash` buckets ki semantics `functions/index.js` `aggregateDay` ke DASH section se EXACTLY
 *  match karni chahiye — dashboard logic badlo to dono jagah badlo.  [[dash-preagg-dual-copy]]
 */
const DASH_BK = ['fresh', 'reinq', 'sched', 'offsched'];

export async function getDashRange(args) {
  const { teamRole, memberUid, memberIds, from, to } = args;
  return cached(`pc_dashrange5_${teamRole}_${memberUid || 't'}_${from}_${to}`, async () => {
    const today = istDay();
    const days = daysBetween(from, to).filter((d) => d <= today);
    const wantToday = days.includes(today);
    const pastDays = days.filter((d) => d < today);
    const key = memberUid || (teamRole === 'sales' ? '_sales' : '_ldr');

    const mk = () => ({ hits: {}, wst: {}, work: new Set(), pend: new Set() });
    const M = { fresh: mk(), reinq: mk(), sched: mk(), offsched: mk() };
    let capped = false;    // koi din ka doc missing
    let building = false;  // purana format (list nahi) — backfill pending

    const merge = (src, bk) => {
      for (const [id, n] of Object.entries(src.hits || {})) {
        M[bk].hits[id] = (M[bk].hits[id] || 0) + n; M[bk].work.add(id);
        if (src.wst && src.wst[id]) M[bk].wst[id] = src.wst[id]; // latest din ka status jeette
      }
      for (const id of (src.pids || [])) M[bk].pend.add(id);
    };

    // PURANE din — pre-agg `stats_daily/{date}.dash` se (1 read/din)
    const snaps = await Promise.all(pastDays.map((d) => getDoc(doc(db, 'stats_daily', d))));
    snaps.forEach((s) => {
      if (!s.exists() || !s.data().dash) { capped = true; return; }
      const dd = s.data().dash[key];
      if (!dd) return;
      for (const bk of DASH_BK) {
        const src = dd[bk] || {};
        if (!src.hits && !src.pids && (src.total || src.pending)) building = true;
        merge(src, bk);
      }
    });

    // AAJ ka din:
    //  - member/personal view (memberUid) -> LIVE, scoped to that person (~200 reads, hamesha fresh —
    //    worker isi se kaam karta hai). Admin ki poori-team view -> pre-agg doc (slaScan ~90 min me
    //    refresh; admin Refresh button server par turant re-agg karta hai).
    if (wantToday) {
      if (memberUid) {
        const live = await dashDayLive({ teamRole, memberUid, memberIds }, today).catch(() => null);
        if (!live) capped = true;
        else for (const bk of DASH_BK) { merge(live[bk] || {}, bk); if (live[bk] && live[bk].capped) capped = true; }
      } else {
        const s = await getDoc(doc(db, 'stats_daily', today));
        const dd = s.exists() && s.data().dash ? s.data().dash[key] : null;
        if (!dd) capped = true;
        else for (const bk of DASH_BK) { const src = dd[bk] || {}; if (!src.hits && !src.pids && (src.total || src.pending)) building = true; merge(src, bk); }
      }
    }

    // range ke kisi bhi din worked hui -> pending nahi
    for (const bk of DASH_BK) for (const id of M[bk].work) M[bk].pend.delete(id);

    const shape = (m) => {
      const workIds = [...m.work];
      const pendIds = [...m.pend];
      const byStatus = {};
      workIds.forEach((id) => { const st = m.wst[id] || 'other'; byStatus[st] = (byStatus[st] || 0) + 1; });
      return {
        total: workIds.length + pendIds.length,   // UNIQUE leads
        pending: pendIds.length,
        worked: workIds.length,
        contacts: Object.values(m.hits).reduce((a, n) => a + n, 0), // ALL calls (worked leads)
        byStatus,                                  // sum(byStatus) === worked (consistent)
        leadIds: workIds,
        pendingIds: pendIds,
        statusMap: m.wst,                          // drill-down bhi isi status se filter kare (card == list)
        touchCounts: m.hits,
        capped,
        building,
      };
    };
    return { fresh: shape(M.fresh), reinq: shape(M.reinq), sched: shape(M.sched), offsched: shape(M.offsched) };
  });
}

/** aggregateDay ki DASH logic ka SINGLE-DAY, LIVE version — AAJ ke liye. Wahi semantics —
 *  badlo to dono jagah badlo.  [[dash-preagg-dual-copy]]
 *  memberUid diya ho to sab queries usi tak scoped (sasti — ~150-200 reads). Return:
 *  { fresh:{hits,wst,pids,capped}, reinq, sched, offsched }. */
export async function dashDayLive({ teamRole, memberUid, memberIds }, dayStr) {
  const isSales = teamRole === 'sales';
  const { ownerField } = fieldsFor(teamRole);
  const rs = dayStart(dayStr); const re = dayEnd(dayStr);
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const uidSet = memberUid ? new Set([memberUid]) : (memberIds && memberIds.length ? new Set(memberIds) : null);
  const okUid = (u) => u && (!uidSet || uidSet.has(u));
  const CLOSED = ['order done', 'order won', 'lost', 'dead', 'not interested'];
  const stOf = (l) => (isSales ? String(l.sales_status || '') : String(l.status || '')).toLowerCase().trim() || 'other';
  const isClosed = (l) => CLOSED.includes(stOf(l)) || ['dead', 'lost'].includes(String(l.status || '').toLowerCase().trim());
  const inDay = (ts) => { const d = ts && ts.toDate ? ts.toDate() : null; return d && d >= rs && d <= re; };
  const ownsL = (l) => { const o = isSales ? l.sales_uid : l.ldr_uid; return o && okUid(o); };

  const mk = () => ({ hits: {}, wst: {}, pids: [], capped: false });
  const R = { fresh: mk(), reinq: mk(), sched: mk(), offsched: mk() };
  const put = (b, id, s, touches) => { b.hits[id] = Math.max(1, touches || 0); b.wst[id] = s; };
  const ALIM = memberUid ? 900 : 3000;

  const aParts = memberUid
    ? [collection(db, 'activity'), where('uid', '==', memberUid), where('at', '>=', rs), where('at', '<=', re), orderBy('at', 'desc'), fbLimit(ALIM)]
    : [collection(db, 'activity'), where('at', '>=', rs), where('at', '<=', re), orderBy('at', 'desc'), fbLimit(ALIM)];
  const bParts = memberUid
    ? [collection(db, 'activity'), where('uid', '==', memberUid), where('scheduled_for', '>=', rs), where('scheduled_for', '<=', re), orderBy('scheduled_for', 'desc'), fbLimit(ALIM)]
    : [collection(db, 'activity'), where('scheduled_for', '>=', rs), where('scheduled_for', '<=', re), orderBy('scheduled_for', 'desc'), fbLimit(ALIM)];
  const [aSnap, bSnap, freshSnap, urgentSnap] = await Promise.all([
    getDocs(query(...aParts)),
    getDocs(query(...bParts)).catch(() => ({ forEach: () => {}, size: 0 })),
    getDocs(query(collection(db, 'leads'), ...owner, where('created_at', '>=', rs), where('created_at', '<=', re), fbLimit(1500))),
    // `is_urgent` kabhi wapas false nahi hota (ek baar re-inquiry hui, hamesha true rehta hai) —
    // isliye is_urgent==true se poori history mil jaati thi (Neelam jaisी purani LDR ke liye 269
    // docs, har dashboard-load par). `urgent_at` par aaj ki range se seedha query karo — sirf AAJ
    // ki re-inquiry chahiye, aur is_urgent==true hamesha implied hai (dono ek saath set hote hain).
    getDocs(query(collection(db, 'leads'), ...owner, where('urgent_at', '>=', rs), where('urgent_at', '<=', re), fbLimit(1500))).catch(() => ({ forEach: () => {}, size: 0 })),
  ]);

  const touchCnt = {}; const dueSet = new Set();
  aSnap.forEach((d) => {
    const a = d.data(); if (!a.lead_id || !okUid(a.uid)) return;
    touchCnt[a.lead_id] = (touchCnt[a.lead_id] || 0) + 1;
    if (inDay(a.was_due_for)) dueSet.add(a.lead_id);
  });
  const schedSet = new Set();
  bSnap.forEach((d) => { const a = d.data(); if (a.lead_id && okUid(a.uid)) schedSet.add(a.lead_id); });
  const capd = aSnap.size >= ALIM || (bSnap.size || 0) >= ALIM;

  // (1) FRESH — aaj bani leads
  const freshIds = new Set();
  freshSnap.forEach((d) => {
    const l = { id: d.id, ...d.data() }; freshIds.add(d.id);
    const s = stOf(l);
    const pend = s === 'other' || (isSales ? ['', 'qualified', 'fresh', 'new'].includes(s) : ['fresh', 'new', ''].includes(s));
    if (pend) R.fresh.pids.push(d.id);
    else put(R.fresh, d.id, s, touchCnt[d.id]);
  });

  // (2) RE-INQUIRY — aaj urgent hui (urgent_at aaj)
  urgentSnap.forEach((d) => {
    const l = { id: d.id, ...d.data() };
    const ua = l.urgent_at?.toDate ? l.urgent_at.toDate() : (l.updated_at?.toDate ? l.updated_at.toDate() : null);
    if (!ua || ua < rs || ua > re) return;
    const s = stOf(l);
    const pend = !touchCnt[d.id] || s === 'other' || ['fresh', 'new', ''].includes(s);
    if (pend) R.reinq.pids.push(d.id);
    else put(R.reinq, d.id, s, touchCnt[d.id]);
  });

  // (3+4) SCHEDULED + OFF-SCHEDULE
  const candIds = [...new Set([...Object.keys(touchCnt), ...schedSet, ...dueSet])];
  const leadMap = {};
  for (let i = 0; i < candIds.length; i += 30) {
    const chunk = candIds.slice(i, i + 30);
    try {
      // eslint-disable-next-line no-await-in-loop
      const qs = await getDocs(query(collection(db, 'leads'), where(documentId(), 'in', chunk)));
      qs.forEach((d) => { leadMap[d.id] = { id: d.id, ...d.data() }; });
    } catch { /* skip */ }
  }
  for (const id of candIds) {
    const l = leadMap[id];
    if (!l || !ownsL(l)) continue;
    const touched = !!touchCnt[id];
    const schFor = schedSet.has(id) || dueSet.has(id) || inDay(l.next_followup);
    const closed = isClosed(l);
    const s = stOf(l);
    const blank = s === 'other';
    if (schFor) {
      if ((!touched && !closed) || blank) R.sched.pids.push(id);
      else put(R.sched, id, s, touchCnt[id]);
    } else if (touched && !freshIds.has(id)) {
      if (closed) put(R.offsched, id, s, touchCnt[id]);
      else R.offsched.pids.push(id); // "still working"
    }
  }

  DASH_BK.forEach((bk) => { R[bk].capped = capd; });
  return R;
}

/** 2) Saare status ka breakdown — di gayi list ke har status ki count (bounded, chhoti list). */
export async function statusBreakdown({ teamRole, memberUid, memberIds, statuses }) {
  const { ownerField, statusField } = fieldsFor(teamRole);
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const rows = await Promise.all(statuses.map(async (s) => ({
    status: s, count: await cnt(...owner, where(statusField, '==', s)),
  })));
  return rows;
}

/** 3) Re-Inquiry — total urgent + kitne pending (fresh) vs worked (aage badh gaye). */
export async function reinquiryStats({ teamRole, memberUid, memberIds }) {
  const { ownerField, statusField } = fieldsFor(teamRole);
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const total = await cnt(...owner, where('is_urgent', '==', true));
  if (total === 0 || total > 300) return { total, pending: null, worked: null };
  const snap = await getDocs(query(collection(db, 'leads'), ...owner, where('is_urgent', '==', true)));
  let pending = 0;
  snap.forEach((d) => {
    const l = d.data();
    const st = String(l[statusField] || '').toLowerCase();
    if (['fresh', 'new', ''].includes(st)) pending++;
  });
  return { total, pending, worked: total - pending };
}

/** 4) Range Ke Followups — us range mein due, kitne pending kitne worked. */
export async function followupRangeStats({ teamRole, memberUid, memberIds, from, to }) {
  const { ownerField } = fieldsFor(teamRole);
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const rangeStart = dayStart(from);
  const r = await safeRangeDetail(
    [...owner, where('next_followup', '>=', rangeStart), where('next_followup', '<=', dayEnd(to))],
    (l) => !(l.last_action_at?.toDate && l.last_action_at.toDate() >= rangeStart),
  );
  return { total: r.total, pending: r.matched, worked: r.matched == null ? null : r.total - r.matched };
}

/** 5) Pending Dues — range se pehle jo due tha, kitna range ke andar clear hua, kitna abhi bhi pending. */
export async function overdueStats({ teamRole, memberUid, memberIds, before, workedFrom, workedTo }) {
  const { ownerField } = fieldsFor(teamRole);
  const owner = ownerScope(ownerField, memberUid, memberIds);
  const total = await cnt(...owner, where('next_followup', '<', dayStart(before)));
  // "worked in range" sirf tab client-fetch karo jab total kaabu mein ho (warna sirf total dikhao).
  if (total === 0 || total > 500) return { total, workedInRange: null, pending: null };
  const snap = await getDocs(query(collection(db, 'leads'), ...owner, where('next_followup', '<', dayStart(before))));
  let workedInRange = 0;
  snap.forEach((d) => {
    const l = d.data();
    const t = l.last_action_at?.toDate?.();
    if (t && t >= dayStart(workedFrom) && t <= dayEnd(workedTo)) workedInRange++;
  });
  return { total, workedInRange, pending: total - workedInRange };
}

/** MECA — per-executive pivot, seedha `activity` docs se (ek hi range-query, ~200-800 reads ek
 *  hafte ke liye). Pre-computed pe depend nahi karta isliye har date-range ke liye kaam karta hai
 *  (purane dino ke liye bhi). Fresh/Old split abhi nahi — uske liye per-lead created_at chahiye. */
export async function mecaFromActivity(from, to) {
  return cached(`pc_meca_${from}_${to}`, async () => {
    const CAP = 4000;
    const [snap, freshSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'activity'),
        where('at', '>=', dayStart(from)), where('at', '<=', dayEnd(to)),
        orderBy('at', 'desc'), fbLimit(CAP),
      )),
      getDocs(query(collection(db, 'leads'), where('created_at', '>=', dayStart(from)), where('created_at', '<=', dayEnd(to)), fbLimit(SAFE_FETCH_CAP + 1))),
    ]);
    const freshIds = new Set();
    const freshCapped = freshSnap.size > SAFE_FETCH_CAP;
    freshSnap.forEach((d) => freshIds.add(d.id));
    const by = {};
    snap.forEach((d) => {
      const a = d.data();
      if (!a.uid) return;
      const b = by[a.uid] || (by[a.uid] = { name: a.actor_name || '', leads: new Set(), touches: 0, qualified: 0, closed: 0, revenue: 0 });
      const toS = String(a.to_status || '').toLowerCase();
      b.touches += 1;
      if (a.lead_id) b.leads.add(a.lead_id);
      if (a.action === 'order' || toS.includes('order')) { b.closed += 1; b.revenue += a.amount || 0; }
      if (toS === 'qualified') b.qualified += 1;
      if (a.actor_name) b.name = a.actor_name;
    });
    const rows = Object.entries(by).map(([uid, b]) => {
      const fresh = freshCapped ? null : [...b.leads].filter((id) => freshIds.has(id)).length;
      return {
        uid, name: b.name, handled: b.leads.size, touches: b.touches,
        fresh, old: fresh == null ? null : b.leads.size - fresh,
        avgTouch: b.leads.size ? Number((b.touches / b.leads.size).toFixed(1)) : 0,
        qualified: b.qualified, closed: b.closed, revenue: b.revenue,
      };
    });
    return { rows, capped: snap.size >= CAP, freshCapped };
  });
}

/** Business Analytics — company-wide slice for a created-at date range. Ek fetch (cap 3500),
 *  client-side tally: total / qualified / orders / revenue / lost / funnel-stages / by-source.
 *  "All time" ke liye caller count() path use kare (yeh sirf bounded range ke liye). 30-min cache. */
export async function companySlice(from, to) {
  return cached(`pc_anaslice_${from}_${to}`, async () => {
    const base = [collection(db, 'leads'), where('created_at', '>=', dayStart(from)), where('created_at', '<=', dayEnd(to))];
    const total = (await getCountFromServer(query(...base))).data().count;
    if (total === 0) return { total: 0, capped: false, qualified: 0, orders: 0, revenue: 0, lost: 0, positive: 0, fresh: 0, bySource: {}, bySourceQ: {} };
    if (total > 3500) return { total, capped: true };
    const snap = await getDocs(query(...base, fbLimit(3500)));
    let qualified = 0; let orders = 0; let revenue = 0; let lost = 0; let positive = 0; let fresh = 0;
    const bySource = {}; const bySourceQ = {};
    const POS = ['hot lead', 'visit customer', 'video call', 'visit done'];
    snap.forEach((d) => {
      const l = d.data();
      const ls = String(l.status || '').toLowerCase();
      const ss = String(l.sales_status || '').toLowerCase();
      if (ls === 'fresh' || ls === 'new' || ls === '') fresh += 1;
      if (ls === 'qualified') qualified += 1;
      if (['dead', 'lost'].includes(ls) || ss === 'lost') lost += 1;
      if (ss === 'order done') { orders += 1; revenue += l.total_revenue || 0; }
      else if (POS.includes(ss)) positive += 1;
      const src = (l.source || '').trim();
      if (src) { bySource[src] = (bySource[src] || 0) + 1; if (ls === 'qualified' || ss === 'order done') bySourceQ[src] = (bySourceQ[src] || 0) + 1; }
    });
    return { total, capped: false, qualified, orders, revenue, lost, positive, fresh, bySource, bySourceQ };
  });
}

/** Business Analytics — "LDR Performance Report": kis LDR ne kitni qualify ki, kis Sales ko bheji,
 *  aur downstream mein kitne Order Done hue (lead QUALITY). Ek fetch (currently-qualified leads,
 *  cap 2000) — har lead ka ldr_uid + sales_uid + sales_status se group. 30-min cache. Admin/MD only. */
export async function ldrDownstream(userName) {
  return cached('pc_ldrdown', async () => {
    const snap = await getDocs(query(collection(db, 'leads'), where('status', '==', 'qualified'), fbLimit(2000)));
    const byLdr = {};
    snap.forEach((d) => {
      const l = d.data();
      const ldr = l.ldr_uid;
      if (!ldr) return;
      const b = byLdr[ldr] || (byLdr[ldr] = { qualified: 0, orders: 0, sentToSales: 0, dest: {} });
      b.qualified += 1;
      const sid = l.sales_uid || null;
      if (sid) {
        b.sentToSales += 1;
        const dd = b.dest[sid] || (b.dest[sid] = { sent: 0, won: 0, lost: 0, active: 0 });
        dd.sent += 1;
        const ss = String(l.sales_status || '').toLowerCase();
        if (ss === 'order done') { dd.won += 1; b.orders += 1; }
        else if (ss.includes('lost') || ss.includes('dead')) dd.lost += 1;
        else dd.active += 1;
      }
    });
    // assigned per LDR — count() (thodi LDRs hain)
    const rows = await Promise.all(Object.entries(byLdr).map(async ([uid, b]) => {
      const assigned = await cnt(where('ldr_uid', '==', uid)).catch(() => b.qualified);
      const dest = Object.entries(b.dest).map(([sid, dd]) => ({
        id: sid, name: userName(sid) || sid, ...dd,
        winRate: dd.sent ? Math.round((dd.won / dd.sent) * 100) : 0,
      })).sort((a, x) => x.sent - a.sent);
      return {
        id: uid, name: userName(uid) || uid, assigned, qualified: b.qualified,
        rate: assigned ? Math.round((b.qualified / assigned) * 100) : 0,
        sentToSales: b.sentToSales, orders: b.orders,
        downstreamRate: b.sentToSales ? Math.round((b.orders / b.sentToSales) * 100) : 0,
        topDestinations: dest.slice(0, 2).map((x) => `${x.name} (${x.sent})`).join(', '),
        dest,
      };
    }));
    return rows.sort((a, b) => b.qualified - a.qualified);
  });
}

/* Source/State (aur All-Time distribution) slow-moving hain — inhe har filter-change / dubara-khulne
 * par dobara fetch karne ki zaroorat nahi. `cached()` (upar) sessionStorage mein 30 min rakhta hai;
 * refresh button `bustDashCache()` se sab saaf. */

/** Source ke hisaab se total + qualified count — config ki sources list se (bounded, chhoti list). */
export function sourceQuality(sources) {
  return cached(`pc_src_${sources.length}`, async () => {
    const rows = await Promise.all(sources.map(async (s) => {
      const [total, qualified] = await Promise.all([
        cnt(where('source', '==', s)),
        cnt(where('source', '==', s), where('status', '==', 'qualified')),
      ]);
      return { source: s, total, qualified, pct: total ? Math.round((qualified / total) * 100) : 0 };
    }));
    return rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  });
}

/** State ke hisaab se total count — config ki states list se. */
export function stateVolume(states) {
  return cached(`pc_state_${states.length}`, async () => {
    const rows = await Promise.all(states.map(async (s) => ({ state: s, total: await cnt(where('state', '==', s)) })));
    return rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  });
}

/** 6) Calling Report — har member ki ek row, POORI selected-range ke hisaab se:
 *   worked (unique leads touched) / contacted (total touches) / result (order done ya qualified) /
 *   last-active. "Assigned" = current book-size (context ke liye). Overdue column HATA diya —
 *   wo live backlog hai, range se nahi badalta (wo "All Leads" ke Overdue filter se dekho).
 *   Off-schedule ab alag RowGroup hai (team-level, `offScheduleStats`).
 *
 * READ-COST: 1 activity range-query (limit 800) + 1 count() per member (book-size). 30-min cached. */
export function teamWorkloadReport(args) {
  return cached(`pc_callrep2_${args.teamRole}_${args.from}_${args.to}`, () => teamWorkloadReportUncached(args));
}
async function teamWorkloadReportUncached({ teamRole, members, from, to, resultStatus }) {
  const { ownerField } = fieldsFor(teamRole);
  // 1 query — poori team ki range-activity ek saath (per-member nahi). worked/contacted/result
  // LIVE activity se (aaj bhi sahi rahe — pre-agg raat 1 baje banta hai).
  const actSnap = await getDocs(query(
    collection(db, 'activity'),
    where('at', '>=', dayStart(from)), where('at', '<=', dayEnd(to)),
    orderBy('at', 'desc'), fbLimit(800),
  ));
  const byUid = {};
  actSnap.forEach((d) => {
    const a = d.data();
    if (!a.uid) return;
    if (!byUid[a.uid]) byUid[a.uid] = { leads: new Set(), contacted: 0, result: 0, lastActive: null };
    const b = byUid[a.uid];
    const t = a.at?.toDate?.();
    if (t && !b.lastActive) b.lastActive = t; // desc order — pehla hi latest hai
    b.contacted++;
    b.leads.add(a.lead_id);
    if (String(a.to_status || '').toLowerCase() === resultStatus) b.result++;
  });

  // "assigned" ab RANGE ka (lifetime count nahi) — is range me is bande ko kitni nayi leads mili.
  const rs = dayStart(from); const re = dayEnd(to);
  const rows = await Promise.all(members.map(async (u) => {
    const assigned = await cnt(where(ownerField, '==', u.id), where('created_at', '>=', rs), where('created_at', '<=', re));
    const b = byUid[u.id];
    return {
      uid: u.id, name: u.full_name, assigned,
      worked: b ? b.leads.size : 0, contacted: b ? b.contacted : 0, result: b ? b.result : 0,
      lastActive: b?.lastActive || u.last_login || null,
    };
  }));
  return rows.sort((a, b) => b.result - a.result || b.worked - a.worked);
}
