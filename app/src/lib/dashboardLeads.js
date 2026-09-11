// Dashboard ke kisi bhi clickable card/row ka "niche list dikhao" — ek hi generic, paginated
// fetcher se sab drill-downs handle hote hain (`usePagedList` ke saath seedha use hota hai).
import {
  collection, query, where, orderBy, limit as fbLimit, startAfter, getDocs, documentId,
} from 'firebase/firestore';
import { db } from '../firebase';
import { dayStart, dayEnd } from './daterange';
import { ownedBy } from './leadStage';
import { workSplitStats } from './dashboardStats';

const PAGE_SIZE = 20;

const ownerField = (teamRole) => (teamRole === 'sales' ? 'sales_uid' : 'ldr_uid');
const statusField = (teamRole) => (teamRole === 'sales' ? 'sales_status' : 'status');

/**
 * @param opts.teamRole 'ldr' | 'sales'
 * @param opts.memberUid  optional — ek hi person tak scope karo
 * @param opts.memberIds  optional — memberUid na diya ho to poori TEAM tak scope karo (in-query,
 *   max 30) — warna "Whole team" click company-wide (dono team mila kar) list khol deta
 * @param opts.filter  {kind:'status',value} | {kind:'created_range',from,to} | {kind:'touched_range',from,to}
 *                      | {kind:'followup_range',from,to} | {kind:'overdue',before} | {kind:'urgent'} | {kind:'all'}
 */
export async function fetchDashLeadsPage({ teamRole, memberUid, memberIds, filter, cursor = null, pageSize = PAGE_SIZE }) {
  const ownerF = ownerField(teamRole);
  const stF = statusField(teamRole);
  const parts = [collection(db, 'leads')];
  if (memberUid) parts.push(where(ownerF, '==', memberUid));
  else if (memberIds && memberIds.length) parts.push(where(ownerF, 'in', memberIds.slice(0, 30)));

  // client-side post-filter — jab range ke andar ek particular status/source/state chahiye
  // (teesra composite index se bachne ke liye: created_at range query + yahan filter).
  const post = [];
  if (filter.statusEq) {
    const arr = (Array.isArray(filter.statusEq) ? filter.statusEq : [filter.statusEq]).map((s) => String(s).toLowerCase());
    post.push((l) => arr.includes(String(l[stF] || l.status || '').toLowerCase()));
  }
  if (filter.notTouched) { // "pending" — is range mein koi action nahi
    const f = new Date(filter.notTouched.from + 'T00:00:00+05:30');
    const tt = new Date(filter.notTouched.to + 'T23:59:59.999+05:30');
    post.push((l) => { const a = l.last_action_at?.toDate?.(); return !(a && a >= f && a <= tt); });
  }
  if (filter.sourceEq) post.push((l) => (l.source || '') === filter.sourceEq);
  if (filter.stateEq) post.push((l) => (l.state || '') === filter.stateEq);
  const fetchLimit = post.length ? pageSize * 4 : pageSize;

  switch (filter.kind) {
    // status/urgent: koi orderBy nahi — teesra field composite index maangega jo nahi banaya
    // (ownerField+status aur ownerField+is_urgent do-field index hi kaafi hain is drill-down ke liye).
    case 'status':
      parts.push(where(stF, '==', filter.value));
      break;
    case 'urgent':
      parts.push(where('is_urgent', '==', true));
      break;
    case 'created_range':
      parts.push(where('created_at', '>=', dayStart(filter.from)), where('created_at', '<=', dayEnd(filter.to)), orderBy('created_at', 'desc'));
      break;
    case 'touched_range':
      // ownerField+last_action_at index ASCENDING banaya hai — orderBy usi direction se match karo.
      parts.push(where('last_action_at', '>=', dayStart(filter.from)), where('last_action_at', '<=', dayEnd(filter.to)), orderBy('last_action_at', 'asc'));
      break;
    case 'followup_range':
      parts.push(where('next_followup', '>=', dayStart(filter.from)), where('next_followup', '<=', dayEnd(filter.to)), orderBy('next_followup', 'asc'));
      break;
    case 'overdue':
      parts.push(where('next_followup', '<', dayStart(filter.before)), orderBy('next_followup', 'asc'));
      break;
    default:
      parts.push(orderBy('created_at', 'desc'));
  }
  if (cursor) parts.push(startAfter(cursor));
  parts.push(fbLimit(fetchLimit));

  const snap = await getDocs(query(...parts));
  let docs = snap.docs;
  const rawCount = docs.length;
  if (post.length) docs = docs.filter((d) => { const l = d.data(); return post.every((f) => f(l)); });
  return {
    rows: docs.slice(0, pageSize).map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    done: rawCount < fetchLimit,
  };
}

