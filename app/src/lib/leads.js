// Leads data-access — HAMESHA paginated + role-scoped.
// Purani galti (poori 14k list ek saath) yahan repeat nahi hogi.
import {
  collection, query, where, orderBy, limit, startAfter, getDocs, getCountFromServer,
  doc, getDoc, setDoc, addDoc, writeBatch, runTransaction, serverTimestamp, Timestamp, increment,
} from 'firebase/firestore';
import { db } from '../firebase';
import { normalizePhone } from './phone';
import { computeScore } from './scoring';

const FLAT_FIELDS = {
  f_customer_type: 'Customer Type', f_bulk: 'Bulk Requirement?', f_intent: 'Buying Intent',
  f_interested_in: 'Customer Interested In', f_quantity: 'Approx Quantity Interested In',
};

/**
 * phone_digits ulta karके store karte hain (jaise "918708151562" -> "265151807819").
 * Isse "ends with" search bhi prefix-query ban jaata hai: user country code ke bina
 * (sirf 8708151562) type kare to bhi milta hai — kyunki wo full number ka SUFFIX hai,
 * aur suffix-of-original = prefix-of-reversed.
 */
export const revDigits = (digits) => String(digits || '').split('').reverse().join('');

/**
 * Naya lead banao. Duplicate phone -> { duplicate:true, existing } return karta hai (write nahi).
 * @param {object} d  { name, phone, alt_phone, email, company, city, state, source, stage, next_followup, form_answers, sales_uid, remark }
 * @param {object} actor { uid, name }
 * @param {string} role  'ldr' | 'sales' | 'admin'
 */
