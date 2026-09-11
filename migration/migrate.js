/**
 * Paris CRM — one-time migration: Google Sheets (copy) -> Firestore
 *
 *   npm run migrate:dry     -> kuch likhega nahi, sirf report
 *   npm run migrate:wipe    -> target collections clear karke fresh likhta hai
 *   npm run migrate         -> merge likhta hai (wipe ke bina)
 *
 * Inputs:  ./csv-exports/{Leads,ARCHIVED_LEADS,Users,Dynamic_Forms,Stages_Config,Settings}.csv
 *          ./serviceAccountKey.json
 * Outputs: ./reports/migration-report-<ts>.json  +  ./user-credentials.csv
 *
 * Prod sheet ko HAATH NAHI — sirf uski copy se export kiya hua CSV.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry');
const WIPE = ARGS.includes('--wipe');
// --limit N  ->  sirf N leads migrate karo (test run ke liye, free tier ke andar)
// --sample   ->  N leads poore data mein se barabar faasle par (junk/dup bhi test ho)
const argNum = flag => {
  const eq = ARGS.find(x => x.startsWith(flag + '='));
  if (eq) return parseInt(eq.split('=')[1], 10) || 0;
  const i = ARGS.indexOf(flag);
  if (i >= 0 && ARGS[i + 1]) return parseInt(ARGS[i + 1], 10) || 0;
  return 0;
};
const LIMIT = argNum('--limit');
const SAMPLE = ARGS.includes('--sample');
const CSV_DIR = path.join(__dirname, 'csv-exports');
const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');
const REPORTS_DIR = path.join(__dirname, 'reports');

const TEMP_PASSWORD = 'Paris@2026'; // sab users ka temp — first login pe forced reset

// ---- reporting form fields (docs/decisions.md) ----
const FORM_FIELD_MAP = {
  f_customer_type: 'Customer Type',
  f_bulk: 'Bulk Requirement?',
  f_intent: 'Buying Intent',
  f_interested_in: 'Customer Interested In',
  f_quantity: 'Approx Quantity Interested In',
};

const report = {
  started: new Date().toISOString(),
  mode: DRY ? 'dry-run' : WIPE ? 'wipe+write' : 'merge-write',
  users: { total: 0, created: 0, skipped: 0 },
  leads: { total: 0, active: 0, archived: 0, needs_review: 0, phone_invalid: 0, duplicates: 0 },
  activity: { total: 0 },
  orders: { total: 0, revenue: 0 },
  warnings: [],
};

// ===================================================================
// Firebase
// ===================================================================
const admin = require('firebase-admin');
const PROJECT_ID = 'paris-crm';

if (fs.existsSync(KEY_PATH)) {
  // Tareeka A: service account key file (agar org policy allow kare)
  console.log('🔑 auth: serviceAccountKey.json');
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)), projectId: PROJECT_ID });
} else {
  // Tareeka B: Application Default Credentials — tumhare apne gcloud login se (koi key file nahi)
  //   Setup:  gcloud auth application-default login
  console.log('🔑 auth: Application Default Credentials (gcloud login)');
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
  } catch (e) {
    console.error('\n❌ Auth nahi mila. Ek baar chalao:');
    console.error('   gcloud auth application-default login\n');
    console.error('   (ya serviceAccountKey.json migration/ folder mein rakho)\n');
    process.exit(1);
  }
}
const db = admin.firestore();
const auth = admin.auth();

// ===================================================================
// Helpers — CSV
// ===================================================================
// Source: agar csv-exports/export.json hai (Apps Script se) to usse padho — warna CSVs.
// JSON me har sheet raw row-arrays hai (header + rows) — bilkul CSV parse jaisa shape.
const JSON_PATH = (() => {
  for (const n of ['export.json', 'paris-crm-migration-export.json']) {
    const p = path.join(CSV_DIR, n);
    if (fs.existsSync(p)) return p;
  }
  // koi bhi paris-crm-migration-export-*.json
  try {
    const hit = fs.readdirSync(CSV_DIR).find((f) => /^paris-crm-migration-export.*\.json$/i.test(f));
    if (hit) return path.join(CSV_DIR, hit);
  } catch { /* ignore */ }
  return null;
})();
const SRC = JSON_PATH ? JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')) : null;
if (SRC) {
  console.log(`📦 source: ${path.basename(JSON_PATH)} (Apps Script export)`);
  // ghost users (purana staff jinki leads hain) ko Users list ke aage jodo — owner na khoye
  if (Array.isArray(SRC.ghost_users) && SRC.ghost_users.length && Array.isArray(SRC.users)) {
    SRC.users = SRC.users.concat(SRC.ghost_users);
    console.log(`   + ${SRC.ghost_users.length} ghost user(s) merged (ex-staff, inactive)`);
  }
  if (SRC.summary) console.log('   summary:', JSON.stringify(SRC.summary));
}

