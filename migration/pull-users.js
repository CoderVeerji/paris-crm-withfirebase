const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
async function run() {
  const snap = await db.collection('users').get();
  snap.forEach((d) => { const u = d.data(); if (u.role !== 'admin') console.log(u.role, '-', u.full_name, '-', u.status || 'active'); });
}
run().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
