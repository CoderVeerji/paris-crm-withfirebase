const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
async function run() {
  for (const d of ['2026-09-04','2026-09-05','2026-09-06']) {
    const s = await db.doc(`stats_daily/${d}`).get();
    if (!s.exists) { console.log(d, '-> MISSING'); continue; }
    const x = s.data();
    console.log(d, '-> totals:', JSON.stringify(x.totals), '| users:', Object.keys(x.by_user||{}).length);
  }
  const c = await db.doc('stats_cohort/2026-09').get();
  console.log('stats_cohort/2026-09 ->', c.exists ? JSON.stringify(c.data().totals) : 'MISSING');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