const JSON_KEY = {
  'Users.csv': 'users', 'Leads.csv': 'leads', 'ARCHIVED_LEADS.csv': 'archived',
  'Dynamic_Forms.csv': 'forms', 'Stages_Config.csv': 'stages', 'Settings.csv': 'settings',
};

function readCsv(name, optional) {
  if (SRC) {
    const key = JSON_KEY[name];
    const rows = key && Array.isArray(SRC[key]) ? SRC[key] : [];
    if (!rows.length && !optional) { console.error(`❌ JSON me "${key}" nahi mila.`); process.exit(1); }
    return rows;
  }
  const p = path.join(CSV_DIR, name);
  if (!fs.existsSync(p)) {
    if (optional) { console.warn(`⚠️  ${name} nahi mila — skip (optional).`); return []; }
    console.error(`❌ ${name} nahi mila csv-exports/ mein. README dekho.`);
    process.exit(1);
  }
  const rows = parse(fs.readFileSync(p), { bom: true, relax_column_count: true, skip_empty_lines: true, trim: false });
  return rows; // array of arrays; row[0] = header
}
const col = (row, i) => (row[i] == null ? '' : String(row[i]).trim());

// ===================================================================
// Helpers — dates
// ===================================================================
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

/** ISO / "YYYY-MM-DD HH:MM" (IST) / blank -> Date|null */
function parseFlexibleDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 5.5 * 3600e3); // IST -> UTC
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/** "02-Sep-2026 02:26 PM" (IST wall clock) -> Date|null */
function parseLogTime(chunk) {
  const m = String(chunk).match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m || MONTHS[m[2].toLowerCase()] === undefined) return null;
  let h = parseInt(m[4], 10);
  const ap = (m[6] || '').toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], h, +m[5]) - 5.5 * 3600e3);
}

// ===================================================================
// Helpers — phone
// ===================================================================
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return { formatted: '', digits: '', valid: false };
  const cleaned = s.replace(/[^\d+ ]/g, '').replace(/\s+/g, ' ').trim();
  let cc, num;
  if (cleaned.startsWith('+')) {
    const rest = cleaned.slice(1);
    const parts = rest.split(' ');
    if (parts.length > 1) { cc = parts[0].replace(/\D/g, ''); num = parts.slice(1).join('').replace(/\D/g, ''); }
    else {
      const digits = rest.replace(/\D/g, '');
      // best-effort: 2-digit cc if 12+ digits, else 1-digit for e.g. +1
      if (digits.length >= 12) { cc = digits.slice(0, 2); num = digits.slice(2); }
      else if (digits.length === 11) { cc = digits.slice(0, 1); num = digits.slice(1); }
      else { cc = '91'; num = digits; }
    }
  } else {
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length === 10) { cc = '91'; num = digits; }
    else if (digits.length === 12 && digits.startsWith('91')) { cc = '91'; num = digits.slice(2); }
    else if (digits.length > 10) { cc = digits.slice(0, digits.length - 10); num = digits.slice(-10); }
    else { cc = '91'; num = digits; }
  }
  const valid = !!cc && num.length >= 6 && num.length <= 12;
  return { formatted: valid ? `+${cc} ${num}` : s, digits: valid ? cc + num : num, valid };
}

// ===================================================================
// Helpers — junk name
// ===================================================================
const JUNK_NAMES = new Set(['0', 'no', 'none', 'na', 'n/a', '-', '--', '...', '..', 'test', 'x', '.', 'null']);
function isJunkName(name) {
  const n = String(name || '').trim().toLowerCase();
  return !n || JUNK_NAMES.has(n) || n.length < 2;
}

