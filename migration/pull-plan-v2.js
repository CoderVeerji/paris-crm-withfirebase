const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
const cnt = async (...w) => (await col.where(...w).count().get()).data().count;

async function run() {
  // full sales_status vocabulary actually present (sample distinct values via small scan)
  const snap = await col.where('sales_uid', '!=', null).limit(1500).get();
  const salesStatusFreq = {};
  snap.forEach((d) => {
    const s = String(d.data().sales_status || '(blank)').toLowerCase();
    salesStatusFreq[s] = (salesStatusFreq[s] || 0) + 1;
  });
  console.log('sales_status frequency (sampled):', JSON.stringify(salesStatusFreq, null, 2));

  const ldrSnap = await col.where('ldr_uid', '!=', null).limit(1500).get();
  const ldrStatusFreq = {};
  ldrSnap.forEach((d) => {
    const s = String(d.data().status || '(blank)').toLowerCase();
    ldrStatusFreq[s] = (ldrStatusFreq[s] || 0) + 1;
  });
  console.log('ldr status frequency (sampled):', JSON.stringify(ldrStatusFreq, null, 2));

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000);
  const d7 = new Date(now.getTime() - 7 * 86400000);

  // assigned-in-range proxy (last 30d, since sample data has no "today" activity)
  const assignedSnap = await col.where('assigned_sales_at', '>=', d30).get();
  let worked = 0, pending = 0;
  assignedSnap.forEach((d) => {
    const l = d.data();
    const touchedAfterAssign = l.last_action_at && l.assigned_sales_at && l.last_action_at.toMillis() > l.assigned_sales_at.toMillis();
    if (touchedAfterAssign) worked++; else pending++;
  });
  console.log('assigned last 30d:', assignedSnap.size, 'worked:', worked, 'pending:', pending);

  const assigned7Snap = await col.where('assigned_sales_at', '>=', d7).count().get();
  console.log('assigned last 7d:', assigned7Snap.data().count);

  // followups due in a range (last 7 days window, incl overdue within it)
  const dueRangeSnap = await col.where('next_followup', '>=', d7).where('next_followup', '<=', now).get();
  let dueWorked = 0, duePending = 0;
  dueRangeSnap.forEach((d) => {
    const l = d.data();
    const touched = l.last_action_at && l.last_action_at.toMillis() >= (l.next_followup ? l.next_followup.toMillis() - 7 * 86400000 : 0);
    // simpler: consider "worked" if last_action_at is within the last 7 days too
    if (l.last_action_at && l.last_action_at.toMillis() >= d7.getTime()) dueWorked++; else duePending++;
  });
  console.log('followups due in last 7d window:', dueRangeSnap.size, 'worked:', dueWorked, 'pending:', duePending);
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1); });
