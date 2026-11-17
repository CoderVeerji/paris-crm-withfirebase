// Reports -> "Team status (text)": har LDR / Sales ka  Naam - Leads - Pending - Followup pending  (copy-paste / WhatsApp ke liye text).
// Sirf count() queries (1 read each, ~5 per person) — koi lead document download nahi hota. Naya index nahi chahiye (sab queries pehle se maujood indexes par chalti hain).
//   Leads            = abhi us person ke paas kul leads (archived nahi)                      — MECA "Ab tak kul" jaisa
//   Pending          = abhi tak chhui nahi: LDR = fresh/new, Sales = sales_open               — MECA "Pending" jaisa
//   Followup pending = next_followup guzar chuki aur lead band nahi (outcome khaali)          — All Leads ka "Overdue" filter jaisa
//                      (window: sab / pichle 7 din / pichle 2 din — purane migrated leads ka bada backlog alag dikhane ke liye)
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';

const DAY = 86400000;
export const FU_WINDOWS = ['all', '7', '2'];

const cnt = (...c) => getCountFromServer(query(collection(db, 'leads'), ...c)).then((s) => s.data().count).catch(() => null);

/** @param users [{ id, full_name, role: 'ldr'|'sales' }]  ->  [{ uid, name, role, leads, pending, fu: { all, 7, 2 } }]  (null = ginti nahi ho payi) */
export async function fetchTeamStatus(users) {
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d2 = new Date(now.getTime() - 2 * DAY);
  return Promise.all(users.map(async (u) => {
    const isSales = u.role === 'sales';
    const own = where(isSales ? 'sales_uid' : 'ldr_uid', '==', u.id);
    const open = where('outcome', '==', '');
    const past = where('next_followup', '<', now);
    const [leads, pending, all, w7, w2] = await Promise.all([
      cnt(own, where('archived', '==', false)),
      isSales ? cnt(own, where('archived', '==', false), where('sales_open', '==', true)) : cnt(own, where('archived', '==', false), where('status', 'in', ['fresh', 'new'])),
      cnt(own, open, past),
      cnt(own, open, where('next_followup', '>=', d7), past),
      cnt(own, open, where('next_followup', '>=', d2), past),
    ]);
    return { uid: u.id, name: u.full_name || '', role: u.role, leads, pending, fu: { all, 7: w7, 2: w2 } };
  }));
}

const n = (v) => (v == null ? '?' : String(v));
const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);

/** Text banao. labels = { title, cols, ldr, sales, total } (selected language ki). teams = ['ldr','sales'], win = 'all'|'7'|'2' */
export function buildTeamStatusText(rows, { teams, win, labels, at = new Date() }) {
  const stamp = at.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const out = [`*${labels.title}*`, stamp];
  teams.forEach((tm) => {
    const list = rows.filter((r) => r.role === tm)
      .sort((a, b) => (b.fu[win] || 0) - (a.fu[win] || 0) || (b.pending || 0) - (a.pending || 0) || a.name.localeCompare(b.name));
    if (!list.length) return;
    out.push('', `*${tm === 'ldr' ? labels.ldr : labels.sales}*`, labels.cols);
    list.forEach((r) => out.push(`${r.name} - ${n(r.leads)} - ${n(r.pending)} - ${n(r.fu[win])}`));
    out.push(`*${labels.total}* - ${sum(list, (r) => r.leads)} - ${sum(list, (r) => r.pending)} - ${sum(list, (r) => r.fu[win])}`);
  });
  return out.join('\n');
}
