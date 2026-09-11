/************************************************************************
 * Paris CRM — OLD SYSTEM (GROW) → migration export
 *
 * Ye script PURANE Google Apps Script CRM ke andar chalti hai. Sheet ko
 * SIRF PADHTI hai — kuch badalti nahi.
 *
 * KAISE CHALAYEIN:
 *   1. Purana sheet kholo (jispe GROW app chal raha hai).
 *   2. Extensions → Apps Script.
 *   3. Ek naya file banao (📄 +) naam "MIGRATION_EXPORT", ye poora code paste karo.
 *   4. Save. Function dropdown se `exportForMigration` chuno → Run.
 *   5. Pehli baar "Authorization required" → Allow (apne hi account se).
 *   6. Execution log (niche) me ek DOWNLOAD LINK aur summary aayega.
 *      Wo JSON file download karke Claude ko do (ya migration/csv-exports/ me daalo).
 *
 * OUTPUT: Google Drive me `paris-crm-migration-export-<timestamp>.json`
 *   { users, leads, forms, stages, settings, ghost_users, dupe_lead_ids, summary }
 *
 * Kya karta hai (owner kabhi na khoye, isliye):
 *   - Har sheet raw export (header + rows) — koi transform nahi.
 *   - Jo LDR/Sales owner-id kisi lead pe hai par Users sheet me nahi (purana staff),
 *     uska naam lead ke Notes se nikaal ke ek "ghost user" (inactive) bana deta hai —
 *     taaki us bande ki leads migration me bhi usi ke naam rahein.
 *   - Duplicate lead-ID rows detect karke list karta hai (migration pehli row rakhegi).
 ************************************************************************/

var SHEET_NAMES = {
  users: 'Users',
  leads: 'Leads',
  forms: 'Dynamic_Forms',
  stages: 'Stages_Config',
  settings: 'Settings',
};