// ===================================================================
// Helpers — Notes -> activity[] + orders[]
// ===================================================================
function classifyAction(text) {
  const U = text.toUpperCase();
  if (U.includes('URGENT RE-INQUIRY')) return 'urgent';
  if (U.includes('ORDER WON') || U.includes('ORDER DONE')) return 'order';
  if (U.includes('BULK UPLOADED') || U.includes('OLD DATA IMPORT') || U.includes('BULK RE-ASSIGN')) return 'bulk';
  if (U.includes('MANUAL RE-ASSIGN') || U.includes('RE-ASSIGNED')) return 'reassign';
  if (U.includes('CREATED')) return 'created';
  if (U.includes('STAGE CHANGED') || U.includes('SALES STAGE') || /^\s*(📌|🚀)/.test(text)) return 'stage_change';
  if (U.includes('ASSIGN')) return 'assigned';
  return 'note';
}
function extractToStatus(text) {
  let m = text.match(/CREATED\s*\(([^)]+)\)/i) || text.match(/STAGE CHANGED to\s+(.+?)(?:\s*\||$)/i)
       || text.match(/SALES STAGE:\s*(.+?)(?:\s*\||$)/i) || text.match(/(?:📌|🚀)\s*([A-Za-z /]+?)(?:\s*\(|\s*\||$)/);
  return m ? m[1].trim().toLowerCase() : '';
}

function parseNotes(notesStr, resolveUser) {
  const acts = [];
  const orders = [];
  if (!notesStr) return { acts, orders };
  const chunks = String(notesStr).split('🕒');
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i].trim();
    if (c.length < 6) continue;
    const at = parseLogTime(c);
    const parts = c.split('|').map(s => s.trim());

    // user — id [9], name, ya "System". Purane (nikal chuke) staff ka bhi naam rakhte hain.
    let uid = '', uidLegacy = '', actorName = '';
    const idm = c.match(/👤\s*\[(\d+)\]\s*([^|]*)/);
    if (idm) {
      uidLegacy = idm[1];
      actorName = (idm[2] || '').trim();
      uid = resolveUser({ legacy: idm[1], name: actorName.toLowerCase() });
    } else {
      const nm = c.match(/👤\s*([^|]+)/);
      if (nm) {
        actorName = nm[1].trim();
        const nk = actorName.toLowerCase().replace(/\s+(ldr|sales|2nd)$/i, '').trim();
        if (nk === 'system' || nk === 'admin') { uid = 'system'; actorName = actorName || 'System'; }
        else uid = resolveUser({ name: nk });
      }
    }
    if (/^system$/i.test(actorName)) uid = 'system';

    const actionPart = parts.find(p => /📌|🚀|🚨|💰/.test(p)) || '';
    const remarkPart = parts.find(p => p.startsWith('💬'));
    // remark: 💬-prefixed part, warna aakhri part jo date/user/action/schedule nahi hai
    let remark = remarkPart ? remarkPart.replace(/^💬\s*/, '').trim() : '';
    if (!remark) {
      const tail = parts[parts.length - 1] || '';
      if (tail && !/👤|📌|🚀|🚨|📅|Scheduled|^\d{1,2}-[A-Za-z]{3}-\d{4}/.test(tail)) remark = tail;
    }
    const fullText = actionPart + ' ' + remark;

    const action = classifyAction(fullText);
    const to_status = extractToStatus(actionPart);

    // "📅 Scheduled: 15-Jun-2026 11:00 AM" -> scheduled_for (history me "kis din ke liye followup dala")
    const schM = c.match(/(?:📅\s*)?Scheduled:\s*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4}(?:\s+[0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)?)?)/i);
    const scheduled_for = schM ? parseLogTime(schM[1]) : null;
    // "Re-assigned to X" / "assigned to X" -> assigned_to_name
    const asgM = c.match(/(?:Re-?assigned to|assigned to)\s+([A-Za-z][A-Za-z .]{1,30}?)(?:\s*[|)]|$)/i);
    const assigned_to_name = asgM ? asgM[1].trim() : '';

    // order? — "ORDER DONE" / "ORDER WON" = ek order event (purane system jaisa),
    // ₹ amount ho to capture, na ho to amount 0 (event phir bhi ginti hai).
    const am = fullText.match(/(?:ORDER WON|AMOUNT)[:\s]*₹?\s*([\d,]+)/i);
    const amount = am ? parseInt(am[1].replace(/,/g, ''), 10) || 0 : 0;
    if (/ORDER\s+(WON|DONE)/i.test(fullText) && at) {
      orders.push({ order_date: at, amount, sales_uid: uid || '', sales_legacy: uidLegacy, sales_name: actorName, remark, source: 'migration' });
    }

    acts.push({
      at: at || null,
      uid: uid || '',
      uid_legacy: uidLegacy,
      actor_name: actorName,
      action,
      from_status: '',
      to_status,
      amount,
      channel: 'system',
      scheduled_for: scheduled_for || null,
      assigned_to_name: assigned_to_name || '',
      remark: remark.slice(0, 500),
    });
  }
  // fill from_status by walking forward
  let prev = '';
  for (let i = acts.length - 1; i >= 0; i--) { // acts are newest-first (Notes prepends)
    if (acts[i].action === 'stage_change') { acts[i].from_status = prev; prev = acts[i].to_status || prev; }
    else if (acts[i].to_status) prev = acts[i].to_status;
  }
  return { acts, orders };
}

