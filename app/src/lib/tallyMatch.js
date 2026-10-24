// Tally se aaya data (Party, Phone, Amount) ko CRM ki leads se match karo.
//   Match mila  -> ONLINE sale (lead system mein hai) + uska stage
//   Match nahi  -> OFFLINE sale
// Kuch bhi likhta nahi (zero writes). Reads: matched number par ~2 (phone_index + lead). Cap TALLY_MAX_ROWS.
import { collection, query, where, getDocs, documentId } from 'firebase/firestore';
import { db } from '../firebase';
import { parseCsv } from './csv';
import { fmtStatus } from './format';

export const TALLY_MAX_ROWS = 3000;

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z]/g, '');

/** text (CSV / Excel se paste kiya tab-separated) -> rows. Delimiter khud pehchanta hai. */
export function parseTallyText(text) {
  const first = String(text || '').split(/\r?\n/).find((l) => l.trim()) || '';
  const count = (ch) => (first.match(new RegExp(ch === '\t' ? '\\t' : `\\${ch}`, 'g')) || []).length;
  const delim = [['\t', count('\t')], [',', count(',')], [';', count(';')]].sort((a, b) => b[1] - a[1])[0][0];
  // parseCsv comma-based hai — baaki delimiters ko comma-safe banane ke liye quote karke convert
  const raw = delim === ',' ? text : String(text).split(/\r?\n/).map((ln) => ln.split(delim).map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const grid = parseCsv(raw);
  if (!grid.length) return { rows: [], hasHeader: false };

  const head = grid[0].map(norm);
  const find = (...keys) => head.findIndex((h) => keys.some((k) => h === k || (k.length > 3 && h.includes(k))));
  let iParty = find('party', 'partyname', 'particulars', 'customer', 'name');
  let iPhone = find('phone', 'mobile', 'contact', 'number', 'whatsapp', 'tel');
  let iAmt = find('amount', 'value', 'debit', 'sales', 'gross', 'total', 'credit');
  const hasHeader = iParty >= 0 || iPhone >= 0 || iAmt >= 0;
  let start = 1;
  if (!hasHeader) { iParty = 0; iPhone = 1; iAmt = 2; start = 0; } // header nahi — order: Party, Phone, Amount
  else {
    if (iParty < 0) iParty = [0, 1, 2].find((i) => i !== iPhone && i !== iAmt) ?? 0;
    if (iPhone < 0) iPhone = [1, 0, 2].find((i) => i !== iParty && i !== iAmt) ?? 1;
    if (iAmt < 0) iAmt = [2, 1, 0].find((i) => i !== iParty && i !== iPhone) ?? 2;
  }
  const rows = [];
  for (let i = start; i < grid.length; i++) {
    const r = grid[i];
    const party = String(r[iParty] ?? '').trim();
    const phoneRaw = String(r[iPhone] ?? '').trim();
    const amount = parseAmount(r[iAmt]);
    if (!party && !phoneRaw && !amount) continue;
    rows.push({ party, phoneRaw, amount });
  }
  return { rows, hasHeader };
}

function parseAmount(v) {
  const s = String(v ?? '').replace(/[₹,\s]|rs\.?|inr/gi, '').replace(/\((.*)\)/, '-$1').replace(/(dr|cr)\.?$/i, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** ek cell mein ek ya zyada number ho sakte hain ("98xxx, 99xxx") — phone_index ke keys (digits with country code) lautata hai */
export function phoneKeys(cell) {
  const keys = [];
  const groups = String(cell || '').match(/\+?\d[\d\s-]{6,}\d/g) || [];
  for (const g of groups) {
    const d = g.replace(/\D/g, '');
    if (d.length === 10) keys.push(`91${d}`);
    else if (d.length === 11 && d.startsWith('0')) keys.push(`91${d.slice(1)}`);
    else if (d.length === 12 && d.startsWith('91')) keys.push(d);
    else if (d.length > 10) { keys.push(d); keys.push(`91${d.slice(-10)}`); }
    else if (d.length >= 7) keys.push(`91${d}`);
  }
  return [...new Set(keys)];
}

async function inChunks(col, ids, size = 30) {
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  for (let i = 0; i < chunks.length; i += 8) { // 8 parallel
    // eslint-disable-next-line no-await-in-loop
    const snaps = await Promise.all(chunks.slice(i, i + 8).map((c) => getDocs(query(collection(db, col), where(documentId(), 'in', c)))));
    snaps.forEach((sn) => sn.forEach((d) => out.set(d.id, d.data())));
  }
  return out;
}

const stageOf = (l) => String(l.sales_status || l.status || '').toLowerCase().trim();

/** rows -> { items, summary } */
export async function matchTally(rows) {
  const keySet = new Set();
  rows.forEach((r) => phoneKeys(r.phoneRaw).forEach((k) => keySet.add(k)));
  const idx = await inChunks('phone_index', [...keySet]);
  const leadIds = [...new Set([...idx.values()].map((x) => x.lead_id).filter(Boolean))];
  const leads = await inChunks('leads', leadIds);

  const items = rows.map((r) => {
    const keys = phoneKeys(r.phoneRaw);
    let lead = null; let leadId = '';
    for (const k of keys) {
      const ix = idx.get(k);
      if (ix && ix.lead_id && leads.has(ix.lead_id)) { leadId = ix.lead_id; lead = leads.get(ix.lead_id); break; }
    }
    return {
      ...r, keys, noPhone: keys.length === 0, online: !!lead, leadId,
      leadName: lead ? (lead.name || '') : '', stage: lead ? stageOf(lead) : '',
      sales: lead ? (lead.sales_name || '') : '', ldr: lead ? (lead.ldr_name || '') : '',
    };
  });

  const on = items.filter((i) => i.online); const off = items.filter((i) => !i.online);
  const sum = (a) => a.reduce((s, i) => s + i.amount, 0);
  const byStage = {};
  on.forEach((i) => { const k = i.stage || 'other'; (byStage[k] = byStage[k] || { count: 0, amount: 0 }); byStage[k].count += 1; byStage[k].amount += i.amount; });
  return {
    items,
    summary: {
      total: { count: items.length, amount: sum(items) },
      online: { count: on.length, amount: sum(on) },
      offline: { count: off.length, amount: sum(off) },
      noPhone: items.filter((i) => i.noPhone).length,
      byStage: Object.entries(byStage).map(([stage, v]) => ({ stage, label: fmtStatus(stage) || stage, ...v })).sort((a, b) => b.amount - a.amount),
    },
  };
}

export const tallyCsv = (items) => ({
  headers: ['Party', 'Phone (as in Tally)', 'Amount', 'Sale type', 'Lead ID', 'Lead name', 'Stage', 'Sales owner', 'LDR'],
  rows: items.map((i) => [i.party, i.phoneRaw, i.amount, i.online ? 'Online' : 'Offline', i.leadId, i.leadName, i.online ? fmtStatus(i.stage) : '', i.sales, i.ldr]),
});
