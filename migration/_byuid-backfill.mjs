// One-time: purane stats_daily/{din}.dash se har user ka apna doc banata hai -> stats_daily/{din}/by_uid/{uid}
// (LDR/Sales ke personal dashboard ke purane din isse padhte hain). Recompute nahi karta — sirf COPY: reads = stats_daily docs ki ginti,
// writes = (din x users). Default DRY-RUN (kuch likhta nahi). Likhne ke liye:  node _byuid-backfill.mjs --apply
// Safe to re-run (set() usi doc ko dobara likhta hai). Aaj ka din skip.
import admin from 'firebase-admin';
const APPLY = process.argv.includes('--apply');
admin.initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'demo-paris-crm' : 'paris-crm', ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: admin.credential.applicationDefault() }) });
const db = admin.firestore();
const IST = 330 * 60000; const today = new Date(Date.now() + IST).toISOString().slice(0, 10);

const snap = await db.collection('stats_daily').get();
let days = 0; let writes = 0; let skipped = 0; let bytes = 0;
const bw = db.bulkWriter();
for (const d of snap.docs) {
  if (d.id >= today) { skipped += 1; continue; }
  const dash = d.data().dash; if (!dash) { skipped += 1; continue; }
  days += 1;
  for (const [uid, v] of Object.entries(dash)) {
    if (uid.startsWith('_')) continue;
    writes += 1; bytes += JSON.stringify(v).length;
    if (APPLY) bw.set(db.doc(`stats_daily/${d.id}/by_uid/${uid}`), { uid, date: d.id, dash: v, computed_at: admin.firestore.FieldValue.serverTimestamp() });
  }
}
if (APPLY) await bw.close();
console.log(`${APPLY ? 'WRITTEN' : 'DRY-RUN (kuch nahi likha)'} | stats_daily docs padhe: ${snap.size} | din: ${days} (skip ${skipped}) | by_uid docs: ${writes} | ~${Math.round(bytes / 1024)} KB`);
if (!APPLY) console.log('Likhne ke liye: node _byuid-backfill.mjs --apply');
process.exit(0);
