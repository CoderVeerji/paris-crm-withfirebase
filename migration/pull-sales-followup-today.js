const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
function dayStart(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
async function run() {
  const today0 = dayStart(new Date()); const now = new Date();
  const snap = await col.where('next_followup', '>=', today0).where('next_followup', '<=', now).get();
  let salesDue = 0, salesDuePending = 0;
  snap.forEach((d) => { const l = d.data(); if (l.sales_uid) { salesDue++; if (!(l.last_action_at && l.last_action_at.toDate() >= today0)) salesDuePending++; } });
  console.log('sales followup-due-today total=', salesDue, 'pending=', salesDuePending);
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