export async function createLead(d, actor, role) {
  const ph = normalizePhone(d.phone);
  if (!ph.digits || ph.digits.replace(/\D/g, '').length < 8) throw new Error('bad-phone');

  // duplicate check — phone_index/{digits} ek doc GET (har role padh sakta hai; display info yahi doc me hai)
  const idxSnap = await getDoc(doc(db, 'phone_index', ph.digits));
  if (idxSnap.exists()) {
    const ix = idxSnap.data();
    let full = null;
    try { full = ix.lead_id ? await getLead(ix.lead_id) : null; } catch { /* dusre ki lead — rules block, index se kaam chalao */ }
    return {
      duplicate: true,
      canOpen: !!full,
      existing: full || {
        id: ix.lead_id, name: ix.name || '', phone: ix.phone || '',
        sales_name: ix.owner_name || '', status: ix.stage || '', source: ix.source || '',
      },
    };
  }

  // next sequential id — transaction (offline cache pe fail ho to auto-id fallback)
  const metaRef = doc(db, 'meta', 'counters');
  let id;
  try {
    id = await runTransaction(db, async (tx) => {
      const m = await tx.get(metaRef);
      const next = (m.exists() ? m.data().leads || 0 : 0) + 1;
      tx.set(metaRef, { leads: next }, { merge: true });
      return String(next);
    });
  } catch (txErr) {
    console.warn('id transaction failed, using auto-id', txErr);
    id = doc(collection(db, 'leads')).id;
  }

  const isSales = role === 'sales';
  const stage = String(d.stage || (isSales ? 'qualified' : 'fresh')).toLowerCase();
  const isQualified = stage === 'qualified' || isSales;
  const answers = d.form_answers || {};

  const lead = {
    created_at: serverTimestamp(), created_by: actor.uid, created_by_name: actor.name || '',
    name: (d.name || '').trim(), name_lower: (d.name || '').trim().toLowerCase(),
    phone: ph.valid ? ph.formatted : '', phone_digits: ph.digits, phone_digits_rev: revDigits(ph.digits),
    phone_raw: ph.valid ? '' : d.phone, phone_invalid: !ph.valid,
    alt_phone: d.alt_phone || '', email: (d.email || '').toLowerCase(),
    company: d.company || '', company_lower: (d.company || '').toLowerCase(), city: d.city || '', state: d.state || '',
    source: d.source || 'Manual',
    status: isSales ? 'qualified' : stage,
    sales_status: isSales ? 'followup' : '',
    ldr_uid: isSales ? null : actor.uid, ldr_name: isSales ? '' : (actor.name || ''),
    sales_uid: isSales ? actor.uid : (d.sales_uid || null),
    sales_name: isSales ? (actor.name || '') : (d.sales_name || ''),
    ldr_legacy: '', sales_legacy: '',
    attempts: 0,
    next_followup: d.next_followup instanceof Date && !isNaN(d.next_followup) ? Timestamp.fromDate(d.next_followup) : null,
    last_action_at: serverTimestamp(), last_action_by: actor.uid, last_action_by_name: actor.name || '',
    qualified_at: isQualified ? serverTimestamp() : null,
    assigned_sales_at: (isSales || d.sales_uid) ? serverTimestamp() : null,
    closed_at: null, outcome: '',
    order_count: 0, total_revenue: 0, first_order_at: null, last_order_at: null,
    form_answers: answers,
    notes: '', archived: false, archived_at: null,
    is_urgent: false, needs_review: !(d.name || '').trim(), dup_of: null,
    updated_at: serverTimestamp(),
  };
  for (const [k, label] of Object.entries(FLAT_FIELDS)) lead[k] = String(answers[label] || '').trim();
  const sc = computeScore(lead);
  lead.score = sc.score; lead.tier = sc.tier;

  const batch = writeBatch(db);
  batch.set(doc(db, 'leads', id), lead);
  batch.set(doc(db, 'phone_index', ph.digits), {
    lead_id: id, name: lead.name, phone: lead.phone || lead.phone_raw,
    owner_name: lead.sales_name || lead.ldr_name || '', stage: lead.sales_status || lead.status,
    source: lead.source, updated_at: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'activity')), {
    lead_id: id, lead_name: lead.name, at: serverTimestamp(),
    uid: actor.uid, actor_name: actor.name || '', action: 'created',
    from_status: '', to_status: lead.status,
    assigned_to_name: !isSales && lead.sales_uid ? (lead.sales_name || '') : '',
    scheduled_for: d.next_followup instanceof Date && !isNaN(d.next_followup) ? Timestamp.fromDate(d.next_followup) : null,
    amount: 0, channel: 'app',
    remark: (d.remark || '').trim().slice(0, 500),
  });
  await batch.commit();
  return { id, autoAssign: isQualified && !lead.sales_uid };
}

/** Archived lead ka number dobara aaya — usi record par NAYA form bhardo (fresh lead jaisa),
 *  un-archive + re-inquiry mark. Purani history rehti hai, uspe nayi activity add hoti hai. */
