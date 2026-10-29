// One-time: plaintext passwords hatao — (1) user_secrets/* docs delete  (2) admin_tasks/*.new_password field hatao.
// Default DRY-RUN (kuch nahi badalta). Karne ke liye:  node _scrub-secrets.mjs --apply
import admin from 'firebase-admin';
const APPLY = process.argv.includes('--apply');
admin.initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'demo-paris-crm' : 'paris-crm', ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: admin.credential.applicationDefault() }) });
const db = admin.firestore(); const FV = admin.firestore.FieldValue;
const sec = await db.collection('user_secrets').get();
const tasks = await db.collection('admin_tasks').get();
const withPw = tasks.docs.filter((d) => d.data().new_password !== undefined);
console.log(`${APPLY ? 'APPLY' : 'DRY-RUN (kuch nahi badla)'} | user_secrets docs: ${sec.size} | admin_tasks docs with new_password: ${withPw.length} (${withPw.map((d) => d.id).join(', ') || '-'})`);
if (APPLY) {
  for (const d of sec.docs) await d.ref.delete();
  for (const d of withPw) await d.ref.update({ new_password: FV.delete() });
  console.log('done: deleted', sec.size, 'user_secrets docs, scrubbed', withPw.length, 'task docs');
} else console.log('Karne ke liye: node _scrub-secrets.mjs --apply');
process.exit(0);
