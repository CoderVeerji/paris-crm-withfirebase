const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const istDay = (ms=Date.now()) => new Date(ms + 5.5*3600*1000).toISOString().slice(0,10);
async function run(){
  await db.doc('admin_tasks/backfill').set({
    from: istDay(Date.now()-29*86400000), to: istDay(), status:'pending', progress:null, result:null, error:null,
    requested_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  for (let i=0;i<60;i++){
    await new Promise(r=>setTimeout(r,3000));
    const d = (await db.doc('admin_tasks/backfill').get()).data();
    if (d.status==='done'){ console.log('DONE:', JSON.stringify(d.result)); return; }
    if (d.status==='error'){ console.log('ERROR:', d.error); return; }
  }
  console.log('timeout');
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
