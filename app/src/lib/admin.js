// Admin operations — users, config, audit, recycle, bulk. Sab isAdmin rules ke andar.
import {
  initializeApp, getApps, getApp,
} from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, documentId,
  query, where, writeBatch, serverTimestamp, addDoc, orderBy, limit, startAfter, increment,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { computeScore } from './scoring';
import { revDigits } from './leads';

const TEMP_PASSWORD = 'Paris@2026';

// secondary app — naya Auth user banаte waqt admin ka session na tootе
function secondaryAuth() {
  const primary = getApp();
  const name = 'secondary';
  const app = getApps().find((a) => a.name === name) || initializeApp(primary.options, name);
  return getAuth(app);
}

/* ---------- AUDIT ---------- */
// changes: [{ field, from, to }] — sirf jo actually badla. Khali ho to kuch nahi likhte.
export async function audit(actor, action, target, changes = [], extra = {}) {
  try {
    if (Array.isArray(changes) && changes.length === 0 && !extra.note) return; // no-op, skip
    await addDoc(collection(db, 'audit'), {
      at: serverTimestamp(),
      uid: actor.uid, actor_name: actor.name || '',
      action, target,
      changes: Array.isArray(changes) ? changes : [],
      ...extra,
    });
  } catch (e) { console.warn('audit fail', e); }
}

/** old vs new object -> [{field, from, to}] sirf changed keys ke liye */
export function diff(oldObj = {}, newObj = {}, keys) {
  const ks = keys || [...new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})])];
  const out = [];
  for (const k of ks) {
    const a = oldObj?.[k] ?? '';
    const b = newObj?.[k] ?? '';
    if (String(a) !== String(b)) out.push({ field: k, from: String(a), to: String(b) });
  }
  return out;
}

export async function fetchAudit({ cursor = null, pageSize = 40, from = null, to = null }) {
  const parts = [collection(db, 'audit')];
  if (from) parts.push(where('at', '>=', from));
  if (to) parts.push(where('at', '<=', to));
  parts.push(orderBy('at', 'desc'));
  if (cursor) parts.push(startAfter(cursor));
  parts.push(limit(pageSize));
  const snap = await getDocs(query(...parts));
  return {
    rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    done: snap.docs.length < pageSize,
  };
}

/* ---------- USERS ---------- */
export async function createUser({ full_name, email, phone, role, team = '' }, actor) {
  const sAuth = secondaryAuth();
  const cred = await createUserWithEmailAndPassword(sAuth, email.trim().toLowerCase(), TEMP_PASSWORD);
  const uid = cred.user.uid;
  await setDoc(doc(db, 'users', uid), {
    legacy_id: '', full_name, email: email.trim().toLowerCase(), phone: phone || '', role,
    team: role === 'tl' ? team : '',
    status: 'active', attendance: 'Present',
    created_at: serverTimestamp(), last_login: null,
    fcm_tokens: [], must_reset_password: true,
  });
  await signOut(sAuth);
  await audit(actor, 'user.create', full_name || email, [], { note: `${email} · ${role}` });
  return { uid, tempPassword: TEMP_PASSWORD };
}

export async function updateUser(uid, patch, oldUser, actor) {
  const changes = diff(oldUser, { ...oldUser, ...patch }, Object.keys(patch));
  if (changes.length === 0) return;
  await updateDoc(doc(db, 'users', uid), patch);
  await audit(actor, 'user.update', oldUser?.full_name || uid, changes);
}

export async function sendReset(email, actor) {
  await sendPasswordResetEmail(auth, email);
  await audit(actor, 'user.password_reset_email', email, [], { note: 'reset email sent' });
}

