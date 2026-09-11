/**
 * Migration verify — Firestore se thoda data padhke sanity check.
 *   node verify.js
 */
'use strict';
const admin = require('firebase-admin');
const PROJECT_ID = 'paris-crm';
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
const db = admin.firestore();

(async function () {
  console.log('\n=== Firestore verify ===\n');

  // counts (aggregation query = sasta, 1 read)
  for (const c of ['users', 'leads', 'activity', 'orders', 'config', 'meta']) {
    const cnt = await db.collection(c).count().get();
    console.log(`${c.padEnd(10)} : ${cnt.data().count}`);
  }

  // meta/counters
  const meta = await db.doc('meta/counters').get();
  console.log('\nmeta/counters :', JSON.stringify(meta.data()));

  // config
  const forms = await db.doc('config/forms').get();
  const stages = await db.doc('config/stages').get();
  console.log('config/forms  :', (forms.data().fields || []).length, 'fields');
  console.log('config/stages :', (stages.data().stages || []).length, 'stages');

  // 3 sample leads
  console.log('\n--- 3 sample leads ---');
  const leads = await db.collection('leads').orderBy('created_at').limit(3).get();
  leads.forEach(d => {
    const l = d.data();
    console.log(`\nlead ${d.id}: ${l.name || '(blank)'} | ${l.phone} | ${l.status}/${l.sales_status}`);
    console.log(`  ldr: ${l.ldr_name || l.ldr_legacy || '-'} | sales: ${l.sales_name || l.sales_legacy || '-'}`);
    console.log(`  created_at: ${l.created_at && l.created_at.toDate().toISOString()}`);
    console.log(`  orders: ${l.order_count} / ₹${l.total_revenue} | activity fields: ${Object.keys(l).length}`);
    console.log(`  f_customer_type: "${l.f_customer_type}" | f_intent: "${l.f_intent}"`);
  });

  // 1 lead with orders + its activity
  const withOrder = await db.collection('leads').where('order_count', '>', 0).limit(1).get();
  if (!withOrder.empty) {
    const lid = withOrder.docs[0].id;
    console.log(`\n--- lead ${lid} (has order) activity ---`);
    const acts = await db.collection('activity').where('lead_id', '==', lid).get();
    acts.forEach(a => {
      const x = a.data();
      console.log(`  ${x.at.toDate().toISOString().slice(0, 16)} | ${x.actor_name || x.uid || '?'} | ${x.action} | ${x.to_status || ''} | ₹${x.amount || 0} | ${x.remark.slice(0, 40)}`);
    });
    const ords = await db.collection('orders').where('lead_id', '==', lid).get();
    ords.forEach(o => console.log(`  ORDER: ₹${o.data().amount} by ${o.data().sales_name || o.data().sales_uid} @ ${o.data().order_date.toDate().toISOString().slice(0,10)}`));
  }

  // a few auth users
  console.log('\n--- Auth users (first 5) ---');
  const list = await admin.auth().listUsers(5);
  list.users.forEach(u => console.log(`  ${u.email} | ${u.displayName} | uid ${u.uid.slice(0, 8)}...`));

  console.log('\n=== done ===\n');
  process.exit(0);
})().catch(e => { console.error('VERIFY FAIL:', e); process.exit(1); });
