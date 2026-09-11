/* Go-live: SLA auto-notification rules 2 din OFF (purani in-flight leads pe spam na ho).
 *   node _sla-toggle.js off   -> saare SLA_* rules 0 (band). Purani values _sla-backup.json me.
 *   node _sla-toggle.js on    -> backup se wapas restore (ya default values).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();

const KEYS = ['SLA_FirstContact', 'SLA_FreshTouch', 'SLA_SalesTouch', 'SLA_FollowupOverdue', 'SLA_QualifiedUnassigned'];
const DEFAULTS = { SLA_FirstContact: '5m', SLA_FreshTouch: '30m', SLA_SalesTouch: '10m', SLA_FollowupOverdue: '2d', SLA_QualifiedUnassigned: '10m' };
const BACKUP = path.join(__dirname, '_sla-backup.json');
const mode = process.argv[2];

(async () => {
  const ref = db.doc('config/settings');
  const cur = (await ref.get()).data() || {};

  if (mode === 'off') {
    const backup = {};
    KEYS.forEach((k) => { backup[k] = cur[k] ?? null; });
    fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2));
    const patch = {}; KEYS.forEach((k) => { patch[k] = '0'; });
    await ref.set(patch, { merge: true });
    console.log('SLA rules OFF. backup:', JSON.stringify(backup));
  } else if (mode === 'on') {
    let backup = {};
    try { backup = JSON.parse(fs.readFileSync(BACKUP, 'utf8')); } catch { /* no backup */ }
    const patch = {};
    KEYS.forEach((k) => { patch[k] = (backup[k] && backup[k] !== '0') ? backup[k] : DEFAULTS[k]; });
    await ref.set(patch, { merge: true });
    console.log('SLA rules restored:', JSON.stringify(patch));
  } else {
    console.log('usage: node _sla-toggle.js off | on');
    console.log('current:', JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, cur[k]]))));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
