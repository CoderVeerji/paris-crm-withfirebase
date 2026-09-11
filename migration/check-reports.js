const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
async function run(){
  for (const d of ['2026-09-03','2026-09-04','2026-09-05','2026-09-06']) {
    const s = await db.doc(`stats_daily/${d}`).get();
    if(!s.exists){console.log(d,'MISSING');continue;}
    const r = s.data().reports;
    if(!r){console.log(d,'-> reports field NAHI hai');continue;}
    console.log(`${d}  fresh: ${r.fresh.total} (worked ${r.fresh.worked}) ${JSON.stringify(r.fresh.by_status)}`);
    console.log(`            reinquiry: ${r.reinquiry.total} (worked ${r.reinquiry.worked}, pending ${r.reinquiry.pending})`);
    console.log(`            followups: due ${r.followups.due}, done ${r.followups.done}, pending ${r.followups.pending}${r.followups.exact===false?'  [purana data adhoora]':''}`);
  }
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
