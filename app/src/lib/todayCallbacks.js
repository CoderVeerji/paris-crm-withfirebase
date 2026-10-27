// "Aaj ke callbacks" — jis lead ke liye aaj ki date + time daali gayi hai (jaise "4 baje aayega"). LDR/Sales ko apni aaj ki
// leads time ke hisaab se sorted, upar highlight ke saath. Bounded query (owner + next_followup range, <= LIMIT docs).
import { collection, query, where, orderBy, limit as fbLimit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const LIMIT = 60;
const toD = (ts) => (ts && ts.toDate ? ts.toDate() : ts ? new Date(ts) : null);

export const isToday = (ts) => { const d = toD(ts); return !!d && d.toDateString() === new Date().toDateString(); };
/** date ke saath time bhi daala gaya? (00:00 = sirf date) */
export const hasTime = (ts) => { const d = toD(ts); return !!d && (d.getHours() !== 0 || d.getMinutes() !== 0); };
export const fmtTime = (ts) => { const d = toD(ts); return d ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''; };

/** @returns {Promise<Array<{ id, name, at: Date, hasTime, past, stage }>>} sorted by time */
export async function fetchTodayCallbacks({ role, uid }) {
  if (!uid || (role !== 'ldr' && role !== 'sales')) return [];
  const field = role === 'sales' ? 'sales_uid' : 'ldr_uid';
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(); e.setHours(23, 59, 59, 999);
  const snap = await getDocs(query(collection(db, 'leads'), where(field, '==', uid),
    where('next_followup', '>=', s), where('next_followup', '<=', e), orderBy('next_followup', 'asc'), fbLimit(LIMIT)));
  const now = Date.now();
  const out = [];
  snap.forEach((d) => {
    const l = d.data();
    if (l.archived) return;
    const st = String(l.status || '').toLowerCase(); const ss = String(l.sales_status || '').toLowerCase();
    if (['lost', 'dead'].includes(st) || ss === 'lost') return;
    // effective owner: sales_status/qualified => Sales ki, warna LDR ki
    const salesOwned = !!ss || st === 'qualified';
    if (role === 'sales' ? !salesOwned : salesOwned) return;
    const at = l.next_followup.toDate();
    out.push({ id: d.id, name: l.name || l.phone || d.id, at, hasTime: hasTime(l.next_followup), past: at.getTime() < now, stage: ss || st, lead: { id: d.id, ...l } });
  });
  return out;
}
