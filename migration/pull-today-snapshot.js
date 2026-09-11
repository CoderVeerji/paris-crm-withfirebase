const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
const cnt = async (...w) => (await col.where(...w).count().get()).data().count;

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

async function run() {
  const today0 = dayStart(new Date());
  const now = new Date();

  // LDR team
  const ldrNew = await cnt('created_at', '>=', today0); // fresh pool + any newly created (company-wide, LDR-relevant)
  const ldrTotal = await cnt('ldr_uid', '!=', null);
  // "old leads touched today": ldr_uid exists, created before today, last_action_at today
  const ldrOldTouchedSnap = await col.where('last_action_at', '>=', today0).get();
  let ldrOldTouched = 0;
  ldrOldTouchedSnap.forEach((d) => { const l = d.data(); if (l.ldr_uid && l.created_at && l.created_at.toDate() < today0) ldrOldTouched++; });
  const ldrFreshPending = await cnt('status', 'in', ['fresh', 'new']);
  const ldrFollowupTodayDue = await col.where('next_followup', '>=', today0).where('next_followup', '<=', now).get();
  let ldrFollowupPending = 0;
  ldrFollowupTodayDue.forEach((d) => { const l = d.data(); if (!(l.last_action_at && l.last_action_at.toDate() >= today0)) ldrFollowupPending++; });
  console.log('LDR: new(created today)=', ldrNew, 'total owned=', ldrTotal, 'old touched today=', ldrOldTouched,
    'fresh pending=', ldrFreshPending, 'followup-due-today pending=', ldrFollowupPending,
    'followup-due-today total=', ldrFollowupTodayDue.size);

  // Sales team
  const salesTotal = await cnt('sales_uid', '!=', null);
  const salesNewAssignedToday = await cnt('assigned_sales_at', '>=', today0);
  const salesOldTouchedSnap = await col.where('last_action_at', '>=', today0).get();
  let salesOldTouched = 0;
  salesOldTouchedSnap.forEach((d) => { const l = d.data(); if (l.sales_uid && l.assigned_sales_at && l.assigned_sales_at.toDate() < today0) salesOldTouched++; });
  const salesNotWorked = await col.where('sales_uid', '!=', null).get();
  let salesPendingNever = 0;
  salesNotWorked.forEach((d) => { const l = d.data(); if (!l.sales_status) salesPendingNever++; });
  console.log('SALES: total owned=', salesTotal, 'newly assigned today=', salesNewAssignedToday,
    'old touched today=', salesOldTouched, 'never-worked (all-time)=', salesPendingNever);
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1); });
