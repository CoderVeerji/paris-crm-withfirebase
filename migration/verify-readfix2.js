const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
// App wahi IST boundaries use karta hai jo daterange.js mein hain
const dayStart = (s) => new Date(`${s}T00:00:00+05:30`);
const dayEnd = (s) => new Date(`${s}T23:59:59.999+05:30`);
const istDay = (ms = Date.now()) => new Date(ms + 5.5*3600*1000).toISOString().slice(0,10);

async function run() {
  for (const label of ['today', 'yesterday', 'last7d']) {
    const to = istDay();
    const from = label === 'today' ? to : label === 'yesterday' ? istDay(Date.now()-86400000) : istDay(Date.now()-6*86400000);
    const f = label === 'yesterday' ? from : from;
    const t = label === 'yesterday' ? from : to;
    const snap = await db.collection('activity')
      .where('at','>=',dayStart(f)).where('at','<=',dayEnd(t))
      .orderBy('at','desc').limit(800).get();
    const byUid = {};
    snap.forEach(d => { const u = d.data().uid; if(u) byUid[u] = (byUid[u]||0)+1; });
    console.log(`${label} (${f}${f!==t?' → '+t:''}): ${snap.size} activity docs, ${Object.keys(byUid).length} log active`);
  }
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
