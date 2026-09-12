/**
 * Paris CRM — Cloud Functions
 *  - dailyMaintenance    : roz 01:00 IST — stats_daily/{date} + stats_cohort/{month} banata/update
 *                          karta hai, aur 30-din-purani recycle docs delete karta hai (pehle 3 alag
 *                          Scheduler jobs the — aggregateYesterday/refreshCohortMonth/purgeRecycle —
 *                          ek mein consolidate kiye taaki free Scheduler-job limit (3) ke andar rahein)
 *  - weeklyReport        : Mon 04:00 IST — reports_weekly/{YYYY-Www} for the Tue–Sun week that
 *                          just ended (weeks numbered from Jan 1). adminTask 'weekly' can pass
 *                          {week_num, year} to (re)build any past week.
 *  - backfillStats       : callable (admin) — purani dates ke liye stats banao
 *  - runWeekly           : callable (admin) — weekly report abhi banao (test)
 */
'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();
setGlobalOptions({ region: 'asia-south1', maxInstances: 3, timeoutSeconds: 540, memory: '512MiB' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const TS = admin.firestore.Timestamp;
const FieldPath = admin.firestore.FieldPath;

const IST = 5.5 * 3600 * 1000;
const LOST = ['dead', 'lost'];

// ---- lead scoring (app/src/lib/scoring.js ka mirror) ----
const SCORE_RULES = {
  'Customer Type': { 'existing shop': 30, boutique: 26, 'online seller': 20, reseller: 20, 'new business': 10, 'personal use': -25 },
  'Bulk Requirement?': { yes: 25, no: -5 },
  'Approx Quantity Interested In': { '50+': 32, '20–50': 20, '20-50': 20, '10–20': 10, '10-20': 10, 'under 10': -12 },
  'Buying Intent': { immediate: 30, exploring: 6, future: 0 },
  'Customer Interested In': { 'visit store': 22, 'video call': 16, 'whatsapp catalog': 6, 'not interested': -30 },
};
function scoreLead(l) {
  const ans = l.form_answers || {};
  const flat = {
    'Customer Type': l.f_customer_type, 'Bulk Requirement?': l.f_bulk, 'Buying Intent': l.f_intent,
    'Customer Interested In': l.f_interested_in, 'Approx Quantity Interested In': l.f_quantity,
  };
  let s = 0;
  for (const [label, map] of Object.entries(SCORE_RULES)) {
    const v = String(ans[label] != null ? ans[label] : (flat[label] || '')).toLowerCase();
    if (!v) continue;
    for (const [n, p] of Object.entries(map)) { if (v.includes(n.toLowerCase())) { s += p; break; } }
  }
  const b = Number(String(ans['Purchase Capacity / Budget'] || '').replace(/[^\d]/g, ''));
  if (b >= 100000) s += 25; else if (b >= 30000) s += 12;
  if (l.order_count > 0) s += 15;
  return { score: s, tier: s >= 55 ? 'hot' : s >= 22 ? 'warm' : 'cold' };
}

// Notification text — recipient ki app-language (users/{uid}.lang) ke hisaab se.
// App khud "lang" nahi bhejta (client-side hi kaam karta tha), isliye ye function
// naye "lang" field par depend karta hai — App.jsx ab har language-change par
// users/{uid}.lang sync karta hai (firestore.rules mein bhi allow kiya gaya).
// Notification copy — chhoti, motivational, emoji-wali. `n` = lead ka naam (ya morning ke
// liye ek object {name, fu, fresh}). Hinglish primary hai; jo user ne app-lang set ki hai
// wahi milti hai, warna hinglish.
const NOTIF_STR = {
  en: {
    new_lead: ['🔥 New lead is yours!', (n) => `${n} — a new lead just came in. Call now before it goes cold.`],
    reinquiry: ['🔁 Old lead came back!', (n) => `${n} re-inquired — call now or they'll go elsewhere. You can also hand them to someone else from the lead's page.`],
    first_contact: ['⏰ Still not called', (n) => `${n} is still waiting — call now before the lead goes cold 📉`],
    first_contact_sales: ['🔥 Work this qualified lead', (n) => `${n} — LDR qualified it and it's waiting on you. Call now! 💪`],
    followup_due: ['⏳ Today\'s follow-up', (n) => `You set a follow-up on ${n} for today — please connect now and keep your word ⭐`],
    assign_fail: ['⚠️ Sales not assigned', (n) => `${n} is qualified but no salesperson is active/present. Assign one yourself.`],
    sla_fresh_ldr: ['📤 Fresh lead back in pool', (n) => `${n} — not touched in time, returned to the pool`],
    sla_fresh_mgr: ['🚨 SLA breach — fresh', (n) => `${n} untouched beyond the limit`],
    sla_followup: ['😟 Follow-up missed', (n) => `${n} — the call slipped. Do it now, don't lose it`],
    sla_followup_mgr: ['🚨 SLA breach — followup', (n) => `${n} overdue`],
    morning: ['☀️ Good morning — today\'s target', (o) => {
      const b = [];
      if (o.fu) b.push(`${o.fu} scheduled follow-up${o.fu === 1 ? '' : 's'}`);
      if (o.fresh) b.push(`${o.fresh} fresh leads in the pool`);
      const line = b.length ? `Today: ${b.join(' + ')}.` : 'Nothing pending today — clean slate!';
      return `${line} Take them one call at a time — today is yours 🚀`;
    }],
    nudge: ['⏰ The day\'s not over', (o) => {
      const b = [];
      if (o.fresh) b.push(`${o.fresh} fresh`);
      if (o.fu) b.push(`${o.fu} follow-up${o.fu === 1 ? '' : 's'}`);
      const line = b.length ? `${b.join(' + ')} still pending.` : 'All clear — great work!';
      return `${line} Please connect before end of day 💪`;
    }],
    morning_mgr: ['📋 Team brief', (o) => `Today: ${o.overdue} follow-ups due across the team, ${o.freshPool} fresh leads unclaimed in the pool. Nudge where needed 👀`],
    test: ['✅ Test notification', () => 'If you can see this, push notifications are working! 🎉'],
  },
  hi: {
    new_lead: ['🔥 नई लीड आपके पास!', (n) => `${n} — नई लीड आई है, अभी कॉल करो वरना ठंडी हो जाएगी।`],
    reinquiry: ['🔁 पुरानी लीड वापस आई!', (n) => `${n} ने दोबारा एन्क्वायरी की — अभी बात करो वरना कहीं और चली जाएगी। या लीड की पेज से किसी और को दे दो।`],
    first_contact: ['⏰ अब तक कॉल नहीं', (n) => `${n} अब भी इंतज़ार में हैं — तुरंत कॉल करो वरना लीड ठंडी हो जाएगी 📉`],
    first_contact_sales: ['🔥 इस क्वालिफाइड लीड पर काम करो', (n) => `${n} — LDR ने क्वालिफाई किया, आपका इंतज़ार है। अभी कॉल! 💪`],
    followup_due: ['⏳ आज का फॉलोअप', (n) => `आपने ${n} को आज के लिए फॉलोअप में डाला था — अभी कनेक्ट करो, वादा निभाओ ⭐`],
    assign_fail: ['⚠️ सेल्स असाइन नहीं हुआ', (n) => `${n} क्वालिफाइड है पर कोई सेल्सपर्सन एक्टिव/प्रेज़ेंट नहीं। खुद असाइन करो।`],
    sla_fresh_ldr: ['📤 फ्रेश लीड पूल में वापस', (n) => `${n} — समय पर टच नहीं हुआ, पूल में वापस`],
    sla_fresh_mgr: ['🚨 SLA ब्रीच — फ्रेश', (n) => `${n} लिमिट से ज़्यादा समय से अनटच्ड`],
    sla_followup: ['😟 फॉलोअप मिस हो गया', (n) => `${n} — कॉल रह गई। अभी कर लो, लीड मत खोओ`],
    sla_followup_mgr: ['🚨 SLA ब्रीच — फॉलोअप', (n) => `${n} ओवरड्यू`],
    morning: ['☀️ गुड मॉर्निंग — आज का टारगेट', (o) => {
      const b = [];
      if (o.fu) b.push(`${o.fu} शेड्यूल्ड फॉलोअप`);
      if (o.fresh) b.push(`${o.fresh} फ्रेश लीड पूल में`);
      const line = b.length ? `आज: ${b.join(' + ')}।` : 'आज कुछ पेंडिंग नहीं — फ्रेश शुरुआत!';
      return `${line} एक-एक करके कनेक्ट करो — आज का दिन आपका है 🚀`;
    }],
    nudge: ['⏰ दिन अभी बाकी है', (o) => {
      const b = [];
      if (o.fresh) b.push(`${o.fresh} फ्रेश`);
      if (o.fu) b.push(`${o.fu} फॉलोअप`);
      const line = b.length ? `${b.join(' + ')} अभी पेंडिंग।` : 'सब क्लियर — बढ़िया!';
      return `${line} शाम होने से पहले कनेक्ट कर लो 💪`;
    }],
    morning_mgr: ['📋 टीम ब्रीफ', (o) => `आज: टीम में ${o.overdue} फॉलोअप ड्यू, पूल में ${o.freshPool} फ्रेश लीड बिना owner। ज़रूरत हो वहाँ नज़र रखें 👀`],
    test: ['✅ टेस्ट नोटिफिकेशन', () => 'अगर ये दिख रहा है, तो पुश नोटिफिकेशन काम कर रहे हैं! 🎉'],
  },
  hinglish: {
    new_lead: ['🔥 Nayi lead aapke paas!', (n) => `${n} — nayi lead aayi hai, abhi call karo warna haath se nikal jayegi.`],
    reinquiry: ['🔁 Purani lead wapas aayi!', (n) => `${n} ne dobara enquiry ki hai — abhi baat karo warna ye kahi aur chali jayegi. Ya lead ki page se kisi aur ko de do.`],
    first_contact: ['⏰ Abhi tak call nahi', (n) => `${n} abhi tak wait kar rahe hain — turant call karo warna lead thandi ho jayegi 📉`],
    first_contact_sales: ['🔥 Is qualified lead pe kaam karo', (n) => `${n} — LDR ne qualify kiya, aapka intezaar hai. Abhi call! 💪`],
    followup_due: ['⏳ Aaj ka followup', (n) => `Aapne ${n} ko aaj ke liye followup me daala tha — abhi connect karo, waada nibhao ⭐`],
    assign_fail: ['⚠️ Sales assign nahi hua', (n) => `${n} qualified hai par koi sales active/present nahi. Khud assign karo.`],
    sla_fresh_ldr: ['📤 Fresh lead pool me wapas', (n) => `${n} — time pe touch nahi hua, pool me wapas daal di`],
    sla_fresh_mgr: ['🚨 SLA breach — fresh', (n) => `${n} bahut der se untouched`],
    sla_followup: ['😟 Followup miss ho gaya', (n) => `${n} ki call reh gayi — abhi kar lo, lead mat khona`],
    sla_followup_mgr: ['🚨 SLA breach — followup', (n) => `${n} overdue ho gaya`],
    morning: ['☀️ Good morning — aaj ka target', (o) => {
      const b = [];
      if (o.fu) b.push(`${o.fu} scheduled followup`);
      if (o.fresh) b.push(`${o.fresh} fresh lead pool me`);
      const line = b.length ? `Aaj: ${b.join(' + ')}.` : 'Aaj kuch pending nahi — fresh start!';
      return `${line} Ek-ek karke connect karo — aaj ka din aapka hai 🚀`;
    }],
    nudge: ['⏰ Din abhi baaki hai', (o) => {
      const b = [];
      if (o.fresh) b.push(`${o.fresh} fresh`);
      if (o.fu) b.push(`${o.fu} followup`);
      const line = b.length ? `${b.join(' + ')} abhi pending hai.` : 'Sab clear — bahut badhiya!';
      return `${line} Shaam hone se pehle connect kar lo 💪`;
    }],
    morning_mgr: ['📋 Team brief', (o) => `Aaj: team me ${o.overdue} followup due, pool me ${o.freshPool} fresh lead bina owner. Zaroorat ho wahan nazar rakho 👀`],
    test: ['✅ Test notification', () => 'Agar ye dikh raha hai, to push notifications kaam kar rahe hain! 🎉'],
  },
};

async function notify(toUid, type, key, nameArg, leadId) {
  if (!toUid) return;
  const userSnap = await db.collection('users').doc(toUid).get();
  const lang = userSnap.data()?.lang;
  const dict = NOTIF_STR[lang] || NOTIF_STR.hinglish;
  const [title, bodyFn] = dict[key] || NOTIF_STR.hinglish[key] || [key, () => ''];
  const body = bodyFn(nameArg != null ? nameArg : '');

  await db.collection('notifications').add({
    to_uid: toUid, type, title, body, lead_id: leadId || null,
    read: false, created_at: FV.serverTimestamp(),
  });
  // Lock-screen push (FCM) — agar user ne is device pe notification allow kiya hai.
  // Token na ho ya bhejna fail ho to bhi in-app notification (upar) already ban chuki hai,
  // isliye ye best-effort hai — silently continue karta hai.
  try {
    const tokens = userSnap.data()?.fcm_tokens || [];
    console.log(`notify[${toUid}]: ${tokens.length} token(s) on file`);
    if (!tokens.length) return;
    // Sirf "data" bhejte hain, "notification" nahi — warna browser khud-ba-khud EK notification
    // dikha deta hai AUR humara apna service-worker handler ALAG SE doosri dikha deta hai (2x, duplicate).
    // "data" ke saath sirf humara onBackgroundMessage handler chalta hai — sirf ek notification.
    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        title, body, leadId: String(leadId || ''), type: String(type || ''),
      },
      webpush: { fcmOptions: { link: '/' } },
    });
    console.log(`notify[${toUid}]: fcm result — success ${resp.successCount}, failure ${resp.failureCount}`,
      JSON.stringify(resp.responses.map((r) => (r.success ? 'ok' : `${r.error?.code}: ${r.error?.message}`))));
    const dead = tokens.filter((_, i) => !resp.responses[i].success);
    if (dead.length) await db.collection('users').doc(toUid).update({ fcm_tokens: FV.arrayRemove(...dead) });
  } catch (e) {
    console.error(`notify[${toUid}]: fcm push threw (non-fatal)`, e.code || '', e.message || e);
  }
}