/** kisi user ki saari leads (LDR + Sales) doosre user ko transfer */
export async function transferLeads(fromUid, toUid, actor) {
  let moved = 0;
  for (const field of ['ldr_uid', 'sales_uid']) {
    let last = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const parts = [collection(db, 'leads'), where(field, '==', fromUid), orderBy(documentId()), limit(400)];
      if (last) parts.push(startAfter(last));
      const snap = await getDocs(query(...parts));
      if (snap.empty) break;
      const b = writeBatch(db);
      snap.docs.forEach((d) => b.update(d.ref, { [field]: toUid, updated_at: serverTimestamp() }));
      await b.commit();
      moved += snap.size;
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < 400) break;
    }
  }
  await audit(actor, 'leads.transfer', '', [], { note: `${moved} leads moved` });
  return moved;
}

/* ---------- CONFIG ---------- */
export async function saveSettings(newObj, oldObj, actor) {
  const changes = diff(oldObj, newObj);
  if (changes.length === 0) return;
  await setDoc(doc(db, 'config', 'settings'), newObj, { merge: true });
  await audit(actor, 'settings.save', 'Settings', changes);
}

/** config/access — kaunsa role kaunsa menu-item aur kaunsa dashboard-variant dekhega.
 *  Ye SIRF visibility hai — asli security (kaun kya kar sakta hai) Firestore rules mein fixed hai. */
export async function saveAccess(access, actor) {
  await setDoc(doc(db, 'config', 'access'), access, { merge: true });
  await audit(actor, 'settings.access', 'Access Control', [{ field: 'menu', from: '', to: 'updated' }]);
}

/** config/ad_spend — daily ad budget (Facebook/Instagram/...).
 *  standing = har din ka default kharcha per platform.
 *  days = kisi khaas din ka actual/override (band-wale din ke liye 0, ya Excel import se).
 *  Report inhi se cost-per-lead nikalta hai. */
export async function saveAdSpend(patch, actor) {
  await setDoc(doc(db, 'config', 'ad_spend'), patch, { merge: true });
  await audit(actor, 'settings.adspend', 'Ad Spend', [{ field: Object.keys(patch).join(','), from: '', to: 'updated' }]);
}

/**
 * Weekly-report email ke liye Gmail address + App Password.
 * Password kabhi wapas nahi padha ja sakta (rules block karti hain) — sirf overwrite hota hai,
 * isliye yahan koi "purana password dikhao" jaisa kaam nahi hai, bas naya save hota hai.
 */
export async function saveMailConfig({ email, appPassword }, actor) {
  const patch = {};
  if (email != null) patch.Report_Email = email;
  if (appPassword) patch.mail_password_set = true;
  if (Object.keys(patch).length) await setDoc(doc(db, 'config', 'settings'), patch, { merge: true });
  if (appPassword) {
    await setDoc(doc(db, 'config', 'mail_secret'), { app_password: appPassword, updated_at: serverTimestamp() });
  }
  await audit(actor, 'settings.mail', 'Email settings', [
    ...(email != null ? [{ field: 'Report_Email', from: '', to: email }] : []),
    ...(appPassword ? [{ field: 'app_password', from: '', to: '(updated)' }] : []),
  ]);
}

/** naam-list ka before/after diff — kaunse fields add/remove/rename hue */
function listDiff(oldList, newList, key) {
  const o = (oldList || []).map((x) => x[key]);
  const n = (newList || []).map((x) => x[key]);
  const added = n.filter((x) => !o.includes(x));
  const removed = o.filter((x) => !n.includes(x));
  const changes = [];
  if (added.length) changes.push({ field: 'added', from: '', to: added.join(', ') });
  if (removed.length) changes.push({ field: 'removed', from: removed.join(', '), to: '' });
  if (!added.length && !removed.length) changes.push({ field: 'reordered / edited', from: '', to: n.join(', ') });
  return changes;
}

export async function saveFormFields(fields, actor) {
  const prev = (await getDoc(doc(db, 'config', 'forms'))).data()?.fields || [];
  await setDoc(doc(db, 'config', 'forms'), { fields });
  await audit(actor, 'config.forms', 'Form Fields', listDiff(prev, fields, 'label'));
}

