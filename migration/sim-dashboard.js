// Dashboard ke EXACT stat functions ko simulate karke har range ka output nikalta hai.
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const col = db.collection('leads');
const dayStart = (s) => new Date(`${s}T00:00:00+05:30`);
const dayEnd = (s) => new Date(`${s}T23:59:59.999+05:30`);
const istDay = (ms = Date.now()) => new Date(ms + 5.5*3600*1000).toISOString().slice(0,10);
const rangeFor = (k) => {
  const today = istDay(); const d = (n) => istDay(Date.now() - n*86400000);
  if (k==='today') return [today,today];
  if (k==='yst') return [d(1),d(1)];
  if (k==='w') return [d(6),today];
  if (k==='m') return [d(29),today];
  return ['2026-04-01', today];
};

async function snapshot(ownerField, ids, from, to) {
  const base = () => col.where(ownerField,'in',ids.slice(0,30));
  const total = (await base().count().get()).data().count;
  const rs = dayStart(from);
  const newSnap = await base().where('created_at','>=',rs).where('created_at','<=',dayEnd(to)).get();
  const touchSnap = await base().where('last_action_at','>=',rs).where('last_action_at','<=',dayEnd(to)).get();
  let old = 0; touchSnap.forEach(d=>{const l=d.data(); if(l.created_at?.toDate() < rs) old++;});
  const dueSnap = await base().where('next_followup','>=',rs).where('next_followup','<=',dayEnd(to)).get();
  let duePending = 0; dueSnap.forEach(d=>{const l=d.data(); if(!(l.last_action_at?.toDate() >= rs)) duePending++;});
  const overdue = (await base().where('next_followup','<',rs).count().get()).data().count;
  return { total, new: newSnap.size, old, followupsDue: dueSnap.size, duePending, overdue };
}

async function run() {
  const users = await db.collection('users').get();
  const ldrIds = users.docs.filter(d=>d.data().role==='ldr').map(d=>d.id);
  const salesIds = users.docs.filter(d=>d.data().role==='sales').map(d=>d.id);

  for (const [teamName, field, ids] of [['LDR','ldr_uid',ldrIds], ['SALES','sales_uid',salesIds]]) {
    console.log(`\n===== ${teamName} =====`);
    for (const k of ['today','yst','w','m']) {
      const [from,to] = rangeFor(k);
      const s = await snapshot(field, ids, from, to);
      console.log(`${k.padEnd(6)} (${from}${from!==to?'→'+to:''})  Book:${s.total}  New:${s.new}  OldTouched:${s.old}  FollowupsDue:${s.followupsDue}(pending ${s.duePending})  Overdue:${s.overdue}`);
    }
  }
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