export async function reopenArchivedLead(leadId, d, actor, role) {
  const snap = await getDoc(doc(db, 'leads', leadId));
  if (!snap.exists()) throw new Error('not-found');
  const prev = { id: leadId, ...snap.data() };
  const now = serverTimestamp();
  const isSales = role === 'sales';
  const stage = String(d.stage || (isSales ? 'qualified' : 'fresh')).toLowerCase();
  const isQualified = stage === 'qualified' || isSales;
  const answers = d.form_answers || {};

  const upd = {
    // fresh form data
    name: (d.name || prev.name || '').trim(), name_lower: (d.name || prev.name || '').trim().toLowerCase(),
    company: d.company || prev.company || '', company_lower: (d.company || prev.company || '').toLowerCase(),
    city: d.city || prev.city || '', state: d.state || prev.state || '',
    source: d.source || prev.source || 'Manual',
    alt_phone: d.alt_phone || prev.alt_phone || '', email: (d.email || prev.email || '').toLowerCase(),
    // fresh pipeline state — LDR ya Sales apna form bharte hain
    status: isSales ? 'qualified' : stage,
    sales_status: isSales ? 'followup' : '',
    ldr_uid: isSales ? (prev.ldr_uid || null) : actor.uid,
    ldr_name: isSales ? (prev.ldr_name || '') : (actor.name || ''),
    sales_uid: isSales ? actor.uid : (d.sales_uid || null),
    sales_name: isSales ? (actor.name || '') : (d.sales_name || ''),
    qualified_at: isQualified ? now : null,
    assigned_sales_at: (isSales || d.sales_uid) ? now : null,
    attempts: 0,
    next_followup: d.next_followup instanceof Date && !Number.isNaN(d.next_followup) ? Timestamp.fromDate(d.next_followup) : null,
    outcome: '', closed_at: '',
    form_answers: { ...(prev.form_answers || {}), ...answers },
    // un-archive + re-inquiry-after-archive track
    archived: false, archived_at: null,
    reinq_after_archive: true, reinq_after_archive_at: now, reinq_after_archive_count: increment(1),
    is_urgent: true, urgent_at: now, reinq_open: true,
    needs_review: !(d.name || prev.name || '').trim(),
    updated_at: now, last_action_at: now, last_action_by: actor.uid, last_action_by_name: actor.name || '',
    sla_fresh_alerted: false, sla_followup_alerted: false, sla_followup_due_alerted: false, sla_contact_alerted: false,
  };
  upd.closed_at = null;
  for (const [k, label] of Object.entries(FLAT_FIELDS)) upd[k] = String(answers[label] || prev[k] || '').trim();
  const sc = computeScore({ ...prev, ...upd });
  upd.score = sc.score; upd.tier = sc.tier;

  const batch = writeBatch(db);
  batch.update(doc(db, 'leads', leadId), upd);
  if (prev.phone_digits) {
    batch.set(doc(db, 'phone_index', prev.phone_digits), {
      lead_id: leadId, name: upd.name, phone: prev.phone || prev.phone_raw || '',
      owner_name: upd.sales_name || upd.ldr_name || '', stage: upd.sales_status || upd.status,
      source: upd.source, updated_at: now,
    }, { merge: true });
  }
  batch.set(doc(collection(db, 'activity')), {
    lead_id: leadId, lead_name: upd.name, at: now,
    uid: actor.uid, actor_name: actor.name || '', action: 'created',
    from_status: 'archived', to_status: upd.status,
    assigned_to_name: !isSales && d.sales_uid ? (d.sales_name || '') : '',
    scheduled_for: d.next_followup instanceof Date && !Number.isNaN(d.next_followup) ? Timestamp.fromDate(d.next_followup) : null,
    amount: 0, channel: 'app',
    remark: (`🔁 Archive (WhatsApp campaign) ke baad naya form. ${d.remark || ''}`).trim().slice(0, 500),
  });
  await batch.commit();
  return { id: leadId, autoAssign: isQualified && !d.sales_uid && !isSales };
}

export const PAGE_SIZE = 25;

/**
 * Role ke hisaab se base constraints. Security rules isi se match karti hain:
 *  - admin : sab
 *  - ldr   : apne assigned leads (ya alag se fresh-pool query)
 *  - sales : apne assigned leads
 */
function scopeConstraints({ role, uid, view }) {
  if (role === 'admin' || role === 'md' || role === 'tl') return []; // oversight — sab dikhta hai
  if (role === 'ldr') {
    if (view === 'fresh') return []; // fresh pool sabka SHARED — status filter viewConstraints() se lagta hai
    return [where('ldr_uid', '==', uid)];
  }
  if (role === 'sales') return [where('sales_uid', '==', uid)];
  return [where('__deny__', '==', true)]; // unknown role -> kuch nahi
}

// Sales ne "start" kiya — inme se koi sales_status ho to lead ab "new / just qualified" nahi
export const SALES_STARTED = ['hot lead', 'visit customer', 'visit done', 'video call', 'followup', 'follow up', 'call back', 'order done', 'order won', 'lost', 'dead'];

