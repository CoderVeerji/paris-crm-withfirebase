// One-time: "gayab" leads wapas pool mein — status 'call back' + na LDR na Sales (owner nahi) + archived nahi.
// Wajah: duplicate phone par "owner ko wapas bhejo" ne bina-owner (fresh pool) lead ka status 'call back' kar diya tha (ab code fix ho gaya).
// Default DRY-RUN. Karne ke liye:  node _fix-orphan-leads.mjs --apply   (status wapas 'fresh', baaki sab waisa hi)
import admin from 'firebase-admin';
const APPLY = process.argv.includes('--apply');
admin.initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'demo-paris-crm' : 'paris-crm', ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: admin.credential.applicationDefault() }) });
const db = admin.firestore(); const FV = admin.firestore.FieldValue;
const snap = await db.collection('leads').where('status', '==', 'call back').where('ldr_uid', '==', null).get();
const rows = snap.docs.filter((d) => { const l = d.data(); return !l.sales_uid && !l.archived; });
console.log(`${APPLY ? 'APPLY' : 'DRY-RUN (kuch nahi badla)'} | 'call back' + bina LDR: ${snap.size} | unme se bina Sales + archived nahi (gayab): ${rows.length}`);
rows.slice(0, 30).forEach((d) => { const l = d.data(); console.log(' ', d.id, '|', (l.name || '').slice(0, 18), '| created', l.created_at && l.created_at.toDate().toISOString().slice(0, 10), '| last by', l.last_action_by_name || '-', '| urgent', !!l.is_urgent, '| phone ...' + String(l.phone_digits || '').slice(-4)); });
if (APPLY && rows.length) {
  const b = db.batch();
  rows.forEach((d) => b.update(d.ref, { status: 'fresh', sales_open: false, updated_at: FV.serverTimestamp() }));
  await b.commit();
  console.log('done: status -> fresh for', rows.length, 'leads');
} else if (!APPLY) console.log('Karne ke liye: node _fix-orphan-leads.mjs --apply');
process.exit(0);
