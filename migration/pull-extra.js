const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
async function run() {
  for (const s of ['hot lead', 'visit customer', 'video call']) {
    const c = await col.where('sales_status', '==', s).count().get();
    console.log(s, '=', c.data().count);
  }
}
run().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
