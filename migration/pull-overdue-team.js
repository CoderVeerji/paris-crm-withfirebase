const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

async function run() {
  const today0 = dayStart(new Date());
  const snap = await col.where('next_followup', '<', today0).get();
  let ldrTotal = 0, ldrWorkedToday = 0, salesTotal = 0, salesWorkedToday = 0;
  snap.forEach((d) => {
    const l = d.data();
    const touchedToday = l.last_action_at && l.last_action_at.toDate() >= today0;
    if (l.ldr_uid && !l.sales_uid) { ldrTotal++; if (touchedToday) ldrWorkedToday++; }
    if (l.sales_uid) { salesTotal++; if (touchedToday) salesWorkedToday++; }
  });
  console.log('LDR overdue: total=', ldrTotal, 'worked today=', ldrWorkedToday, 'still pending=', ldrTotal - ldrWorkedToday);
  console.log('SALES overdue: total=', salesTotal, 'worked today=', salesWorkedToday, 'still pending=', salesTotal - salesWorkedToday);
}
run().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
