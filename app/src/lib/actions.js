// Lead pe action — activity likho + lead update karo + (order ho to) order likho. Ek transaction jaisा flow.
import {
  doc, collection, serverTimestamp, writeBatch, increment, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { computeScore } from './scoring';

const LOST = ['lost', 'dead'];

/**
 * @param {object} p
 *   lead        {id, status, sales_status, ...}
 *   actor       {uid, name}
 *   role        'ldr' | 'sales' | 'admin'
 *   toStage     e.g. 'call back' | 'qualified' | 'order done' | 'lost'
 *   remark      string (required)
 *   nextFollowup Date | null
 *   formAnswers  {label: value}  (merge)
 *   assignSalesUid string | null   (ldr/admin qualifying -> assign)
 *   assignSalesName string | null  (History tab mein saaf dikhाने ke liye — "assigned to X")
 *   orderAmount  number | 0
 *   attemptLimit number | null   (LDR side — config Attempt_Limit; attempts>=isse aur stage terminal na ho to review_queue)
 */
// Sales-only stages — LDR ye kabhi set nahi kar sakta (chahe UI bug ho ya purana cache).
const SALES_ONLY_STAGES = ['hot lead', 'visit customer', 'visit done', 'video call', 'order done', 'order won', 'followup', 'follow up', 'meeting', 'demo'];

export async function logLeadAction(p) {
  const {
    lead, actor, role, toStage, remark, allowedStages = null,
    nextFollowup = null, formAnswers = null, assignSalesUid = null, assignSalesName = '', orderAmount = 0, attemptLimit = null,
  } = p;

  if (!remark || !remark.trim()) throw new Error('remark-required');
  const stage = String(toStage || '').toLowerCase().trim();
  if (!stage) throw new Error('stage-required'); // status/stage bharna zaroori — blank submit nahi

  // "Kiske paas hai" position se decide — sirf sales_uid hone se nahi (LDR ne qualify kiya =>
  // status 'qualified' => tab Sales ki). Isse admin bhi LDR-lead pe LDR-flow hi chalata hai.
  const leadAtSales = String(lead.status || '').toLowerCase() === 'qualified'
    || !!String(lead.sales_status || '').trim();
  const isSales = role === 'sales' ? true : role === 'ldr' ? false : leadAtSales;

  // galat data guard — LDR Sales-stage set na kar sake, aur (agar list di ho) list ke bahar kuch na jaaye
  if (!isSales && SALES_ONLY_STAGES.includes(stage)) throw new Error('bad-stage-ldr');
  if (Array.isArray(allowedStages) && allowedStages.length && !allowedStages.map((s) => s.toLowerCase()).includes(stage)) {
    throw new Error('bad-stage');
  }

  const now = serverTimestamp();

  const batch = writeBatch(db);
  const leadRef = doc(db, 'leads', lead.id);

  // 1) activity
  const actRef = doc(collection(db, 'activity'));
  const isOrder = stage.includes('order');
  const action = isOrder ? 'order'
    : stage === 'qualified' ? 'stage_change'
      : LOST.includes(stage) ? 'stage_change'
        : 'stage_change';
  // `scheduled_for` = is action mein jo AGLI date set ki (history mein "5 Sep ko 12 Sep ka
  //   followup lagaya" dikhane ke liye).
  // `was_due_for` = action se PEHLE lead ki followup-date kya thi — isse pata chalta hai ki
  //   ye action KIS din ka due followup pura kar raha hai. Iske bina "us din kitne followup
  //   due the aur kitne hue" retroactively nikalna namumkin hai, kyunki action hote hi
  //   next_followup aage khisak jaati hai aur purani date kahin store hi nahi hoti thi.
  const prevDue = lead.next_followup?.toDate ? lead.next_followup.toDate() : null;
  batch.set(actRef, {
    lead_id: lead.id,
    lead_name: lead.name || '',
    at: now,
    uid: actor.uid,
    actor_name: actor.name || '',
    action,
    from_status: (isSales ? lead.sales_status : lead.status) || '',
    to_status: stage,
    assigned_to_name: assignSalesUid ? (assignSalesName || '') : '',
    amount: orderAmount || 0,
    channel: 'app',
    scheduled_for: nextFollowup instanceof Date && !isNaN(nextFollowup) ? Timestamp.fromDate(nextFollowup) : null,
    was_due_for: prevDue ? Timestamp.fromDate(prevDue) : null,
    remark: remark.trim().slice(0, 500),
  });

  // 2) lead update
  const upd = {
    updated_at: now,
    last_action_at: now,
    last_action_by: actor.uid,
    last_action_by_name: actor.name || '',
    reinq_open: false, // re-inquiry ke baad owner ne ab kaam kar liya -> "pending" se hata do
  };
  let sentToReview = false;
  if (isSales) upd.sales_status = stage;
  else {
    upd.status = stage;
    const newAttempts = (lead.attempts || 0) + 1;
    upd.attempts = increment(1);
    // fresh pool se uthaya -> ab ye LDR ka ho gaya
    if (!lead.ldr_uid) { upd.ldr_uid = actor.uid; upd.ldr_name = actor.name || ''; }
    const isTerminal = stage === 'qualified' || LOST.includes(stage);
    if (isTerminal) {
      upd.review_queue = false;
      upd.review_reason = '';
    } else if (attemptLimit && newAttempts >= attemptLimit) {
      upd.review_queue = true;
      upd.review_reason = 'attempt_limit';
      sentToReview = true;
    } else {
      upd.review_queue = false;
      upd.review_reason = '';
    }
  }
  if (nextFollowup instanceof Date && !isNaN(nextFollowup)) {
    upd.next_followup = Timestamp.fromDate(nextFollowup);
    // nayi followup date -> purane SLA alert-flags reset, warna agla cycle notify nahi karega
    upd.sla_followup_alerted = false;
    upd.sla_followup_due_alerted = false;
  } else if (LOST.includes(stage) || isOrder || sentToReview) {
    upd.next_followup = null;
  }
  if (formAnswers && typeof formAnswers === 'object') {
    upd.form_answers = formAnswers;
    for (const [k, label] of Object.entries(FLAT_FIELDS)) {
      if (label in formAnswers) upd[k] = String(formAnswers[label] || '').trim();
    }
  }
  // lead score refresh (naye answers + latest state se)
  const { score, tier } = computeScore({ ...lead, ...upd, form_answers: formAnswers || lead.form_answers });
  upd.score = score;
  upd.tier = tier;
  if (assignSalesUid) {
    upd.sales_uid = assignSalesUid;
    upd.assigned_sales_at = now;
  }
  if (stage === 'qualified') upd.qualified_at = upd.qualified_at || now;
  if (LOST.includes(stage)) { upd.closed_at = now; upd.outcome = 'lost'; }

  // 3) order
  if (isOrder && orderAmount > 0) {
    const ordRef = doc(collection(db, 'orders'));
    batch.set(ordRef, {
      lead_id: lead.id,
      lead_name: lead.name || '',
      order_date: now,
      amount: orderAmount,
      sales_uid: actor.uid,
      sales_name: actor.name || '',
      remark: remark.trim().slice(0, 300),
      source: 'app',
    });
    upd.order_count = increment(1);
    upd.total_revenue = increment(orderAmount);
    upd.last_order_at = now;
    upd.outcome = 'customer';
  }

  // Live Monitor "kisne aakhri baar kaam kiya" — user doc pe timestamp (Monitor bina extra
  // query ke ye padh leta hai). Presence heartbeat (last_seen) sirf "app khuli hai" batata hai;
  // ye "asli kaam" ka signal hai.
  if (actor.uid) batch.set(doc(db, 'users', actor.uid), { last_worked_at: now }, { merge: true });

  batch.update(leadRef, upd);
  await batch.commit();
  return { sentToReview };
}

const FLAT_FIELDS = {
  f_customer_type: 'Customer Type',
  f_bulk: 'Bulk Requirement?',
  f_intent: 'Buying Intent',
  f_interested_in: 'Customer Interested In',
  f_quantity: 'Approx Quantity Interested In',
};

/**
 * Urgent re-inquiry / resurrection — customer dobara aaya.
 * Lead ko turant "abhi" schedule karta hai, urgent flag, activity log.
 * @param newAssignee  optional { uid, name, role } — kisi aur ko de do (sirf owner-fields wale rules —
 *                     effectively admin; non-admin caller ke paas ye fields save nahi honge, rule block karegi).
 */
export async function markUrgent(lead, actor, remark, newAssignee) {
  const now = serverTimestamp();
  const batch = writeBatch(db);
  const leadRef = doc(db, 'leads', lead.id);

  const fromArchive = !!lead.archived;
  const upd = {
    is_urgent: true,
    urgent_at: now, // re-inquiry kab hui — dashboard "Re-Inquiry" section date-range isi pe filter karta hai
    reinq_open: true, // owner ne re-inquiry ke baad abhi kaam nahi kiya -> "pending" me dikhao
    next_followup: now,
    updated_at: now, last_action_at: now,
    last_action_by: actor.uid, last_action_by_name: actor.name || '',
    outcome: '', closed_at: null,
    sla_fresh_alerted: false, sla_followup_alerted: false,
    sla_followup_due_alerted: false, // re-inquiry par followup reminder dobara arm
  };
  if (fromArchive) {
    // archive (WhatsApp campaign) ke baad customer dobara aaya -> list me wapas + track flag
    upd.archived = false;
    upd.archived_at = null;
    upd.reinq_after_archive = true;
    upd.reinq_after_archive_at = now;
    upd.reinq_after_archive_count = increment(1);
  }
  if (newAssignee?.uid) {
    if (newAssignee.role === 'sales') {
      // Sales ko dena = qualified hand-off
      upd.sales_uid = newAssignee.uid; upd.sales_name = newAssignee.name || '';
      upd.assigned_sales_at = now; upd.sales_status = 'followup';
      upd.status = 'qualified';
    } else {
      upd.ldr_uid = newAssignee.uid; upd.ldr_name = newAssignee.name || '';
      upd.status = 'call back';
    }
  } else {
    // dobara kholo — jiske paas thi usi ko wapas
    if (lead.sales_uid) upd.sales_status = 'followup';
    else upd.status = 'call back';
  }

  batch.update(leadRef, upd);
  if (lead.phone_digits) {
    batch.set(doc(db, 'phone_index', lead.phone_digits), {
      stage: upd.sales_status || upd.status || lead.sales_status || lead.status || '',
      owner_name: upd.sales_name || upd.ldr_name || lead.sales_name || lead.ldr_name || '',
    }, { merge: true });
  }
  batch.set(doc(collection(db, 'activity')), {
    lead_id: lead.id, lead_name: lead.name || '', at: now,
    uid: actor.uid, actor_name: actor.name || '', action: 'urgent',
    from_status: lead.sales_status || lead.status || '', to_status: fromArchive ? 'reinquiry after archive' : 'urgent re-inquiry',
    assigned_to_name: newAssignee?.name || '',
    amount: 0, channel: 'app',
    remark: ((fromArchive ? '🔁 Archive (WhatsApp campaign) ke baad dobara enquiry. ' : '') + (remark || 'Customer ne dobara contact kiya')).slice(0, 500),
  });
  await batch.commit();
}

/**
 * Manager review-queue resolve: "more attempts do" — attempts reset, review flag clear,
 * LDR ko wapas normal follow-up flow mein bhejo.
 */
export async function giveMoreAttempts(lead, actor, remark) {
  const now = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(doc(db, 'leads', lead.id), {
    attempts: 0, review_queue: false, review_reason: '',
    updated_at: now, last_action_at: now, last_action_by: actor.uid, last_action_by_name: actor.name || '',
  });
  batch.set(doc(collection(db, 'activity')), {
    lead_id: lead.id, lead_name: lead.name || '', at: now,
    uid: actor.uid, actor_name: actor.name || '', action: 'review_resolve',
    from_status: 'review queue', to_status: lead.status || '',
    amount: 0, channel: 'app', remark: (remark || 'More attempts given').slice(0, 500),
  });
  await batch.commit();
}

/**
 * Admin manual reassign — kisi bhi khuli lead ka LDR/Sales owner seedha badlo.
 * Sirf admin ke paas leads.update ka full access hai (rules), isliye caller admin hona chahiye.
 * @param assignee {ldr_uid?, ldr_name?, sales_uid?, sales_name?}  — jo key di, wahi field update hoga
 */
export async function reassignLead(lead, actor, assignee) {
  const now = serverTimestamp();
  const batch = writeBatch(db);
  const leadRef = doc(db, 'leads', lead.id);
  const upd = {
    updated_at: now, last_action_at: now,
    last_action_by: actor.uid, last_action_by_name: actor.name || '',
  };
  const changes = [];
  if ('ldr_uid' in assignee) {
    upd.ldr_uid = assignee.ldr_uid || null;
    upd.ldr_name = assignee.ldr_name || '';
    changes.push({ field: 'ldr', from: lead.ldr_name || '—', to: assignee.ldr_name || '—' });
  }
  if ('sales_uid' in assignee) {
    upd.sales_uid = assignee.sales_uid || null;
    upd.sales_name = assignee.sales_name || '';
    upd.assigned_sales_at = assignee.sales_uid ? now : null;
    changes.push({ field: 'sales', from: lead.sales_name || '—', to: assignee.sales_name || '—' });
  }
  if (changes.length === 0) return { changed: 0 };

  batch.update(leadRef, upd);
  batch.set(doc(collection(db, 'activity')), {
    lead_id: lead.id, lead_name: lead.name || '', at: now,
    uid: actor.uid, actor_name: actor.name || '', action: 'reassign',
    from_status: lead.sales_status || lead.status || '', to_status: lead.sales_status || lead.status || '',
    amount: 0, channel: 'app',
    remark: changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(' · ').slice(0, 500),
  });
  batch.set(doc(collection(db, 'audit')), {
    at: now, uid: actor.uid, actor_name: actor.name || '',
    action: 'lead.reassign', target: lead.name || `#${lead.id}`, changes,
  });
  if (lead.phone_digits) {
    batch.set(doc(db, 'phone_index', lead.phone_digits), {
      owner_name: upd.sales_name || upd.ldr_name || lead.sales_name || lead.ldr_name || '',
    }, { merge: true });
  }
  await batch.commit();
  return { changed: changes.length };
}
