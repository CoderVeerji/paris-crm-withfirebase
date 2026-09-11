const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
async function run() {
  const snap = await col.where('is_urgent', '==', true).get();
  let ldrTotal=0, ldrWorked=0, salesTotal=0, salesWorked=0;
  snap.forEach((d)=>{
    const l = d.data();
    const stL = String(l.status||'').toLowerCase();
    const stS = String(l.sales_status||'').toLowerCase();
    if (l.sales_uid) {
      salesTotal++;
      if (stS && !['fresh','new',''].includes(stS)) salesWorked++;
    } else if (l.ldr_uid) {
      ldrTotal++;
      if (!['fresh','new'].includes(stL)) ldrWorked++;
    }
  });
  console.log('LDR urgent: total=', ldrTotal, 'worked=', ldrWorked, 'pending=', ldrTotal-ldrWorked);
  console.log('SALES urgent: total=', salesTotal, 'worked=', salesWorked, 'pending=', salesTotal-salesWorked);
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
