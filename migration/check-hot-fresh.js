const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
async function run() {
  const hot = await col.where('tier', '==', 'hot').count().get();
  const fresh = await col.where('status', 'in', ['fresh', 'new']).count().get();
  console.log('hot:', hot.data().count, 'fresh:', fresh.data().count);
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