export async function saveStages(stages, actor) {
  const prev = (await getDoc(doc(db, 'config', 'stages'))).data()?.stages || [];
  await setDoc(doc(db, 'config', 'stages'), { stages });
  await audit(actor, 'config.stages', 'Pipeline Stages', listDiff(prev, stages, 'name'));
}

/* ---------- RECYCLE ---------- */
export async function softDeleteLead(lead, actor) {
  const b = writeBatch(db);
  b.set(doc(db, 'recycle', lead.id), {
    kind: 'lead', data: lead, deleted_at: serverTimestamp(), deleted_by: actor.uid, deleted_by_name: actor.name || '',
  });
  b.delete(doc(db, 'leads', lead.id));
  // phone_index bhi saaf karo — warna delete ke baad bhi wo number "already exists" dikhata rahega
  // (stale index kisi aisi lead ki taraf ishaara karta jo ab hai hi nahi).
  if (lead.phone_digits) {
    const idx = await getDoc(doc(db, 'phone_index', lead.phone_digits));
    if (idx.exists() && idx.data().lead_id === lead.id) b.delete(doc(db, 'phone_index', lead.phone_digits));
  }
  await b.commit();
  await audit(actor, 'lead.delete', lead.name || `#${lead.id}`, [], { note: lead.phone || lead.phone_raw || '' });
}

export async function restoreLead(recycleId, actor) {
  const snap = await getDoc(doc(db, 'recycle', recycleId));
  if (!snap.exists()) throw new Error('not-found');
  const { data } = snap.data();
  const b = writeBatch(db);
  const { id, ...rest } = data;
  b.set(doc(db, 'leads', id), { ...rest, updated_at: serverTimestamp(), restored_at: serverTimestamp() });
  b.delete(doc(db, 'recycle', recycleId));
  // phone_index wapas is lead ki taraf point karo (delete ke waqt hataya tha)
  if (rest.phone_digits) {
    b.set(doc(db, 'phone_index', rest.phone_digits), {
      lead_id: id, name: rest.name || '', phone: rest.phone || rest.phone_raw || '',
      owner_name: rest.sales_name || rest.ldr_name || '', stage: rest.sales_status || rest.status || '',
      source: rest.source || '', updated_at: serverTimestamp(),
    });
  }
  await b.commit();
  await audit(actor, 'lead.restore', data.name || `#${id}`, [], { note: 'restored from recycle bin' });
}

export async function fetchRecycle() {
  const snap = await getDocs(query(collection(db, 'recycle'), orderBy('deleted_at', 'desc'), limit(100)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ---------- BULK ---------- */
export async function bulkArchive(leadIds, archived, actor) {
  const upd = archived
    ? { archived: true, archived_at: serverTimestamp(), updated_at: serverTimestamp() }
    : { archived: false, archived_at: null, updated_at: serverTimestamp() };
  for (let i = 0; i < leadIds.length; i += 400) {
    const b = writeBatch(db);
    leadIds.slice(i, i + 400).forEach((id) => b.update(doc(db, 'leads', id), upd));
    await b.commit();
  }
  await audit(actor, archived ? 'leads.archive' : 'leads.unarchive', '', [], { note: `${leadIds.length} leads` });
}

export async function bulkAssign(leadIds, { ldr_uid, sales_uid }, names, actor) {
  const patch = { updated_at: serverTimestamp() };
  if (ldr_uid) { patch.ldr_uid = ldr_uid; patch.ldr_name = names.ldr || ''; }
  if (sales_uid) { patch.sales_uid = sales_uid; patch.sales_name = names.sales || ''; }
  for (let i = 0; i < leadIds.length; i += 400) {
    const b = writeBatch(db);
    leadIds.slice(i, i + 400).forEach((id) => b.update(doc(db, 'leads', id), patch));
    await b.commit();
  }
  await audit(actor, 'leads.bulk_assign', '', [], {
    note: `${leadIds.length} leads → ${names.sales || names.ldr || 'assigned'}`,
  });
}

/** Diye gaye phone_digits mein se jo pehle se DB mein hain — un ka Set. (Bulk-import preview.) */
export async function checkExistingPhones(digitsArr) {
  const uniq = [...new Set((digitsArr || []).filter(Boolean))];
  const seen = new Set();
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, 'leads'), where('phone_digits', 'in', chunk)));
    snap.forEach((d) => seen.add(d.data().phone_digits));
  }
  return seen;
}

