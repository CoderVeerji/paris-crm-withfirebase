const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'paris-crm' });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;
const FieldPath = admin.firestore.FieldPath;
const IST = 5.5*3600*1000;
function dayBounds(d){const s=Date.parse(d+'T00:00:00Z')-IST;return {start:TS.fromMillis(s),end:TS.fromMillis(s+86400000)};}

async function agg(dayStr) {
  const { start, end } = dayBounds(dayStr);
  const acts = await db.collection('activity').where('at','>=',start).where('at','<',end).get();
  const fresh = await db.collection('leads').where('created_at','>=',start).where('created_at','<',end).get();
  const st = (l) => String(l.sales_status||l.status||'').toLowerCase() || 'untouched';
  const bump = (o,k)=>{o[k]=(o[k]||0)+1;};

  const freshRep={total:fresh.size,worked:0,by_status:{}};
  fresh.forEach(d=>{const l=d.data(); if(l.last_action_at&&l.last_action_at.toMillis()>=start.toMillis())freshRep.worked++; bump(freshRep.by_status,st(l));});

  const urgentIds=[...new Set(acts.docs.filter(d=>d.data().action==='urgent').map(d=>d.data().lead_id))];
  const reinqRep={total:urgentIds.length,worked:0,pending:0,by_status:{}};
  urgentIds.forEach(id=>{const acted=acts.docs.some(a=>a.data().lead_id===id&&a.data().action!=='urgent'); if(acted)reinqRep.worked++; else reinqRep.pending++;});
  for(let i=0;i<urgentIds.length;i+=30){
    const snap=await db.collection('leads').where(FieldPath.documentId(),'in',urgentIds.slice(i,i+30)).get();
    snap.forEach(doc=>bump(reinqRep.by_status,st(doc.data())));
  }

  const doneIds=new Set(); const followRep={due:0,done:0,pending:0,by_status:{},exact:true}; let sawDue=false;
  acts.forEach(doc=>{const a=doc.data(); const wd=a.was_due_for; if(wd)sawDue=true;
    if(wd&&wd.toMillis()>=start.toMillis()&&wd.toMillis()<end.toMillis()){doneIds.add(a.lead_id);bump(followRep.by_status,String(a.to_status||'').toLowerCase()||'unknown');}});
  followRep.done=doneIds.size;
  const stillDue=await db.collection('leads').where('next_followup','>=',start).where('next_followup','<',end).get();
  followRep.pending=stillDue.size; followRep.due=followRep.done+followRep.pending;
  if(acts.size>0&&!sawDue)followRep.exact=false;

  const r = {fresh:freshRep,reinquiry:reinqRep,followups:followRep};
  const ok = reinqRep.total === reinqRep.worked + reinqRep.pending;
  console.log(dayStr, '| acts:', acts.size, '| reconcile(reinq total==worked+pending):', ok ? 'OK' : 'MISMATCH');
  console.log('  ', JSON.stringify(r));
}
async function run(){ for(const d of ['2026-09-04','2026-09-05','2026-09-06']) await agg(d); }
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
