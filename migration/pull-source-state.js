const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');

function splitList(str) { return String(str || '').split(',').map((s) => s.trim()).filter(Boolean); }

async function run() {
  const settings = (await db.doc('config/settings').get()).data() || {};
  const sources = splitList(settings.Lead_Sources);
  const states = splitList(settings.State_List);
  console.log('configured sources:', sources);
  console.log('configured states:', states);

  const srcRows = [];
  for (const s of sources) {
    const c = await col.where('source', '==', s).count().get();
    if (c.data().count > 0) srcRows.push([s, c.data().count]);
  }
  srcRows.sort((a, b) => b[1] - a[1]);
  console.log('SOURCE COUNTS:', JSON.stringify(srcRows));

  const stateRows = [];
  for (const s of states) {
    const c = await col.where('state', '==', s).count().get();
    if (c.data().count > 0) stateRows.push([s, c.data().count]);
  }
  stateRows.sort((a, b) => b[1] - a[1]);
  console.log('STATE COUNTS:', JSON.stringify(stateRows));

  // fallback: if configured lists don't cover much, sample actual distinct values present on leads
  if (srcRows.reduce((a,b)=>a+b[1],0) < 500) {
    const snap = await col.limit(1500).get();
    const freq = {};
    snap.forEach((d) => { const s = d.data().source || '(blank)'; freq[s] = (freq[s]||0)+1; });
    console.log('SOURCE FREQ (sampled, fallback):', JSON.stringify(freq));
  }
  if (stateRows.reduce((a,b)=>a+b[1],0) < 500) {
    const snap = await col.limit(1500).get();
    const freq = {};
    snap.forEach((d) => { const s = d.data().state || '(blank)'; freq[s] = (freq[s]||0)+1; });
    console.log('STATE FREQ (sampled, fallback):', JSON.stringify(freq));
  }
}
run().then(() => process.exit(0)).catch((e) => { console.error('ERR:', e.message); process.exit(1); });