/**
 * Pre-filtered rows -> naye fresh leads. Har row apna `_ldr_uid`/`_ldr_name` khud carry karta hai
 * (BulkImport component name-column + auto/manual distribution se resolve karta hai).
 * `rows` sirf valid + non-duplicate hone chahiye. Return: { added, byLdr:{name:count} }.
 */
export async function importLeads(rows, actor, onProgress) {
  const metaRef = doc(db, 'meta', 'counters');
  const metaSnap = await getDoc(metaRef);
  let nextId = (metaSnap.exists() ? metaSnap.data().leads || 0 : 0) + 1;

  let added = 0;
  const byLdr = {};
  const toWrite = rows.filter((r) => r._valid && !r._dup);

  for (let i = 0; i < toWrite.length; i += 300) {
    const b = writeBatch(db);
    for (const r of toWrite.slice(i, i + 300)) {
      const id = String(nextId++);
      const lead = {
        created_at: serverTimestamp(), created_by: actor.uid, created_by_name: actor.name || '',
        name: r.name || '', name_lower: (r.name || '').toLowerCase(), phone: r._formatted, phone_digits: r._digits, phone_digits_rev: revDigits(r._digits), phone_raw: r._valid ? '' : r.phone,
        phone_invalid: !r._valid, alt_phone: '', email: (r.email || '').toLowerCase(),
        company: r.company || '', company_lower: (r.company || '').toLowerCase(), city: r.city || '', state: r.state || '', source: r.source || 'Bulk Import',
        status: 'fresh', sales_status: '',
        ldr_uid: r._ldr_uid || null, sales_uid: null,
        ldr_name: r._ldr_name || '', sales_name: '',
        attempts: 0, next_followup: null, form_answers: {}, outcome: '',
        order_count: 0, total_revenue: 0, archived: false, needs_review: !r.name,
        bulk_import: true, // assignSales isse per-lead "nayi lead" notification skip karta hai (spam se bacho)
        updated_at: serverTimestamp(),
      };
      const sc = computeScore(lead);
      lead.score = sc.score; lead.tier = sc.tier;
      b.set(doc(db, 'leads', id), lead);
      const key = r._ldr_name || '—';
      byLdr[key] = (byLdr[key] || 0) + 1;
      added++;
    }
    await b.commit();
    onProgress?.(Math.min(i + 300, toWrite.length), toWrite.length);
  }
  await updateDoc(metaRef, { leads: nextId - 1 }).catch(() => setDoc(metaRef, { leads: nextId - 1 }, { merge: true }));
  const note = Object.entries(byLdr).map(([n, c]) => `${n}:${c}`).join(', ');
  await audit(actor, 'leads.import', '', [], { note: `${added} added — ${note}` });
  return { added, byLdr };
}

/* ---------- DUPLICATE FINDER ---------- */

/**
 * Poori leads collection ek baar scan karo (phone_digits se sorted, isliye same-phone
 * docs adjacent aa jaate hain — ek hi pass mein group ban jaate hain, alag query nahi chahiye).
 * Sirf ek baar admin ke tap karne par chalta hai — koi background job / function nahi.
 * @param onProgress (scannedCount) => void
 * @returns [{ digits, leads: [...] }]  — sirf wo groups jisme 2+ leads hain
 */
