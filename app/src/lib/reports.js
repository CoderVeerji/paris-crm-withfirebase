// Reports screen — har report ka data-builder. Sab bounded (detail reports pe 92-din + row-cap
// limit — warna ek "all time" export 14k reads / 10 MB payload le jaata, free tier + browser dono
// pe bhaari). Summary reports stats_daily se aate hain (1 read/din) — inpe lambi range OK.
import {
  collection, query, where, orderBy, limit as fbLimit, getDocs, getCountFromServer, documentId,
} from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { dayStart, dayEnd } from './daterange';
import { getRangeStats, daysBetween } from './stats';
import { fmtStatus } from './format';

// Firestore `limit()` ka max 10000 hai — cap 9500 se zyada mat rakho (fetchAll `cap+1` limit lagata hai).
export const REPORTS = [
  { key: 'leads_created', tk: 'rpLeadsCreated', kind: 'detail', maxDays: 92, cap: 9500 },
  { key: 'leads_worked', tk: 'rpLeadsWorked', kind: 'detail', maxDays: 92, cap: 8000 },
  { key: 'leads_qualified', tk: 'rpLeadsQualified', kind: 'detail', maxDays: 92, cap: 9500 },
  { key: 'activity', tk: 'rpActivity', kind: 'detail', maxDays: 92, cap: 9500 },
  { key: 'orders', tk: 'rpOrders', kind: 'detail', maxDays: 366, cap: 9500 },
  { key: 'team_perf', tk: 'rpTeamPerf', kind: 'summary', maxDays: 400 },
  { key: 'daily_leads', tk: 'rpDailyLeads', kind: 'summary', maxDays: 45 },
  { key: 'reinq_archive', tk: 'rpReinqArchive', kind: 'detail', maxDays: 366, cap: 9500 },
  { key: 'pipeline_now', tk: 'rpPipelineNow', kind: 'snapshot' },
];

export const spanDays = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

