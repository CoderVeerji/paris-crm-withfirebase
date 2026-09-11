const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
async function run(){
  const merged = {};
  for (const d of ['2026-08-08','2026-08-15','2026-09-01','2026-09-05']) {
    const s = await db.doc(`stats_daily/${d}`).get();
    if(!s.exists) continue;
    const bs = s.data().reports?.fresh?.by_source || {};
    console.log(d, JSON.stringify(bs));
  }
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
