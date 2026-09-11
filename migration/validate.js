/**
 * Paris CRM — migration PRE-FLIGHT VALIDATOR  (read-only, no Firestore, no writes)
 *
 *   node validate.js
 *
 * Purana Sheets-copy CSV padhta hai, migrate.js jaisi hi cleaning-logic chalata hai,
 * aur 3 review-files banata hai `reports/` mein:
 *
 *   1. validation-issues-<ts>.csv   — har problem row: lead_id | field | issue | value | fix
 *                                     (Excel mein kholo, source sheet mein fix karo, dobara export)
 *   2. leads-cleaned-preview-<ts>.csv — poori leads table CLEANING KE BAAD (jaisa Firestore mein
 *                                     jayega): normalized phone, trimmed naam, resolved owner naam,
 *                                     dup-flag. Isse end-state eyeball-verify karo.
 *   3. validation-summary.txt        — counts + top issues
 *
 * Ye kuch LIKHTA nahi. Migration khud `migrate.js --wipe` karta hai (activity + orders +
 * milestones bhi — isliye "Bulk Import Excel" wala route use MAT karo, wo sirf naye fresh
 * leads ke liye hai, history/status/owner kho jaayega).
 *
 * Inputs: ./csv-exports/{Leads,ARCHIVED_LEADS,Users,Dynamic_Forms,Stages_Config,Settings}.csv
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const CSV_DIR = path.join(__dirname, 'csv-exports');
const OUT_DIR = path.join(__dirname, 'reports');
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ---------- source: export.json (Apps Script) ya CSVs ----------
const JSON_PATH = (() => {
  for (const n of ['export.json', 'paris-crm-migration-export.json']) {
    const p = path.join(CSV_DIR, n);
    if (fs.existsSync(p)) return p;
  }
  try {
    const hit = fs.readdirSync(CSV_DIR).find((f) => /^paris-crm-migration-export.*\.json$/i.test(f));
    if (hit) return path.join(CSV_DIR, hit);
  } catch { /* ignore */ }
  return null;
})();
const SRC = JSON_PATH ? JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) : null;
if (SRC) {
  console.log(`source: ${path.basename(JSON_PATH)} (Apps Script export)`);
  if (Array.isArray(SRC.ghost_users) && SRC.ghost_users.length && Array.isArray(SRC.users)) {
    SRC.users = SRC.users.concat(SRC.ghost_users);
    console.log(`  + ${SRC.ghost_users.length} ghost users merged`);
  }
}
const JSON_KEY = {
  'Users.csv': 'users', 'Leads.csv': 'leads', 'ARCHIVED_LEADS.csv': 'archived',
  'Dynamic_Forms.csv': 'forms', 'Stages_Config.csv': 'stages', 'Settings.csv': 'settings',
};

function readCsv(name, optional) {
  if (SRC) {
    const rows = SRC[JSON_KEY[name]];
    if (Array.isArray(rows) && rows.length) return rows;
    if (optional) { console.warn(`  (skip) ${name} JSON me nahi`); return []; }
    console.error(`ERROR: JSON me "${JSON_KEY[name]}" nahi.`); process.exit(1);
  }
  const p = path.join(CSV_DIR, name);
  if (!fs.existsSync(p)) {
    if (optional) { console.warn(`  (skip) ${name} nahi mila`); return []; }
    console.error(`ERROR: ${name} nahi mila csv-exports/ mein. README dekho.`); process.exit(1);
  }
  return parse(fs.readFileSync(p), { bom: true, relax_column_count: true, skip_empty_lines: true, trim: false });
}
const col = (row, i) => (row[i] == null ? '' : String(row[i]).trim());
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const writeCsv = (file, headerArr, rows) => {
  const out = [headerArr.join(',')].concat(rows.map((r) => r.map(csvCell).join(','))).join('\n');
  fs.writeFileSync(path.join(OUT_DIR, file), out);
};

