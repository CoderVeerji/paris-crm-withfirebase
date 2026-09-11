/**
 * One-time cleanup: phone_index docs jinka lead_id ab exist hi nahi karta
 * (purane softDeleteLead se pehle, jab phone_index clean nahi hota tha) — unhe delete karo,
 * taaki wo number dobara naya lead banane ke liye free ho jaaye.
 *
 *   node clean-stale-phone-index.js        -> delete karta hai
 *   node clean-stale-phone-index.js --dry  -> sirf list, delete nahi
 */
'use strict';
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DRY = process.argv.includes('--dry');
const PROJECT_ID = 'paris-crm';
const KEY_PATH = path.join(__dirname, 'serviceAccountKey.json');

if (fs.existsSync(KEY_PATH)) {
  admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)), projectId: PROJECT_ID });
} else {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}
const db = admin.firestore();

async function run() {
  const idxSnap = await db.collection('phone_index').get();
  console.log(`total phone_index docs: ${idxSnap.size}`);
  let stale = 0, batch = db.batch(), inBatch = 0;

  for (const doc of idxSnap.docs) {
    const leadId = doc.data().lead_id;
    if (!leadId) continue;
    // eslint-disable-next-line no-await-in-loop
    const leadSnap = await db.collection('leads').doc(leadId).get();
    if (leadSnap.exists) continue; // theek hai, lead abhi bhi hai
    stale++;
    console.log(' stale:', doc.id, '->', leadId, '(', doc.data().name, ')');
    if (!DRY) {
      batch.delete(doc.ref);
      inBatch++;
      if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
  }
  if (!DRY && inBatch > 0) await batch.commit();
  console.log(`stale entries: ${stale}${DRY ? ' (dry run — nothing deleted)' : ' — deleted'}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