const CB_RE = /call ?back|no ans|follow/;
const LOST_RE = /lost|dead|not interest/;

/** bucketStats jaisa hi per-lead classification — CARD aur LIST ki ginti bilkul ek jaisi rahe.
 *  (Pehle list `l.sales_status || l.status` fallback karti thi, card sirf `sales_status` —
 *   isse 7 lost card par click karke 8 leads aati thi.) */
function classify(l, { kind, teamRole, from, to }) {
  const isSales = teamRole === 'sales';
  const st = isSales ? String(l.sales_status || '').toLowerCase().trim() : String(l.status || '').toLowerCase().trim();
  const rs = new Date(`${from}T00:00:00+05:30`);
  const re = new Date(`${to}T23:59:59.999+05:30`);
  const ta = l.last_action_at?.toDate?.() || null;
  const salesUntouched = isSales && (st === '' || st === 'qualified' || st === 'fresh' || st === 'new');
  let isPending;
  // 'created_range' = RowGroup 1 ka drill-down — bucketStats waha kind:'fresh' use karta hai,
  // to yahan bhi wahi logic (warna card 4 dikhata hai, list 3 aati hai).
  if (kind === 'fresh' || kind === 'created_range') isPending = salesUntouched || st === 'fresh' || st === 'new' || st === '';
  else if (kind === 'overdue') isPending = salesUntouched || !(ta && ta >= rs);
  else if (kind === 'urgent' || kind === 'reinquiry') isPending = l.reinq_open || salesUntouched || ['fresh', 'new', ''].includes(st);
  else isPending = l.reinq_open || salesUntouched || !(ta && ta >= rs && ta <= re);
  return { st, isPending };
}

/**
 * Poore bucket ki leads ek saath (cap default 900) — post-filter client-side.
 * `filter.bucketSel` diya ho to `classify()` se card ke EXACT same logic se filter hota hai.
 */
