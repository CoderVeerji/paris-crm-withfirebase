const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
const actCol = db.collection('activity');

function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

async function reportFor(users, ownerField, cutoff, cutoffEnd) {
  const rows = [];
  for (const u of users) {
    const assignedSnap = await col.where(ownerField, '==', u.id).count().get();
    const overdueSnap = await col.where(ownerField, '==', u.id).where('next_followup', '<', new Date()).count().get();
    const recentSnap = await actCol.where('uid', '==', u.id).orderBy('at', 'desc').limit(80).get();
    const distinctLeads = new Set();
    let qualified = 0; let contacted = 0; let lastActive = null;
    recentSnap.forEach((d) => {
      const a = d.data();
      if (!lastActive) lastActive = a.at.toDate();
      const t = a.at.toDate();
      if (t >= cutoff && (!cutoffEnd || t < cutoffEnd)) {
        contacted++;
        distinctLeads.add(a.lead_id);
        if (String(a.to_status || '').toLowerCase() === 'qualified') qualified++;
      }
    });
    rows.push({
      name: u.full_name, assigned: assignedSnap.data().count, overdue: overdueSnap.data().count,
      worked: distinctLeads.size, contacted, qualified, lastActive,
    });
  }
  return rows.sort((a, b) => b.assigned - a.assigned);
}

async function run() {
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => (u.status || 'active') === 'active');
  const ldrUsers = users.filter((u) => u.role === 'ldr');
  const salesUsers = users.filter((u) => u.role === 'sales');

  const today0 = dayStart(new Date());
  const yst0 = dayStart(new Date(Date.now() - 86400000));

  console.log('=== TODAY ===');
  console.log('LDR:', JSON.stringify(await reportFor(ldrUsers, 'ldr_uid', today0), null, 2));
  console.log('SALES:', JSON.stringify(await reportFor(salesUsers, 'sales_uid', today0), null, 2));

  console.log('=== YESTERDAY ===');
  console.log('LDR:', JSON.stringify(await reportFor(ldrUsers, 'ldr_uid', yst0, today0), null, 2));
  console.log('SALES:', JSON.stringify(await reportFor(salesUsers, 'sales_uid', yst0, today0), null, 2));
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1); });