// ===================================================================
// Batched writer
// ===================================================================
class Writer {
  constructor() { this.batch = db.batch(); this.n = 0; this.committed = 0; }
  async set(ref, data) {
    if (DRY) { this.committed++; return; }
    this.batch.set(ref, data, { merge: !WIPE });
    if (++this.n >= 400) await this.flush();
  }
  async flush() { if (this.n === 0) return; await this.batch.commit(); this.committed += this.n; this.batch = db.batch(); this.n = 0; }
}

async function wipeCollection(name, keepIds) {
  if (DRY) return;
  const keep = new Set(keepIds || []);
  process.stdout.write(`  wiping ${name}${keep.size ? ` (keep: ${[...keep].join(', ')})` : ''} ... `);
  let total = 0;
  while (true) {
    const snap = await db.collection(name).limit(400).get();
    if (snap.empty) break;
    const del = snap.docs.filter((d) => !keep.has(d.id));
    if (del.length) {
      const b = db.batch();
      del.forEach((d) => b.delete(d.ref));
      await b.commit();
      total += del.length;
    }
    if (snap.size < 400) break;
  }
  console.log(`${total} deleted`);
}

async function wipeAuthUsers() {
  if (DRY) return;
  process.stdout.write('  wiping auth users ... ');
  let count = 0, pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    const uids = res.users.map(u => u.uid);
    if (uids.length) { await auth.deleteUsers(uids); count += uids.length; }
    pageToken = res.pageToken;
  } while (pageToken);
  console.log(`${count} deleted`);
}