function exportForMigration() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function readSheet(name, required) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      if (required) throw new Error('Sheet "' + name + '" nahi mila.');
      Logger.log('  (skip) sheet "' + name + '" nahi mila');
      return [];
    }
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 1) return [];
    var vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
    // har cell -> safe string (Date -> ISO)
    return vals.map(function (row) {
      return row.map(function (c) {
        if (c instanceof Date) return c.toISOString();
        return (c === null || c === undefined) ? '' : String(c);
      });
    });
  }

  Logger.log('reading sheets…');
  var users = readSheet(SHEET_NAMES.users, true);
  var leads = readSheet(SHEET_NAMES.leads, true);
  var forms = readSheet(SHEET_NAMES.forms, false);
  var stages = readSheet(SHEET_NAMES.stages, false);
  var settings = readSheet(SHEET_NAMES.settings, false);

  // ---- Users sheet: ID -> {name, role} ----
  var userById = {};        // id -> [role, name]
  for (var i = 1; i < users.length; i++) {
    var u = users[i];
    if (!u[0]) continue;
    userById[String(u[0]).trim()] = { role: String(u[5] || '').toLowerCase(), name: String(u[1] || '').trim() };
  }

  // ---- Leads: owner ids + dup ids + names-from-notes ----
  // Leads col: 0=ID 1=Date 2=Name 3=Phone 4=Alt 5=Email 6=Company 7=City 8=State
  //   9=Status 10=LDR_User 11=Sales_User 12=Attempts 13=Next_Followup
  //   14=Form_Answers 15=Notes 16=Source 17=Sales_Status 18=Last_Updated
  var seenId = {};
  var dupeIds = [];
  var ldrIds = {};      // owner id -> count seen in LDR col
  var salesIds = {};    // owner id -> count seen in Sales col
  var nameFromNotes = {}; // owner id -> name (from "👤[8] Rajesh Yadav" in Notes)

  var noteIdRe = /👤\s*\[(\d+)\]\s*([^|\n]+)/g;

  for (var r = 1; r < leads.length; r++) {
    var row = leads[r];
    var id = String(row[0] || '').trim();
    if (id) {
      if (seenId[id]) dupeIds.push(id);
      else seenId[id] = true;
    }
    var ldr = String(row[10] || '').trim();
    var sal = String(row[11] || '').trim();
    if (ldr) ldrIds[ldr] = (ldrIds[ldr] || 0) + 1;
    if (sal) salesIds[sal] = (salesIds[sal] || 0) + 1;

    var notes = String(row[15] || '');
    var m;
    noteIdRe.lastIndex = 0;
    while ((m = noteIdRe.exec(notes)) !== null) {
      var nid = m[1], nm = (m[2] || '').trim().replace(/\s+/g, ' ');
      if (nm && !nameFromNotes[nid]) nameFromNotes[nid] = nm;
    }
  }

  // ---- Ghost users: owner id jo Users sheet me nahi ----
  var ghost = [];
  var allOwnerIds = {};
  Object.keys(ldrIds).forEach(function (k) { allOwnerIds[k] = true; });
  Object.keys(salesIds).forEach(function (k) { allOwnerIds[k] = true; });

  Object.keys(allOwnerIds).forEach(function (oid) {
    if (userById[oid]) return;                 // already a real user
    if (oid === '' || oid === '0' || oid.toLowerCase() === 'system') return;
    var inLdr = ldrIds[oid] || 0, inSales = salesIds[oid] || 0;
    var role = inSales > inLdr ? 'sales' : 'ldr';
    var name = nameFromNotes[oid] || ('Ex-Employee ' + oid);
    // Users sheet ke same 10 columns: ID, Full_Name, Email, Password, Phone, Role, Status, Created_At, Last Login, Attendance
    ghost.push([
      oid, name, 'ghost-' + oid + '@paris-migrated.local', '', '',
      role, 'inactive', '', '', 'Present',
    ]);
  });

  // ---- assemble ----
  var out = {
    exported_at: new Date().toISOString(),
    source: 'GROW Apps Script CRM',
    users: users,
    leads: leads,
    forms: forms,
    stages: stages,
    settings: settings,
    ghost_users: ghost,           // ye Users list ke aage jodni hain (migrate.js khud karega)
    dupe_lead_ids: dedupe(dupeIds),
    summary: {
      users: Math.max(0, users.length - 1),
      leads: Math.max(0, leads.length - 1),
      forms: Math.max(0, forms.length - 1),
      stages: Math.max(0, stages.length - 1),
      settings: Math.max(0, settings.length - 1),
      ghost_users: ghost.length,
      dupe_lead_ids: dedupe(dupeIds).length,
    },
  };

  // ---- write to Drive ----
  var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  var fname = 'paris-crm-migration-export-' + stamp + '.json';
  var json = JSON.stringify(out);
  var file = DriveApp.createFile(fname, json, 'application/json');
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  Logger.log('==================================================');
  Logger.log('EXPORT DONE  (' + Math.round(json.length / 1024 / 1024 * 10) / 10 + ' MB)');
  Logger.log('  users          : ' + out.summary.users);
  Logger.log('  leads          : ' + out.summary.leads);
  Logger.log('  forms          : ' + out.summary.forms);
  Logger.log('  stages         : ' + out.summary.stages);
  Logger.log('  settings       : ' + out.summary.settings);
  Logger.log('  ghost users    : ' + out.summary.ghost_users + '  (ex-staff whose leads keep their name)');
  if (ghost.length) Logger.log('    -> ' + ghost.map(function (g) { return g[0] + '=' + g[1] + ' (' + g[5] + ')'; }).join(', '));
  Logger.log('  duplicate IDs  : ' + out.summary.dupe_lead_ids);
  Logger.log('--------------------------------------------------');
  Logger.log('DOWNLOAD: ' + file.getDownloadUrl());
  Logger.log('  (ya Drive me file: ' + file.getUrl() + ' )');
  Logger.log('==================================================');
  Logger.log('Ye JSON file download karke migration/csv-exports/ folder me "export.json" naam se rakho.');

  return file.getDownloadUrl();

  function dedupe(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
}