export async function fetchDashLeadsAll({ teamRole, memberUid, memberIds, filter, cap = 900 }) {
  const stF = statusField(teamRole);

  // kind:'worksplit' — Scheduled/Off-Schedule drill-down. Cards pre-agg se aate hain, par
  // yaha LIVE workSplitStats chalta hai (sirf click par) taaki asli lead-list mile.
  if (filter.kind === 'worksplit') {
    const r = await workSplitStats({ teamRole, memberUid, memberIds, from: filter.from, to: filter.to }).catch(() => null);
    const bucket = r && r[filter.section];
    if (!bucket) return { rows: [], capped: false };
    const isPend = filter.bucketSel === 'pending' || filter.bucketSel === 'never';
    const ids = (isPend ? bucket.pendingIds : bucket.leadIds) || [];
    return fetchDashLeadsAll({ teamRole, memberUid, memberIds, cap, filter: { kind: 'ids', ids, bucketSel: isPend ? 'total' : filter.bucketSel, teamRole: filter.teamRole || teamRole } });
  }

  // kind:'ids' — seedhi lead-id list. Batched fetch by documentId.
  if (filter.kind === 'ids') {
    const ids = (filter.ids || []).slice(0, cap);
    if (!ids.length) return { rows: [], capped: false };
    const out = [];
    for (let i = 0; i < ids.length; i += 30) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const s = await getDocs(query(collection(db, 'leads'), where(documentId(), 'in', ids.slice(i, i + 30))));
        s.forEach((d) => out.push({ id: d.id, ...d.data() }));
      } catch {
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(ids.slice(i, i + 30).map(async (id) => {
          try { const one = await getDocs(query(collection(db, 'leads'), where(documentId(), '==', id))); one.forEach((d) => out.push({ id: d.id, ...d.data() })); } catch { /* skip */ }
        }));
      }
    }
    let rows = out.filter((l) => !l.archived);
    const sel = filter.bucketSel;
    const tr = filter.teamRole || teamRole;
    // "Total Calls" drill-down — har lead pe kitni baar call hua (badge), zyada-call wale upar
    if (filter.touchCounts) {
      rows.forEach((l) => { l._touches = filter.touchCounts[l.id] || 0; });
      rows.sort((a, b) => (b._touches || 0) - (a._touches || 0));
    }
    if (sel && sel !== 'total') {
      const sm = filter.statusMap || null; // card ne jis status se gina (wst) — wahi use karo
      rows = rows.filter((l) => {
        const st = sm && sm[l.id]
          ? String(sm[l.id]).toLowerCase().trim()
          : String((tr === 'sales' ? l.sales_status : l.status) || l.status || '').toLowerCase().trim();
        const closed = /order (done|won)|lost|dead|not interest/.test(st) || /dead|lost/.test(String(l.status || '').toLowerCase());
        if (sel === 'pending' || sel === 'never') return !closed;
        // cb / ql = "abhi kaam chal raha" buckets — closed lead inme nahi
        if (sel === 'cb') return !closed && CB_RE.test(st);
        if (sel === 'ql') return !closed && !CB_RE.test(st) && !LOST_RE.test(st);
        if (sel === 'ls') return LOST_RE.test(st);
        // exact status match (jaise 'order done', 'lost', 'hot lead') — closed hona theek hai
        return st === sel;
      });
    }
    return { rows, capped: (filter.ids || []).length > cap };
  }

  const ownerF = ownerField(teamRole);
  const parts = [collection(db, 'leads')];
  if (memberUid) parts.push(where(ownerF, '==', memberUid));
  else if (memberIds && memberIds.length) parts.push(where(ownerF, 'in', memberIds.slice(0, 30)));

  const post = [];
  const cx = { kind: filter.kind, teamRole, from: filter.from || filter.before, to: filter.to || filter.before };
  // "Scheduled" / followup list — sirf us team ke apne followups (qualified/hand-off ho chuki lead
  // dusri team ki). bucketStats (card) ke saath exactly match.
  if (filter.kind === 'followup_range') post.push((l) => ownedBy(l, teamRole));
  // Re-Inquiry drill-down: is_urgent leads ko selected range (urgent_at) tak seemit karo — card se match.
  if (filter.kind === 'urgent' && filter.from && filter.to) {
    const urs = dayStart(filter.from); const ure = dayEnd(filter.to);
    post.push((l) => {
      const ua = l.urgent_at?.toDate?.() || l.updated_at?.toDate?.() || null;
      return ua && ua >= urs && ua <= ure;
    });
  }
  if (filter.bucketSel && filter.bucketSel !== 'total') {
    const sel = filter.bucketSel;
    post.push((l) => {
      const { st, isPending } = classify(l, cx);
      if (sel === 'pending' || sel === 'never') return isPending;
      if (isPending) return false;
      if (sel === 'cb') return CB_RE.test(st);
      if (sel === 'ql') return !CB_RE.test(st) && !LOST_RE.test(st);
      if (sel === 'ls') return LOST_RE.test(st);
      return st === sel; // sales stage exact
    });
  } else if (filter.statusEq) {
    const arr = (Array.isArray(filter.statusEq) ? filter.statusEq : [filter.statusEq]).map((s) => String(s).toLowerCase());
    post.push((l) => arr.includes(String(l[stF] || '').toLowerCase()));
  }
  if (filter.sourceEq) post.push((l) => (l.source || '') === filter.sourceEq);
  if (filter.stateEq) post.push((l) => (l.state || '') === filter.stateEq);

  switch (filter.kind) {
    case 'status': parts.push(where(stF, '==', filter.value)); break;
    case 'urgent': parts.push(where('is_urgent', '==', true)); break;
    case 'created_range': parts.push(where('created_at', '>=', dayStart(filter.from)), where('created_at', '<=', dayEnd(filter.to)), orderBy('created_at', 'desc')); break;
    case 'touched_range': parts.push(where('last_action_at', '>=', dayStart(filter.from)), where('last_action_at', '<=', dayEnd(filter.to)), orderBy('last_action_at', 'asc')); break;
    case 'followup_range': parts.push(where('next_followup', '>=', dayStart(filter.from)), where('next_followup', '<=', dayEnd(filter.to)), orderBy('next_followup', 'asc')); break;
    case 'overdue': parts.push(where('next_followup', '<', dayStart(filter.before)), orderBy('next_followup', 'asc')); break;
    default: parts.push(orderBy('created_at', 'desc'));
  }
  parts.push(fbLimit(cap + 1));
  const snap = await getDocs(query(...parts));
  let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (post.length) docs = docs.filter((l) => post.every((f) => f(l)));
  return { rows: docs.slice(0, cap), capped: snap.size > cap };
}