/** parse "30m" | "2h" | "1d" -> ms (0/blank -> 0 = rule off) */
function durMs(s) {
  const m = String(s || '').match(/^(\d+)\s*([mhd])$/);
  if (!m || +m[1] === 0) return 0;
  return +m[1] * (m[2] === 'm' ? 60000 : m[2] === 'h' ? 3600000 : 86400000);
}
async function getSettings() {
  const s = await db.doc('config/settings').get();
  return s.exists ? s.data() : {};
}
/** abhi working hours ke andar hain? */
function inWorkHours(settings) {
  const from = settings.Work_Start || '09:00';
  const to = settings.Work_End || '21:00';
  const now = new Date(Date.now() + IST);
  const hm = now.toISOString().slice(11, 16);
  return hm >= from && hm <= to;
}

function istDay(ms) { return new Date(ms + IST).toISOString().slice(0, 10); }
function dayBounds(dayStr) {
  const startUtc = Date.parse(dayStr + 'T00:00:00Z') - IST;
  return { start: TS.fromMillis(startUtc), end: TS.fromMillis(startUtc + 86400000) };
}

// ===================================================================
// DAILY AGGREGATION
// ===================================================================
async function aggregateDay(dayStr) {
  const { start, end } = dayBounds(dayStr);

  const usersSnap = await db.collection('users').get();
  const users = {};
  usersSnap.forEach((u) => { users[u.id] = u.data(); });

  const acts = await db.collection('activity').where('at', '>=', start).where('at', '<', end).get();

  const byUser = {};
  const totals = { calls: 0, qualified: 0, closed: 0, revenue: 0, lost: 0, fresh_created: 0 };
  const closedSets = {};

  acts.forEach((doc) => {
    const a = doc.data();
    const uid = a.uid || 'system';
    if (!byUser[uid]) {
      byUser[uid] = {
        name: a.actor_name || (users[uid] && users[uid].full_name) || '',
        role: (users[uid] && users[uid].role) || '',
        calls: 0, qualified: 0, closed: 0, revenue: 0, lost: 0,
      };
    }
    const u = byUser[uid];
    u.calls++; totals.calls++;
    const to = String(a.to_status || '').toLowerCase();
    if (to === 'qualified') { u.qualified++; totals.qualified++; }
    if (LOST.includes(to)) { u.lost++; totals.lost++; }
    if (a.action === 'order' || /order\s+(won|done)/i.test(to) || /order\s+(won|done)/i.test(a.remark || '')) {
      const amt = Number(a.amount) || 0;
      if (!closedSets[uid]) closedSets[uid] = new Set();
      if (!closedSets[uid].has(a.lead_id)) { closedSets[uid].add(a.lead_id); u.closed++; totals.closed++; }
      u.revenue += amt; totals.revenue += amt;
    }
  });

  // fresh leads created that day (cohort ke liye by_source / by_customer_type)
  const fresh = await db.collection('leads')
    .where('created_at', '>=', start).where('created_at', '<', end).get();
  totals.fresh_created = fresh.size;
  const cohort = { by_source: {}, by_customer_type: {} };
  fresh.forEach((doc) => {
    const l = doc.data();
    const s = l.source || 'Unknown';
    const c = l.f_customer_type || 'Unknown';
    cohort.by_source[s] = (cohort.by_source[s] || 0) + 1;
    cohort.by_customer_type[c] = (cohort.by_customer_type[c] || 0) + 1;
  });

  // ---------------------------------------------------------------
  // REPORTS — wahi 3 sawaal jo dashboard par roz chahiye. Ye yahin (raat mein, ek baar,
  // server par) nikal kar store ho jaate hain, taaki har user ka dashboard 20+ queries
  // ki jagah sirf 1 doc padhe. Sab kuch upar already-fetched `acts` aur `fresh` se
  // banta hai — sirf followup-due ke liye ek chhoti extra query lagti hai.
  // ---------------------------------------------------------------
  const st = (l) => String(l.sales_status || l.status || '').toLowerCase() || 'untouched';
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  // Har report teen buckets mein — all / ldr / sales — taaki dashboard ka team-filter bhi
  // inhi pre-computed numbers se chal jaaye aur live query ki zaroorat na pade.
  //
  // Do alag semantics, jaan-boojh kar:
  //  - teamsOf()      = ABHI kiska kaam hai (followups/re-inquiry ke liye — lead sales ko de
  //                     di gayi to followup sales ka hai, LDR ka nahi)
  //  - teamsOfTouch() = kis-kis ne ISE HANDLE kiya (nayi leads ke liye — LDR ne banayi aur
  //                     sales ko di, to dono ke report mein ginni chahiye. Warna LDR ko apni
  //                     hi banayi 9 leads "0" dikhti thi, jo bilkul galat message deta.)
  const teamsOf = (l) => (l.sales_uid ? ['all', 'sales'] : l.ldr_uid ? ['all', 'ldr'] : ['all']);
  const teamsOfTouch = (l) => {
    const t = ['all'];
    if (l.ldr_uid) t.push('ldr');
    if (l.sales_uid) t.push('sales');
    return t;
  };
  const mk = () => ({
    fresh: { total: 0, worked: 0, by_status: {}, by_source: {}, by_source_qualified: {} },
    reinquiry: { total: 0, worked: 0, pending: 0, by_status: {} },
    followups: { due: 0, done: 0, pending: 0, by_status: {}, exact: true },
  });
  const rep = { all: mk(), ldr: mk(), sales: mk() };

  // A) Us din aayi leads — kitni par kaam hua, ab kis status par hain, kis source se.
  //    by_source/by_source_qualified = ad-ROI report (cost per lead / per qualified lead) ke liye.
  fresh.forEach((doc) => {
    const l = doc.data();
    const touched = l.last_action_at && l.last_action_at.toMillis() >= start.toMillis();
    const src = l.source || 'Unknown';
    const isQ = String(l.sales_status || l.status || '').toLowerCase() === 'qualified' || !!l.sales_uid;
    teamsOfTouch(l).forEach((tm) => {
      rep[tm].fresh.total++;
      if (touched) rep[tm].fresh.worked++;
      bump(rep[tm].fresh.by_status, st(l));
      bump(rep[tm].fresh.by_source, src);
      if (isQ) bump(rep[tm].fresh.by_source_qualified, src);
    });
  });

  // B) Re-inquiry — us din jo leads dobara enquiry mein aayin (activity se pata chalta hai),
  //    unka abhi kya status hai.
  //    worked/pending SIRF activity se nikaalte hain (lead doc ki zaroorat nahi) — kyunki agar
  //    lead beech mein delete/recycle ho gayi to lead-fetch usse chhod deta tha aur
  //    total ≠ worked+pending ho jaata tha (test mein yahi pakda: total 1, worked+pending 0).
  const urgentIds = [...new Set(acts.docs.filter((d) => d.data().action === 'urgent').map((d) => d.data().lead_id))];
  const urgentLeads = {};
  for (let i = 0; i < urgentIds.length; i += 30) {
    const chunk = urgentIds.slice(i, i + 30);
    const snap = await db.collection('leads').where(FieldPath.documentId(), 'in', chunk).get();
    snap.forEach((doc) => { urgentLeads[doc.id] = doc.data(); });
  }
  urgentIds.forEach((id) => {
    const acted = acts.docs.some((a) => a.data().lead_id === id && a.data().action !== 'urgent');
    const l = urgentLeads[id];
    // lead delete/recycle ho chuki ho to bhi event ginte hain (sirf 'all' mein), warna
    // total aur worked+pending mismatch ho jaate the
    (l ? teamsOf(l) : ['all']).forEach((tm) => {
      rep[tm].reinquiry.total++;
      if (acted) rep[tm].reinquiry.worked++; else rep[tm].reinquiry.pending++;
      if (l) bump(rep[tm].reinquiry.by_status, st(l));
    });
  });

  // C) Followups — us din kitne DUE the, kitne hue, kitne pending
  //    "hue" = us din ki activity jisme was_due_for usi din ka tha (isi liye wo field add kiya).
  //    "pending" = wo leads jinki next_followup abhi bhi usi din par atki hai (action hota to
  //    date aage khisak jaati, isliye jo bachi hain wahi pending hain).
  const doneSeen = {};
  let sawDueField = false;
  acts.forEach((doc) => {
    const a = doc.data();
    const wd = a.was_due_for;
    if (wd) sawDueField = true;
    if (wd && wd.toMillis() >= start.toMillis() && wd.toMillis() < end.toMillis()) {
      if (doneSeen[a.lead_id]) return;
      doneSeen[a.lead_id] = true;
      // activity par team ka field nahi hota — actor ke role se team nikalte hain
      const role = (users[a.uid] && users[a.uid].role) || '';
      const tms = role === 'sales' ? ['all', 'sales'] : role === 'ldr' ? ['all', 'ldr'] : ['all'];
      tms.forEach((tm) => {
        rep[tm].followups.done++;
        bump(rep[tm].followups.by_status, String(a.to_status || '').toLowerCase() || 'unknown');
      });
    }
  });
  const stillDue = await db.collection('leads')
    .where('next_followup', '>=', start).where('next_followup', '<', end).get();
  stillDue.forEach((doc) => teamsOf(doc.data()).forEach((tm) => { rep[tm].followups.pending++; }));
  ['all', 'ldr', 'sales'].forEach((tm) => {
    rep[tm].followups.due = rep[tm].followups.done + rep[tm].followups.pending;
  });
  // `was_due_for` field 6-Sep-2026 se add hua hai. Usse pehle ke dinon ke liye "kitne followup
  // HUE" nikalna namumkin hai (action hote hi purani due-date overwrite ho jaati thi, kahin
  // store nahi hoti thi) — isliye us din ka data adhoora mark karte hain, taaki dashboard
  // galat "0 hue" na dikhaye balki saaf bataye ki purana record maujood nahi hai.
  if (acts.size > 0 && !sawDueField) {
    ['all', 'ldr', 'sales'].forEach((tm) => { rep[tm].followups.exact = false; });
  }

  // ---------------------------------------------------------------
  // DASH — per-person dashboard buckets (Fresh / Re-Inquiry / Scheduled / Off-Schedule).
  // Client `TeamDashboard` in-din-ke docs ko range ke liye JOD leta hai — LIVE activity query
  // NAHI karta (roz ~4000 reads bachte hain). Semantics client ke lib/dashboardStats.js se
  // EXACTLY match karni chahiye — dono jagah saath badalna.  [[dash-preagg-dual-copy]]
  // ---------------------------------------------------------------
  const CLOSED_ST = ['order done', 'order won', 'lost', 'dead', 'not interested'];
  // hits = { leadId: kitni baar us din touch/call hua }  (worked leads — "All contacts" count)
  // wst  = { leadId: us din ke end ka status }            (byStatus range me exact rakhne ke liye)
  // pids = [leadId]  (pending — jinpe us din kaam nahi hua)   [[dash-preagg-dual-copy]]
  const mkB = () => ({ total: 0, pending: 0, by: {}, hits: {}, wst: {}, pids: [] });
  const dash = {};
  const dU = (uid) => (dash[uid] || (dash[uid] = { fresh: mkB(), reinq: mkB(), sched: mkB(), offsched: mkB() }));
  const roleOf = (uid) => (users[uid] && users[uid].role) || '';
  const isSalesU = (uid) => roleOf(uid) === 'sales';
  const stOf = (uid, l) => {
    const s = isSalesU(uid) ? String(l.sales_status || '').toLowerCase().trim() : String(l.status || '').toLowerCase().trim();
    return s || 'other';
  };
  const isClosedL = (uid, l) => {
    const s = stOf(uid, l);
    return CLOSED_ST.includes(s) || ['dead', 'lost'].includes(String(l.status || '').toLowerCase().trim());
  };
  const inDay = (ts) => ts && ts.toMillis && ts.toMillis() >= start.toMillis() && ts.toMillis() < end.toMillis();
  const addTeam = (uid, bucket, lead, opts) => {
    const tm = isSalesU(uid) ? '_sales' : roleOf(uid) === 'ldr' ? '_ldr' : null;
    if (!tm) return;
    if (!dash[tm]) dash[tm] = { fresh: mkB(), reinq: mkB(), sched: mkB(), offsched: mkB() };
    applyBucket(dash[tm][bucket], stOf(uid, lead), opts);
  };
  function applyBucket(b, s, { pending, leadId, touches = 0 }) {
    const pend = pending || s === 'other'; // blank/na-set stage = abhi kaam baaki (pending), status-bucket nahi
    b.total++;
    if (pend) {
      b.pending++;
      if (leadId && b.pids.length < 6000) b.pids.push(leadId);
    } else {
      b.by[s] = (b.by[s] || 0) + 1;
      if (leadId && Object.keys(b.hits).length < 6000) {
        b.hits[leadId] = (b.hits[leadId] || 0) + Math.max(1, touches);
        b.wst[leadId] = s;
      }
    }
  }

  // scheduled_for activity us din ke liye — kis lead ka followup IS din ke liye set hua tha
  const schedForSnap = await db.collection('activity')
    .where('scheduled_for', '>=', start).where('scheduled_for', '<', end).get();
  const schedUidByLead = {};
  schedForSnap.forEach((doc) => {
    const a = doc.data();
    if (!a.lead_id || !a.uid) return;
    (schedUidByLead[a.lead_id] = schedUidByLead[a.lead_id] || new Set()).add(a.uid);
  });
  // touched + due-touched by uid (aaj ki activity se) + per-lead touch count
  const touchedByUid = {}; const dueByUid = {}; const touchCntByUid = {};
  acts.forEach((doc) => {
    const a = doc.data();
    if (!a.lead_id || !a.uid) return;
    (touchedByUid[a.uid] = touchedByUid[a.uid] || new Set()).add(a.lead_id);
    const m = (touchCntByUid[a.uid] = touchCntByUid[a.uid] || {});
    m[a.lead_id] = (m[a.lead_id] || 0) + 1;
    if (inDay(a.was_due_for)) (dueByUid[a.uid] = dueByUid[a.uid] || new Set()).add(a.lead_id);
  });
  const tc = (uid, lid) => (touchCntByUid[uid] && touchCntByUid[uid][lid]) || 0;

  // (1) FRESH — us din bani leads, owner ke hisaab se
  fresh.forEach((doc) => {
    const l = doc.data();
    [l.ldr_uid, l.sales_uid].forEach((uid) => {
      if (!uid || !roleOf(uid)) return;
      const s = stOf(uid, l);
      const salesUntouched = isSalesU(uid) && ['', 'qualified', 'fresh', 'new'].includes(s);
      const pending = salesUntouched || ['fresh', 'new', ''].includes(s);
      const o = { pending, leadId: doc.id, touches: tc(uid, doc.id) };
      applyBucket(dU(uid).fresh, s, o);
      addTeam(uid, 'fresh', l, o);
    });
  });

  // (2) RE-INQUIRY — us din urgent hui leads (upar `urgentLeads` fetch ho chuki)
  urgentIds.forEach((id) => {
    const l = urgentLeads[id];
    if (!l) return;
    const acted = acts.docs.some((a) => a.data().lead_id === id && a.data().action !== 'urgent');
    [l.ldr_uid, l.sales_uid].forEach((uid) => {
      if (!uid || !roleOf(uid)) return;
      const s = stOf(uid, l);
      const pending = !acted || ['fresh', 'new', ''].includes(s);
      const o = { pending, leadId: id, touches: tc(uid, id) };
      applyBucket(dU(uid).reinq, s, o);
      addTeam(uid, 'reinq', l, o);
    });
  });

  // (3+4) SCHEDULED + OFF-SCHEDULE — jin leads ko touch kiya YA jinka followup is din ke liye tha.
  //   scheduled = schedFor-is-din OR was_due-is-din OR next_followup-is-din
  //   offsched  = touch hui, par na scheduled na fresh-is-din
  const freshIdSet = new Set(fresh.docs.map((d) => d.id));
  const stillDueByLead = {};
  stillDue.forEach((doc) => { stillDueByLead[doc.id] = true; });
  const relevantLeadIds = new Set();
  Object.values(touchedByUid).forEach((set) => set.forEach((id) => relevantLeadIds.add(id)));
  Object.keys(schedUidByLead).forEach((id) => relevantLeadIds.add(id));
  stillDue.forEach((doc) => relevantLeadIds.add(doc.id));
  const relArr = [...relevantLeadIds];
  const relLeads = {};
  for (let i = 0; i < relArr.length; i += 30) {
    const snap = await db.collection('leads').where(FieldPath.documentId(), 'in', relArr.slice(i, i + 30)).get();
    snap.forEach((doc) => { relLeads[doc.id] = doc.data(); });
  }
  const allWorkers = usersSnap.docs.filter((u) => ['ldr', 'sales'].includes(u.data().role)).map((u) => u.id);
  for (const uid of allWorkers) {
    const tset = touchedByUid[uid] || new Set();
    const dset = dueByUid[uid] || new Set();
    // is uid ke liye relevant leads: usne touch kiye + usne is din ke liye schedule kiye + uski due-today leads
    const cand = new Set([...tset]);
    Object.entries(schedUidByLead).forEach(([lid, us]) => { if (us.has(uid)) cand.add(lid); });
    for (const lid of cand) {
      const l = relLeads[lid];
      if (!l) continue;
      // ownership check — lead is uid ki honi chahiye (ya usne touch ki)
      const owns = (isSalesU(uid) ? l.sales_uid === uid : l.ldr_uid === uid) || tset.has(lid);
      if (!owns) continue;
      const schForThis = (schedUidByLead[lid] && schedUidByLead[lid].has(uid)) || dset.has(lid) || inDay(l.next_followup);
      const freshToday = freshIdSet.has(lid);
      const closed = isClosedL(uid, l);
      const s = stOf(uid, l);
      if (schForThis) {
        const pending = !tset.has(lid) && !closed;
        const o = { pending, leadId: lid, touches: tc(uid, lid) };
        applyBucket(dU(uid).sched, s, o);
        addTeam(uid, 'sched', l, o);
      } else if (tset.has(lid) && !freshToday) {
        const pending = !closed;
        const o = { pending, leadId: lid, touches: tc(uid, lid) };
        applyBucket(dU(uid).offsched, s, o);
        addTeam(uid, 'offsched', l, o);
      }
    }
  }

  await db.doc(`stats_daily/${dayStr}`).set({
    date: dayStr, computed_at: FV.serverTimestamp(), totals, by_user: byUser,
    reports: rep.all, reports_by_team: { ldr: rep.ldr, sales: rep.sales },
    dash,
  });

  return { dayStr, totals, cohort, byUser };
}

