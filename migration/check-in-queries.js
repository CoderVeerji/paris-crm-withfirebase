const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');

function dayStart(s) { return new Date(`${s}T00:00:00+05:30`); }
function dayEnd(s) { return new Date(`${s}T23:59:59.999+05:30`); }
const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

async function run() {
  const usersSnap = await db.collection('users').get();
  const ldrIds = []; const salesIds = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.role === 'ldr') ldrIds.push(d.id);
    if (u.role === 'sales') salesIds.push(d.id);
  });
  console.log('ldr members:', ldrIds.length, 'sales members:', salesIds.length);

  for (const [owner, ids, stField] of [['ldr_uid', ldrIds, 'status'], ['sales_uid', salesIds, 'sales_status']]) {
    await col.where(owner, 'in', ids.slice(0, 30)).limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('created_at', '>=', dayStart(weekAgo)).where('created_at', '<=', dayEnd(today)).limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('last_action_at', '>=', dayStart(weekAgo)).where('last_action_at', '<=', dayEnd(today)).limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('next_followup', '>=', dayStart(weekAgo)).where('next_followup', '<=', dayEnd(today)).limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('next_followup', '<', dayStart(today)).limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('is_urgent', '==', true).limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where(stField, '==', 'qualified').limit(1).get();
    // drill-down variants with orderBy
    await col.where(owner, 'in', ids.slice(0, 30)).where('created_at', '>=', dayStart(today)).where('created_at', '<=', dayEnd(today)).orderBy('created_at', 'desc').limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('last_action_at', '>=', dayStart(today)).where('last_action_at', '<=', dayEnd(today)).orderBy('last_action_at', 'asc').limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('next_followup', '>=', dayStart(today)).where('next_followup', '<=', dayEnd(today)).orderBy('next_followup', 'asc').limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).where('next_followup', '<', dayStart(today)).orderBy('next_followup', 'asc').limit(1).get();
    await col.where(owner, 'in', ids.slice(0, 30)).orderBy('created_at', 'desc').limit(1).get();
  }
  console.log('ALL_IN_QUERIES_OK');
}
run().then(() => process.exit(0)).catch((e) => { console.error('NOT_READY:', e.message); process.exit(1); });
