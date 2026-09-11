const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const istDay = (ms=Date.now()) => new Date(ms + 5.5*3600*1000).toISOString().slice(0,10);
async function run(){
  const from = istDay(Date.now() - 13*86400000); // pichhle 14 din
  const to = istDay();
  await db.doc('admin_tasks/backfill').set({
    from, to, status:'pending', progress:null, result:null, error:null,
    requested_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('backfill trigger kiya:', from, '->', to, '... wait karo');
  for (let i=0;i<40;i++){
    await new Promise(r=>setTimeout(r,3000));
    const d = (await db.doc('admin_tasks/backfill').get()).data();
    if (d.status==='done'){ console.log('DONE:', JSON.stringify(d.result)); return; }
    if (d.status==='error'){ console.log('ERROR:', d.error); return; }
    if (d.progress) process.stdout.write(`\r  progress: ${JSON.stringify(d.progress)}   `);
  }
  console.log('\ntimeout — baad mein check karo');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
