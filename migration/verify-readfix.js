const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();

function dayStart(d){const x=new Date(d);x.setHours(0,0,0,0);return x;}
async function run() {
  const today0 = dayStart(new Date());
  const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);

  // NAYA query shape — jo teamWorkloadReport ab use karta hai
  const snap = await db.collection('activity')
    .where('at','>=',today0).where('at','<=',todayEnd)
    .orderBy('at','desc').limit(800).get();
  console.log('NEW single range-query works. Aaj ki activity docs:', snap.size, '=> utni hi reads');

  // Purana tarika kitna karta tha
  const users = await db.collection('users').get();
  const sales = users.docs.filter(d=>d.data().role==='sales' && (d.data().status||'active')==='active').length;
  const ldr = users.docs.filter(d=>d.data().role==='ldr' && (d.data().status||'active')==='active').length;
  console.log('PURANA tarika: Sales', sales*(2+80), 'reads | LDR', ldr*(2+80), 'reads');
  console.log('NAYA  tarika: Sales', sales*2 + snap.size, 'reads | LDR', ldr*2 + snap.size, 'reads');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:', e.message);process.exit(1);});
