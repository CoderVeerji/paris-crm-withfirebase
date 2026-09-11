// Data Health — company-wide "leads jo system mein kho rahi hain" ke counts + drill list.
// Sab count()-based (1 read each, size se farak nahi). Per-person 3 count/user. 30-min cache.
import {
  collection, query, where, orderBy, limit as fbLimit, getDocs, getCountFromServer,
} from 'firebase/firestore';
import { db } from '../firebase';

const cnt = async (...w) => (await getCountFromServer(query(collection(db, 'leads'), ...w))).data().count;
const CACHE_TTL = 30 * 60 * 1000;
function cached(key, fn) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) { const { at, v } = JSON.parse(raw); if (Date.now() - at < CACHE_TTL) return Promise.resolve(v); }
  } catch { /* ignore */ }
  return fn().then((v) => { try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch { /* ignore */ } return v; });
}
export function bustHealthCache() {
  try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k && k.startsWith('pc_dh')) sessionStorage.removeItem(k); } } catch { /* ignore */ }
}

const days14 = () => new Date(Date.now() - 14 * 86400000);

// har check: {key, label, tone, wheres}
// tk = i18n key (screen `t(c.tk)` se render karta hai — hardcoded label nahi)
export const HEALTH_CHECKS = [
  { key: 'total', tk: 'dhcTotal', tone: 'ink' },
  { key: 'open', tk: 'dhcOpen', tone: 'warn' },
  { key: 'unassigned', tk: 'dhcUnassigned', tone: 'bad', wheres: () => [where('status', '==', 'qualified'), where('sales_uid', '==', null)] },
  { key: 'noname', tk: 'dhcNoname', tone: 'bad', wheres: () => [where('name', '==', '')] },
  { key: 'overdue', tk: 'dhcOverdue', tone: 'brown', wheres: () => [where('next_followup', '<', new Date())] },
  { key: 'never', tk: 'dhcNever', tone: 'red', wheres: () => [where('attempts', '==', 0)] },
  { key: 'stale', tk: 'dhcStale', tone: 'purple', wheres: () => [where('last_action_at', '<', days14())] },
];

export async function healthOverview() {
  return cached('pc_dh_ov', async () => {
    const [total, qualified, lost, orders] = await Promise.all([
      cnt(), cnt(where('status', '==', 'qualified')),
      cnt(where('status', 'in', ['dead', 'lost'])), cnt(where('sales_status', '==', 'order done')),
    ]);
    const rest = await Promise.all(HEALTH_CHECKS.filter((c) => c.wheres).map((c) => cnt(...c.wheres()).catch(() => null)));
    const out = { total, open: Math.max(0, total - lost - orders) };
    HEALTH_CHECKS.filter((c) => c.wheres).forEach((c, i) => { out[c.key] = rest[i]; });
    return out;
  });
}

/** per-person: total / overdue / never — 3 count() per active user */
export async function healthByPerson(users) {
  return cached(`pc_dh_pp_${users.length}`, async () => {
    const rows = await Promise.all(users.map(async (u) => {
      const f = u.role === 'sales' ? 'sales_uid' : 'ldr_uid';
      const [total, overdue, never] = await Promise.all([
        cnt(where(f, '==', u.id)).catch(() => 0),
        cnt(where(f, '==', u.id), where('next_followup', '<', new Date())).catch(() => 0),
        cnt(where(f, '==', u.id), where('attempts', '==', 0)).catch(() => 0),
      ]);
      return { uid: u.id, name: u.full_name, role: u.role, total, overdue, never };
    }));
    return rows.filter((r) => r.total > 0).sort((a, b) => (b.overdue + b.never) - (a.overdue + a.never));
  });
}

/** ek bucket ki saari leads (cap 600) — filter + multi-select + client-side pagination ke liye */
export async function fetchHealthLeads(bucketKey, cap = 600) {
  const c = HEALTH_CHECKS.find((x) => x.key === bucketKey);
  if (!c || !c.wheres) return { rows: [], capped: false };
  const parts = [collection(db, 'leads'), ...c.wheres()];
  if (bucketKey === 'overdue') parts.push(orderBy('next_followup', 'asc'));
  else if (bucketKey === 'stale') parts.push(orderBy('last_action_at', 'asc'));
  parts.push(fbLimit(cap + 1));
  const snap = await getDocs(query(...parts));
  return { rows: snap.docs.slice(0, cap).map((d) => ({ id: d.id, ...d.data() })), capped: snap.size > cap };
}
