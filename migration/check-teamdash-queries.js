const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
const actCol = db.collection('activity');

function dayStart(s) { return new Date(`${s}T00:00:00+05:30`); }
function dayEnd(s) { return new Date(`${s}T23:59:59.999+05:30`); }
const today = new Date().toISOString().slice(0, 10);
const yst = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

async function run() {
  for (const owner of ['ldr_uid', 'sales_uid']) {
    for (const [from, to] of [[today, today], [yst, yst], [weekAgo, today], [monthAgo, today]]) {
      // snapshotStats: total, new(created_range), old(touched_range), followup(range)
      await col.where(owner, '==', 'x').limit(1).get();
      await col.where(owner, '==', 'x').where('created_at', '>=', dayStart(from)).where('created_at', '<=', dayEnd(to)).limit(1).get();
      await col.where(owner, '==', 'x').where('last_action_at', '>=', dayStart(from)).where('last_action_at', '<=', dayEnd(to)).limit(1).get();
      await col.where(owner, '==', 'x').where('next_followup', '>=', dayStart(from)).where('next_followup', '<=', dayEnd(to)).limit(1).get();
      // team-level (no owner) variants
      await col.where('created_at', '>=', dayStart(from)).where('created_at', '<=', dayEnd(to)).limit(1).get();
      await col.where('last_action_at', '>=', dayStart(from)).where('last_action_at', '<=', dayEnd(to)).limit(1).get();
      await col.where('next_followup', '>=', dayStart(from)).where('next_followup', '<=', dayEnd(to)).limit(1).get();
      // overdueStats
      await col.where(owner, '==', 'x').where('next_followup', '<', dayStart(from)).limit(1).get();
      await col.where('next_followup', '<', dayStart(from)).limit(1).get();
    }
    // statusBreakdown
    const stField = owner === 'sales_uid' ? 'sales_status' : 'status';
    await col.where(owner, '==', 'x').where(stField, '==', 'qualified').limit(1).get();
    await col.where(stField, '==', 'qualified').limit(1).get();
    // reinquiryStats
    await col.where(owner, '==', 'x').where('is_urgent', '==', true).limit(1).get();
    await col.where('is_urgent', '==', true).limit(1).get();
  }
  await col.where('status', 'in', ['fresh', 'new']).limit(1).get();
  await col.where('ldr_uid', '==', 'x').where('status', 'in', ['fresh', 'new']).limit(1).get();

  // dashboardLeads.js drill-down variants (with orderBy)
  for (const owner of ['ldr_uid', 'sales_uid']) {
    await col.where(owner, '==', 'x').where('is_urgent', '==', true).limit(1).get();
    const stField = owner === 'sales_uid' ? 'sales_status' : 'status';
    await col.where(owner, '==', 'x').where(stField, '==', 'qualified').limit(1).get();
    await col.where(owner, '==', 'x').where('created_at', '>=', dayStart(today)).where('created_at', '<=', dayEnd(today)).orderBy('created_at', 'desc').limit(1).get();
    await col.where(owner, '==', 'x').where('last_action_at', '>=', dayStart(today)).where('last_action_at', '<=', dayEnd(today)).orderBy('last_action_at', 'asc').limit(1).get();
    await col.where(owner, '==', 'x').where('next_followup', '>=', dayStart(today)).where('next_followup', '<=', dayEnd(today)).orderBy('next_followup', 'asc').limit(1).get();
    await col.where(owner, '==', 'x').where('next_followup', '<', dayStart(today)).orderBy('next_followup', 'asc').limit(1).get();
    await col.where(owner, '==', 'x').orderBy('created_at', 'desc').limit(1).get();
  }

  // teamWorkloadReport activity fetch
  await actCol.where('uid', '==', 'x').orderBy('at', 'desc').limit(1).get();

  console.log('ALL_TEAMDASH_QUERIES_OK');
}
run().then(() => process.exit(0)).catch((e) => { console.error('NOT_READY:', e.message); process.exit(1); });
