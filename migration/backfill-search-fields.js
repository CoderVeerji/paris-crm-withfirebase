/**
 * One-time backfill: leads.name_lower / leads.company_lower / leads.phone_digits_rev
 * (search fields — prefix + "ends with" via reversed digits). Naye leads ye khud set
 * karte hain (lib/leads.js / lib/admin.js) — ye script sirf PURANI (is script se pehle
 * bani) leads ke liye hai.
 *
 *   node backfill-search-fields.js         -> likhta hai
 *   node backfill-search-fields.js --dry   -> sirf count, likhता nahi
 */
'use strict';
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DRY = process.argv.includes('--dry');
const PROJECT_ID = 'paris-crm';
const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(KEY_PATH)) {
  console.log('auth: serviceAccountKey.json');
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)), projectId: PROJECT_ID });
} else {
  console.log('auth: Application Default Credentials (gcloud login)');
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
  } catch (e) {
    console.error('\nAuth nahi mila. Ek baar chalao:\n  gcloud auth application-default login\n');
    process.exit(1);
  }
}
const db = admin.firestore();

async function run() {
  const snap = await db.collection('leads').get();
  console.log(`total leads: ${snap.size}`);
  let toUpdate = 0, batch = db.batch(), inBatch = 0, batches = 0;

  const revDigits = (s) => String(s || '').split('').reverse().join('');

  for (const doc of snap.docs) {
    const d = doc.data();
    const wantName = String(d.name || '').toLowerCase();
    const wantCompany = String(d.company || '').toLowerCase();
    const wantRev = revDigits(d.phone_digits);
    if (d.name_lower === wantName && d.company_lower === wantCompany && d.phone_digits_rev === wantRev) continue; // already sahi
    toUpdate++;
    if (!DRY) {
      batch.update(doc.ref, { name_lower: wantName, company_lower: wantCompany, phone_digits_rev: wantRev });
      inBatch++;
      if (inBatch >= 400) {
        batches++;
        // eslint-disable-next-line no-await-in-loop
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
  }
  if (!DRY && inBatch > 0) { batches++; await batch.commit(); }

  console.log(`needs update: ${toUpdate}${DRY ? ' (dry run — nothing written)' : ` — written in ${batches} batch(es)`}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