// ===================================================================
// COHORT (monthly rollup) — is mahine ke daily docs se recompute
// ===================================================================
async function refreshCohort(month) {
  const snap = await db.collection('stats_daily')
    .where('date', '>=', month + '-01').where('date', '<', month + '-32').get();

  const by_source = {}, by_customer_type = {};
  let revenue = 0, closed = 0, qualified = 0, fresh = 0, calls = 0;

  // by_source/customer_type: har daily doc ko dobara scan nahi kar sakte (wo cohort inc store nahi hota).
  // Isliye month ke fresh leads directly query karte hain (chhota — ek mahine ke).
  const { start } = dayBounds(month + '-01');
  const nextMonth = new Date(Date.parse(month + '-01T00:00:00Z'));
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const end = TS.fromMillis(nextMonth.getTime() - IST);

  const fl = await db.collection('leads').where('created_at', '>=', start).where('created_at', '<', end).get();
  fresh = fl.size;
  fl.forEach((d) => {
    const l = d.data();
    const s = l.source || 'Unknown', c = l.f_customer_type || 'Unknown';
    by_source[s] = (by_source[s] || 0) + 1;
    by_customer_type[c] = (by_customer_type[c] || 0) + 1;
  });

  snap.forEach((d) => {
    const t = d.data().totals || {};
    revenue += t.revenue || 0; closed += t.closed || 0;
    qualified += t.qualified || 0; calls += t.calls || 0;
  });

  await db.doc(`stats_cohort/${month}`).set({
    month, computed_at: FV.serverTimestamp(),
    totals: { revenue, closed, qualified, fresh, calls },
    by_source, by_customer_type,
  });
  return { month, revenue, closed };
}

// ===================================================================
// WEEKLY PERFORMANCE REPORT
// ===================================================================
function lastNDays(n, backFrom) {
  const out = [];
  for (let i = backFrom; i < backFrom + n; i++) out.push(istDay(Date.now() - i * 86400000));
  return out;
}

// ---- Week model (MIRROR of app/src/lib/weeks.js) — business week = Tue → Sun,
//      numbered from Jan 1. Data window = [Tue, next Mon] (7 days). ----
const wkNoon = (day) => new Date(`${day}T12:00:00+05:30`);
const wkIso = (dt) => dt.toISOString().slice(0, 10);
const wkDow = (day) => wkNoon(day).getUTCDay();
const wkAdd = (day, k) => { const d = wkNoon(day); d.setUTCDate(d.getUTCDate() + k); return wkIso(d); };
function wkAnchors(year) {
  const jan1 = `${year}-01-01`;
  const w1Start = wkDow(jan1) === 1 ? wkAdd(jan1, 1) : jan1;
  let firstTue = w1Start;
  while (wkDow(firstTue) !== 2) firstTue = wkAdd(firstTue, 1);
  if (firstTue === w1Start) firstTue = wkAdd(w1Start, 7);
  return { w1Start, firstTue };
}
function wkNumFor(day, year) {
  const { w1Start, firstTue } = wkAnchors(year);
  if (day < w1Start) return null;
  if (day < firstTue) return 1;
  const diff = Math.round((wkNoon(day) - wkNoon(firstTue)) / 86400000);
  return 2 + Math.floor(diff / 7);
}
function wkMaxOfYear(year) { return wkNumFor(`${year}-12-31`, year) || 52; }
function weekRange(num, year) {
  const { w1Start, firstTue } = wkAnchors(year);
  const start = num <= 1 ? w1Start : wkAdd(firstTue, (num - 2) * 7);
  const dataEnd = num <= 1 ? wkAdd(firstTue, -1) : wkAdd(start, 6);
  const d = wkDow(dataEnd);
  const end = d === 0 ? dataEnd : wkAdd(dataEnd, -d);
  const days = [];
  for (let x = start; x <= dataEnd; x = wkAdd(x, 1)) days.push(x);
  return { num, year, start, end, dataEnd, days };
}
function latestCompleteWeek() {
  const refDay = istDay(Date.now());
  let year = Number(refDay.slice(0, 4));
  let n = wkNumFor(refDay, year) || 1;
  let r = weekRange(n, year);
  while (r.end >= refDay) {
    if (n > 1) n -= 1; else { year -= 1; n = wkMaxOfYear(year); }
    r = weekRange(n, year);
  }
  return r;
}
const weekDocId = (r) => `${r.year}-W${String(r.num).padStart(2, '0')}`;

async function sumDays(days) {
  const refs = days.map((d) => db.doc(`stats_daily/${d}`));
  const snaps = await db.getAll(...refs);
  const byUser = {};
  const totals = { calls: 0, qualified: 0, closed: 0, revenue: 0 };
  snaps.forEach((s) => {
    if (!s.exists) return;
    const d = s.data();
    for (const k of ['calls', 'qualified', 'closed', 'revenue']) totals[k] += (d.totals && d.totals[k]) || 0;
    for (const [uid, u] of Object.entries(d.by_user || {})) {
      if (!byUser[uid]) byUser[uid] = { name: u.name, role: u.role, calls: 0, qualified: 0, closed: 0, revenue: 0 };
      byUser[uid].calls += u.calls || 0;
      byUser[uid].qualified += u.qualified || 0;
      byUser[uid].closed += u.closed || 0;
      byUser[uid].revenue += u.revenue || 0;
      if (u.name) byUser[uid].name = u.name;
      if (u.role) byUser[uid].role = u.role;
    }
  });
  return { byUser, totals };
}

async function overdueByUser() {
  const usersSnap = await db.collection('users').where('status', '==', 'active').get();
  const now = TS.now();
  const res = {};
  for (const u of usersSnap.docs) {
    const role = u.data().role;
    const field = role === 'sales' ? 'sales_uid' : 'ldr_uid';
    try {
      const c = await db.collection('leads')
        .where(field, '==', u.id).where('next_followup', '<', now).count().get();
      res[u.id] = c.data().count;
    } catch { res[u.id] = 0; }
  }
  return res;
}

function trend(now, prev) {
  if (prev === 0) return now > 0 ? 'up' : 'flat';
  const ch = (now - prev) / prev;
  return ch > 0.1 ? 'up' : ch < -0.1 ? 'down' : 'flat';
}

/** Gmail App Password se transporter banata hai — configure na ho to null (silent skip, error nahi). */
async function getMailTransport() {
  const settings = await getSettings();
  const email = settings.Report_Email;
  if (!email) return null;
  const secretSnap = await db.doc('config/mail_secret').get();
  const appPassword = secretSnap.exists ? secretSnap.data().app_password : null;
  if (!appPassword) return null;
  return { transporter: nodemailer.createTransport({ service: 'gmail', auth: { user: email, pass: appPassword } }), email };
}

/* ─────────────────────────  EMAIL TEMPLATE  ─────────────────────────
   Sab outgoing emails ek hi branded shell use karti hain. Email clients
   (Gmail/Outlook) modern CSS support nahi karte — isliye table layout +
   inline styles, max 600px, logo paris-crm.web.app se. */
const MAIL_APP_URL = 'https://paris-crm.web.app';
const MAIL_LOGO = MAIL_APP_URL + '/icon-192.png';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escBr = (s) => esc(s).replace(/\r?\n/g, '<br>');