/** view-specific extra filters. `{ parts, post }` — post = client-side filters (index bachane ke liye). */
function viewConstraints(view) {
  switch (view) {
    case 'fresh':
      // "Fresh Leads Pool" — sirf abhi tak kisi ne na uthayi (fresh/new). Har role ke liye same.
      return [where('status', 'in', ['fresh', 'new']), orderBy('created_at', 'desc')];
    case 'sales_fresh':
      // "New Qualified Leads" — LDR ne qualify kiya, Sales ne abhi start nahi kiya.
      // qualified_at purane leads pe null hota tha (isliye khaali dikhta tha) — created_at pe order.
      return [where('status', '==', 'qualified'), orderBy('created_at', 'desc')];
    case 'followup_due':
      return [where('next_followup', '<=', new Date()), orderBy('next_followup', 'asc')];
    case 'needs_review':
      return [where('needs_review', '==', true)];
    case 'review_queue':
      return [where('review_queue', '==', true)];
    case 'urgent':
      return [where('is_urgent', '==', true)];
    case 'hot':
      return [where('tier', '==', 'hot'), orderBy('score', 'desc')];
    default:
      return [orderBy('created_at', 'desc')];
  }
}

/** "All Leads" ka filter — team + status(prefixed) + flag + member.
 *  status format: "ldr:fresh" | "ldr:call back" | "ldr:dead" | "sales:new" | "sales:hot lead" | ""
 *   - ldr:*   -> `status` field pe filter (LDR ka kaam)
 *   - sales:new -> status=='qualified' AND Sales ne abhi start nahi kiya (client-side)
 *   - sales:*  -> `sales_status` field pe filter
 *  Returns { parts, post }  (post = client-side lead filters). */
function allLeadsConstraints({ team, status, flag, member }) {
  const out = []; const post = [];
  const [side, ...rest] = String(status || '').split(':');
  const val = rest.join(':').toLowerCase();

  const memberW = member ? [where(team === 'sales' ? 'sales_uid' : 'ldr_uid', '==', member)] : [];

  // Archived — WhatsApp campaign pe bheji leads (list se hataayi). Reply aaye to un-archive.
  if (flag === 'archived') { return { parts: [where('archived', '==', true)], post: [], archivedView: true }; }
  if (flag === 'hot') { return { parts: [...memberW, where('tier', '==', 'hot'), orderBy('score', 'desc')], post }; }
  if (flag === 'urgent') { return { parts: [...memberW, where('is_urgent', '==', true)], post }; }
  if (flag === 'review') { return { parts: [...memberW, where('review_queue', '==', true)], post }; }
  if (flag === 'needs_review') { return { parts: [...memberW, where('needs_review', '==', true)], post }; }
  // Overdue — next_followup guzar chuki + lead abhi band nahi hui (outcome khaali). Sabse purani pehle.
  if (flag === 'overdue') {
    return {
      parts: [...memberW, where('next_followup', '<', new Date()), orderBy('next_followup', 'asc')],
      post: [(l) => String(l.outcome || '') === ''],
    };
  }

  // member chuna -> uske hi leads, status client-side (member-scoped bounded)
  if (member) {
    out.push(...memberW, orderBy('created_at', 'desc'));
    if (side === 'ldr' && val) {
      if (val === 'fresh') post.push((l) => ['fresh', 'new'].includes(String(l.status || '').toLowerCase()));
      else if (val === 'dead') post.push((l) => ['dead', 'lost'].includes(String(l.status || '').toLowerCase()));
      else post.push((l) => String(l.status || '').toLowerCase() === val);
    } else if (side === 'sales' && val === 'new') {
      post.push((l) => String(l.status || '').toLowerCase() === 'qualified' && !SALES_STARTED.includes(String(l.sales_status || '').toLowerCase()));
    } else if (side === 'sales' && val) {
      post.push((l) => String(l.sales_status || '').toLowerCase() === val);
    }
    return { parts: out, post };
  }

  if (side === 'ldr' && val) {
    if (val === 'fresh') out.push(where('status', 'in', ['fresh', 'new']));
    else if (val === 'dead') out.push(where('status', 'in', ['dead', 'lost']));
    else out.push(where('status', '==', val));
    out.push(orderBy('created_at', 'desc'));
    return { parts: out, post };
  }
  if (side === 'sales' && val === 'new') {
    out.push(where('status', '==', 'qualified'), orderBy('created_at', 'desc'));
    post.push((l) => !SALES_STARTED.includes(String(l.sales_status || '').toLowerCase()));
    return { parts: out, post };
  }
  if (side === 'sales' && val) {
    out.push(where('sales_status', '==', val), orderBy('created_at', 'desc'));
    return { parts: out, post };
  }
  // koi status nahi
  if (team === 'sales') { out.push(where('status', '==', 'qualified'), orderBy('created_at', 'desc')); return { parts: out, post }; }
  if (team === 'ldr') { out.push(where('status', 'in', ['fresh', 'new', 'call back', 'callback', 'no answer', 'dead', 'lost']), orderBy('created_at', 'desc')); return { parts: out, post }; }
  out.push(orderBy('created_at', 'desc'));
  return { parts: out, post };
}

