// Read-only, one-time full scan (2509 leads — cheap, well within free tier) for the
// Business Analytics + MECA plan mockup. Computes everything client-side in a single pass
// to avoid many redundant count() round-trips.
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();

const QUALIFIED = 'qualified';
const LOST = ['dead', 'lost'];
const FRESH = ['fresh', 'new'];

async function run() {
  const usersSnap = await db.collection('users').get();
  const users = {};
  usersSnap.forEach((d) => { users[d.id] = d.data(); });

  const leadsSnap = await db.collection('leads').get();
  const leads = [];
  leadsSnap.forEach((d) => leads.push({ id: d.id, ...d.data() }));

  const total = leads.length;
  const now = Date.now();
  const day14 = 14 * 86400000;

  let qualifiedCount = 0, orderDoneCount = 0, totalRevenue = 0, atRisk = 0, qualifiedUnassigned = 0;
  const bySource = {}; // source -> {total, qualified}
  const byState = {}; // state -> total
  const ldrStats = {}; // uid -> {assigned, qualified, sentTo: {salesUid: count}, name}
  const salesStats = {}; // uid -> {assigned, orderDone, lost, active, name}
  const pipeline = { fresh: 0, inProgress: 0, qualifiedPendingSales: 0, positiveEngagement: 0, orderDone: 0, lost: 0 };

  for (const l of leads) {
    const st = String(l.status || '').toLowerCase();
    const sst = String(l.sales_status || '').toLowerCase();
    const isQualified = st === QUALIFIED || !!l.sales_uid;
    if (isQualified) qualifiedCount++;
    if (sst === 'order done' || (l.order_count || 0) > 0) { orderDoneCount++; totalRevenue += l.total_revenue || 0; }
    if (st === QUALIFIED && !l.sales_uid) qualifiedUnassigned++;

    const lastTouch = (l.last_action_at || l.updated_at)?.toDate?.() || null;
    const isClosed = LOST.includes(st) || LOST.includes(sst) || sst === 'order done';
    if (!isClosed && lastTouch && (now - lastTouch.getTime()) > day14) atRisk++;

    // source
    const src = l.source || '(blank)';
    if (!bySource[src]) bySource[src] = { total: 0, qualified: 0 };
    bySource[src].total++;
    if (isQualified) bySource[src].qualified++;

    // state
    if (l.state) byState[l.state] = (byState[l.state] || 0) + 1;

    // pipeline health buckets
    if (FRESH.includes(st) && !l.sales_uid) pipeline.fresh++;
    else if (LOST.includes(st) || LOST.includes(sst)) pipeline.lost++;
    else if (sst === 'order done' || (l.order_count || 0) > 0) pipeline.orderDone++;
    else if (l.sales_uid && ['followup', 'call back', 'hot lead', 'video call', 'visit customer'].includes(sst)) pipeline.positiveEngagement++;
    else if (st === QUALIFIED && !l.sales_uid) pipeline.qualifiedPendingSales++;
    else pipeline.inProgress++;

    // LDR stats + downstream
    if (l.ldr_uid) {
      const u = users[l.ldr_uid];
      if (!ldrStats[l.ldr_uid]) ldrStats[l.ldr_uid] = { assigned: 0, qualified: 0, sentTo: {}, name: u?.full_name || l.ldr_uid };
      const ls = ldrStats[l.ldr_uid];
      ls.assigned++;
      if (isQualified) ls.qualified++;
      if (l.sales_uid) {
        const su = users[l.sales_uid];
        const key = l.sales_uid;
        if (!ls.sentTo[key]) ls.sentTo[key] = { name: su?.full_name || key, sent: 0, orderDone: 0, lost: 0, active: 0 };
        ls.sentTo[key].sent++;
        if (sst === 'order done' || (l.order_count || 0) > 0) ls.sentTo[key].orderDone++;
        else if (LOST.includes(sst)) ls.sentTo[key].lost++;
        else ls.sentTo[key].active++;
      }
    }

    // Sales stats
    if (l.sales_uid) {
      const u = users[l.sales_uid];
      if (!salesStats[l.sales_uid]) salesStats[l.sales_uid] = { assigned: 0, orderDone: 0, lost: 0, name: u?.full_name || l.sales_uid };
      const ss = salesStats[l.sales_uid];
      ss.assigned++;
      if (sst === 'order done' || (l.order_count || 0) > 0) ss.orderDone++;
      else if (LOST.includes(sst)) ss.lost++;
    }
  }

  console.log('=== TOP CARDS ===');
  console.log({
    total, qualifiedCount, qualRate: ((qualifiedCount / total) * 100).toFixed(1) + '%',
    orderDoneCount, closeRateOfQualified: ((orderDoneCount / qualifiedCount) * 100).toFixed(1) + '%',
    totalRevenue, atRisk, qualifiedUnassigned,
  });

  console.log('=== SOURCE PERFORMANCE ===');
  console.log(Object.entries(bySource).map(([s, v]) => ({ source: s, total: v.total, qualified: v.qualified, rate: v.total ? ((v.qualified / v.total) * 100).toFixed(0) + '%' : '0%' })).sort((a, b) => b.total - a.total));

  console.log('=== TOP STATES ===');
  console.log(Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 10));

  console.log('=== PIPELINE HEALTH ===');
  console.log(pipeline);

  console.log('=== TOP LDRs by qualified ===');
  console.log(Object.values(ldrStats).sort((a, b) => b.qualified - a.qualified).map((l) => ({ name: l.name, assigned: l.assigned, qualified: l.qualified, rate: l.assigned ? ((l.qualified / l.assigned) * 100).toFixed(0) + '%' : '0%' })));

  console.log('=== TOP SALES by orderDone ===');
  console.log(Object.values(salesStats).sort((a, b) => b.orderDone - a.orderDone).map((s) => ({ name: s.name, assigned: s.assigned, orderDone: s.orderDone, closeRate: s.assigned ? ((s.orderDone / s.assigned) * 100).toFixed(0) + '%' : '0%' })));

  console.log('=== MONTHLY TREND ===');
  const monthly = {};
  for (const l of leads) {
    const d = l.created_at?.toDate?.();
    if (!d) continue;
    const m = d.toISOString().slice(0, 7);
    if (!monthly[m]) monthly[m] = { total: 0, qualified: 0, orderDone: 0 };
    monthly[m].total++;
    const st = String(l.status || '').toLowerCase();
    if (st === QUALIFIED || l.sales_uid) monthly[m].qualified++;
    if (String(l.sales_status || '').toLowerCase() === 'order done' || (l.order_count || 0) > 0) monthly[m].orderDone++;
  }
  console.log(JSON.stringify(Object.entries(monthly).sort(), null, 2));

  console.log('=== FULL LDR -> SALES DOWNSTREAM (for the drill-down table) ===');
  const ldrDrill = Object.entries(ldrStats).map(([uid, l]) => ({
    uid, name: l.name, assigned: l.assigned, qualified: l.qualified,
    qualifyRate: l.assigned ? Math.round((l.qualified / l.assigned) * 100) : 0,
    sentTo: Object.values(l.sentTo).sort((a, b) => b.sent - a.sent),
    downstreamOrders: Object.values(l.sentTo).reduce((s, x) => s + x.orderDone, 0),
    downstreamSent: Object.values(l.sentTo).reduce((s, x) => s + x.sent, 0),
  })).sort((a, b) => b.assigned - a.assigned);
  console.log(JSON.stringify(ldrDrill, null, 2));
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message, e.stack); process.exit(1); });
