// Reports -> "Team report": date range ke liye har LDR / Sales ka  Name - Leads - Pending - Followup.
// Sirf count() queries (1 read each, ~3 per person, sab parallel) — koi lead document download nahi hota, isliye tez hai.
//   Leads    = is date range mein MILI fresh leads. LDR: created_at range (owner ldr_uid); Sales: assigned_sales_at range (owner sales_uid) — MECA jaisa
//   Pending  = un mili hui leads mein se jo report nikalte waqt (abhi) bhi pending hain: LDR = status fresh/new, Sales = sales_open (chhui nahi)
//   Followup = is range mein SCHEDULED followups jo abhi pending hain: lead khuli (outcome khaali) aur uski next_followup range ke andar.
//              (lead par kaam ho jaaye to next_followup aage badh jaati hai / hat jaati hai, isliye jo range mein dikhti hai wo abhi tak nipti nahi)
//              LDR = sirf LDR ki apni (sales_status khaali — Sales ko ja chuki lead Sales ke count mein), Sales = sales_uid wali.
// Indexes: LDR leads/pending/followup aur Sales leads/followup maujooda indexes par chalte hain; Sales pending (sales_uid + sales_open + assigned_sales_at) aur
// LDR followup (ldr_uid + sales_status + outcome + next_followup) ke liye firestore.indexes.json mein 2 naye composite indexes hain — index bante tak wo cell '?' dikhata hai.
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { dayStart, dayEnd } from './daterange';

const cnt = (...c) => getCountFromServer(query(collection(db, 'leads'), ...c)).then((s) => s.data().count).catch(() => null);

/** @param users [{ id, full_name, role: 'ldr'|'sales' }], from/to = 'YYYY-MM-DD' (IST)  ->  [{ uid, name, role, leads, pending, followup }]  (null = ginti nahi ho payi) */
export function fetchTeamReport(users, from, to) {
  const s = dayStart(from); const e = dayEnd(to);
  return Promise.all(users.map(async (u) => {
    const isSales = u.role === 'sales';
    const own = where(isSales ? 'sales_uid' : 'ldr_uid', '==', u.id);
    const got = where(isSales ? 'assigned_sales_at' : 'created_at', '>=', s); const gotE = where(isSales ? 'assigned_sales_at' : 'created_at', '<=', e);
    const fuS = where('next_followup', '>=', s); const fuE = where('next_followup', '<=', e);
    const open = where('outcome', '==', '');
    const [leads, pending, followup] = await Promise.all([
      cnt(own, got, gotE),
      isSales ? cnt(own, where('sales_open', '==', true), got, gotE) : cnt(own, where('status', 'in', ['fresh', 'new']), got, gotE),
      isSales ? cnt(own, open, fuS, fuE) : cnt(own, where('sales_status', '==', ''), open, fuS, fuE),
    ]);
    return { uid: u.id, name: u.full_name || '', role: u.role, leads, pending, followup };
  }));
}

const n = (v) => (v == null ? '?' : v);
const total = (rows, f) => rows.reduce((a, r) => a + (r[f] || 0), 0);
const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const byLeads = (a, b) => (b.leads || 0) - (a.leads || 0) || a.name.localeCompare(b.name);

/** Structured: [{ team: 'ldr'|'sales', rows: [...sorted], total: {leads,pending,followup} }] */
export function groupTeams(rows, teams) {
  return teams.map((tm) => {
    const list = rows.filter((r) => r.role === tm).sort(byLeads);
    return { team: tm, rows: list, total: { leads: total(list, 'leads'), pending: total(list, 'pending'), followup: total(list, 'followup') } };
  }).filter((g) => g.rows.length);
}

/** Excel jaisa text: tab-separated (Excel / Sheets se copy kiya hua jaisa) — Excel mein paste karo to columns mein bantta hai.
 *  L = { period, ldr, sales, name, leads, pending, followup, total } (selected language ki labels) */
export function buildTsv(groups, { from, to, L }) {
  const out = [`${L.period}: ${fmtDay(from)}${from === to ? '' : ` - ${fmtDay(to)}`}`];
  groups.forEach((g) => {
    out.push('', g.team === 'ldr' ? L.ldr : L.sales, [L.name, L.leads, L.pending, L.followup].join('\t'));
    g.rows.forEach((r) => out.push([r.name, n(r.leads), n(r.pending), n(r.followup)].join('\t')));
    out.push([L.total, g.total.leads, g.total.pending, g.total.followup].join('\t'));
  });
  return out.join('\n');
}

/** WhatsApp ke liye: tab WhatsApp mein theek nahi dikhta, isliye "Name - Leads - Pending - Followup" lines. */
export function buildWhatsappText(groups, { from, to, L }) {
  const out = [`*${L.title}*`, `${L.period}: ${fmtDay(from)}${from === to ? '' : ` - ${fmtDay(to)}`}`];
  groups.forEach((g) => {
    out.push('', `*${g.team === 'ldr' ? L.ldr : L.sales}*`, [L.name, L.leads, L.pending, L.followup].join(' - '));
    g.rows.forEach((r) => out.push([r.name, n(r.leads), n(r.pending), n(r.followup)].join(' - ')));
    out.push(`*${L.total}* - ${g.total.leads} - ${g.total.pending} - ${g.total.followup}`);
  });
  return out.join('\n');
}

/** Excel / CSV file ke liye seedhi table (Team column ke saath, filter karne layak). */
export function buildTable(groups, { L }) {
  const headers = [L.team, L.name, L.leads, L.pending, L.followup];
  const rows = [];
  groups.forEach((g) => {
    g.rows.forEach((r) => rows.push([g.team === 'ldr' ? L.ldr : L.sales, r.name, n(r.leads), n(r.pending), n(r.followup)]));
    rows.push([g.team === 'ldr' ? L.ldr : L.sales, L.total, g.total.leads, g.total.pending, g.total.followup]);
  });
  return { headers, rows };
}