/**
 * @param {object} opts { role, uid, view, filters, cursor, pageSize }
 * @returns {Promise<{ rows, cursor, done }>}
 */
export async function fetchLeadsPage({ role, uid, view = 'all', filters = null, cursor = null, pageSize = PAGE_SIZE }) {
  let extra; const post = []; let archivedView = false;
  if (view === 'all' && filters) {
    const r = allLeadsConstraints(filters);
    extra = r.parts; post.push(...(r.post || [])); archivedView = !!r.archivedView;
  } else {
    extra = viewConstraints(view);
    // "New Qualified Leads" — Sales ne start nahi kiya
    if (view === 'sales_fresh') post.push((l) => !SALES_STARTED.includes(String(l.sales_status || '').toLowerCase().trim()));
  }
  // LDR ke views ko uske apne kaam tak seemit rakho (rules allow karti hain zyada, par UX galat lagta hai):
  //  - Fresh Pool: sirf UN-CLAIMED fresh leads (ya jo khud uski hai) — doosre LDR ki claimed fresh nahi
  //  - All Leads: qualified/hand-off ho chuki leads nahi (wo ab Sales ki hain, LDR ko nahi chahiye)
  if (role === 'ldr') {
    if (view === 'fresh') post.push((l) => !l.ldr_uid || l.ldr_uid === uid);
    else if (view === 'all') post.push((l) => String(l.status || '').toLowerCase() !== 'qualified' && !String(l.sales_status || '').trim());
  }
  // Archived leads normal views/filters me kabhi nahi — sirf "Archived" flag chuna ho tabhi.
  if (!archivedView) post.push((l) => !l.archived);
  const over = post.length ? 4 : 1;
  const parts = [
    collection(db, 'leads'),
    ...(archivedView ? [] : scopeConstraints({ role, uid, view })),
    ...extra,
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize * over),
  ];
  const snap = await getDocs(query(...parts));
  const rawCount = snap.docs.length;
  let docs = snap.docs;
  if (post.length) docs = docs.filter((d) => { const l = d.data(); return post.every((f) => f(l)); });
  const rows = docs.slice(0, pageSize).map((d) => ({ id: d.id, ...d.data() }));
  return {
    rows,
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    done: rawCount < pageSize * over,
  };
}

