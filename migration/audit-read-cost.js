// Dashboard ka ek page-load kitni Firestore reads karta hai — actual count, guess nahi.
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();

async function run() {
  const users = await db.collection('users').get();
  const ldr = users.docs.filter((d) => d.data().role === 'ldr' && (d.data().status || 'active') === 'active');
  const sales = users.docs.filter((d) => d.data().role === 'sales' && (d.data().status || 'active') === 'active');
  const settings = (await db.doc('config/settings').get()).data() || {};
  const sources = String(settings.Lead_Sources || '').split(',').filter(Boolean).length;
  const states = String(settings.State_List || '').split(',').filter(Boolean).length;

  // TeamDashboard ka current per-load cost (admin, Sales team, "Today")
  const perMemberActivity = 80; // teamWorkloadReport fbLimit(80)
  const salesWorkload = sales.length * (2 + perMemberActivity);
  const ldrWorkload = ldr.length * (2 + perMemberActivity);
  const srcCost = sources * 2;
  const stateCost = states * 1;
  const urgentSales = (await db.collection('leads').where('is_urgent', '==', true).count().get()).data().count;

  console.log('--- CURRENT per dashboard load (admin) ---');
  console.log('teamWorkloadReport  Sales:', salesWorkload, ' LDR:', ldrWorkload);
  console.log('sourceQuality      :', srcCost, `(${sources} sources x 2 counts)`);
  console.log('stateVolume        :', stateCost, `(${states} states x 1 count)`);
  console.log('reinquiry fetch    : ~', urgentSales, '(is_urgent docs, cap 300)');
  console.log('snapshot+status+fu : ~60');
  console.log('=> SALES team load ≈', salesWorkload + srcCost + stateCost + urgentSales + 60, 'reads');
  console.log('=> LDR   team load ≈', ldrWorkload + srcCost + stateCost + 60, 'reads');
  console.log('   (aur ye har team/range/person change par DOBARA chalta hai)');

  // Proposed: single activity range-query instead of per-member
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const actToday = await db.collection('activity').where('at', '>=', today0).count().get();
  console.log('\n--- FIX ke baad ---');
  console.log('activity range-query (aaj):', actToday.data().count, 'reads (per-member 80x ki jagah)');
  console.log('=> SALES team load ≈', sales.length * 2 + actToday.data().count + 60, 'reads (source/state ek hi baar, cached)');
}
run().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
