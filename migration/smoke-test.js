// Deployed app ke startup reads simulate — kya rules/config theek hain?
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
async function run(){
  const docs = ['config/stages','config/forms','config/settings','config/access','config/ad_spend'];
  for (const d of docs) {
    const s = await db.doc(d).get();
    console.log(d.padEnd(20), s.exists ? 'EXISTS' : 'missing (ok — getDoc returns empty)');
  }
  const u = await db.collection('users').limit(1).get();
  console.log('users collection    ', u.size, 'docs readable');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