/** Total count (aggregation query = 1 read, sasta). orderBy count me nahi chahiye. */
export async function countLeads({ role, uid, view = 'all' }) {
  const filters = [];
  if (view === 'followup_due') filters.push(where('next_followup', '<=', new Date()));
  else if (view === 'needs_review') filters.push(where('needs_review', '==', true));
  else if (view === 'review_queue') filters.push(where('review_queue', '==', true));
  else if (view === 'urgent') filters.push(where('is_urgent', '==', true));
  else if (view === 'hot') filters.push(where('tier', '==', 'hot'));
  // 'fresh' pool = status fresh/new (har role ke liye same, scope nahi lagta — pool shared hai)
  else if (view === 'fresh') filters.push(where('status', 'in', ['fresh', 'new']));
  const parts = [
    collection(db, 'leads'),
    ...scopeConstraints({ role, uid, view }),
    ...filters,
  ];
  const snap = await getCountFromServer(query(...parts));
  return snap.data().count;
}

// --- Bounded "poori view" fetch — count-card + pivot table ke liye (list abhi bhi paginated).
//     Ek query + client tally, 30-min sessionStorage-jaisa module cache. Naya index nahi
//     (fresh = single-field `status in`, sales_fresh = `status==qualified` [+ sales_uid, jo
//      `(status, sales_uid)` index se chalta hai]). ---
const _allCache = new Map(); // key -> { at, data }
const ALL_TTL = 30 * 60 * 1000;

const VIEW_ALL_PARTS = {
  fresh: () => [where('status', 'in', ['fresh', 'new'])],
  sales_fresh: () => [where('status', '==', 'qualified')],
};

/** @returns {Promise<{ rows, capped }>} */
export async function fetchLeadsAll({ role, uid, view, cap = 2000, force = false }) {
  const key = `${role}:${uid}:${view}:${cap}`;
  const hit = _allCache.get(key);
  if (!force && hit && Date.now() - hit.at < ALL_TTL) return hit.data;

  const vparts = (VIEW_ALL_PARTS[view] || (() => []))();
  const parts = [
    collection(db, 'leads'),
    ...scopeConstraints({ role, uid, view }),
    ...vparts,
    limit(cap + 1),
  ];
  const snap = await getDocs(query(...parts));
  let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => !l.archived);
  if (view === 'sales_fresh') {
    docs = docs.filter((l) => !SALES_STARTED.includes(String(l.sales_status || '').toLowerCase().trim()));
  }
  // Fresh Pool: LDR ko sirf un-claimed (ya apni) fresh leads — fetchLeadsPage jaisa hi
  if (role === 'ldr' && view === 'fresh') {
    docs = docs.filter((l) => !l.ldr_uid || l.ldr_uid === uid);
  }
  const data = { rows: docs.slice(0, cap), capped: snap.size > cap };
  _allCache.set(key, { at: Date.now(), data });
  return data;
}

export function bustLeadsAll() { _allCache.clear(); }

/** "All Leads" ke current filter se MATCHING saari leads (bounded) — "select all" + CSV export ke liye.
 *  @returns {Promise<{ rows, capped }>} */
export async function fetchLeadsForFilter({ role, uid, filters, cap = 6000 }) {
  const r = allLeadsConstraints(filters || {});
  const post = [...(r.post || [])];
  if (!r.archivedView) post.push((l) => !l.archived);
  if (role === 'ldr' && !r.archivedView) post.push((l) => String(l.status || '').toLowerCase() !== 'qualified' && !String(l.sales_status || '').trim());
  const parts = [
    collection(db, 'leads'),
    ...(r.archivedView ? [] : scopeConstraints({ role, uid, view: 'all' })),
    ...r.parts,
    limit(Math.min(cap + 1, 10000)),
  ];
  const snap = await getDocs(query(...parts));
  let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (post.length) docs = docs.filter((l) => post.every((f) => f(l)));
  return { rows: docs.slice(0, cap), capped: snap.size > cap || docs.length > cap };
}