const asDate = (d) => (d && d.toDate ? d.toDate() : d ? new Date(d) : null);
const fmtTs = (d) => { const x = asDate(d); return x && !isNaN(x) ? x.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
const fmtDay = (d) => { const x = asDate(d); return x && !isNaN(x) ? x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; };
const FA = (l, label) => String((l.form_answers || {})[label] || '');

async function fetchAll(parts, cap) {
  const snap = await getDocs(query(...parts, fbLimit(Math.min(cap + 1, 10000))));
  return { docs: snap.docs.slice(0, cap).map((d) => ({ id: d.id, ...d.data() })), capped: snap.size > cap };
}
const countWhere = async (...parts) => (await getCountFromServer(query(...parts))).data().count;

const LEAD_COLS = ['Lead ID', 'Name', 'Phone', 'Company', 'City', 'State', 'Source', 'LDR', 'Sales',
  'LDR Status', 'Sales Status', 'Tier', 'Score', 'Orders', 'Revenue',
  'Customer Type', 'Bulk?', 'Buying Intent', 'Interested In', 'Approx Quantity'];
const leadRow = (l) => [
  l.id, l.name || '', l.phone || l.phone_raw || '', l.company || '', l.city || '', l.state || '', l.source || '',
  l.ldr_name || '', l.sales_name || '', fmtStatus(l.status), fmtStatus(l.sales_status), (l.tier || '').toUpperCase(), l.score ?? '',
  l.order_count || 0, l.total_revenue || 0,
  FA(l, 'Customer Type'), FA(l, 'Bulk Requirement?'), FA(l, 'Buying Intent'),
  FA(l, 'Customer Interested In'), FA(l, 'Approx Quantity Interested In'),
];

/** @returns {Promise<{ headers, rows, capped, note }>} */
export async function buildReport(key, from, to, cfg) {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw new Error('unknown report');

  if (key === 'leads_created') {
    const { docs, capped } = await fetchAll([
      collection(db, 'leads'),
      where('created_at', '>=', dayStart(from)), where('created_at', '<=', dayEnd(to)),
      orderBy('created_at', 'desc'),
    ], def.cap);
    return {
      headers: ['Created', ...LEAD_COLS, 'Qualified On'],
      rows: docs.filter((l) => !l.archived).map((l) => [fmtTs(l.created_at), ...leadRow(l), fmtDay(l.qualified_at)]),
      capped,
    };
  }

  if (key === 'leads_worked') {
    // "Is range mein jitni leads pe baat hui" — data-analyst report. Activity (range) group-by lead,
    // fir un leads ke current docs merge. Bounded: 8k activity + 30-batched lead fetch (max 1500).
    const { docs: acts, capped: actCap } = await fetchAll([
      collection(db, 'activity'),
      where('at', '>=', dayStart(from)), where('at', '<=', dayEnd(to)),
      orderBy('at', 'desc'),
    ], 9500);
    const byLead = new Map();
    for (const a of acts) {
      if (!a.lead_id) continue;
      let b = byLead.get(a.lead_id);
      if (!b) { b = { touches: 0, people: new Set(), lastAt: null, lastAction: '', lastRemark: '' }; byLead.set(a.lead_id, b); }
      b.touches += 1;
      if (a.actor_name) b.people.add(a.actor_name);
      const at = a.at && a.at.toDate ? a.at.toDate() : null;
      if (at && (!b.lastAt || at > b.lastAt)) { b.lastAt = at; b.lastAction = a.action || ''; if (a.remark) b.lastRemark = a.remark; }
      if (!b.lastRemark && a.remark) b.lastRemark = a.remark;
    }
    const ids = [...byLead.keys()];
    if (ids.length > def.cap) return { headers: [], rows: [], capped: true };
    const leadMap = new Map();
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await getDocs(query(collection(db, 'leads'), where(documentId(), 'in', ids.slice(i, i + 30))));
      snap.forEach((d) => leadMap.set(d.id, d.data()));
    }
    const fromMs = dayStart(from).getTime();
    const headers = ['Lead ID', 'Name', 'Phone', 'Company', 'City', 'Source', 'Created On', 'New / Old',
      'Created By', 'LDR', 'Sales', 'LDR Status', 'Sales Status', 'Tier', 'Score',
      'Touches in range', 'Talked by', 'Last action', 'Last talked', 'Last remark', 'Last Updated',
      'Customer Type', 'Bulk?', 'Approx Quantity'];
    const rows = ids.map((id) => {
      const b = byLead.get(id); const l = leadMap.get(id) || {};
      const cMs = l.created_at && l.created_at.toDate ? l.created_at.toDate().getTime() : 0;
      return [
        id, l.name || '', l.phone || l.phone_raw || '', l.company || '', l.city || '', l.source || '',
        fmtTs(l.created_at), (cMs && cMs >= fromMs) ? 'New' : 'Old (re-inquiry)',
        l.created_by_name || '', l.ldr_name || '', l.sales_name || '',
        fmtStatus(l.status), fmtStatus(l.sales_status), (l.tier || '').toUpperCase(), l.score ?? '',
        b.touches, [...b.people].join(' · '), b.lastAction, fmtTs(b.lastAt), b.lastRemark || '',
        fmtTs(l.last_action_at || b.lastAt),
        FA(l, 'Customer Type'), FA(l, 'Bulk Requirement?'), FA(l, 'Approx Quantity Interested In'),
      ];
    }).sort((a, x) => x[15] - a[15]);
    return { headers, rows, capped: actCap };
  }

  if (key === 'leads_qualified') {
    const { docs, capped } = await fetchAll([
      collection(db, 'leads'),
      where('qualified_at', '>=', dayStart(from)), where('qualified_at', '<=', dayEnd(to)),
      orderBy('qualified_at', 'desc'),
    ], def.cap);
    return {
      headers: ['Qualified On', ...LEAD_COLS, 'Created'],
      rows: docs.filter((l) => !l.archived).map((l) => [fmtTs(l.qualified_at), ...leadRow(l), fmtDay(l.created_at)]),
      capped,
    };
  }

  if (key === 'activity') {
    const { docs, capped } = await fetchAll([
      collection(db, 'activity'),
      where('at', '>=', dayStart(from)), where('at', '<=', dayEnd(to)),
      orderBy('at', 'desc'),
    ], def.cap);
    return {
      headers: ['Date & Time', 'Lead ID', 'Lead', 'Person', 'Action', 'From', 'To', 'Amount', 'Channel', 'Remark'],
      rows: docs.map((a) => [
        fmtTs(a.at), a.lead_id || '', a.lead_name || '', a.actor_name || '', a.action || '',
        fmtStatus(a.from_status), fmtStatus(a.to_status), a.amount || '', a.channel || '', a.remark || '',
      ]),
      capped,
    };
  }

  if (key === 'orders') {
    const { docs, capped } = await fetchAll([
      collection(db, 'orders'),
      where('order_date', '>=', dayStart(from)), where('order_date', '<=', dayEnd(to)),
      orderBy('order_date', 'desc'),
    ], def.cap);
    return {
      headers: ['Order Date', 'Lead ID', 'Customer', 'Sales Person', 'Amount', 'Remark', 'Source'],
      rows: docs.map((o) => [fmtTs(o.order_date), o.lead_id || '', o.lead_name || '', o.sales_name || '', o.amount || 0, o.remark || '', o.source || '']),
      capped,
    };
  }

  if (key === 'team_perf') {
    const rs = await getRangeStats(from, to);
    // current role config se — admin / md / tl kabhi performance report mein nahi
    const roleOf = (uid) => (cfg?.users || []).find((x) => x.id === uid)?.role;
    const rows = Object.entries(rs.byUser)
      .filter(([uid, u]) => { const r = roleOf(uid) || u.role; return r === 'ldr' || r === 'sales'; })
      .map(([uid, u]) => ({ ...u, role: roleOf(uid) || u.role }))
      .sort((a, b) => b.revenue - a.revenue || b.closed - a.closed)
      .map((u) => [
        u.name || '', (u.role || '').toUpperCase(), u.calls || 0, u.qualified || 0, u.closed || 0,
        u.revenue || 0, u.lost || 0, u.calls ? Math.round((u.closed / u.calls) * 100) : 0,
      ]);
    const missing = rs.daysAsked - rs.daysWithData;
    return {
      headers: ['Name', 'Role', 'Calls', 'Qualified', 'Orders', 'Revenue', 'Lost', 'Conversion %'],
      rows,
      capped: false,
      note: missing > 0 ? `stats_daily_missing:${missing}` : '',
    };
  }

  if (key === 'reinq_archive') {
    // Archive (WhatsApp campaign) ke baad jo leads DOBARA enquiry me aayi.
    const { docs, capped } = await fetchAll([
      collection(db, 'leads'),
      where('reinq_after_archive_at', '>=', dayStart(from)), where('reinq_after_archive_at', '<=', dayEnd(to)),
      orderBy('reinq_after_archive_at', 'desc'),
    ], def.cap);
    return {
      headers: ['Re-inquiry On', 'Times Back', 'Lead ID', 'Name', 'Phone', 'Company', 'City', 'Source',
        'LDR Status', 'Sales Status', 'LDR', 'Sales', 'Created', 'Score', 'Tier'],
      rows: docs.map((l) => [
        fmtTs(l.reinq_after_archive_at), l.reinq_after_archive_count || 1, l.id, l.name || '',
        l.phone || l.phone_raw || '', l.company || '', l.city || '', l.source || '',
        fmtStatus(l.status), fmtStatus(l.sales_status), l.ldr_name || '', l.sales_name || '',
        fmtDay(l.created_at), l.score ?? '', (l.tier || '').toUpperCase(),
      ]),
      capped,
    };
  }

  if (key === 'daily_leads') {
    // RAW DATA — pivot ke liye. Ek row = ek (din, banda, category, lead). Pre-aggregated
    // `stats_daily/{date}.dash` se lead-id list + call-count, phir un leads ke current
    // doc se status/name/phone. LDR aur Sales alag TAB (ek Excel file).
    const days = daysBetween(from, to);
    const snaps = await Promise.all(days.map((d) => getDoc(doc(db, 'stats_daily', d))));
    const uById = {}; (cfg?.users || []).forEach((u) => { uById[u.id] = u; });
    const CATS = { fresh: 'Fresh', reinq: 'Urgent', sched: 'Scheduled', offsched: 'Off-Schedule' };
    let missing = 0;

    // saare (din, uid, cat, leadId) collect + saare unique lead-ids
    const recs = []; // { d, uid, role, cat, leadId, connected, calls }
    const idSet = new Set();
    days.forEach((d, i) => {
      const s = snaps[i];
      if (!s.exists() || !s.data().dash) { missing += 1; return; }
      const dash = s.data().dash;
      Object.keys(dash).forEach((uid) => {
        if (uid.startsWith('_')) return;
        const role = uById[uid]?.role || '';
        if (role !== 'ldr' && role !== 'sales') return;
        const b = dash[uid] || {};
        for (const bk of Object.keys(CATS)) {
          const bucket = b[bk] || {};
          for (const [id, n] of Object.entries(bucket.hits || {})) {
            recs.push({ d, uid, role, cat: CATS[bk], leadId: id, connected: 'Connected', calls: n });
            idSet.add(id);
          }
          for (const id of (bucket.pids || [])) {
            recs.push({ d, uid, role, cat: CATS[bk], leadId: id, connected: 'Not Connected', calls: 0 });
            idSet.add(id);
          }
        }
      });
    });

    const ids = [...idSet];
    const CAP = 9000;
    const capped = ids.length > CAP;
    const leadMap = new Map();
    for (let i = 0; i < Math.min(ids.length, CAP); i += 30) {
      const snap = await getDocs(query(collection(db, 'leads'), where(documentId(), 'in', ids.slice(i, i + 30))));
      snap.forEach((d) => leadMap.set(d.id, d.data()));
    }

    const HEADERS = ['Date', 'Person', 'Category', 'Lead Status', 'Connected?', 'Calls', 'Lead Name', 'Phone', 'Lead ID'];
    const sheetFor = (role) => {
      const rows = recs
        .filter((r) => r.role === role)
        .sort((a, b) => (a.d === b.d
          ? (uById[a.uid]?.full_name || '').localeCompare(uById[b.uid]?.full_name || '')
          : a.d.localeCompare(b.d)))
        .map((r) => {
          const l = leadMap.get(r.leadId) || {};
          const st = role === 'sales' ? fmtStatus(l.sales_status) : fmtStatus(l.status);
          return [r.d, uById[r.uid]?.full_name || r.uid, r.cat, st, r.connected, r.calls,
            l.name || '', l.phone || l.phone_raw || '', r.leadId];
        });
      return { name: role === 'ldr' ? 'LDR Team' : 'Sales Team', headers: HEADERS, rows };
    };

    return {
      multiSheet: true,
      sheets: [sheetFor('ldr'), sheetFor('sales')],
      rows: [{}],
      capped,
      note: missing > 0 ? `stats_daily_missing:${missing}` : '',
    };
  }

  if (key === 'pipeline_now') {
    const L = (s) => [collection(db, 'leads'), where('status', '==', s)];
    const SS = (s) => [collection(db, 'leads'), where('sales_status', '==', s)];
    const [fresh, callback, qualified, hot, visit, video, followup, order, deadL, lostL, lostS, deadS] = await Promise.all([
      countWhere(collection(db, 'leads'), where('status', 'in', ['fresh', 'new'])),
      countWhere(collection(db, 'leads'), where('status', 'in', ['call back', 'callback', 'no answer'])),
      countWhere(...L('qualified')),
      countWhere(...SS('hot lead')),
      countWhere(...SS('visit customer')),
      countWhere(...SS('video call')),
      countWhere(...SS('followup')),
      countWhere(...SS('order done')),
      countWhere(...L('dead')), countWhere(...L('lost')),
      countWhere(...SS('lost')), countWhere(...SS('dead')),
    ]);
    return {
      headers: ['Stage', 'Team', 'Leads right now'],
      rows: [
        ['Fresh / New (pool)', 'LDR', fresh],
        ['Call Back (LDR working)', 'LDR', callback],
        ['Qualified — handed to Sales', 'LDR→Sales', qualified],
        ['Hot Lead', 'Sales', hot],
        ['Visit Customer', 'Sales', visit],
        ['Video Call', 'Sales', video],
        ['Follow-up', 'Sales', followup],
        ['Order Done', 'Sales', order],
        ['Lost / Dead', 'Both', deadL + lostL + lostS + deadS],
      ],
      capped: false,
    };
  }

  throw new Error('unknown report');
}