// ===================================================================
// MAIN
// ===================================================================
(async function main() {
  console.log(`\n=== Paris CRM migration — ${report.mode}${LIMIT ? ` — ${SAMPLE ? 'SAMPLE' : 'LIMIT'} ${LIMIT} leads` : ''} ===\n`);

  const usersCsv = readCsv('Users.csv');
  const formsCsv = readCsv('Dynamic_Forms.csv');
  const stagesCsv = readCsv('Stages_Config.csv');
  const settingsCsv = readCsv('Settings.csv');
  const leadsCsv = readCsv('Leads.csv');
  const archCsv = readCsv('ARCHIVED_LEADS.csv', true); // optional — abhi na ho to skip

  if (WIPE) {
    console.log('WIPE mode — clearing target...');
    await wipeAuthUsers();
    // migration data
    for (const c of ['users', 'leads', 'activity', 'orders', 'logs', 'meta', 'phone_index']) await wipeCollection(c);
    // clean launch: dev/test data + auto-rebuild-able aggregates
    for (const c of ['help_queries', 'tickets', 'notifications', 'help_kb', 'admin_tasks',
      'stats_daily', 'stats_cohort', 'reports_weekly', 'audit', 'recycle']) await wipeCollection(c);
    // config: sirf forms/stages/settings refresh hote hain. ai_secret / mail_secret / access /
    // ad_spend / settings ko HAATH NAHI — warna AI + email + RBAC + operational settings toot jaayein.
    await wipeCollection('config', ['ai_secret', 'mail_secret', 'access', 'ad_spend', 'settings']);
    console.log('');
  }

  // ---------- 1. USERS ----------
  console.log('1/4  Users -> Auth + users/');
  const byLegacy = {}, byName = {}, byFirst = {}, byUidName = {};
  const creds = [['legacy_id', 'name', 'email', 'role', 'temp_password']];
  for (let i = 1; i < usersCsv.length; i++) {
    const r = usersCsv[i];
    const legacy = col(r, 0), name = col(r, 1), email = col(r, 2).toLowerCase();
    const phone = col(r, 4), role = col(r, 5).toLowerCase() || 'ldr', status = col(r, 6).toLowerCase() || 'active';
    if (!email) { report.warnings.push(`user ${legacy} ${name}: email nahi, skip`); report.users.skipped++; continue; }
    report.users.total++;

    let uid;
    if (!DRY) {
      try {
        const u = await auth.createUser({ email, password: TEMP_PASSWORD, displayName: name || email });
        uid = u.uid; report.users.created++;
      } catch (e) {
        if (e.code === 'auth/email-already-exists') { uid = (await auth.getUserByEmail(email)).uid; report.users.skipped++; }
        else { report.warnings.push(`user ${email}: ${e.message}`); continue; }
      }
    } else { uid = 'dry_' + legacy; report.users.created++; }

    byLegacy[legacy] = uid;
    if (name) { byUidName[legacy] = name; byName[name.toLowerCase()] = uid; const f = name.toLowerCase().split(' ')[0]; byFirst[f] = byFirst[f] === undefined ? uid : null; }

    const w = new Writer();
    await w.set(db.collection('users').doc(uid), {
      legacy_id: legacy, full_name: name, email, phone, role,
      status, attendance: col(r, 9) || 'Present',
      created_at: parseFlexibleDate(col(r, 7)) || admin.firestore.FieldValue.serverTimestamp(),
      last_login: parseFlexibleDate(col(r, 8)),
      fcm_tokens: [], must_reset_password: true,
    });
    await w.flush();
    creds.push([legacy, name, email, role, TEMP_PASSWORD]);
  }
  if (!DRY) fs.writeFileSync(path.join(__dirname, 'user-credentials.csv'), creds.map(r => r.join(',')).join('\n'));

  const resolveUser = ({ legacy, name }) => {
    if (legacy && byLegacy[legacy]) return byLegacy[legacy];
    if (name && byName[name]) return byName[name];
    if (name && byFirst[name.split(' ')[0]]) return byFirst[name.split(' ')[0]];
    return '';
  };

  // legacy user-id -> display name (Notes se) — nikal chuke staff ke naam yahin se aate hain
  const legacyName = { ...byUidName };
  for (const csv of [leadsCsv, archCsv]) {
    for (let i = 1; i < csv.length; i++) {
      const notes = csv[i] && csv[i][15];
      if (!notes) continue;
      for (const ch of String(notes).split('🕒')) {
        const m = ch.match(/👤\s*\[(\d+)\]\s*([^|\n]+)/);
        if (m && m[2].trim() && !legacyName[m[1]]) legacyName[m[1]] = m[2].trim().replace(/\s+/g, ' ');
      }
    }
  }
  const nameForLegacy = lg => (lg && legacyName[lg]) ? legacyName[lg] : '';

  // ---------- 2. CONFIG ----------
  console.log('2/4  Config -> config/');
  {
    const w = new Writer();
    const forms = [];
    for (let i = 1; i < formsCsv.length; i++) {
      const r = formsCsv[i];
      forms.push({ id: col(r, 0), role_view: col(r, 1), label: col(r, 2), type: col(r, 3),
        is_mandatory: col(r, 4), options: col(r, 5), status: col(r, 6), role_edit: col(r, 7) || 'both' });
    }
    const stages = [];
    for (let i = 1; i < stagesCsv.length; i++) {
      const r = stagesCsv[i];
      stages.push({ id: col(r, 0), role: col(r, 1), name: col(r, 2), requires_date: col(r, 3), color: col(r, 4) });
    }
    // stages: naye Stage Builder ko `shows_form` chahiye — purane config me nahi tha.
    // "qualified" naam wale stage pe form ON, baaki OFF (admin baad me Stage Builder se badal sakta hai).
    stages.forEach((s) => { if (!s.shows_form) s.shows_form = /qualified/i.test(s.name) ? 'Yes' : 'No'; });

    const settings = {};
    for (let i = 1; i < settingsCsv.length; i++) settings[col(settingsCsv[i], 0)] = col(settingsCsv[i], 1);
    await w.set(db.collection('config').doc('forms'), { fields: forms });
    await w.set(db.collection('config').doc('stages'), { stages });
    await w.flush();
    // config/settings: OVERWRITE nahi — MERGE. Naye system ke operational keys (ai_ready,
    // Report_Email, mail_password_set, Morning_Brief, SLA_*, brand/theme, ad-spend standing…)
    // bache rahein; purane business settings (sources, states, company name, work hours…) layer ho jaayein.
    if (!DRY && Object.keys(settings).length) {
      await db.collection('config').doc('settings').set(settings, { merge: true });
    }
    report.config = { forms: forms.length, stages: stages.length, settings: Object.keys(settings).length };
  }

  // ---------- 3. LEADS + ARCHIVED ----------
  console.log('3/4  Leads + ARCHIVED_LEADS -> leads/ + activity/ + orders/ + phone_index/');
  const leadW = new Writer(), actW = new Writer(), orderW = new Writer(), pidxW = new Writer();
  const seenPhone = {};
  const seenLeadId = new Set();   // duplicate lead-ID guard
  let maxLeadId = 0, dupIdSkipped = 0, reIded = 0;

  // Purane system ki race-condition se ~100 jagah do alag leads ko same ID mil gaya.
  // Doosri row ko DROP nahi karte — use max-se-aage ki fresh numeric ID de dete hain
  // (dono asli leads + unki history rahein). Pehle poore data ka max ID nikaalo.
  let freshIdSeq = 0;
  for (const rs of [leadsCsv, archCsv]) {
    for (let i = 1; i < rs.length; i++) {
      const n = parseInt(col(rs[i], 0), 10);
      if (n > freshIdSeq) freshIdSeq = n;
    }
  }

  async function migrateLeadRows(rows, archived) {
    // --sample: poore data mein se ~LIMIT rows barabar faasle par (junk/dup bhi test ho)
    const stride = (SAMPLE && LIMIT && rows.length > LIMIT) ? Math.floor((rows.length - 1) / LIMIT) : 1;
    for (let i = 1; i < rows.length; i += stride) {
      if (LIMIT && report.leads.total >= LIMIT) break; // test run cap
      const r = rows[i];
      let id = col(r, 0);
      if (!id) continue;
      if (seenLeadId.has(id)) {
        const newId = String(++freshIdSeq);
        report.warnings.push(`lead ${id}: duplicate ID — nayi ID ${newId} di (dono leads + history rakhi)`);
        id = newId;
        reIded++;
      }
      seenLeadId.add(id);
      report.leads.total++;
      archived ? report.leads.archived++ : report.leads.active++;
      const n = parseInt(id, 10); if (n > maxLeadId) maxLeadId = n;

      const rawName = col(r, 2);
      const junk = isJunkName(rawName);
      if (junk) report.leads.needs_review++;

      const ph = normalizePhone(col(r, 3));
      if (!ph.valid && col(r, 3)) report.leads.phone_invalid++;

      let dupOf = null;
      if (ph.digits) {
        if (seenPhone[ph.digits]) { dupOf = seenPhone[ph.digits]; report.leads.duplicates++; }
        else seenPhone[ph.digits] = id;
      }

      let formAnswers = {};
      try { formAnswers = col(r, 14) ? JSON.parse(col(r, 14)) : {}; } catch (e) { formAnswers = {}; }

      const status = col(r, 9).toLowerCase();
      const salesStatus = col(r, 17).toLowerCase();
      const ldrUid = resolveUser({ legacy: col(r, 10) });
      const salesUid = resolveUser({ legacy: col(r, 11) });

      const notes = col(r, 15);
      const { acts, orders } = parseNotes(notes, resolveUser);
      const cleanName = junk ? '' : rawName.replace(/\s+/g, ' ').trim();

      // activity docs
      for (const a of acts) {
        if (!a.at) continue;
        report.activity.total++;
        await actW.set(db.collection('activity').doc(), {
          ...a, lead_id: id, lead_name: cleanName, at: admin.firestore.Timestamp.fromDate(a.at),
          scheduled_for: a.scheduled_for ? admin.firestore.Timestamp.fromDate(a.scheduled_for) : null,
        });
      }
      // order docs + summary
      let orderCount = 0, totalRev = 0, firstOrder = null, lastOrder = null;
      for (const o of orders) {
        report.orders.total++; report.orders.revenue += o.amount;
        orderCount++; totalRev += o.amount;
        if (!firstOrder || o.order_date < firstOrder) firstOrder = o.order_date;
        if (!lastOrder || o.order_date > lastOrder) lastOrder = o.order_date;
        await orderW.set(db.collection('orders').doc(), {
          ...o, lead_id: id, lead_name: cleanName, order_date: admin.firestore.Timestamp.fromDate(o.order_date),
        });
      }

      // milestones from acts (acts newest-first)
      const sorted = acts.filter(a => a.at).slice().sort((x, y) => x.at - y.at);
      const find = pred => { const a = sorted.find(pred); return a ? admin.firestore.Timestamp.fromDate(a.at) : null; };
      const qualified_at = find(a => (a.to_status || '').includes('qualified') || (a.action === 'created' && (a.to_status || '').includes('qualified')));
      // re-inquiry kab hui — dashboard "Re-Inquiry" section date-range isi field pe filter karta hai
      const urgent_at = (() => {
        const u = sorted.filter(a => a.action === 'urgent' || /urgent re-?inquiry/i.test(a.to_status || ''));
        return u.length ? admin.firestore.Timestamp.fromDate(u[u.length - 1].at) : null;
      })();
      const assigned_sales_at = find(a => a.action === 'assigned' || /sales stage|order|followup|visit/i.test(a.to_status));
      const isLost = ['dead', 'lost'].includes(status) || ['dead', 'lost'].includes(salesStatus) || status.includes('lost');
      const closed_at = isLost ? find(a => /dead|lost/i.test(a.to_status)) : null;
      const lastActionAt = sorted.length ? admin.firestore.Timestamp.fromDate(sorted[sorted.length - 1].at) : null;
      const outcome = isLost ? 'lost' : (orderCount > 0 ? 'customer' : '');

      const lead = {
        created_at: parseFlexibleDate(col(r, 1)),
        created_by: acts.length ? (acts[acts.length - 1].uid || 'import') : 'import',
        created_by_name: acts.length ? (acts[acts.length - 1].actor_name || '') : '',
        name: cleanName,
        name_lower: cleanName.toLowerCase(),
        phone: ph.valid ? ph.formatted : '',
        phone_raw: ph.valid ? '' : col(r, 3),
        phone_digits: ph.digits,
        phone_digits_rev: String(ph.digits || '').split('').reverse().join(''),
        phone_invalid: !ph.valid && !!col(r, 3),
        alt_phone: col(r, 4), email: col(r, 5).toLowerCase(), company: col(r, 6),
        company_lower: col(r, 6).toLowerCase(),
        city: col(r, 7), state: col(r, 8), source: col(r, 16) || 'Unknown',
        ldr_uid: ldrUid || null, sales_uid: salesUid || null,
        ldr_legacy: col(r, 10), sales_legacy: col(r, 11),
        ldr_name: byUidName[col(r, 10)] || nameForLegacy(col(r, 10)),
        sales_name: byUidName[col(r, 11)] || nameForLegacy(col(r, 11)),
        status, sales_status: salesStatus,
        attempts: parseInt(col(r, 12), 10) || 0,
        next_followup: parseFlexibleDate(col(r, 13)),
        last_action_at: lastActionAt || parseFlexibleDate(col(r, 18)),
        last_action_by: sorted.length ? sorted[sorted.length - 1].uid : '',
        last_action_by_name: sorted.length ? (sorted[sorted.length - 1].actor_name || '') : '',
        qualified_at, assigned_sales_at, closed_at, outcome,
        order_count: orderCount, total_revenue: totalRev,
        first_order_at: firstOrder ? admin.firestore.Timestamp.fromDate(firstOrder) : null,
        last_order_at: lastOrder ? admin.firestore.Timestamp.fromDate(lastOrder) : null,
        form_answers: formAnswers,
        notes: notes.split('\n\n').slice(0, 10).join('\n\n'),
        archived: !!archived,
        archived_at: archived ? parseFlexibleDate(col(r, 18)) : null,
        is_urgent: /🚨 URGENT RE-INQUIRY/.test(notes),
        urgent_at,
        needs_review: junk,
        dup_of: dupOf,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      for (const [k, label] of Object.entries(FORM_FIELD_MAP)) lead[k] = String(formAnswers[label] || '').trim();

      await leadW.set(db.collection('leads').doc(id), lead);

      // phone_index/{digits} — new-lead dedup isi collection se hota hai. Sirf phone ki
      // PEHLI lead ke liye (dup ho to canonical wahi). Archived lead skip.
      if (ph.digits && !dupOf && !archived) {
        await pidxW.set(db.collection('phone_index').doc(ph.digits), {
          lead_id: id, name: cleanName, phone: ph.valid ? ph.formatted : col(r, 3),
          owner_name: lead.sales_name || lead.ldr_name || '',
          stage: lead.sales_status || lead.status || '',
          source: lead.source || '', updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
  }

  await migrateLeadRows(leadsCsv, false);
  await migrateLeadRows(archCsv, true);
  await Promise.all([leadW.flush(), actW.flush(), orderW.flush(), pidxW.flush()]);
  report.phone_index = pidxW.committed;

  // ---------- 4. META ----------
  console.log('4/4  meta/counters');
  {
    const w = new Writer();
    await w.set(db.collection('meta').doc('counters'), { leads: maxLeadId, orders: report.orders.total, activity: report.activity.total });
    await w.flush();
  }

  // ---------- report ----------
  report.leads.dup_id_reided = reIded;
  report.finished = new Date().toISOString();
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR);
  const rp = path.join(REPORTS_DIR, `migration-report-${Date.now()}.json`);
  fs.writeFileSync(rp, JSON.stringify(report, null, 2));

  console.log('\n================ REPORT ================');
  console.log(`mode           : ${report.mode}`);
  console.log(`users          : ${report.users.total}  (created ${report.users.created}, skipped ${report.users.skipped})`);
  console.log(`leads          : ${report.leads.total}  (active ${report.leads.active}, archived ${report.leads.archived})`);
  console.log(`  needs_review : ${report.leads.needs_review}   (junk naam)`);
  console.log(`  phone_invalid: ${report.leads.phone_invalid}`);
  console.log(`  dup phone    : ${report.leads.duplicates}   (dono rakhi, dup_of flag)`);
  console.log(`  dup ID re-ID'd: ${reIded}   (nayi numeric ID, dono leads + history rakhi)`);
  if (dupIdSkipped) console.log(`  dup ID skipped: ${dupIdSkipped}`);
  console.log(`activity       : ${report.activity.total}`);
  console.log(`phone_index    : ${report.phone_index || 0}   (new-lead dedup)`);
  console.log(`orders         : ${report.orders.total}   revenue ₹${report.orders.revenue.toLocaleString('en-IN')}`);
  console.log(`warnings       : ${report.warnings.length}`);
  console.log(`next lead id   : ${maxLeadId + 1}`);
  console.log(`\nfull report    : ${rp}`);
  if (!DRY) console.log(`credentials    : ${path.join(__dirname, 'user-credentials.csv')}`);
  console.log('=======================================\n');
  if (report.warnings.length) console.log('⚠️  warnings:\n' + report.warnings.slice(0, 20).map(w => '   - ' + w).join('\n') + '\n');

  process.exit(0);
})().catch(e => { console.error('\n💥 FATAL:', e); process.exit(1); });