export async function getLead(id) {
  const snap = await getDoc(doc(db, 'leads', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * "All Leads" ke upar status-wise count cards ke liye. Har status = 1 count() (1 read, size se
 * farak nahi). Team + member ke hisaab se scope. 15-min module cache (refresh/filter-change safe).
 * @returns [{ key, label, count, filter }]  — filter = { team?, status?, flag? } jo card click set karega
 */
const _statusCountCache = new Map();
const SC_TTL = 15 * 60 * 1000;

export async function leadStatusCounts({ role, uid, team = '', member = '', force = false }) {
  const key = `${role}:${uid}:${team}:${member}`;
  const hit = _statusCountCache.get(key);
  if (!force && hit && Date.now() - hit.at < SC_TTL) return hit.data;

  const scope = scopeConstraints({ role, uid, view: 'all' });
  const memberW = member ? [where(team === 'sales' ? 'sales_uid' : 'ldr_uid', '==', member)] : [];
  const base = [collection(db, 'leads'), ...scope, ...memberW];
  const c = (w) => getCountFromServer(query(...base, ...w)).then((r) => r.data().count).catch(() => 0);

  // LDR user ko sirf apna kaam (fresh/call back/lost); Sales user ko sirf sales stages.
  const isLdrUser = role === 'ldr';
  const isSalesUser = role === 'sales';
  const wantLdr = !isSalesUser && (team === '' || team === 'ldr');
  const wantSales = !isLdrUser && (team === '' || team === 'sales');

  const defs = [];
  if (wantLdr) {
    defs.push(
      { key: 'fresh', label: 'Fresh', w: [where('status', 'in', ['fresh', 'new'])], filter: { team: 'ldr', status: 'ldr:fresh' } },
      { key: 'callback', label: 'Call Back', w: [where('status', '==', 'call back')], filter: { team: 'ldr', status: 'ldr:call back' } },
    );
  }
  if (wantSales) defs.push({ key: 'qualified', label: 'Qualified', w: [where('status', '==', 'qualified')], filter: { team: 'sales', status: '' } });
  if (wantSales) {
    defs.push(
      { key: 'hot lead', label: 'Hot Lead', w: [where('sales_status', '==', 'hot lead')], filter: { team: 'sales', status: 'sales:hot lead' } },
      { key: 'visit customer', label: 'Visit Customer', w: [where('sales_status', '==', 'visit customer')], filter: { team: 'sales', status: 'sales:visit customer' } },
      { key: 'video call', label: 'Video Call', w: [where('sales_status', '==', 'video call')], filter: { team: 'sales', status: 'sales:video call' } },
      { key: 'followup', label: 'Followup', w: [where('sales_status', '==', 'followup')], filter: { team: 'sales', status: 'sales:followup' } },
      { key: 'order done', label: 'Order Done', w: [where('sales_status', '==', 'order done')], filter: { team: 'sales', status: 'sales:order done' } },
    );
  }
  defs.push(isSalesUser
    ? { key: 'lost', label: 'Lost / Dead', w: [where('sales_status', 'in', ['lost', 'dead'])], filter: { team: 'sales', status: 'sales:lost' } }
    : { key: 'lost', label: 'Lost / Dead', w: [where('status', 'in', ['dead', 'lost'])], filter: { team: 'ldr', status: 'ldr:dead' } });

  const counts = await Promise.all(defs.map((d) => c(d.w)));
  const data = defs.map((d, i) => ({ key: d.key, label: d.label, count: counts[i], filter: d.filter }));
  _statusCountCache.set(key, { at: Date.now(), data });
  return data;
}

export function bustStatusCounts() { _statusCountCache.clear(); }

/**
 * Search — Firestore substring search support nahi karta, isliye ye har field ka
 * PREFIX match karता hai (name/company lowercase, phone digits) — poore collection mein,
 * sirf currently-loaded page mein nahi. LDR/Sales sirf apni leads mein (view chip se
 * independent — "meri koi bhi lead" dhoondta hai), admin sabme.
 */
function searchScope({ role, uid }) {
  if (role === 'ldr') return [where('ldr_uid', '==', uid)];
  if (role === 'sales') return [where('sales_uid', '==', uid)];
  return []; // admin / md / tl — sabme search
}

async function prefixQuery(scope, field, prefix, max) {
  if (!prefix) return [];
  const parts = [
    collection(db, 'leads'), ...scope,
    where(field, '>=', prefix), where(field, '<', prefix + ''),
    limit(max),
  ];
  const snap = await getDocs(query(...parts));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function searchLeads({ role, uid, q, max = 30 }) {
  const term = String(q || '').trim();
  if (!term) return [];
  const scope = searchScope({ role, uid });
  const nameLower = term.toLowerCase();
  const digits = term.replace(/\D/g, '');

  const results = await Promise.all([
    prefixQuery(scope, 'name_lower', nameLower, 20),
    prefixQuery(scope, 'company_lower', nameLower, 10),
    // poore number se shuru (+91 87... type kiya)
    digits.length >= 2 ? prefixQuery(scope, 'phone_digits', digits, 20) : Promise.resolve([]),
    // ya sirf local number, country code ke bina (87... type kiya) — "ends with" via reversed field
    digits.length >= 2 ? prefixQuery(scope, 'phone_digits_rev', revDigits(digits), 20) : Promise.resolve([]),
  ]);

  const merged = new Map();
  for (const rows of results) for (const r of rows) merged.set(r.id, r);
  return [...merged.values()].slice(0, max);
}

/** Lead ki basic info edit (naam, phone, company, city, state, email, source). Phone badla to dup check. */
export async function updateLeadInfo(lead, patch, actor) {
  const changes = [];
  const clean = { updated_at: serverTimestamp() };
  for (const k of ['name', 'company', 'city', 'state', 'source', 'alt_phone']) {
    if (patch[k] != null && String(patch[k]) !== String(lead[k] || '')) { clean[k] = patch[k]; changes.push({ field: k, from: String(lead[k] || ''), to: String(patch[k]) }); }
  }
  if (patch.email != null && patch.email.toLowerCase() !== (lead.email || '')) {
    clean.email = patch.email.toLowerCase(); changes.push({ field: 'email', from: lead.email || '', to: clean.email });
  }
  let newDigits = null;
  if (patch.phone != null) {
    const ph = normalizePhone(patch.phone);
    if (ph.digits && ph.digits !== lead.phone_digits) {
      const idx = await getDoc(doc(db, 'phone_index', ph.digits));
      if (idx.exists() && idx.data().lead_id !== lead.id) throw new Error('dup-phone');
      clean.phone = ph.valid ? ph.formatted : '';
      clean.phone_digits = ph.digits;
      clean.phone_digits_rev = revDigits(ph.digits);
      clean.phone_raw = ph.valid ? '' : patch.phone;
      clean.phone_invalid = !ph.valid;
      newDigits = ph.digits;
      changes.push({ field: 'phone', from: lead.phone || lead.phone_raw || '', to: clean.phone || patch.phone });
    }
  }
  if (changes.length === 0) return { changed: 0 };
  if ('name' in clean) { clean.needs_review = !String(clean.name).trim(); clean.name_lower = String(clean.name).trim().toLowerCase(); }
  if ('company' in clean) clean.company_lower = String(clean.company).toLowerCase();

  const batch = writeBatch(db);
  batch.update(doc(db, 'leads', lead.id), clean);
  if (newDigits) {
    batch.set(doc(db, 'phone_index', newDigits), {
      lead_id: lead.id, name: clean.name ?? lead.name ?? '', phone: clean.phone,
      owner_name: lead.sales_name || lead.ldr_name || '', stage: lead.sales_status || lead.status || '',
      source: clean.source ?? lead.source ?? '', updated_at: serverTimestamp(),
    });
    if (lead.phone_digits) batch.delete(doc(db, 'phone_index', lead.phone_digits));
  }
  batch.set(doc(collection(db, 'audit')), {
    at: serverTimestamp(), uid: actor.uid, actor_name: actor.name || '',
    action: 'lead.edit', target: lead.name || `#${lead.id}`, changes,
  });
  await batch.commit();
  return { changed: changes.length };
}
