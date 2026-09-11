const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
async function run(){
  for (const d of ['2026-09-04','2026-09-05','2026-09-06']) {
    const s = await db.doc(`stats_daily/${d}`).get();
    if(!s.exists){console.log(d,'MISSING');continue;}
    const x = s.data();
    const show = (label, r) => r ? `${label}: fresh ${r.fresh.total}/${r.fresh.worked}w ${JSON.stringify(r.fresh.by_status)} | reinq ${r.reinquiry.total}(${r.reinquiry.worked}w/${r.reinquiry.pending}p) | followups ${r.followups.due}due ${r.followups.done}done ${r.followups.pending}pend` : `${label}: —`;
    console.log(`\n${d}`);
    console.log('  ', show('ALL  ', x.reports));
    console.log('  ', show('LDR  ', x.reports_by_team?.ldr));
    console.log('  ', show('SALES', x.reports_by_team?.sales));
  }
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
