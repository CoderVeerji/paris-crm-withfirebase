const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();

async function run() {
  await db.collection('leads').where('ldr_uid', '==', 'x').where('is_urgent', '==', true).limit(1).get();
  await db.collection('leads').where('sales_uid', '==', 'x').where('is_urgent', '==', true).limit(1).get();
  await db.collection('leads').where('attempts', '==', 0).where('next_followup', '<', new Date()).limit(1).get();
  await db.collection('leads').where('source', '==', 'x').where('status', '==', 'qualified').limit(1).get();
  console.log('ALL_INDEXES_READY');
}
run().then(() => process.exit(0)).catch((e) => { console.error('NOT_READY:', e.message); process.exit(1); });
