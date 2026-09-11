const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();

async function run() {
  const usersSnap = await db.collection('users').get();
  const users = {};
  usersSnap.forEach((d) => { users[d.id] = d.data(); });

  const leadsSnap = await db.collection('leads').get();
  const leads = [];
  leadsSnap.forEach((d) => leads.push({ id: d.id, ...d.data() }));

  const cut30 = Date.now() - 30 * 86400000;
  const salesLeadStats = {}; // uid -> {fresh, old, revenue, orderDone, assigned}
  for (const l of leads) {
    if (!l.sales_uid) continue;
    if (users[l.sales_uid]?.role !== 'sales') continue; // test-data noise guard: skip mis-tagged non-sales uids
    if (!salesLeadStats[l.sales_uid]) salesLeadStats[l.sales_uid] = { fresh: 0, old: 0, revenue: 0, orderDone: 0, assigned: 0 };
    const s = salesLeadStats[l.sales_uid];
    s.assigned++;
    const createdMs = l.created_at?.toDate?.().getTime() || 0;
    if (createdMs >= cut30) s.fresh++; else s.old++;
    s.revenue += l.total_revenue || 0;
    if (String(l.sales_status || '').toLowerCase() === 'order done' || (l.order_count || 0) > 0) s.orderDone++;
  }

  const actSnap = await db.collection('activity').get();
  const actByUid = {};
  actSnap.forEach((d) => {
    const a = d.data();
    if (!a.uid) return;
    actByUid[a.uid] = (actByUid[a.uid] || 0) + 1;
  });
  console.log('total activity docs:', actSnap.size);

  const rows = Object.entries(salesLeadStats).map(([uid, s]) => {
    const touches = actByUid[uid] || 0;
    const handled = s.fresh + s.old;
    return {
      name: users[uid]?.full_name || uid,
      handled, fresh: s.fresh, old: s.old,
      followups: touches,
      avgTouch: handled ? (touches / handled).toFixed(1) : '0.0',
      dealsClosed: s.orderDone,
      convPct: handled ? ((s.orderDone / handled) * 100).toFixed(1) : '0.0',
      totalSales: s.revenue,
      avgValue: s.orderDone ? Math.round(s.revenue / s.orderDone) : 0,
    };
  }).sort((a, b) => b.totalSales - a.totalSales);
  console.log(JSON.stringify(rows, null, 2));
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1); });
