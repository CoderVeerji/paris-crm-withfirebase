// "Pending Calls" (LDR) + "My Follow-ups" (Sales) — dono ka data.
// Ek team ke due-followup leads bounded hote hain (cap 900) — isliye ek fetch + client-side
// filter/tally/pagination. Naya composite index nahi chahiye (ldr_uid+next_followup /
// sales_uid+next_followup pehle se hain; admin ke liye next_followup single-field range).
import {
  collection, query, where, orderBy, limit as fbLimit, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';

const IST = '+05:30';
const startOfToday = () => { const d = new Date(); return new Date(`${d.toISOString().slice(0, 10)}T00:00:00${IST}`); };
const endOfToday = () => { const d = new Date(); return new Date(`${d.toISOString().slice(0, 10)}T23:59:59.999${IST}`); };

// LDR ke liye "abhi bhi LDR ke paas" = handoff/closed nahi
const LDR_DONE = ['qualified', 'dead', 'lost', 'not interested', 'order done', 'fresh', 'new'];
// Sales ne kaam shuru kiya = sales_status set + closed/qualified/fresh nahi
const SALES_INACTIVE = ['', 'qualified', 'fresh', 'new', 'order done', 'lost', 'dead'];

/**
 * @param kind 'ldr' | 'sales'
 * @param mode 'overdue' (aaj se pehle) | 'today' | 'all' (aaj tak sab due)
 * @param scopeUid  role ldr/sales ho to unki uid — warna null (admin/tl = poori team)
 */
export async function fetchFollowups({ kind, mode = 'all', from = '', to = '', scopeUid = null, cap = 900 }) {
  const parts = [collection(db, 'leads')];
  if (scopeUid) parts.push(where(kind === 'sales' ? 'sales_uid' : 'ldr_uid', '==', scopeUid));

  if (from && to) {
    parts.push(where('next_followup', '>=', new Date(`${from}T00:00:00${IST}`)), where('next_followup', '<=', new Date(`${to}T23:59:59.999${IST}`)));
  } else if (mode === 'today') {
    parts.push(where('next_followup', '>=', startOfToday()), where('next_followup', '<=', endOfToday()));
  } else if (mode === 'overdue') {
    parts.push(where('next_followup', '<', startOfToday()));
  } else {
    parts.push(where('next_followup', '<=', endOfToday()));
  }
  parts.push(orderBy('next_followup', 'asc'), fbLimit(cap + 1));

  const snap = await getDocs(query(...parts));
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  rows = rows.filter((l) => {
    if (kind === 'sales') {
      const ss = String(l.sales_status || '').toLowerCase().trim();
      return !SALES_INACTIVE.includes(ss);
    }
    // ldr: LDR ke paas hai, Sales ko nahi gaya, closed nahi
    const s = String(l.status || '').toLowerCase().trim();
    if (LDR_DONE.includes(s)) return false;
    if (l.sales_uid && String(l.sales_uid).trim() !== '') return false;
    return true;
  });

  const byStatus = {};
  rows.forEach((l) => {
    const s = String((kind === 'sales' ? l.sales_status : l.status) || 'other').toLowerCase().trim() || 'other';
    byStatus[s] = (byStatus[s] || 0) + 1;
  });

  return { rows: rows.slice(0, cap), capped: snap.size > cap, byStatus };
}
