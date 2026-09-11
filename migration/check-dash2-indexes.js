const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');

async function run() {
  await col.where('ldr_uid', '==', 'x').where('status', '==', 'fresh').limit(1).get();
  await col.where('sales_uid', '==', 'x').where('sales_status', '==', 'followup').limit(1).get();
  await col.where('ldr_uid', '==', 'x').where('last_action_at', '>=', new Date(0)).limit(1).get();
  await col.where('sales_uid', '==', 'x').where('last_action_at', '>=', new Date(0)).limit(1).get();
  console.log('DASH2_INDEXES_READY');
}
run().then(() => process.exit(0)).catch((e) => { console.error('NOT_READY:', e.message); process.exit(1); });
