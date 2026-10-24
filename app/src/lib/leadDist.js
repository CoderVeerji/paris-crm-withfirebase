// "Lead distribution" report — kis DIN kis Sales person ko kitni leads mili, aur unme se abhi kitni pending.
// Source: leads.assigned_sales_at (jis din Sales ko di gayi). Pending = ABHI bhi Sales ne chhua nahi (sales_open). Bounded, 92 din.
import { collection, query, where, orderBy, limit as fbLimit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { dayStart, dayEnd } from './daterange';
import { istDay } from './stats';
import { isSalesOpen } from './leads';

export const LEAD_DIST_MAX_DAYS = 92;
const CAP = 9500;

/** @returns {{ rows: {day, uid, name, received, pending, worked}[], capped, total }} */
export async function fetchLeadDist(from, to, cfg) {
  const snap = await getDocs(query(
    collection(db, 'leads'),
    where('assigned_sales_at', '>=', dayStart(from)), where('assigned_sales_at', '<=', dayEnd(to)),
    orderBy('assigned_sales_at', 'asc'), fbLimit(CAP + 1),
  ));
  const capped = snap.size > CAP;
  const nameOf = {}; (cfg?.users || []).forEach((u) => { nameOf[u.id] = u.full_name; });
  const map = new Map();
  snap.docs.slice(0, CAP).forEach((d) => {
    const l = d.data();
    const ts = l.assigned_sales_at?.toMillis ? l.assigned_sales_at.toMillis() : null;
    if (!ts || !l.sales_uid) return;
    const day = istDay(ts);
    const k = `${day}|${l.sales_uid}`;
    let r = map.get(k);
    if (!r) { r = { day, uid: l.sales_uid, name: nameOf[l.sales_uid] || l.sales_name || l.sales_uid, received: 0, pending: 0, worked: 0 }; map.set(k, r); }
    r.received += 1;
    if (!l.archived && isSalesOpen(l.status, l.sales_status)) r.pending += 1; else r.worked += 1;
  });
  const rows = [...map.values()].sort((a, b) => (a.day === b.day ? a.name.localeCompare(b.name) : b.day.localeCompare(a.day)));
  return { rows, capped, total: snap.size > CAP ? CAP : snap.size };
}