// ---------- cleaning helpers (migrate.js ka mirror) ----------
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return { formatted: '', digits: '', valid: false };
  const cleaned = s.replace(/[^\d+ ]/g, '').replace(/\s+/g, ' ').trim();
  let cc, num;
  if (cleaned.startsWith('+')) {
    const rest = cleaned.slice(1); const parts = rest.split(' ');
    if (parts.length > 1) { cc = parts[0].replace(/\D/g, ''); num = parts.slice(1).join('').replace(/\D/g, ''); }
    else {
      const d = rest.replace(/\D/g, '');
      if (d.length >= 12) { cc = d.slice(0, 2); num = d.slice(2); }
      else if (d.length === 11) { cc = d.slice(0, 1); num = d.slice(1); }
      else { cc = '91'; num = d; }
    }
  } else {
    const d = cleaned.replace(/\D/g, '');
    if (d.length === 10) { cc = '91'; num = d; }
    else if (d.length === 12 && d.startsWith('91')) { cc = '91'; num = d.slice(2); }
    else if (d.length > 10) { cc = d.slice(0, d.length - 10); num = d.slice(-10); }
    else { cc = '91'; num = d; }
  }
  const valid = !!cc && num.length >= 6 && num.length <= 12;
  return { formatted: valid ? `+${cc} ${num}` : s, digits: valid ? cc + num : num, valid };
}
const JUNK_NAMES = new Set(['0', 'no', 'none', 'na', 'n/a', '-', '--', '...', '..', 'test', 'x', '.', 'null']);
const isJunkName = (name) => {
  const n = String(name || '').trim().toLowerCase();
  return !n || JUNK_NAMES.has(n) || n.length < 2;
};
const KNOWN_STATUS = new Set(['fresh', 'new', 'call back', 'callback', 'no answer', 'qualified', 'dead', 'lost', '']);
const KNOWN_SALES = new Set(['', 'hot lead', 'visit customer', 'visit done', 'video call', 'followup', 'follow up', 'call back', 'order done', 'order won', 'lost', 'dead']);

// ---------- run ----------
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
console.log('\n=== Paris CRM — migration pre-flight validation ===\n');

const usersCsv = readCsv('Users.csv');
const leadsCsv = readCsv('Leads.csv');
const archCsv = readCsv('ARCHIVED_LEADS.csv', true);

// user maps (migrate.js jaisa)
const byLegacy = {}, byName = {}, byFirst = {}, userRole = {};
for (let i = 1; i < usersCsv.length; i++) {
  const r = usersCsv[i];
  const legacy = col(r, 0), name = col(r, 1).toLowerCase(), email = col(r, 2).toLowerCase(), role = col(r, 5).toLowerCase();
  if (!email) continue;
  byLegacy[legacy] = { name: col(r, 1), role };
  userRole[legacy] = role;
  if (name) { byName[name] = legacy; const f = name.split(' ')[0]; byFirst[f] = byFirst[f] === undefined ? legacy : null; }
}
const usersActive = Object.keys(byLegacy).length;
console.log(`users in Users.csv : ${usersActive}`);

const issues = [];   // [lead_id, field, issue, value, suggested_fix]
const add = (id, field, issue, value, fix) => issues.push([id, field, issue, value || '', fix || '']);

const seenPhone = {};     // digits -> first lead_id
const seenId = new Set();
const cleaned = [];       // preview rows
const counts = {
  rows: 0, archived: 0, junkName: 0, badPhone: 0, noPhone: 0, dupPhone: 0,
  unmappedLdr: 0, unmappedSales: 0, salesNoOwner: 0, weirdStatus: 0, badFormJson: 0, dupId: 0, futureFollowup: 0,
};
const NOW = Date.now();

