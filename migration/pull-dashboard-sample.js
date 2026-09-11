// Read-only — pulls real aggregate numbers for the Dashboard-plan mockup. No writes, count()-only + small getDocs.
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
const cnt = async (...w) => (await col.where(...w).count().get()).data().count;
const cntAll = async () => (await col.count().get()).data().count;

async function run() {
  const stagesDoc = await db.doc('config/stages').get();
  const stages = (stagesDoc.data()?.stages || []).map((s) => s.key || s.name || s);

  const totalLeads = await cntAll();
  const totalFresh = await cnt('status', 'in', ['fresh', 'new']);
  const totalOld = totalLeads - totalFresh;

  // status breakdown (LDR side field: status)
  const ldrStatusCounts = {};
  for (const s of ['fresh', 'new', 'call back', 'callback', 'follow-up', 'followup', 'qualified', 'dead', 'lost']) {
    try { ldrStatusCounts[s] = await cnt('status', '==', s); } catch { ldrStatusCounts[s] = 0; }
  }
  // sales side field: sales_status
  const salesStatusCounts = {};
  for (const s of ['qualified', 'call back', 'callback', 'follow-up', 'followup', 'order done', 'lost', 'dead']) {
    try { salesStatusCounts[s] = await cnt('sales_status', '==', s); } catch { salesStatusCounts[s] = 0; }
  }

  const totalUrgent = await cnt('is_urgent', '==', true);
  const ldrCount = await cnt('ldr_uid', '!=', null).catch(() => 0);
  const salesCount = await cnt('sales_uid', '!=', null).catch(() => 0);

  console.log(JSON.stringify({
    stages, totalLeads, totalFresh, totalOld, ldrStatusCounts, salesStatusCounts, totalUrgent, ldrCount, salesCount,
  }, null, 2));
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1); });
