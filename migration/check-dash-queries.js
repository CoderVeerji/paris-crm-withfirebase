const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');

async function run() {
  const now = new Date();
  const past = new Date(now.getTime() - 86400000);

  // freshLeadsToday (with + without member filter)
  await col.where('ldr_uid', '==', 'x').where('created_at', '>=', past).where('created_at', '<=', now).limit(1).get();
  await col.where('sales_uid', '==', 'x').where('created_at', '>=', past).where('created_at', '<=', now).limit(1).get();
  await col.where('created_at', '>=', past).where('created_at', '<=', now).limit(1).get();

  // scheduledToday
  await col.where('ldr_uid', '==', 'x').where('next_followup', '>=', past).where('next_followup', '<=', now).limit(1).get();
  await col.where('sales_uid', '==', 'x').where('next_followup', '>=', past).where('next_followup', '<=', now).limit(1).get();
  await col.where('next_followup', '>=', past).where('next_followup', '<=', now).limit(1).get();

  // overdueBacklog
  await col.where('next_followup', '<', now).limit(1).get();
  await col.where('next_followup', '<', now).where('attempts', '==', 0).limit(1).get();

  // sourceQuality
  await col.where('source', '==', 'x').limit(1).get();
  await col.where('source', '==', 'x').where('status', '==', 'qualified').limit(1).get();

  // stateVolume
  await col.where('state', '==', 'x').limit(1).get();

  // callingReport
  await col.where('ldr_uid', '==', 'x').limit(1).get();
  await col.where('sales_uid', '==', 'x').limit(1).get();
  await col.where('ldr_uid', '==', 'x').where('next_followup', '<', now).limit(1).get();
  await col.where('sales_uid', '==', 'x').where('next_followup', '<', now).limit(1).get();

  // actionableLeads (orderBy variant)
  await col.where('ldr_uid', '==', 'x').where('next_followup', '<=', now).orderBy('next_followup', 'asc').limit(1).get();
  await col.where('sales_uid', '==', 'x').where('next_followup', '<=', now).orderBy('next_followup', 'asc').limit(1).get();
  await col.where('next_followup', '<=', now).orderBy('next_followup', 'asc').limit(1).get();

  // urgentSummary
  await col.where('is_urgent', '==', true).limit(1).get();
  await col.where('is_urgent', '==', true).where('ldr_uid', '==', 'x').limit(1).get();
  await col.where('is_urgent', '==', true).where('sales_uid', '==', 'x').limit(1).get();

  console.log('ALL_DASHBOARD_QUERIES_OK');
}
run().then(() => process.exit(0)).catch((e) => { console.error('NOT_READY:', e.message); process.exit(1); });
