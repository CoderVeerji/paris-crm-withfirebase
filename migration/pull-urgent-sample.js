const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');

async function run() {
  const urgentSnap = await col.where('is_urgent', '==', true).limit(500).get();
  let pending = 0, callback = 0, qualified = 0, lost = 0, worked = 0;
  urgentSnap.forEach((d) => {
    const l = d.data();
    const st = String(l.status || '').toLowerCase();
    if (['fresh', 'new'].includes(st)) pending++;
    else if (['call back', 'callback', 'follow-up', 'followup'].includes(st)) { callback++; worked++; }
    else if (st === 'qualified') { qualified++; worked++; }
    else if (['dead', 'lost'].includes(st)) { lost++; worked++; }
  });
  console.log(JSON.stringify({ total: urgentSnap.size, pending, callback, qualified, lost, worked }, null, 2));
  const now = new Date(); const dayAgo = new Date(now.getTime() - 86400000);
  const todaySnap = await col.where('created_at', '>=', dayAgo).count().get();
  console.log('created last 24h:', todaySnap.data().count);
  const dueSnap = await col.where('next_followup', '<=', now).count().get();
  console.log('due now (incl overdue):', dueSnap.data().count);
}
run().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