function scan(rows, archived) {
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = col(r, 0);
    if (!id) { add('(row ' + (i + 1) + ')', 'ID', 'blank ID — row skip ho jayegi', '', 'sheet mein ID daalo ya row hatao'); continue; }
    counts.rows++; if (archived) counts.archived++;
    if (seenId.has(id)) { counts.dupId++; add(id, 'ID', 'duplicate lead ID (dono me se ek hi migrate hogi)', id, 'ek row ka ID badlo'); }
    seenId.add(id);

    const rawName = col(r, 2);
    const name = isJunkName(rawName) ? '' : rawName.replace(/\s+/g, ' ').trim();
    if (isJunkName(rawName)) { counts.junkName++; add(id, 'Name', 'junk/empty naam -> needs_review flag', rawName, 'asli naam bharo (warna review queue me jayegi)'); }

    const phraw = col(r, 3);
    const ph = normalizePhone(phraw);
    if (!phraw) { counts.noPhone++; add(id, 'Phone', 'phone bilkul nahi', '', 'phone number daalo (dedup + call ke liye zaroori)'); }
    else if (!ph.valid) { counts.badPhone++; add(id, 'Phone', 'invalid phone -> phone_raw me jayega, call/dedup nahi hoga', phraw, 'sahi 10-digit number daalo'); }

    if (ph.digits) {
      if (seenPhone[ph.digits]) { counts.dupPhone++; add(id, 'Phone', `same phone lead #${seenPhone[ph.digits]} par bhi hai (dono aayengi, baad me merge karo)`, ph.formatted, `#${seenPhone[ph.digits]} se check karo — ek rakho`); }
      else seenPhone[ph.digits] = id;
    }

    const ldrLeg = col(r, 10), salesLeg = col(r, 11);
    let ldrUid = ldrLeg && byLegacy[ldrLeg] ? ldrLeg : '';
    let salesUid = salesLeg && byLegacy[salesLeg] ? salesLeg : '';
    if (ldrLeg && !ldrUid) { counts.unmappedLdr++; add(id, 'LDR_User', `LDR id "${ldrLeg}" Users.csv me nahi — owner KHO jayega`, ldrLeg, 'Users.csv me ye id add karo ya lead ka LDR_User theek karo'); }
    if (salesLeg && !salesUid) { counts.unmappedSales++; add(id, 'Sales_User', `Sales id "${salesLeg}" Users.csv me nahi — owner KHO jayega`, salesLeg, 'Users.csv me ye id add karo ya Sales_User theek karo'); }
    // role mismatch — LDR_User jo actually sales hai (ya ulta)
    if (ldrUid && userRole[ldrUid] && userRole[ldrUid] !== 'ldr' && userRole[ldrUid] !== 'admin') add(id, 'LDR_User', `LDR_User "${byLegacy[ldrUid].name}" ka role "${userRole[ldrUid]}" hai, ldr nahi`, ldrLeg, 'confirm karo — galat column me to nahi');
    if (salesUid && userRole[salesUid] && userRole[salesUid] !== 'sales') add(id, 'Sales_User', `Sales_User "${byLegacy[salesUid].name}" ka role "${userRole[salesUid]}" hai, sales nahi`, salesLeg, 'confirm karo');

    const status = col(r, 9).toLowerCase();
    const salesStatus = col(r, 17).toLowerCase();
    if (!KNOWN_STATUS.has(status)) { counts.weirdStatus++; add(id, 'Status', `anjaan status "${status}"`, col(r, 9), 'known status me badlo: fresh / call back / qualified / dead / lost'); }
    if (salesStatus && !KNOWN_SALES.has(salesStatus)) add(id, 'Sales_Status', `anjaan sales_status "${salesStatus}"`, col(r, 17), 'known: hot lead / visit customer / video call / followup / order done / lost');
    if (salesStatus && !salesUid) { counts.salesNoOwner++; add(id, 'Sales_Status', `sales_status "${salesStatus}" set hai par koi Sales owner nahi`, salesStatus, 'Sales_User bharo ya sales_status hatao'); }
    if (status === 'qualified' && !salesLeg) add(id, 'Status', 'qualified hai par Sales_User khali — go-live pe auto-assign hoga', '', 'theek hai / ya sahi salesperson daal do');

    let fa = {};
    try { fa = col(r, 14) && col(r, 14) !== '{}' ? JSON.parse(col(r, 14)) : {}; }
    catch { counts.badFormJson++; add(id, 'Form_Answers', 'Form_Answers valid JSON nahi — qualification answers kho jayenge', col(r, 14).slice(0, 60), 'sheet me JSON theek karo ya {} kar do'); }

    const nf = col(r, 13);
    if (nf) {
      const d = Date.parse(nf) || (() => { const m = nf.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN; })();
      if (!isNaN(d) && d > NOW + 400 * 86400000) { counts.futureFollowup++; add(id, 'Next_Followup', 'followup date 1 saal se zyada aage — shayad galat', nf, 'date check karo'); }
    }

    cleaned.push([
      id, name || '(needs review)', ph.valid ? ph.formatted : (phraw ? phraw + ' (INVALID)' : ''),
      col(r, 6), col(r, 7), col(r, 8), col(r, 16) || 'Unknown',
      status || 'fresh', salesStatus,
      ldrUid ? byLegacy[ldrUid].name : (ldrLeg ? `?? id ${ldrLeg}` : ''),
      salesUid ? byLegacy[salesUid].name : (salesLeg ? `?? id ${salesLeg}` : ''),
      seenPhone[ph.digits] && seenPhone[ph.digits] !== id ? `DUP of #${seenPhone[ph.digits]}` : '',
      archived ? 'archived' : '',
    ]);
  }
}