export async function scanDuplicates(onProgress) {
  const groups = [];
  let cursor = null;
  let curDigits = null;
  let curGroup = [];
  let scanned = 0;
  for (;;) {
    const parts = [
      collection(db, 'leads'), orderBy('phone_digits'),
      ...(cursor ? [startAfter(cursor)] : []), limit(500),
    ];
    const snap = await getDocs(query(...parts));
    for (const d of snap.docs) {
      const lead = { id: d.id, ...d.data() };
      scanned++;
      if (!lead.phone_digits) continue;
      if (lead.phone_digits === curDigits) {
        curGroup.push(lead);
      } else {
        if (curGroup.length > 1) groups.push({ digits: curDigits, leads: curGroup });
        curDigits = lead.phone_digits;
        curGroup = [lead];
      }
    }
    onProgress?.(scanned);
    if (snap.docs.length < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  if (curGroup.length > 1) groups.push({ digits: curDigits, leads: curGroup });
  return groups;
}

/**
 * Do duplicate leads ko ek mein milao. `duplicate` ki orders `canonical` ko mil jaati hain
 * (revenue/order_count add ho jaata hai), `duplicate` recycle bin mein chala jaata hai
 * (permanently delete nahi — restore ho sakta hai galti se).
 * `activity` docs immutable hain (rules), isliye purani history duplicate ki id ke neeche
 * hi rehti hai — canonical ki timeline mein ek "merged" note likh dete hain.
 */
export async function mergeLead(canonical, duplicate, actor) {
  const ordersSnap = await getDocs(query(collection(db, 'orders'), where('lead_id', '==', duplicate.id)));
  let movedRevenue = 0;
  const orderDocs = ordersSnap.docs;
  for (let i = 0; i < orderDocs.length; i += 400) {
    const b = writeBatch(db);
    orderDocs.slice(i, i + 400).forEach((d) => {
      movedRevenue += Number(d.data().amount || 0);
      b.update(d.ref, { lead_id: canonical.id, lead_name: canonical.name || '' });
    });
    await b.commit();
  }
  const movedCount = orderDocs.length;

  const batch = writeBatch(db);
  if (movedCount > 0) {
    batch.update(doc(db, 'leads', canonical.id), {
      order_count: increment(movedCount), total_revenue: increment(movedRevenue),
      outcome: 'customer', updated_at: serverTimestamp(),
    });
  }
  if (canonical.phone_digits) {
    batch.set(doc(db, 'phone_index', canonical.phone_digits), {
      lead_id: canonical.id, name: canonical.name || '', phone: canonical.phone || canonical.phone_raw || '',
      owner_name: canonical.sales_name || canonical.ldr_name || '', stage: canonical.sales_status || canonical.status || '',
    }, { merge: true });
  }
  batch.set(doc(collection(db, 'activity')), {
    lead_id: canonical.id, lead_name: canonical.name || '', at: serverTimestamp(),
    uid: actor.uid, actor_name: actor.name || '', action: 'merge',
    from_status: '', to_status: '', amount: movedRevenue, channel: 'app',
    remark: `Merged duplicate #${duplicate.id} (${duplicate.name || 'no name'}, ${duplicate.phone || duplicate.phone_raw || ''}) — ${movedCount} order(s) moved.`.slice(0, 500),
  });
  batch.set(doc(db, 'recycle', duplicate.id), {
    kind: 'lead', data: { ...duplicate, dup_merged_into: canonical.id },
    deleted_at: serverTimestamp(), deleted_by: actor.uid, deleted_by_name: actor.name || '',
  });
  batch.delete(doc(db, 'leads', duplicate.id));
  batch.set(doc(collection(db, 'audit')), {
    at: serverTimestamp(), uid: actor.uid, actor_name: actor.name || '',
    action: 'lead.merge', target: canonical.name || `#${canonical.id}`,
    changes: [{ field: 'merged_duplicate', from: `#${duplicate.id}`, to: canonical.name || `#${canonical.id}` }],
  });
  await batch.commit();
  return { movedCount, movedRevenue };
}