/** Branded HTML email. bodyHtml = ready-made inner HTML (use the mb* helpers). */
function emailShell({ heading, preheader, bodyHtml, cta }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#eef2f7;">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(preheader || heading)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(16,34,59,.10);">
  <tr><td style="background:#001f3f;background:linear-gradient(135deg,#001f3f,#003a6b);padding:20px 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:12px;vertical-align:middle;">
        <img src="${MAIL_LOGO}" width="40" height="40" alt="Paris Fashion" style="display:block;border-radius:9px;background:#fff;">
      </td>
      <td style="vertical-align:middle;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.3px;">Paris Fashion CRM</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:26px 28px 0;">
    <h1 style="margin:0;font-size:19px;line-height:1.35;color:#0f1e36;">${esc(heading)}</h1>
  </td></tr>
  <tr><td style="padding:14px 28px 4px;color:#3a4a63;font-size:14px;line-height:1.62;">${bodyHtml}</td></tr>
  ${cta ? `<tr><td style="padding:20px 28px 30px;">
    <a href="${esc(cta.url)}" style="display:inline-block;background:#0074d9;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 24px;border-radius:8px;">${esc(cta.text)}</a>
  </td></tr>` : '<tr><td style="height:22px;"></td></tr>'}
  <tr><td style="background:#f7f9fc;border-top:1px solid #e7edf4;padding:16px 28px;color:#8a97a8;font-size:11.5px;line-height:1.65;">
    Paris Fashion Delhi &middot; CRM ke andar se bheja gaya automated email.<br>
    Is inbox par reply na karein — action ke liye CRM kholein.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* small building blocks for email bodies */
const mbP = (html) => `<p style="margin:0 0 12px;">${html}</p>`;
const mbKV = (label, value) =>
  `<p style="margin:0 0 8px;"><span style="color:#8a97a8;font-size:12px;text-transform:uppercase;letter-spacing:.4px;">${esc(label)}</span><br><span style="color:#1d2c45;font-size:14px;font-weight:600;">${value}</span></p>`;
const mbQuote = (html) =>
  `<div style="border-left:3px solid #0074d9;background:#f4f8fd;border-radius:0 8px 8px 0;padding:11px 14px;margin:4px 0 14px;color:#3a4a63;font-size:13.5px;line-height:1.6;">${html}</div>`;
const mbMuted = (html) => `<p style="margin:10px 0 0;color:#8a97a8;font-size:12.5px;">${html}</p>`;

function weeklyEmailHtml(report) {
  const fm = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;
  const td = 'padding:9px 10px;border-bottom:1px solid #edf1f6;font-size:13px;';
  const th = 'padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#5a6b82;text-align:right;';
  const rows = (report.people || []).map((p, i) => `
    <tr style="background:${i % 2 ? '#fbfcfe' : '#ffffff'};">
      <td style="${td}"><span style="display:inline-block;min-width:20px;color:#8a97a8;">#${p.rank}</span> <b style="color:#1d2c45;">${esc(p.name)}</b></td>
      <td style="${td}text-align:right;">${p.calls}</td>
      <td style="${td}text-align:right;">${p.closed}</td>
      <td style="${td}text-align:right;">${p.conv_pct}%</td>
      <td style="${td}text-align:right;font-weight:600;color:#0f7a3d;">${fm(p.revenue)}</td>
    </tr>
    ${(p.insights || []).length ? `<tr style="background:${i % 2 ? '#fbfcfe' : '#ffffff'};"><td colspan="5" style="padding:0 10px 10px;color:#6b7a8d;font-size:12px;line-height:1.55;">${(p.insights || []).map((x) => '&bull; ' + esc(x.text)).join('<br>')}</td></tr>` : ''}`).join('');

  const body = mbP(`Week <b>${esc(report.week_start)}</b> se <b>${esc(report.week_end)}</b> tak ka team summary.`)
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 16px;">
       <tr>
         <td width="33%" style="background:#f4f8fd;border-radius:10px;padding:12px 14px;">
           <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#5a6b82;">Calls</div>
           <div style="font-size:20px;font-weight:700;color:#0f1e36;">${report.team?.calls || 0}</div></td>
         <td width="10">&nbsp;</td>
         <td width="33%" style="background:#f4f8fd;border-radius:10px;padding:12px 14px;">
           <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#5a6b82;">Orders</div>
           <div style="font-size:20px;font-weight:700;color:#0f1e36;">${report.team?.closed || 0}</div></td>
         <td width="10">&nbsp;</td>
         <td width="33%" style="background:#f4f8fd;border-radius:10px;padding:12px 14px;">
           <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#5a6b82;">Revenue</div>
           <div style="font-size:18px;font-weight:700;color:#0f7a3d;">${fm(report.team?.revenue)}</div></td>
       </tr></table>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e7edf4;border-radius:10px;overflow:hidden;">
        <thead><tr style="background:#f2f6fb;">
          <th style="${th}text-align:left;">Name</th><th style="${th}">Calls</th>
          <th style="${th}">Closed</th><th style="${th}">Conv%</th><th style="${th}">Revenue</th>
        </tr></thead><tbody>${rows}</tbody></table>`;

  return emailShell({
    heading: 'Weekly Report — Week ' + (report.week_num || '') + ' / ' + (report.year || ''),
    preheader: `Team: ${report.team?.calls || 0} calls, ${report.team?.closed || 0} orders, ${fm(report.team?.revenue)}`,
    bodyHtml: body,
    cta: { text: 'Open Reports', url: MAIL_APP_URL + '/' },
  });
}

async function sendWeeklyEmail(report) {
  try {
    const mail = await getMailTransport();
    if (!mail) { console.log('weekly email skipped — not configured'); return { sent: false, reason: 'not-configured' }; }
    const admins = (await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get())
      .docs.map((d) => d.data().email).filter(Boolean);
    if (!admins.length) return { sent: false, reason: 'no-admin-email' };
    await mail.transporter.sendMail({
      from: `"Paris CRM" <${mail.email}>`,
      to: admins.join(','),
      subject: `Paris CRM Weekly Report — ${report.week_start} to ${report.week_end}`,
      html: weeklyEmailHtml(report),
    });
    console.log('weekly email sent to', admins.join(', '));
    return { sent: true, to: admins };
  } catch (e) {
    console.error('weekly email failed (non-fatal)', e.message || e);
    return { sent: false, reason: e.message || String(e) };
  }
}

async function buildWeekly(opts = {}) {
  const wk = (opts.week_num && Number(opts.week_num) >= 1)
    ? weekRange(Number(opts.week_num), Number(opts.year) || Number(istDay(Date.now()).slice(0, 4)))
    : latestCompleteWeek();
  const prev = wk.num > 1
    ? weekRange(wk.num - 1, wk.year)
    : weekRange(wkMaxOfYear(wk.year - 1), wk.year - 1);

  const thisW = await sumDays(wk.days);
  const lastW = await sumDays(prev.days);
  const overdue = await overdueByUser();

  const uids = Object.keys(thisW.byUser).filter((u) => u !== 'system' && u !== 'import');
  const activeUids = uids.filter((u) => thisW.byUser[u].role === 'sales' || thisW.byUser[u].role === 'ldr');
  const teamCalls = activeUids.reduce((s, u) => s + thisW.byUser[u].calls, 0);
  const teamAvgCalls = activeUids.length ? teamCalls / activeUids.length : 0;
  const maxRev = Math.max(0, ...activeUids.map((u) => thisW.byUser[u].revenue));

  const people = activeUids.map((uid) => {
    const c = thisW.byUser[uid];
    const p = lastW.byUser[uid] || { calls: 0, qualified: 0, closed: 0, revenue: 0 };
    const conv = c.calls ? (c.closed / c.calls) * 100 : 0;
    const prevConv = p.calls ? (p.closed / p.calls) * 100 : 0;
    const od = overdue[uid] || 0;
    const insights = [];
    if (prevConv >= 5 && conv < prevConv * 0.6) insights.push({ type: 'warn', text: `Conversion ${prevConv.toFixed(0)}% → ${conv.toFixed(0)}%, gir rahi hai` });
    if (c.calls > 0 && c.calls < teamAvgCalls * 0.5) insights.push({ type: 'warn', text: `Sirf ${c.calls} calls (team avg ${teamAvgCalls.toFixed(0)}) — activity kam` });
    if (c.calls === 0) insights.push({ type: 'warn', text: 'Is hafte 0 activity' });
    if (od >= 20) insights.push({ type: 'warn', text: `${od} leads overdue — backlog clear karo` });
    if (c.revenue > 0 && c.revenue === maxRev) insights.push({ type: 'good', text: `Best closer — ₹${c.revenue.toLocaleString('en-IN')}, ${c.closed} orders` });
    if (conv > prevConv * 1.3 && conv > 8) insights.push({ type: 'good', text: `Conversion improve — ${prevConv.toFixed(0)}% → ${conv.toFixed(0)}%` });
    return {
      uid, name: c.name, role: c.role,
      calls: c.calls, qualified: c.qualified, closed: c.closed, revenue: c.revenue,
      conv_pct: Number(conv.toFixed(1)), overdue: od,
      vs_last: {
        calls: trend(c.calls, p.calls), closed: trend(c.closed, p.closed),
        revenue: trend(c.revenue, p.revenue), conv: trend(conv, prevConv),
      },
      insights,
    };
  }).sort((a, b) => b.revenue - a.revenue || b.closed - a.closed);

  people.forEach((p, i) => { p.rank = i + 1; });

  // pipeline health
  let freshUnworked = 0, funnel = {};
  try {
    freshUnworked = (await db.collection('leads').where('status', 'in', ['fresh', 'new']).count().get()).data().count;
  } catch { freshUnworked = 0; }

  const id = weekDocId(wk);
  const reportDoc = {
    id, week_num: wk.num, year: wk.year,
    week_start: wk.start, week_end: wk.end,        // Tue, Sun (display)
    data_from: wk.days[0], data_to: wk.dataEnd,    // actual aggregation window
    prev_id: weekDocId(prev),
    computed_at: FV.serverTimestamp(),
    team: thisW.totals, team_prev: lastW.totals,
    people,
    pipeline: { fresh_unworked: freshUnworked, funnel },
  };
  await db.doc(`reports_weekly/${id}`).set(reportDoc);
  const emailResult = await sendWeeklyEmail(reportDoc);
  return { id, week_num: wk.num, year: wk.year, people: people.length, email: emailResult };
}

// ===================================================================
// SCHEDULES
// ===================================================================
// aggregateYesterday + refreshCohortMonth + purgeRecycle — ye teeno pehle 3 alag Cloud Scheduler
// jobs the (1am/1:30am/3am). Google sirf 3 job/account free deta hai, hum 5 use kar rahe the (+slaScan,
// +weeklyReport) — 2 extra job ka ~₹17/month recurring lagta tha. Teeno roz-raat-wale maintenance kaam
// hain, ek hi function mein same tarteeb se chalte hain — behavior bilkul same, sirf 1 scheduler job kam.
exports.dailyMaintenance = onSchedule({ schedule: '0 1 * * *', timeZone: 'Asia/Kolkata' }, async () => {
  // pichhle 5 din DOBARA aggregate karo — jin leads ka status baad me badla (fresh -> lost) un dino
  // ka `dash` bhi current rahe. 5 din × ~2.5k reads = ~12k, ek baar raat me. Isse purane din
  // "frozen" (status change reflect nahi hoga) — 5 din se purani lead ka status shayad hi badalta.
  for (let d = 5; d >= 0; d--) {
    // eslint-disable-next-line no-await-in-loop
    await aggregateDay(istDay(Date.now() - d * 86400000));
  }
  await refreshCohort(istDay(Date.now()).slice(0, 7));

  const cutoff = TS.fromMillis(Date.now() - 30 * 86400000);
  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection('recycle').where('deleted_at', '<', cutoff).limit(400).get();
    if (snap.empty) break;
    const b = db.batch();
    snap.forEach((d) => b.delete(d.ref));
    await b.commit();
    n += snap.size;
    if (snap.size < 400) break;
  }
  console.log('purged', n);
});

exports.weeklyReport = onSchedule({ schedule: '0 4 * * 1', timeZone: 'Asia/Kolkata' }, async () => {
  await buildWeekly();
});

// ===================================================================
// ADMIN TASK RUNNER — app `admin_tasks/{id}` doc likhta hai (status:'pending'),
// ye function DB-event se trigger hota hai. Callable ki jagah (org allUsers-invoker block karta hai).
// ===================================================================
async function doBackfill(from, to, onProgress) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('from=YYYY-MM-DD chahiye');
  const start = Date.parse(from + 'T00:00:00Z');
  const endMs = Date.parse((to || istDay(Date.now())) + 'T00:00:00Z');
  const total = Math.floor((endMs - start) / 86400000) + 1;
  const months = new Set();
  let days = 0;
  for (let cur = start; cur <= endMs; cur += 86400000) {
    const dstr = new Date(cur).toISOString().slice(0, 10);
    await aggregateDay(dstr);
    months.add(dstr.slice(0, 7));
    days++;
    if (onProgress && (days % 10 === 0 || days === total)) await onProgress(days, total);
  }
  for (const m of months) await refreshCohort(m);
  return { days, months: [...months] };
}

async function rescoreAll(onProgress) {
  let last = null, done = 0;
  const totalSnap = await db.collection('leads').count().get();
  const total = totalSnap.data().count;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db.collection('leads').orderBy('__name__').limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const b = db.batch();
    snap.docs.forEach((d) => {
      const { score, tier } = scoreLead(d.data());
      b.update(d.ref, { score, tier });
    });
    await b.commit();
    done += snap.size;
    last = snap.docs[snap.docs.length - 1];
    if (onProgress) await onProgress(done, total);
    if (snap.size < 400) break;
  }
  return { done, total };
}

exports.adminTask = onDocumentWritten('admin_tasks/{taskId}', async (event) => {
  const after = event.data && event.data.after && event.data.after.data();
  if (!after || after.status !== 'pending') return;
  const ref = event.data.after.ref;
  const id = event.params.taskId;
  const progress = (done, total) => ref.set({ progress: { done, total } }, { merge: true });
  try {
    await ref.set({ status: 'running', started_at: FV.serverTimestamp() }, { merge: true });
    let result;
    if (id === 'backfill') result = await doBackfill(String(after.from || ''), String(after.to || ''), progress);
    else if (id === 'agg_today') { const dstr = istDay(Date.now()); await aggregateDay(dstr); await db.doc('meta/notify_state').set({ today_agg_at: Date.now() }, { merge: true }); result = { day: dstr }; }
    else if (id === 'weekly') result = await buildWeekly({ week_num: after.week_num, year: after.year });
    else if (id === 'rescore') result = await rescoreAll(progress);
    else if (id === 'test_push') {
      if (!after.target_uid) throw new Error('no target_uid');
      await notify(after.target_uid, 'test', 'test', '', null);
      result = { sent: true };
    }
    else if (id === 'user_email') {
      // Login email badlo — Firebase Auth + users/{uid} doc dono (client SDK ye nahi kar sakta).
      const uid = String(after.target_uid || '');
      const email = String(after.new_email || '').trim().toLowerCase();
      if (!uid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('valid uid + new_email chahiye');
      await admin.auth().updateUser(uid, { email, emailVerified: false });
      await db.doc('users/' + uid).set({ email, updated_at: FV.serverTimestamp() }, { merge: true });
      result = { uid, email };
    }
    else if (id === 'user_delete') {
      const uid = String(after.target_uid || '');
      if (!uid) throw new Error('target_uid chahiye');
      if (!after.force) {
        const [l1, l2] = await Promise.all([
          db.collection('leads').where('ldr_uid', '==', uid).limit(1).get(),
          db.collection('leads').where('sales_uid', '==', uid).limit(1).get(),
        ]);
        if (!l1.empty || !l2.empty) { const e = new Error('has-leads'); e.hasLeads = true; throw e; }
      }
      await admin.auth().deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw e; });
      await db.doc('users/' + uid).delete();
      result = { uid, deleted: true };
    }
    else throw new Error('unknown task: ' + id);
    await ref.set({ status: 'done', result, done_at: FV.serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error('adminTask fail', id, e);
    await ref.set({ status: 'error', error: String((e && e.message) || e), done_at: FV.serverTimestamp() }, { merge: true });
  }
});

// ===================================================================
// SMART ASSIGNMENT — qualified lead bina sales ke -> load-aware round-robin
// ===================================================================
async function pickSalesUser() {
  const usersSnap = await db.collection('users')
    .where('role', '==', 'sales').where('status', '==', 'active').get();
  const cands = usersSnap.docs.filter((u) => String(u.data().attendance || 'Present').toLowerCase() !== 'absent');
  if (cands.length === 0) return null;
  // load = open leads (outcome == '')
  const loads = await Promise.all(cands.map(async (u) => {
    const c = await db.collection('leads').where('sales_uid', '==', u.id).where('outcome', '==', '').count().get();
    return { uid: u.id, name: u.data().full_name, load: c.data().count };
  }));
  loads.sort((a, b) => a.load - b.load);
  return loads[0];
}

exports.assignSales = onDocumentWritten('leads/{id}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const leadId = event.params.id;

  // RE-INQUIRY — customer dobara aaya (markUrgent). urgent_at abhi-abhi set/badla + lead
  // kisi ke paas hai -> us owner ko turant batao (pehle se unke paas tha ya nahi).
  const uaNew = after.urgent_at?.toMillis ? after.urgent_at.toMillis() : 0;
  const uaOld = before && before.urgent_at?.toMillis ? before.urgent_at.toMillis() : 0;
  if (after.is_urgent && uaNew > uaOld && (Date.now() - uaNew) < 10 * 60000) {
    const owner = after.sales_uid || after.ldr_uid;
    if (owner) await notify(owner, 'reinquiry', 'reinquiry', after.name || 'Lead', leadId);
    return; // re-inquiry write pe qualify/assign logic nahi chalani
  }
  const nowQualified = String(after.status || '').toLowerCase() === 'qualified';
  const wasQualified = before && String(before.status || '').toLowerCase() === 'qualified';

  // Fresh lead kisi ne MANUALLY (ek-ek karke) kisi LDR ko assign kiya -> us LDR ko batao.
  // Bulk import / bulk-assign / migration skip — warna 50 leads = 50 notification (spam).
  const src = String(after.source || '').toLowerCase();
  const bulkish = after.bulk_import === true || src.indexOf('import') !== -1 || src.indexOf('bulk') !== -1 || src.indexOf('migrat') !== -1;
  const freshAssignedToSomeoneElse = !before && after.ldr_uid
    && ['fresh', 'new'].includes(String(after.status || '').toLowerCase())
    && !bulkish && after.created_by !== after.ldr_uid
    && after.created_by !== 'import' && after.created_by !== 'system';
  if (freshAssignedToSomeoneElse) {
    await notify(after.ldr_uid, 'new_lead', 'new_lead', after.name || 'Lead', leadId);
    return; // fresh lead qualify thodi hui hai
  }

  // LDR ne isi save mein qualify BHI kiya aur sales BHI khud chun liya (assignTo dropdown) —
  // koi auto-pick nahi karna, bas usi ko notify karo. (Pehle sirf auto-assign wale case mein
  // notify hota tha — manual assign silently chhoot jaata tha, yahi report hui thi.)
  // `!wasQualified` zaroori hai: auto-assign khud "sales_uid" likh kar isi function ko dobara
  // trigger karta hai (onDocumentWritten apne hi write pe bhi chalta hai) — us doosre trigger mein
  // status pehle se hi 'qualified' hoga, isliye wahan ye dobara notify nahi karega (double-notify se bacha).
  const salesJustSet = nowQualified && !wasQualified && !!after.sales_uid
    && (!before || before.sales_uid !== after.sales_uid);
  if (salesJustSet) {
    await notify(after.sales_uid, 'new_lead', 'new_lead', after.name || 'Lead', leadId);
    return;
  }

  const needsAssign = nowQualified && !after.sales_uid;
  // sirf jab abhi qualified hua ya assign nikal gaya — infinite loop se bacho
  if (!needsAssign) return;
  if (before && before.sales_uid) return; // already tha, koi aur ne hataya — chhodo

  const pick = await pickSalesUser();
  if (!pick) {
    await notify(after.ldr_uid, 'assign_fail', 'assign_fail', after.name || 'Lead', leadId);
    return;
  }
  await db.doc(`leads/${leadId}`).update({
    sales_uid: pick.uid, sales_name: pick.name, assigned_sales_at: FV.serverTimestamp(), updated_at: FV.serverTimestamp(),
  });
  await db.collection('activity').add({
    lead_id: leadId, lead_name: after.name || '', at: FV.serverTimestamp(),
    uid: 'system', actor_name: 'System', action: 'assigned', from_status: '', to_status: 'assigned to sales',
    amount: 0, channel: 'auto', remark: `Auto-assigned to ${pick.name} (load ${pick.load})`,
  });
  await notify(pick.uid, 'new_lead', 'new_lead', after.name || 'Lead', leadId);
  console.log(`assigned ${leadId} -> ${pick.name}`);
});

// ===================================================================
// SLA SCAN — har 15 min. Kaam:
//   - "5 min pehli call" nudge (fresh uthai lead + sales ko assign hui qualified lead)
//   - followup: due-now reminder + overdue escalation
//   - fresh untouched -> pool wapas (+ manager)
//   - qualified unassigned -> assignSales dobara trigger
//   - morning brief (din me ek baar, Work_Start ke baad)
// Sab queries bounded (limit<=50) + time-window floors — alerted docs window se bahar
// nikal jaati hain, dobara-dobara read nahi hoti. Naya Scheduler job NAHI (cost).
// ===================================================================
exports.slaScan = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Asia/Kolkata' }, async () => {
  const settings = await getSettings();
  const now = Date.now();

  // ---- morning brief (work-hours check se pehle — start-time par hi chalega) ----
  try { await maybeMorningBrief(settings, now); } catch (e) { console.error('morningBrief', e.message || e); }
  // Din me 2 nudge (~14:00 aur ~18:30) — har worker ko uska personal pending count
  try { await maybeNudge(settings, now); } catch (e) { console.error('nudge', e.message || e); }
  // Admin ko daily (roz 20:00) + weekly (Sunday 20:00) report email
  try { await maybeReportEmail(settings, now); } catch (e) { console.error('reportEmail', e.message || e); }
  // AAJ ka `stats_daily.dash` ~90 min me refresh (dashboard isse padhta hai — LIVE query nahi karta)
  try { await maybeRefreshToday(settings, now); } catch (e) { console.error('refreshToday', e.message || e); }

  if (!inWorkHours(settings)) { console.log('outside work hours, skip SLA'); return; }
  let acted = 0;
  const H6 = 6 * 3600000;
  // ek rule fail ho (missing index / transient) to baaki rules chalte rahein
  const rule = async (name, fn) => { try { await fn(); } catch (e) { console.error('slaScan rule', name, e.message || e); } };

  // 1. PEHLI CALL — 5 min rule. (a) LDR ne fresh lead uthai par koi action nahi.
  //    (b) qualified lead sales ko assign hui par sales_status abhi tak khali.
  await rule('firstContact', async () => {
    const firstMs = durMs(settings.SLA_FirstContact || '5m');
    if (!firstMs) return;
    const cut = TS.fromMillis(now - firstMs);
    const floor = TS.fromMillis(now - H6);
    const fa = await db.collection('leads')
      .where('status', 'in', ['fresh', 'new'])
      .where('created_at', '<', cut).where('created_at', '>', floor).limit(40).get();
    for (const d of fa.docs) {
      const l = d.data();
      if (l.sla_contact_alerted || !l.ldr_uid || l.last_action_at || l.source === 'Bulk Import') continue;
      await d.ref.update({ sla_contact_alerted: true });
      await notify(l.ldr_uid, 'sla', 'first_contact', l.name || d.id, d.id);
      acted++;
    }
    const qa = await db.collection('leads')
      .where('status', '==', 'qualified')
      .where('qualified_at', '<', cut).where('qualified_at', '>', floor).limit(40).get();
    for (const d of qa.docs) {
      const l = d.data();
      if (l.sla_contact_alerted || !l.sales_uid || String(l.sales_status || '').trim()) continue;
      await d.ref.update({ sla_contact_alerted: true });
      await notify(l.sales_uid, 'sla', 'first_contact_sales', l.name || d.id, d.id);
      acted++;
    }
  });

  // 2. FRESH untouched (lamba) -> pool wapas. Sirf us LDR ko batao — manager ko PER-LEAD ping
  //    NAHI (wo noise banta tha); manager ko din me ek daily email digest jaata hai.
  await rule('freshReturn', async () => {
    const fMs = durMs(settings.SLA_FreshTouch);
    if (!fMs) return;
    const cut = TS.fromMillis(now - fMs);
    const floor = TS.fromMillis(now - 3 * 86400000);
    const snap = await db.collection('leads')
      .where('status', 'in', ['fresh', 'new'])
      .where('created_at', '<', cut).where('created_at', '>', floor).limit(30).get();
    for (const d of snap.docs) {
      const l = d.data();
      if (l.sla_fresh_alerted || !l.ldr_uid) continue;
      await d.ref.update({ sla_fresh_alerted: true, ldr_uid: null, ldr_name: '', updated_at: FV.serverTimestamp() });
      await notify(l.ldr_uid, 'sla', 'sla_fresh_ldr', l.name || d.id, d.id);
      acted++;
    }
  });

  // 3. SALES first-touch (SLA_SalesTouch) — assign hui qualified lead, itni der se sales_status khali.
  //    Manager ko per-lead nahi (storm) — sirf salesperson ko.
  await rule('salesTouch', async () => {
    const stMs = durMs(settings.SLA_SalesTouch || '2h');
    if (!stMs) return;
    const cut = TS.fromMillis(now - stMs);
    const floor = TS.fromMillis(now - 3 * 86400000);
    const snap = await db.collection('leads')
      .where('status', '==', 'qualified')
      .where('qualified_at', '<', cut).where('qualified_at', '>', floor).limit(30).get();
    for (const d of snap.docs) {
      const l = d.data();
      if (l.sla_sales_alerted || !l.sales_uid || String(l.sales_status || '').trim()) continue;
      await d.ref.update({ sla_sales_alerted: true });
      await notify(l.sales_uid, 'sla', 'sla_followup', l.name || d.id, d.id);
      acted++;
    }
  });

  // 4. FOLLOWUP reminder — DUE se ~10-15 min PEHLE (ek baar). Window: [now-5m, now+18m] taaki
  //    15-min scan-gap cover ho aur banda ~10 min pehle heads-up paaye. One-shot flag —
  //    `logLeadAction` naya next_followup set hone par isko reset kar deta hai (dobara arm).
  await rule('followupDue', async () => {
    const dueFloor = TS.fromMillis(now - 5 * 60000);
    const dueCeil = TS.fromMillis(now + 18 * 60000);
    const snap = await db.collection('leads')
      .where('outcome', '==', '')
      .where('next_followup', '>', dueFloor).where('next_followup', '<', dueCeil).limit(40).get();
    for (const d of snap.docs) {
      const l = d.data();
      if (l.sla_followup_due_alerted) continue;
      await d.ref.update({ sla_followup_due_alerted: true });
      await notify(l.sales_uid || l.ldr_uid, 'followup', 'followup_due', l.name || d.id, d.id);
      acted++;
    }
  });

  // 5. FOLLOWUP overdue escalation — sirf jo pichhle 3 din me SLA cross kiya (purana
  //    backlog data-cleanup ka mudda hai, uspe spam nahi). Manager ko per-lead NAHI —
  //    subah ke brief me aggregate milta hai.
  await rule('followupOverdue', async () => {
    const foMs = durMs(settings.SLA_FollowupOverdue);
    if (!foMs) return;
    const cut = TS.fromMillis(now - foMs);
    const floor = TS.fromMillis(now - foMs - 36 * 3600000); // 1.5 din se purana = data-cleanup ka mudda
    const snap = await db.collection('leads')
      .where('outcome', '==', '')
      .where('next_followup', '<', cut).where('next_followup', '>', floor).limit(15).get();
    for (const d of snap.docs) {
      const l = d.data();
      if (l.sla_followup_alerted) continue;
      await d.ref.update({ sla_followup_alerted: true });
      await notify(l.sales_uid || l.ldr_uid, 'sla', 'sla_followup', l.name || d.id, d.id);
      acted++;
    }
  });

  // 6. Qualified but unassigned too long -> assignSales dobara trigger (touch)
  await rule('unassigned', async () => {
    const qMs = durMs(settings.SLA_QualifiedUnassigned);
    if (!qMs) return;
    const cut = TS.fromMillis(now - qMs);
    const snap = await db.collection('leads')
      .where('status', '==', 'qualified').where('qualified_at', '<', cut).limit(30).get();
    for (const d of snap.docs) {
      if (d.data().sales_uid) continue;
      await d.ref.update({ updated_at: FV.serverTimestamp() }); // re-trigger assignSales
      acted++;
    }
  });

  console.log('slaScan acted on', acted);
});

// Din me ek baar — Work_Start ke baad, business-day (Mon weekly off) — har active
// LDR/sales ko motivational good-morning + aaj ka brief. State meta/notify_state me.
async function maybeMorningBrief(settings, nowMs) {
  if (String(settings.Morning_Brief || 'on') === 'off') return;
  const istNow = new Date(nowMs + IST);
  if (istNow.getUTCDay() === 1) return; // Monday = weekly off
  const today = istNow.toISOString().slice(0, 10);
  const hm = istNow.toISOString().slice(11, 16);
  const start = settings.Work_Start || '09:00';
  if (hm < start) return;

  const stRef = db.doc('meta/notify_state');
  const st = (await stRef.get()).data() || {};
  if (st.morning_date === today) return;
  await stRef.set({ morning_date: today }, { merge: true }); // pehle set — double-send se bacho

  // status-only query (single-field, koi composite index nahi chahiye) — role client-side filter
  const usersSnap = await db.collection('users').where('status', '==', 'active').get();
  const workers = usersSnap.docs.filter((u) => ['ldr', 'sales'].includes(u.data().role)
    && String(u.data().attendance || 'Present').toLowerCase() !== 'absent');
  // SIRF AAJ ka — aaj scheduled followups + fresh pool. Koi bada "pending backlog" number nahi
  // (migrated data me wo hazaaron ho jaata hai — demotivating + spam jaisa lagta hai).
  const startDay = TS.fromMillis(Date.parse(today + 'T00:00:00+05:30'));
  const endDay = TS.fromMillis(Date.parse(today + 'T23:59:59+05:30'));
  const freshCount = (await db.collection('leads').where('status', 'in', ['fresh', 'new']).count().get()).data().count;

  const norm = (v) => String(v || '').toLowerCase().trim();
  for (const u of workers) {
    const uid = u.id;
    const isSales = u.data().role === 'sales';
    const field = isSales ? 'sales_uid' : 'ldr_uid';
    let fu = 0;
    try {
      // aaj next_followup wali apni leads laao (bounded, (field,next_followup) index) — phir
      // client-side sirf apne stage wali gino (LDR: still-LDR; Sales: sales-owned).
      const snap = await db.collection('leads')
        .where(field, '==', uid)
        .where('next_followup', '>=', startDay).where('next_followup', '<=', endDay)
        .limit(300).get();
      snap.forEach((d) => {
        const l = d.data();
        const st = norm(l.status); const ss = norm(l.sales_status);
        if (isSales) { if (ss || st === 'qualified') { if (['lost', 'dead', 'order done'].indexOf(ss) === -1) fu++; } }
        else if (!ss && st !== 'qualified' && ['dead', 'lost'].indexOf(st) === -1) fu++;
      });
    } catch { /* index race — 0 */ }
    await notify(uid, 'morning', 'morning', { fu, fresh: isSales ? 0 : freshCount });
  }

  // Manager digest — AAJ ke due followup jo abhi tak nahi hue (poora backlog nahi — wo demotivating
  // number banta tha). Detail admin ko 20:00 wale daily email me milta hai.
  try {
    const overdue = (await db.collection('leads').where('outcome', '==', '')
      .where('next_followup', '>=', startDay).where('next_followup', '<', TS.fromMillis(nowMs)).count().get()).data().count;
    const adminSnap = await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get();
    for (const admin of adminSnap.docs) {
      await notify(admin.id, 'morning', 'morning_mgr', { overdue, freshPool: freshCount });
    }
  } catch (e) { console.error('mgr digest', e.message || e); }
  console.log('morning brief sent to', workers.length);
}

// Din me ~2 baar (default 14:00 aur 18:30) — har active worker ko uska personal pending
// (aaj ke followup jo abhi tak nahi hue + fresh pool). Kuch pending na ho to skip (spam nahi).
async function maybeNudge(settings, nowMs) {
  if (String(settings.Day_Nudge || 'on') === 'off') return;
  const istNow = new Date(nowMs + IST);
  if (istNow.getUTCDay() === 1) return; // Monday weekly off
  const today = istNow.toISOString().slice(0, 10);
  const hm = istNow.toISOString().slice(11, 16);
  const slots = String(settings.Nudge_Times || '14:00,18:30').split(',').map((s) => s.trim()).filter(Boolean);
  const due = slots.filter((s) => hm >= s);
  if (!due.length) return;
  const slot = due[due.length - 1]; // aaj ka latest slot jo cross ho chuka
  const stRef = db.doc('meta/notify_state');
  const st = (await stRef.get()).data() || {};
  if (st[`nudge_${slot}_date`] === today) return;
  await stRef.set({ [`nudge_${slot}_date`]: today }, { merge: true });

  const usersSnap = await db.collection('users').where('status', '==', 'active').get();
  const workers = usersSnap.docs.filter((u) => ['ldr', 'sales'].includes(u.data().role)
    && String(u.data().attendance || 'Present').toLowerCase() !== 'absent');
  const startDay = TS.fromMillis(Date.parse(today + 'T00:00:00+05:30'));
  const nowTs = TS.fromMillis(nowMs);
  const freshCount = (await db.collection('leads').where('status', 'in', ['fresh', 'new']).count().get()).data().count;
  const norm = (v) => String(v || '').toLowerCase().trim();
  let sent = 0;
  for (const u of workers) {
    const uid = u.id;
    const isSales = u.data().role === 'sales';
    const field = isSales ? 'sales_uid' : 'ldr_uid';
    let fu = 0;
    try {
      // aaj due ho chuki (abhi tak nahi hui) apni followup leads
      const snap = await db.collection('leads').where(field, '==', uid)
        .where('next_followup', '>=', startDay).where('next_followup', '<', nowTs).limit(300).get();
      snap.forEach((d) => {
        const l = d.data(); const stt = norm(l.status); const ss = norm(l.sales_status);
        if (l.last_action_at && l.last_action_at.toMillis() >= startDay.toMillis()) return; // aaj ho chuki
        if (isSales) { if ((ss || stt === 'qualified') && ['lost', 'dead', 'order done'].indexOf(ss) === -1) fu++; }
        else if (!ss && stt !== 'qualified' && ['dead', 'lost'].indexOf(stt) === -1) fu++;
      });
    } catch { /* index race */ }
    const fresh = isSales ? 0 : freshCount;
    if (fu === 0 && fresh === 0) continue; // kuch pending nahi — nudge mat bhejo
    await notify(uid, 'followup', 'nudge', { fu, fresh });
    sent++;
  }
  console.log(`day nudge (${slot}) sent to ${sent}`);
}

// Admin ko report email — daily roz 20:00, weekly Sunday 20:00. stats_daily/{date}.dash se
// (koi lead-fetch nahi). Gmail configure na ho to silently skip.
async function maybeReportEmail(settings, nowMs) {
  if (String(settings.Report_Email_Daily || 'on') === 'off') return;
  const istNow = new Date(nowMs + IST);
  const today = istNow.toISOString().slice(0, 10);
  const hm = istNow.toISOString().slice(11, 16);
  const sendAt = settings.Report_Email_Time || '20:00';
  if (hm < sendAt) return;

  const stRef = db.doc('meta/notify_state');
  const st = (await stRef.get()).data() || {};
  const isSunday = istNow.getUTCDay() === 0;
  const wantWeekly = isSunday && st.report_email_week !== isoWeekOf(today);
  const wantDaily = st.report_email_date !== today;
  if (!wantDaily && !wantWeekly) return;

  const mail = await getMailTransport();
  if (!mail) { console.log('report email skip — Gmail not configured'); if (wantDaily) await stRef.set({ report_email_date: today }, { merge: true }); return; }
  const admins = (await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get())
    .docs.map((d) => d.data().email).filter(Boolean);
  if (!admins.length) return;
  const usersSnap = await db.collection('users').get();
  const uById = {}; usersSnap.forEach((u) => { uById[u.id] = u.data(); });

  const send = async (fromDay, toDay, label) => {
    const days = []; for (let d = new Date(fromDay + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= toDay; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
    const snaps = await Promise.all(days.map((d) => db.doc(`stats_daily/${d}`).get()));
    const dashes = snaps.filter((s) => s.exists && s.data().dash).map((s) => s.data().dash);
    const ldr = dashStatsFromDash(dashes, 'ldr', uById);
    const sales = dashStatsFromDash(dashes, 'sales', uById);
    if (ldr.T.interactions === 0 && sales.T.interactions === 0) return;
    await mail.transporter.sendMail({
      from: `"Paris CRM" <${mail.email}>`, to: admins.join(','),
      subject: `Paris CRM — ${label} report (${fromDay === toDay ? fromDay : `${fromDay} to ${toDay}`})`,
      html: reportEmailHtml(label, fromDay === toDay ? fromDay : `${fromDay} – ${toDay}`, sales, ldr),
    });
    console.log(`${label} report email -> ${admins.length} admin(s)`);
  };

  if (wantDaily) { await send(today, today, 'Daily'); await stRef.set({ report_email_date: today }, { merge: true }); }
  if (wantWeekly) {
    const wStart = new Date(istNow.getTime()); wStart.setUTCDate(wStart.getUTCDate() - 6);
    await send(wStart.toISOString().slice(0, 10), today, 'Weekly');
    await stRef.set({ report_email_week: isoWeekOf(today) }, { merge: true });
  }
}

// AAJ ka dash pre-agg refresh — har ~90 min (08:00–21:00 IST). Dashboard "today" isse padhta hai
// (LIVE per-load query nahi — reads bachao). Manual "refresh" button ke liye bhi kaafi.
async function maybeRefreshToday(settings, nowMs) {
  const istNow = new Date(nowMs + IST);
  const hm = istNow.toISOString().slice(11, 16);
  if (hm < '08:30' || hm > '20:30') return; // raat 1 baje dailyMaintenance final version likhta hai
  const gapMin = Number(settings.Today_Agg_Mins) || 120;
  const stRef = db.doc('meta/notify_state');
  const st = (await stRef.get()).data() || {};
  if (st.today_agg_at && (nowMs - st.today_agg_at) < gapMin * 60000) return;
  await stRef.set({ today_agg_at: nowMs }, { merge: true });
  await aggregateDay(istDay(nowMs));
  console.log('today dash refreshed');
}

function isoWeekOf(dayStr) {
  const d = new Date(dayStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
}

// stats_daily.dash (array of daily dash objects) -> per-person + team stats for one role.
function dashStatsFromDash(dashes, role, uById) {
  const CATN = { fresh: 'Fresh', reinq: 'Urgent', sched: 'Scheduled', offsched: 'Off-Schedule' };
  const mkP = () => ({ interactions: 0, connected: 0, calls: 0, leads: new Set(), days: 0,
    cat: { Fresh: [0, 0], Urgent: [0, 0], Scheduled: [0, 0], 'Off-Schedule': [0, 0] },
    qualified: 0, dead: 0, lost: 0 });
  const persons = {};
  for (const dash of dashes) {
    const seen = new Set();
    for (const uid of Object.keys(dash)) {
      if (uid.startsWith('_') || (uById[uid] || {}).role !== role) continue;
      const p = (persons[uid] = persons[uid] || mkP());
      for (const bk of Object.keys(CATN)) {
        const b = dash[uid][bk] || {}; const cat = CATN[bk];
        const hitKeys = Object.keys(b.hits || {});
        const pend = (b.pids || []);
        const inter = hitKeys.length + pend.length;
        if (!inter) continue;
        p.interactions += inter; p.connected += hitKeys.length;
        p.calls += Object.values(b.hits || {}).reduce((a, n) => a + n, 0);
        p.cat[cat][0] += inter; p.cat[cat][1] += hitKeys.length;
        hitKeys.forEach((id) => p.leads.add(id)); pend.forEach((id) => p.leads.add(id));
        p.qualified += (b.by || {}).qualified || 0;
        p.dead += (b.by || {}).dead || 0;
        p.lost += (b.by || {}).lost || 0;
        seen.add(uid);
      }
    }
    for (const uid of seen) persons[uid].days += 1;
  }
  const list = Object.entries(persons).map(([uid, p]) => ({
    name: (uById[uid] || {}).full_name || uid, ...p, uniqueLeads: p.leads.size,
    connectRate: p.interactions ? p.connected / p.interactions : 0,
  })).sort((a, b) => b.interactions - a.interactions);

  const T = { interactions: 0, connected: 0, calls: 0, uniqueLeads: 0, people: list.length,
    cat: { Fresh: [0, 0], Urgent: [0, 0], Scheduled: [0, 0], 'Off-Schedule': [0, 0] }, qualified: 0, dead: 0, lost: 0 };
  const allLeads = new Set();
  for (const [, p] of Object.entries(persons)) {
    T.interactions += p.interactions; T.connected += p.connected; T.calls += p.calls;
    T.qualified += p.qualified; T.dead += p.dead; T.lost += p.lost;
    for (const c of Object.keys(T.cat)) { T.cat[c][0] += p.cat[c][0]; T.cat[c][1] += p.cat[c][1]; }
    p.leads.forEach((id) => allLeads.add(id));
  }
  T.uniqueLeads = allLeads.size;
  T.connectRate = T.interactions ? T.connected / T.interactions : 0;
  for (const c of Object.keys(T.cat)) T.cat[c].rate = T.cat[c][0] ? T.cat[c][1] / T.cat[c][0] : null;
  list.forEach((p) => {
    p.lostRate = p.uniqueLeads ? p.lost / p.uniqueLeads : 0;
    p.qualRate = p.connected ? p.qualified / p.connected : 0;
    for (const c of Object.keys(p.cat)) p.cat[c].rate = p.cat[c][0] ? p.cat[c][1] / p.cat[c][0] : null;
  });
  return { list, T, flags: emailFlags(list, T, role) };
}

/** compact flag list for the email — same spirit as the visual report's §4e rules. */
function emailFlags(list, T, role) {
  const F = [];
  const teamQual = T.connected ? T.qualified / T.connected : 0;
  const teamLost = list.length ? list.reduce((a, p) => a + (p.lostRate || 0), 0) / list.length : 0;
  for (const p of list) {
    if (p.interactions >= 5 && p.connected === 0) F.push(`<b>${esc(p.name)}</b> — ${p.interactions} interactions, 0 connect. Kuch to gadbad hai.`);
    else if (p.cat.Scheduled[0] >= 3 && p.cat.Scheduled[1] === 0) F.push(`<b>${esc(p.name)}</b> — ${p.cat.Scheduled[0]} scheduled calls, 0 connect. Customer ne time diya tha.`);
    if (role === 'ldr' && p.connected >= 10 && teamQual > 0 && p.qualRate < teamQual / 2) F.push(`<b>${esc(p.name)}</b> — qualification rate ${Math.round(p.qualRate * 100)}% (team avg ${Math.round(teamQual * 100)}%).`);
    if (role === 'sales' && p.uniqueLeads >= 5 && teamLost > 0 && p.lostRate > teamLost * 2) F.push(`<b>${esc(p.name)}</b> — lost rate ${Math.round(p.lostRate * 100)}% (team avg ${Math.round(teamLost * 100)}%).`);
  }
  if (list.length >= 3) {
    const top2 = list.slice(0, 2);
    const sh = T.interactions ? top2.reduce((a, p) => a + p.interactions, 0) / T.interactions : 0;
    if (sh > 0.5) F.push(`Workload skew — <b>${top2.map((p) => esc(p.name)).join(' + ')}</b> akele ${Math.round(sh * 100)}% volume kar rahe hain.`);
  }
  let weak = null;
  for (const c of Object.keys(T.cat)) {
    const r = T.cat[c].rate;
    if (r != null && T.cat[c][0] >= 3 && r < 0.5 && (!weak || r < weak.r)) weak = { c, r };
  }
  if (weak) F.push(`Sabse kamzor channel — <b>${weak.c}</b>, poori team ka connect rate ${Math.round(weak.r * 100)}%.`);
  return F;
}

function reportEmailHtml(label, rangeLabel, sales, ldr) {
  const p1 = (n) => `${Math.round((n || 0) * 100)}%`;
  const nf = (n) => Number(n || 0).toLocaleString('en-IN');
  const td = 'padding:7px 9px;border-bottom:1px solid #edf1f6;font-size:12.5px;text-align:right;';
  const th = 'padding:7px 9px;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;color:#5a6b82;text-align:right;';

  const cats = ['Fresh', 'Scheduled', 'Off-Schedule', 'Urgent'];
  const teamBlock = (name, R, isSales) => {
    const T = R.T;
    if (!T.interactions) return mbP(`<b>${name}:</b> is range me koi activity nahi.`);
    const kpi = isSales
      ? `Scheduled adherence <b>${T.cat.Scheduled.rate == null ? '—' : p1(T.cat.Scheduled.rate)}</b> &middot; Lost <b>${nf(T.lost)}</b>`
      : `Qualification rate <b>${T.connected ? p1(T.qualified / T.connected) : '—'}</b> &middot; Dead <b>${nf(T.dead)}</b>`;
    const catRow = cats.map((c) => `<td style="${td}">${nf(T.cat[c][0])}<span style="color:#8a97a8;"> / ${p1(T.cat[c].rate)}</span></td>`).join('');
    const rows = R.list.map((p, i) => `<tr style="background:${i % 2 ? '#fbfcfe' : '#fff'};">
      <td style="${td}text-align:left;"><b style="color:#1d2c45;">${esc(p.name)}</b></td>
      <td style="${td}">${nf(p.interactions)}</td>
      <td style="${td}">${nf(p.uniqueLeads)}</td>
      <td style="${td}">${nf(p.connected)}</td>
      <td style="${td}">${p1(p.connectRate)}</td>
      <td style="${td}">${nf(isSales ? p.lost : p.qualified)}</td>
    </tr>`).join('');
    const flags = (R.flags || []).length
      ? `<div style="margin:8px 0 2px;padding:11px 13px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#9a5b1a;font-weight:700;margin-bottom:5px;">Dhyaan dena hai</div>
          ${R.flags.map((f) => `<div style="font-size:12.5px;color:#5a4a2f;line-height:1.55;margin-bottom:3px;">&bull; ${f}</div>`).join('')}
        </div>` : '';
    return `<p style="margin:18px 0 6px;font-size:15px;font-weight:700;color:#0f1e36;">${name}</p>`
      + mbP(`${nf(T.interactions)} interactions &middot; ${p1(T.connectRate)} connect &middot; ${nf(T.uniqueLeads)} unique leads &middot; ${nf(T.calls)} calls`)
      + mbP(kpi)
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e7edf4;border-radius:8px;overflow:hidden;margin:4px 0 6px;font-size:11px;">
          <tr style="background:#f2f6fb;"><td style="${th}text-align:left;">By category — total / connect%</td>${cats.map((c) => `<td style="${th}">${c}</td>`).join('')}</tr>
          <tr>${'<td style="' + td + 'text-align:left;color:#8a97a8;">Team</td>'}${catRow}</tr>
        </table>`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e7edf4;border-radius:8px;overflow:hidden;margin-top:4px;">
          <thead><tr style="background:#f2f6fb;"><th style="${th}text-align:left;">Person</th><th style="${th}">Inter.</th><th style="${th}">Unique</th><th style="${th}">Conn.</th><th style="${th}">Conn%</th><th style="${th}">${isSales ? 'Lost' : 'Qual'}</th></tr></thead>
          <tbody>${rows}</tbody></table>`
      + flags;
  };

  const body = mbP(`<b>${label}</b> report &middot; ${esc(rangeLabel)}`)
    + teamBlock('Sales team', sales, true)
    + teamBlock('LDR team', ldr, false)
    + mbMuted('Ye wahi report hai jo CRM &rarr; Reports &rarr; "Daily Leads — Raw" &rarr; "Report kholo" me dikhti hai (trend chart + full breakdown wahan).');

  return emailShell({
    heading: `${label} Leads Report — ${rangeLabel}`,
    preheader: `Sales ${nf(sales.T.interactions)} &middot; LDR ${nf(ldr.T.interactions)} interactions`,
    bodyHtml: body,
    cta: { text: 'Open CRM Reports', url: MAIL_APP_URL + '/' },
  });
}

// ===================================================================
// HELP — Ask-AI (Anthropic) + Support Tickets
// ===================================================================
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

const CRM_GUIDE = [
  'Paris Fashion CRM — fashion wholesale lead system.',
  'TEAMS: LDR (lead qualifier) talks to new leads, marks "Qualified" and hands to Sales, or "Dead/Lost". Sales works qualified leads: hot lead / visit customer / video call / followup, then "Order Done" + amount, or "Lost". Admin/TL/MD only view.',
  'TWO STATUS FIELDS: "status" (LDR: fresh/call back/qualified/dead/lost, frozen after qualified) and "sales_status" (empty until Sales starts, then hot lead/visit customer/video call/followup/order done/lost). If sales_status set -> Sales-owned, else LDR-owned. "qualified" is the hand-off point.',
  'ADD ONE LEAD: the round "+" button (bottom-right on the Leads / Fresh Pool / Follow-up screens) opens "New Lead" — fill name + phone (phone is the only required field) + optional company/city/source, Save. Duplicate phone is caught and shows the existing lead.',
  'ADD MANY LEADS (BULK): Menu -> Bulk Import (admin / bulk permission). Download the sample CSV, fill your leads (one per row, keep row 1 headings), optionally add an "assign" column with an LDR name per lead. Upload -> it shows total / will-import / duplicates / bad-phone + per-person assignment. Rows with no assignee: choose Auto (split evenly among active LDRs), or one person, or leave unassigned. Then Import. Bulk leads are always "fresh" (LDR pool).',
  'LDR FLOW: open Fresh Leads Pool -> tap lead -> Call/WhatsApp -> pick next stage (Call Back needs a next-call date; Qualified opens the qualification form; Dead/Lost). Always write a remark. 7 no-answer/call-back attempts auto-marks Lost.',
  'UPDATE / EDIT A LEAD: tap the lead anywhere (any list, or search by name/phone) — the lead sheet opens with 3 tabs: Action, History, Details. To move the lead forward or log a call: Action tab -> pick the new stage -> write a remark -> Save (also logs to History). To fix name / phone / company / city / email / other info: Details tab -> "Edit info" button -> change fields -> Save. To set the next follow-up date: pick "Call Back" (LDR) or "Followup" (Sales) on the Action tab and choose the date. There is no separate update screen — everything about a lead is done from its lead sheet.',
  'QUALIFICATION FORM: shows when picking a stage that has "shows_form" ON (default: the stage named "qualified"). Answers (Customer Type, Bulk?, Quantity, Budget, Buying Intent, Interested In) appear to Sales as a chip strip on top of the lead + in Details.',
  'ASSIGN TO SALES on qualify: blank = Auto = system instantly assigns the salesperson with fewest open leads (active + present) and notifies them; if none, lead stays unassigned and LDR gets a reminder. Or pick a name.',
  'SALES FLOW: New Qualified Leads -> open lead -> read LDR answers -> call -> update stage -> Order Done + amount, or Lost. My Follow-ups shows leads whose next call is due.',
  'FOLLOW-UPS: Pending Calls (LDR-owned, call-back due). My Follow-ups (Sales-owned, due). Filters: Overdue / Today / All due.',
  'NOTIFICATIONS: bell icon top-right -> Turn on notifications -> allow on phone. iPhone: must Add to Home Screen first.',
  'ATTENDANCE: Present/Absent per user. Absent = no auto-assigned leads.',
  'STALE DATA: app caches offline; pull-to-refresh or the Refresh button; hard-refresh (Ctrl+Shift+R) if the Settings build time looks old.',
  'REPORTS (admin): Reports & Export -> pick report + date range -> CSV (opens in Excel). Detail reports capped at 90 days.',
].join('\n');

/** Reasoning models kabhi-kabhi apna "soch" content mein hi de dete hain — usko hata do. */
function cleanAnswer(s) {
  let out = String(s || '');
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();          // tagged thinking
  const marker = out.lastIndexOf('</think>');
  if (marker >= 0) out = out.slice(marker + 8).trim();                  // unclosed open tag
  return out;
}

// timeout-bounded fetch — NVIDIA/Anthropic ka koi request 14s se zyada na latke
async function fetchT(url, opts, ms) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms || 14000);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(to); }
}

// User ke latest sawaal ka script detect karke AI ko explicit reply-language batao.
// gpt-oss-20b LANGUAGE rule ignore kar deta tha (Hinglish sawaal -> Devanagari jawab),
// isliye ab deterministic detection + prompt ke start aur end dono par instruction.
const HINGLISH_HINTS = ['kaise', 'kese', 'kya', 'kyu', 'kyun', 'kaha', 'kahan', 'hai', 'hain', ' hu ', ' hoon', 'nahi', 'nhi', 'karo', 'karu', 'karun', 'kare', 'karna', 'karni', 'batao', 'bta', 'chahiye', 'chaiye', 'mujhe', 'mera', 'meri', 'apna', 'kaam', 'nikaal', 'daalu', 'dalu', 'kyuki', 'lekin', 'wagera', 'thik', 'theek', 'acha', 'accha', 'krna', 'krni', 'hota', 'raha', 'rha', 'jaega', 'jayega', 'namaste', 'namaskar', 'namste', 'shukriya', 'dhanyavaad', 'bhai', 'yaar', 'matlab', 'samajh', 'samjha', 'dikkat', 'pareshani', 'madad', 'jankari', 'jaankari', 'bata', 'dena', 'hoga', 'hogi', 'update kese', 'kaise karu', 'ke liye'];
const ENGLISH_HINTS = [' the ', ' is ', ' are ', ' how ', ' what ', ' where ', ' which ', ' can ', ' does ', ' should ', ' please ', ' need ', ' want ', ' with ', ' from ', ' when '];
function replyLangHint(question) {
  const q = ' ' + String(question || '').toLowerCase().trim() + ' ';
  if (/[ऀ-ॿ]/.test(q)) return 'Reply in Hindi using Devanagari script.';
  const hin = HINGLISH_HINTS.reduce((n, w) => n + (q.includes(w) ? 1 : 0), 0);
  const eng = ENGLISH_HINTS.reduce((n, w) => n + (q.includes(w) ? 1 : 0), 0);
  const HINGLISH = 'Reply in Hindi but written ONLY in Roman/English letters (Hinglish, the way the user typed). NEVER use Devanagari (देवनागरी) script — not even one word.';
  if (hin >= 1 && hin >= eng) return HINGLISH;
  if (eng >= 2 && eng > hin) return 'Reply in English.';
  // ambiguous (chhota sawaal, greeting, single word) -> is CRM ki team Hinglish bolti hai
  return HINGLISH;
}

function buildSystemPrompt(role, kb, question) {
  const langLine = replyLangHint(question);
  let s = 'REPLY LANGUAGE (obey exactly): ' + langLine + '\n\n'
    + 'You are "Paris Assistant" — the friendly in-app support agent for the Paris Fashion CRM, like the chat assistants on Swiggy / Flipkart / Zepto. '
    + 'Behave like a real, warm human support person:\n'
    + '- If the user just greets ("hi", "hello", "namaste") or is vague, greet back briefly and ask what they need help with. Do NOT dump a manual.\n'
    + '- Be empathetic if they sound stuck or frustrated ("koi baat nahi, main help karta hoon").\n'
    + '- If the question is unclear, ask ONE short clarifying question instead of guessing.\n'
    + '- Give the solution as short numbered steps. Keep it tight — a few lines, no long essays, no preamble like "Sure, I can help".\n'
    + '- Use the exact screen / button / tab names from the CRM KNOWLEDGE below.\n'
    + 'ALWAYS TRY TO ANSWER FIRST. You know this whole CRM from the knowledge below — for any "how do I..." / "kaise karu" question, work out the answer from what you know and give clear steps, even if there is no exact line for it. Example: "how to update a lead" -> you know leads are edited from the lead sheet (Action tab for stage, Details tab -> Edit info for fields), so explain that. Reason from the parts you do know.\n'
    + 'Do NOT tell the user to raise a ticket or ask an admin for normal how-to / navigation / process questions. Only suggest a ticket when it is genuinely NOT a how-to: something is broken / erroring, they need data or a permission changed, an account issue, or a feature that truly does not exist in this CRM. In that case say briefly why and suggest the ticket.\n'
    + 'Never invent a button, menu or screen name that is not in the knowledge. If you are unsure of the exact label, describe the action ("open the lead and change its stage") rather than making up a label.\n'
    + 'LANGUAGE: reply in the SAME script the user used. Roman-letter Hindi (Hinglish) -> reply Hinglish in Roman letters (never Devanagari). Devanagari -> Devanagari. English -> English.\n\n'
    + 'The user\'s role is: ' + (role || 'unknown') + '.\n\n'
    + 'CRM KNOWLEDGE:\n' + CRM_GUIDE;
  if (kb && kb.length) {
    const verified = kb.filter((e) => e.verified || (e.source && e.source !== 'ai'));
    const prior = kb.filter((e) => !(e.verified || (e.source && e.source !== 'ai')));
    if (verified.length) {
      s += '\n\nVERIFIED SOLUTIONS (from resolved tickets / admin — trust these, prefer them):\n'
        + verified.map((e, i) => (i + 1) + '. Q: ' + e.q + '\n   A: ' + e.a).join('\n');
    }
    if (prior.length) {
      s += '\n\nEARLIER AI ANSWERS to similar questions (not yet human-verified — reuse if correct, fix if wrong):\n'
        + prior.map((e, i) => (i + 1) + '. Q: ' + e.q + '\n   A: ' + e.a).join('\n');
    }
  }
  s += '\n\nREMINDER — ' + langLine;
  return s;
}

/** @param history [{role:'user'|'assistant', content}] prior turns (optional) */
async function callAI({ provider, key, model, role, question, history, kb }) {
  const sys = buildSystemPrompt(role, kb, question);
  const turns = (Array.isArray(history) ? history : []).slice(-6)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 1200) }));
  const q = String(question || '').slice(0, 1500);

  if (provider === 'anthropic') {
    const resp = await fetchT('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001', max_tokens: 700, system: sys,
        messages: [...turns, { role: 'user', content: q }],
      }),
    }, 20000);
    if (!resp.ok) throw new Error('anthropic ' + resp.status + ': ' + (await resp.text().catch(() => '')).slice(0, 200));
    const data = await resp.json();
    return cleanAnswer((data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')) || '(empty)';
  }

  // NVIDIA — OpenAI-compatible. Retry on 429/5xx, then fall back through other models.
  // (chat_template_kwargs mat bhejo — 404 deta hai. fetchT abort se hang nahi hota.)
  const primary = model || 'openai/gpt-oss-20b';
  const chain = [primary, 'openai/gpt-oss-20b', 'nvidia/nemotron-3-super-120b-a12b']
    .filter((m, i, a) => a.indexOf(m) === i);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 78000; // client 90s wait ke andar rehna
  let lastErr = 'unknown';
  let overloaded = false;

  for (const m of chain) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline) { const e = new Error(lastErr + ' (deadline)'); e.overloaded = overloaded; throw e; }
      try {
        const resp = await fetchT('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model: m, max_tokens: 900, temperature: 0.3, top_p: 0.95,
            messages: [{ role: 'system', content: sys }, ...turns, { role: 'user', content: q }],
          }),
        }, 18000);
        if (resp.ok) {
          const data = await resp.json();
          const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
          const text = cleanAnswer(String(msg.content || '').trim() || String(msg.reasoning_content || '').trim());
          if (text) return text;
          lastErr = m + ': empty response';
          break;
        }
        lastErr = 'nvidia ' + resp.status + ' (' + m + '): ' + (await resp.text().catch(() => '')).slice(0, 150);
        if (resp.status === 429 || resp.status >= 500) { overloaded = true; if (attempt < 2) { await sleep(1200 * (attempt + 1)); continue; } break; }
        break; // 4xx -> is model pe rukna bekaar
      } catch (e) {
        lastErr = m + ': ' + String((e && e.message) || e);
        if (String(e && e.name) === 'AbortError') overloaded = true;
        if (attempt < 2) { await sleep(700); continue; }
      }
    }
  }
  const err = new Error(lastErr);
  err.overloaded = overloaded;
  throw err;
}

// KB search — bahut simple keyword-overlap (small collection, no vector DB).
const KB_STOP = new Set(['the', 'a', 'an', 'is', 'to', 'in', 'me', 'ka', 'ki', 'ke', 'hai', 'kaise', 'kese', 'kya', 'how', 'do', 'i', 'my', 'and', 'ko', 'se', 'par', 'ye', 'yeh', 'wo', 'ek', 'aa', 'raha', 'rahi', 'nahi', 'not']);
const kbTokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !KB_STOP.has(w));
/** Scored matches from help_kb. `bad`-flagged entries skip. Returns [{id,q,a,source,verified,uses,score}] best-first. */
async function searchKbScored(question, max = 5) {
  try {
    const snap = await db.collection('help_kb').orderBy('updated_at', 'desc').limit(200).get();
    const qtArr = kbTokens(question);
    const qt = new Set(qtArr);
    if (!qt.size) return { hits: [], qTokens: 0 };
    const scored = snap.docs.map((d) => {
      const e = d.data();
      if (e.bad) return null;
      const et = kbTokens(e.q + ' ' + (e.a || '').slice(0, 200) + ' ' + (e.tags || []).join(' '));
      const hits = et.filter((w) => qt.has(w)).length;
      // verified/ticket/manual entries ko halka boost
      const boost = (e.verified || (e.source && e.source !== 'ai')) ? 1 : 0;
      return { id: d.id, e, score: hits + boost };
    }).filter((x) => x && x.score >= 2).sort((a, b) => b.score - a.score).slice(0, max);
    return {
      qTokens: qtArr.length,
      hits: scored.map((x) => ({
        id: x.id, q: x.e.q, a: x.e.a, source: x.e.source || 'ai',
        verified: !!x.e.verified, uses: x.e.uses || 0, score: x.score,
      })),
    };
  } catch (err) { console.error('searchKb', err.message || err); return { hits: [], qTokens: 0 }; }
}
// backward-compat wrapper (callAI kb param)
async function searchKb(question, max = 3) {
  return (await searchKbScored(question, max)).hits.slice(0, max).map((h) => ({ q: h.q, a: h.a, verified: h.verified, source: h.source }));
}

// "Punt" jawab — AI ne actually solve nahi kiya, ticket/admin par taal diya.
// Aise jawab KB me cache nahi karte (warna galat "training data" ban jaata hai).
function isPunt(answer) {
  const a = String(answer || '').toLowerCase();
  return /raise a ticket|raise a support|support ticket|ticket (raise|daal|kar)|admin se (pooch|puch|contact|baat)|admin ko (pooch|puch|contact)|ask (your |the )?admin|contact (your |the )?admin|not (mentioned|covered|available|in the knowledge|part of)|knowledge (me|mein|base me)|specifically mention|mujhe (nahi pata|nahi maloom|jaankari nahi)|i (don'?t|do not) have (that|this|the) (info|information|detail)|i'?m not sure how|cannot help with that/.test(a);
}

/** AI ka fresh jawab help_kb me cache karo (source:'ai', verified:false) taaki agli baar
 *  same sawaal turant mile. Near-duplicate ho to naya doc nahi — purane ka `uses` badhao. */
const GREET_RE = /^\s*(hi+|hello+|hey+|helo|yo|namaste|namaskar|namste|good\s*(morning|evening|afternoon)|salaam|hii)\b[\s!.]*$/i;
async function cacheAiAnswer(question, answer, role) {
  try {
    const q = String(question || '').trim().slice(0, 300);
    const a = String(answer || '').trim().slice(0, 1500);
    // greeting / bahut chhota / vague sawaal ya punt jawab -> cache mat karo
    if (q.length < 6 || a.length < 40 || isPunt(a) || GREET_RE.test(q) || kbTokens(q).length < 3) return null;
    const { hits, qTokens } = await searchKbScored(q, 1);
    if (hits[0] && qTokens && hits[0].score >= Math.max(6, qTokens * 0.8)) {
      await db.doc('help_kb/' + hits[0].id).set({ uses: FV.increment(1), updated_at: FV.serverTimestamp() }, { merge: true });
      return hits[0].id;
    }
    const refNew = await db.collection('help_kb').add({
      q, a, tags: kbTokens(q).slice(0, 8),
      source: 'ai', verified: false, bad: false, uses: 0, role: role || '',
      created_at: FV.serverTimestamp(), updated_at: FV.serverTimestamp(),
    });
    return refNew.id;
  } catch (err) { console.error('cacheAiAnswer', err.message || err); return null; }
}

exports.helpAsk = onDocumentWritten('help_queries/{id}', async (event) => {
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;

  // ── Feedback signal -> KB "training" ──
  // User ne 👍/👎 diya. Jis KB entry se ye jawab bana/aaya (cache_id) usko verify ya flag karo.
  if (before && before.helpful !== after.helpful && after.cache_id) {
    try {
      const kref = db.doc('help_kb/' + after.cache_id);
      if (after.helpful === true) {
        await kref.set({ verified: true, bad: false, uses: FV.increment(1), updated_at: FV.serverTimestamp() }, { merge: true });
      } else if (after.helpful === false) {
        await kref.set({ bad: true, updated_at: FV.serverTimestamp() }, { merge: true });
      }
    } catch (e) { console.error('kb feedback', e.message || e); }
    return;
  }

  if (after.status !== 'pending') return;
  const ref = event.data.after.ref;
  try {
    const secret = (await db.doc('config/ai_secret').get()).data() || {};
    const key = secret.api_key || secret.anthropic_key;
    if (!key) {
      await ref.set({ status: 'error', answer: 'AI is not set up yet — please raise a ticket and the admin will help.', answered_at: FV.serverTimestamp() }, { merge: true });
      return;
    }
    const hist = Array.isArray(after.history) ? after.history : [];
    const { hits, qTokens } = await searchKbScored(after.question);

    // ── Fast path: pehle se answered near-exact sawaal -> AI call skip ──
    // (sirf fresh sawaal par — follow-up me context chahiye. `bad`-flagged entries
    //  searchKbScored me pehle hi filter ho jaati hain, isliye yahan verified check nahi.)
    const top = hits[0];
    const strong = top && qTokens >= 3 && top.score >= Math.max(5, Math.ceil(qTokens * 0.8)) && !isPunt(top.a);
    if (!hist.length && strong) {
      await db.doc('help_kb/' + top.id).set({ uses: FV.increment(1), updated_at: FV.serverTimestamp() }, { merge: true });
      await ref.set({
        status: 'done', answer: top.a, from_kb: hits.length, served: 'cache',
        cache_id: top.id, answered_at: FV.serverTimestamp(),
      }, { merge: true });
      return;
    }

    const answer = await callAI({
      provider: secret.provider || (secret.anthropic_key ? 'anthropic' : 'nvidia'),
      key, model: secret.model, role: after.role, question: after.question,
      history: hist, kb: hits.filter((h) => !isPunt(h.a)).slice(0, 3),
    });
    // fresh sawaal ho to jawab cache karo (training). follow-up cache nahi karte.
    const cacheId = hist.length ? null : await cacheAiAnswer(after.question, answer, after.role);
    await ref.set({
      status: 'done', answer, from_kb: hits.length, served: 'ai',
      ...(cacheId ? { cache_id: cacheId } : {}),
      answered_at: FV.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error('helpAsk fail', e.message || e);
    const answer = e.overloaded
      ? 'The AI service is busy right now — please try again in a minute. If it keeps failing, raise a ticket below.'
      : 'Could not reach the AI right now. Please try again, or raise a ticket below.';
    await ref.set({ status: 'error', answer, error: String(e.message || e), answered_at: FV.serverTimestamp() }, { merge: true });
  }
});

async function adminEmails() {
  const snap = await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get();
  return snap.docs.map((d) => d.data().email).filter(Boolean);
}

exports.ticketCreated = onDocumentCreated('tickets/{id}', async (event) => {
  const tk = event.data && event.data.data();
  if (!tk) return;
  const id = event.params.id;
  const admins = (await db.collection('users').where('role', '==', 'admin').where('status', '==', 'active').get()).docs;
  for (const a of admins) {
    await db.collection('notifications').add({
      to_uid: a.id, type: 'ticket', title: 'New help ticket',
      body: (tk.by_name || 'Someone') + ' (' + (tk.role || '-') + '): ' + tk.subject,
      lead_id: null, ticket_id: id, read: false, created_at: FV.serverTimestamp(),
    });
  }
  try {
    const mail = await getMailTransport();
    const to = await adminEmails();
    if (mail && to.length) {
      const body = mbKV('From', esc(tk.by_name || '-') + ' <span style="color:#8a97a8;font-weight:400;">(' + esc(tk.role || '-') + ')</span>')
        + mbKV('Subject', esc(tk.subject))
        + mbKV('Detail', escBr(tk.detail || '-'))
        + (tk.ai_answer ? mbMuted('AI ne pehle ye jawab diya tha:') + mbQuote(escBr(tk.ai_answer)) : '')
        + mbMuted('User ko is ticket ka status CRM me dikhta rahega — solve karte hi unhe notify ho jayega.');
      await mail.transporter.sendMail({
        from: '"Paris Fashion CRM" <' + mail.email + '>',
        to: to.join(','),
        subject: 'New help ticket — ' + tk.subject,
        html: emailShell({
          heading: 'New help ticket',
          preheader: (tk.by_name || 'Someone') + ': ' + tk.subject,
          bodyHtml: body,
          cta: { text: 'Open Tickets', url: MAIL_APP_URL + '/' },
        }),
      });
    }
  } catch (e) { console.error('ticket email failed (non-fatal)', e.message || e); }
});

exports.ticketResolved = onDocumentWritten('tickets/{id}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after || !before) return;
  const statusChanged = before.status !== after.status;
  const noteChanged = (before.admin_note || '') !== (after.admin_note || '') && !!after.admin_note;
  // status badla, ya admin ne update-remark likha (taaki user ko pata chale kaam ho raha hai)
  if (!statusChanged && !noteChanged) return;
  if (after.status !== 'solved' && after.status !== 'progress') return;

  const title = after.status === 'solved' ? 'Your ticket is solved' : 'Update on your ticket';
  const body = '"' + after.subject + '"'
    + (after.admin_note ? ' — ' + after.admin_note : (after.status === 'progress' ? ' — admin is on it' : ''));
  await db.collection('notifications').add({
    to_uid: after.by_uid, type: 'ticket', title, body,
    lead_id: null, ticket_id: event.params.id, read: false, created_at: FV.serverTimestamp(),
  });

  // Ticket owner ko email bhi — status update / solved
  try {
    const mail = await getMailTransport();
    const owner = (await db.doc('users/' + after.by_uid).get()).data();
    if (mail && owner && owner.email) {
      const solved = after.status === 'solved';
      const eBody = mbP(solved
        ? 'Aapki help ticket <b>solve</b> ho gayi hai. 🎉'
        : 'Aapki help ticket par admin kaam kar raha hai — latest update niche hai.')
        + mbKV('Subject', esc(after.subject))
        + (after.admin_note ? mbKV('Admin ka jawab', escBr(after.admin_note)) : '')
        + (after.ai_answer ? mbMuted('AI ka pehla jawab:') + mbQuote(escBr(after.ai_answer)) : '')
        + (solved ? mbMuted('Agar issue phir aaye to CRM ke Help section me dobara pooch sakte hain.') : '');
      await mail.transporter.sendMail({
        from: '"Paris Fashion CRM" <' + mail.email + '>',
        to: owner.email,
        subject: (solved ? 'Solved — ' : 'Update — ') + after.subject,
        html: emailShell({
          heading: solved ? 'Your ticket is solved' : 'Update on your ticket',
          preheader: after.admin_note || after.subject,
          bodyHtml: eBody,
          cta: { text: 'Open Help', url: MAIL_APP_URL + '/' },
        }),
      });
    }
  } catch (e) { console.error('ticket owner email failed (non-fatal)', e.message || e); }

  // SOLVED + note -> knowledge base entry (agar admin ne "add to KB" off na kiya ho).
  // Isse AI dheere-dheere "train" hota hai — same issue agli baar turant answer.
  if (after.status === 'solved' && after.admin_note && after.kb_skip !== true) {
    const q = (after.subject || after.detail || '').slice(0, 300);
    if (q && !after.kb_id) {
      const kbRef = await db.collection('help_kb').add({
        q, a: after.admin_note.slice(0, 1500),
        tags: kbTokens(q + ' ' + (after.detail || '')).slice(0, 8),
        source: 'ticket', ticket_id: event.params.id,
        by: after.handled_by_name || 'admin', uses: 0,
        created_at: FV.serverTimestamp(), updated_at: FV.serverTimestamp(),
      });
      await event.data.after.ref.set({ kb_id: kbRef.id }, { merge: true });
    }
  }
});