scan(leadsCsv, false);
scan(archCsv, true);

// ---------- write ----------
writeCsv(`validation-issues-${TS}.csv`,
  ['lead_id', 'field', 'issue', 'current_value', 'suggested_fix'], issues);
writeCsv(`leads-cleaned-preview-${TS}.csv`,
  ['id', 'name', 'phone', 'company', 'city', 'state', 'source', 'status', 'sales_status', 'ldr_owner', 'sales_owner', 'dup_flag', 'archived'],
  cleaned);

const critical = counts.unmappedLdr + counts.unmappedSales + counts.dupId;
const summary = [
  `Paris CRM migration validation — ${new Date().toISOString()}`,
  ``,
  `Leads scanned      : ${counts.rows}   (archived ${counts.archived})`,
  `Users in Users.csv : ${usersActive}`,
  ``,
  `--- issues ---`,
  `duplicate lead ID  : ${counts.dupId}      ${counts.dupId ? '<<< FIX (data loss)' : 'ok'}`,
  `unmapped LDR owner : ${counts.unmappedLdr}   ${counts.unmappedLdr ? '<<< FIX (owner lost)' : 'ok'}`,
  `unmapped Sales owner: ${counts.unmappedSales}   ${counts.unmappedSales ? '<<< FIX (owner lost)' : 'ok'}`,
  `junk / empty name  : ${counts.junkName}   -> needs_review (not lost)`,
  `invalid phone      : ${counts.badPhone}   -> phone_raw kept (no call/dedup)`,
  `no phone at all    : ${counts.noPhone}`,
  `duplicate phone    : ${counts.dupPhone}   -> both imported, merge later in app`,
  `sales_status w/o owner: ${counts.salesNoOwner}`,
  `unknown status     : ${counts.weirdStatus}`,
  `bad Form_Answers JSON: ${counts.badFormJson}`,
  `far-future followup: ${counts.futureFollowup}`,
  ``,
  critical
    ? `>>> ${critical} CRITICAL issue(s). validation-issues CSV kholo, source sheet me fix karo, dobara export + validate.`
    : `>>> No critical issues. Proceed: migrate:dry -> review -> migrate:wipe.`,
  ``,
  `files: reports/validation-issues-${TS}.csv , reports/leads-cleaned-preview-${TS}.csv`,
].join('\n');

fs.writeFileSync(path.join(OUT_DIR, 'validation-summary.txt'), summary);
console.log(summary + '\n');
