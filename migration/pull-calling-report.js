const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
const actCol = db.collection('activity');

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

async function reportFor(users, ownerField) {
  const cutoff = new Date(Date.now() - 7 * 86400000); // last 7 days — sample dataset's "today" is too sparse to be illustrative
  const rows = [];
  for (const u of users) {
    const assignedSnap = await col.where(ownerField, '==', u.id).count().get();
    const overdueSnap = await col.where(ownerField, '==', u.id).where('next_followup', '<', new Date()).count().get();
    // existing index is uid+at DESC — reuse it (no new index just for this mockup pull), filter today client-side
    const recentSnap = await actCol.where('uid', '==', u.id).orderBy('at', 'desc').limit(50).get();
    const distinctLeads = new Set();
    let qualified = 0; let contactedToday = 0; let lastActive = null;
    recentSnap.forEach((d) => {
      const a = d.data();
      if (!lastActive) lastActive = a.at.toDate();
      if (a.at.toDate() >= cutoff) {
        contactedToday++;
        distinctLeads.add(a.lead_id);
        if (String(a.to_status || '').toLowerCase() === 'qualified') qualified++;
      }
    });
    rows.push({
      name: u.full_name, assigned: assignedSnap.data().count, overdue: overdueSnap.data().count,
      worked: distinctLeads.size, contacted: contactedToday, qualified, lastActive,
    });
  }
  return rows.sort((a, b) => b.assigned - a.assigned);
}

async function run() {
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => (u.status || 'active') === 'active');
  const ldrUsers = users.filter((u) => u.role === 'ldr');
  const salesUsers = users.filter((u) => u.role === 'sales');

  const ldrReport = await reportFor(ldrUsers, 'ldr_uid');
  console.log('LDR REPORT:', JSON.stringify(ldrReport, null, 2));

  const salesReport = await reportFor(salesUsers, 'sales_uid');
  console.log('SALES REPORT:', JSON.stringify(salesReport, null, 2));
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1); });
