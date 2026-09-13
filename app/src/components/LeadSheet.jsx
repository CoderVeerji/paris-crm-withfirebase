import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { useConfig, salesUsers, ldrUsers, splitList } from '../config';
import { getLead, updateLeadInfo } from '../lib/leads';
import { fetchLeadActivity, fetchLeadOrders } from '../lib/activity';
import { logLeadAction, reassignLead, giveMoreAttempts } from '../lib/actions';
import { fmtStatus, fmtDateTime, fmtDate } from '../lib/format';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { useBackClose } from '../lib/useBackClose';
import { can } from '../lib/permissions';
import CountryPicker from './CountryPicker';
import WaIcon from './WaIcon';
import { byCode, phoneLenOk, splitDigits } from '../lib/countries';
import { markCalling } from '../lib/callLog';
import { waLink } from '../lib/waMessage';

const ACT_ICON = {
  created: 'fa-circle-plus', order: 'fa-sack-dollar', assigned: 'fa-user-check',
  assign: 'fa-user-check', reassign: 'fa-arrows-rotate', urgent: 'fa-triangle-exclamation',
  stage_change: 'fa-arrow-right', note: 'fa-comment', bulk: 'fa-layer-group', review_resolve: 'fa-gavel',
};
const fmtDT = fmtDateTime;

const SB = {
  fresh: 'bg-fresh', new: 'bg-fresh', qualified: 'bg-qualified', 'call back': 'bg-callback',
  callback: 'bg-callback', 'no answer': 'bg-callback', followup: 'bg-callback', 'hot lead': 'bg-callback',
  'visit customer': 'bg-callback', 'video call': 'bg-callback',
  dead: 'bg-lost', lost: 'bg-lost', 'order done': 'bg-order', 'order won': 'bg-order',
};
const statusBadge = (s) => SB[String(s || '').toLowerCase().trim()] || 'bg-default';

// Purani (migrated) activity me `scheduled_for` field nahi hota — us waqt ki notes-text me
// "📅 Scheduled: 15-Jun-2026 11:00 AM" jaisa hota tha. Remark/action-text se wo date nikaal lo.
function schedFromText(a) {
  if (a.scheduled_for) return null;
  const m = String(a.remark || '').match(/(?:scheduled|📅)[:\s]*([0-9]{1,2}[-/][A-Za-z0-9]{2,4}[-/][0-9]{2,4}(?:\s+[0-9:]{3,5}\s*(?:AM|PM)?)?)/i);
  return m ? m[1].trim() : null;
}
// Kaun sa "kaam hua" — action label
function actLabel(a, t) {
  const map = {
    created: t('tlCreated'), order: t('tlOrder'), assigned: t('tlAssigned'), assign: t('tlAssigned'),
    reassign: t('tlReassign'), urgent: t('tlReinq'), review_resolve: t('tlReview'), bulk: t('tlBulk'),
    note: t('tlNote'),
  };
  if (map[a.action]) return map[a.action];
  return t('tlStageChange');
}

export default function LeadSheet({ lead: leadIn, onClose, onSaved }) {
  const { user, role } = useAuth();
  const cfg = useConfig();
  const { t } = useT();

  const [lead, setLead] = useState(leadIn);
  // Owner ka naam HAMESHA uid se resolve karo (users config se) — stored ldr_name/sales_name stale ho
  // sakta hai (reassign ke baad, ya user rename). Isse "Sonu 2nd" jaisa purana naam nahi atkega.
  const ownerLabel = (uid, storedName) => {
    if (!uid) return storedName || '—';
    const u = (cfg.users || []).find((x) => x.id === uid);
    if (!u) return storedName ? `${storedName} (removed)` : '—';
    return (u.status && u.status !== 'active') ? `${u.full_name} (inactive)` : u.full_name;
  };
  const [acts, setActs] = useState(null);
  const [orders, setOrders] = useState(null);
  const [tab, setTab] = useState('action');
  const [editing, setEditing] = useState(false);

  // action form state
  // Lead "kiske paas" hai isse decide hota hai kaun se stages dikhein — sirf sales_uid hone se nahi.
  // LDR jab tak "Qualified" na kare tab tak lead LDR ki hai (sales_status khaali). Qualified hote hi Sales ki.
  const leadAtSales = String(leadIn.status || '').toLowerCase() === 'qualified'
    || !!String(leadIn.sales_status || '').trim();
  const isSalesFlow = role === 'sales' ? true
    : role === 'ldr' ? false
      : leadAtSales; // admin / md / tl → lead ke position ke hisaab se
  const roleStages = useMemo(() => {
    const list = (cfg.stages || []).filter((s) => s.role === 'both' || s.role === (isSalesFlow ? 'sales' : 'ldr'));
    if (list.length) return list.map((s) => ({
      name: s.name.toLowerCase(), label: s.name, req: s.requires_date === 'Yes',
      // "shows_form" config OR (backward-compat) stage literally named "qualified"
      form: s.shows_form === 'Yes' || s.name.toLowerCase() === 'qualified',
    }));
    return isSalesFlow
      ? [{ name: 'followup', label: 'Follow-up', req: true }, { name: 'order done', label: 'Order Done', req: false }, { name: 'lost', label: 'Lost', req: false }]
      : [{ name: 'call back', label: 'Call Back', req: true }, { name: 'qualified', label: 'Qualified', req: false, form: true }, { name: 'lost', label: 'Lost', req: false }];
  }, [cfg.stages, isSalesFlow]);

  const [stage, setStage] = useState(roleStages[0]?.name || 'call back');
  const [nextDt, setNextDt] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [answers, setAnswers] = useState(() => lead.form_answers || {});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const errRef = useRef(null);
  const fail = (msg) => { setErr(msg); setTimeout(() => errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30); };

  // Action tab mein kuch type/select kiya (chahe abhi kisi aur tab par ho) — galti se scrim/X/back se band na ho jaaye.
  const dirty = remark.trim() !== '' || amount !== '' || nextDt !== '';
  const attemptClose = () => { if (dirty && !window.confirm(t('confirmDiscard'))) return; onClose(); };
  const blockEnterSubmit = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.preventDefault(); };
  useBackClose(true, attemptClose);

  const stageObj = roleStages.find((s) => s.name === stage);
  const isOrder = stage.includes('order');
  const isLost = stage === 'lost' || stage === 'dead';
  const isQualify = stage === 'qualified';
  // order / lost = terminal, inme agli call ki date nahi chahiye
  const needsDate = !!stageObj?.req && !isOrder && !isLost;

  // full detail (form_answers/notes) agar list se aadhoora aaya
  useEffect(() => {
    let alive = true;
    if (lead.form_answers == null) {
      getLead(lead.id).then((full) => { if (alive && full) { setLead(full); setAnswers(full.form_answers || {}); } });
    }
    return () => { alive = false; };
  }, [lead.id]);

  useEffect(() => {
    let alive = true;
    fetchLeadActivity(lead.id).then((a) => { if (alive) setActs(a); }).catch(() => alive && setActs([]));
    return () => { alive = false; };
  }, [lead.id]);

  useEffect(() => {
    let alive = true;
    if (lead.order_count > 0) fetchLeadOrders(lead.id).then((o) => { if (alive) setOrders(o); }).catch(() => alive && setOrders([]));
    else setOrders([]);
    return () => { alive = false; };
  }, [lead.id, lead.order_count]);

  // LDR side: custom fields sirf un stages pe jinme admin ne "Ask qualification form?" ON kiya hai
  // (Stage Builder). Default: "qualified" naam wale stage pe ON. Call Back / Lost pe fast rahe.
  // Sales side: unchanged.
  const showCustomFields = isSalesFlow || !!stageObj?.form;
  const editableForms = showCustomFields ? (cfg.forms || []).filter(
    (f) => ['admin', 'md', 'tl'].includes(role) || f.role_edit === 'both' || f.role_edit === (isSalesFlow ? 'sales' : 'ldr'),
  ) : [];
  const readOnlyAnswers = Object.entries(answers).filter(
    ([k, v]) => v && !editableForms.some((f) => f.label === k),
  );

  const attemptLimit = Number(cfg.settings?.Attempt_Limit) || null;
  const willHitLimit = !isSalesFlow && !isQualify && stage !== 'dead' && stage !== 'lost'
    && attemptLimit && (lead.attempts || 0) + 1 >= attemptLimit;

  async function save(e) {
    e.preventDefault();
    setErr('');
    if (!remark.trim()) return fail(t('remarkReq'));
    if (needsDate && !nextDt) return fail(t('dateReq'));
    if (isOrder && !(Number(amount) > 0)) return fail(t('amountReq'));
    const missing = editableForms.find((f) => f.is_mandatory === 'Yes' && !String(answers[f.label] || '').trim());
    if (missing) return fail(fill(t('fieldReq'), { f: missing.label }));
    setSaving(true);
    try {
      const r = await logLeadAction({
        lead, role,
        actor: { uid: user.id, name: user.full_name },
        toStage: stage,
        allowedStages: roleStages.map((s) => s.name),
        remark: remark.trim(),
        nextFollowup: nextDt ? new Date(nextDt) : null,
        formAnswers: answers,
        assignSalesUid: isQualify ? (assignTo || null) : null,
        assignSalesName: isQualify ? (salesUsers(cfg).find((u) => u.id === assignTo)?.full_name || '') : '',
        orderAmount: isOrder ? Number(amount) : 0,
        attemptLimit,
      });
      toast(r?.sentToReview ? t('rqSentToast') : `${t('saveAction')} ✓ — ${fmtStatus(stage)}`);
      onSaved?.();
      onClose();
    } catch (e2) {
      console.error(e2);
      fail(e2.message === 'remark-required' ? t('remarkReq')
        : (e2.message === 'bad-stage-ldr' || e2.message === 'bad-stage') ? t('badStage')
          : t('saveFail'));
    } finally {
      setSaving(false);
    }
  }

  const st = isSalesFlow ? (lead.sales_status || lead.status) : lead.status;
  const dial = lead.phone_raw || lead.phone;

  // Compact qualification-answer strip — LDR ne form bhara, Sales ko call karte waqt ek nazar mein
  // "kaun hai / kya chahiye" dikh jaaye (details tab kholne ki zaroorat nahi).
  const SIGNAL = ['customer type', 'bulk', 'buying intent', 'interested', 'quantity', 'budget', 'capacity', 'purpose'];
  const sigRank = (k) => { const i = SIGNAL.findIndex((s) => k.toLowerCase().includes(s)); return i < 0 ? 99 : i; };
  const shortLbl = (k) => k.replace(/\?$/, '').replace(/\s*\(.*\)\s*/g, '').replace(/approx\.?\s*/i, '').trim();
  const answerStrip = Object.entries(lead.form_answers || {})
    .filter(([, v]) => String(v || '').trim())
    .sort((a, b) => sigRank(a[0]) - sigRank(b[0]));
  const wa = (lead.phone_digits || '').replace(/\D/g, '');
  const waHref = waLink(wa, cfg.settings?.Whatsapp_Template, {
    name: lead.name, user: user.full_name, company: cfg.settings?.Company_Name,
  });

  return (
    <div className="sheet-scrim" onClick={attemptClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />

        <div className="ls-head">
          <div>
            <div className="ls-name">{lead.name || t('noName')}</div>
            <div className="ls-phone">{lead.phone || lead.phone_raw || '—'}</div>
            <div className="ls-tags">
              {lead.source && <span className="ls-chip">{lead.source}</span>}
              {lead.city && <span className="ls-chip">{lead.city}</span>}
              {!isSalesFlow && <span className="ls-chip">{t('attempt')}: {lead.attempts || 0}</span>}
              <span className="ls-chip">{fmtStatus(st)}</span>
              {lead.review_queue && <span className="ls-chip rq"><i className="fas fa-gavel" /> {t('cReviewQueue')}</span>}
              {lead.reinq_after_archive && <span className="ls-chip rq"><i className="fas fa-arrow-rotate-left" /> {t('lsReinqArchive')}{lead.reinq_after_archive_count > 1 ? ` ×${lead.reinq_after_archive_count}` : ''}</span>}
            </div>
          </div>
          <button className="icon-btn dark" onClick={attemptClose}><i className="fas fa-xmark" /></button>
        </div>

        <div className="ls-quick">
          {dial && <a className="btn act-call" href={`tel:${dial}`} onClick={() => markCalling(lead.id)}><i className="fas fa-phone" /> {t('call')}</a>}
          {wa && <a className="btn act-wa" href={waHref} target="_blank" rel="noreferrer"><WaIcon /> {t('whatsapp')}</a>}
        </div>

        {answerStrip.length > 0 && (
          <button type="button" className="ls-fstrip" onClick={() => setTab('details')} title={t('tabDetails')}>
            {answerStrip.slice(0, 5).map(([k, v]) => (
              <span className="ls-fchip" key={k}><em>{shortLbl(k)}</em> {String(v).length > 22 ? String(v).slice(0, 22) + '…' : v}</span>
            ))}
            {answerStrip.length > 5 && <span className="ls-fchip more">+{answerStrip.length - 5}</span>}
          </button>
        )}

        <div className="ls-tabs">
          <button className={tab === 'action' ? 'on' : ''} onClick={() => setTab('action')}>{t('tabAction')}</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>{t('tabHistory')}{acts ? ` (${acts.length})` : ''}</button>
          <button className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>{t('tabDetails')}</button>
        </div>

        {tab === 'action' && (
          <form onSubmit={save} onKeyDown={blockEnterSubmit} className="ls-form">
            <div ref={errRef}>{err && <div className="alert alert-error">{err}</div>}</div>

            {lead.review_queue && <div className="alert alert-error"><i className="fas fa-gavel" /> {t('rqBanner')}</div>}
            {!lead.review_queue && willHitLimit && <div className="alert alert-warn"><i className="fas fa-triangle-exclamation" /> {t('rqWarn')}</div>}

            <div className="form-group">
              <label>{t('nextStage')} *</label>
              <select className="form-control" value={stage} onChange={(e) => setStage(e.target.value)}>
                {roleStages.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
              </select>
            </div>

            {needsDate && (
              <div className="form-group">
                <label style={{ color: 'var(--warning)' }}>{t('nextCallAt')} *</label>
                <input type="datetime-local" className="form-control" required value={nextDt}
                  onChange={(e) => setNextDt(e.target.value)} />
              </div>
            )}

            {isQualify && (
              <div className="form-group">
                <label style={{ color: 'var(--navy-accent)' }}>{t('assignSales')}</label>
                <select className="form-control" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  <option value="">{t('assignLater')}</option>
                  {salesUsers(cfg).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
                {!assignTo && <p className="field-hint">{t('assignAutoHint')}</p>}
              </div>
            )}

            {isOrder && (
              <div className="form-group">
                <label style={{ color: 'var(--success)' }}>{t('dealAmount')} (₹) *</label>
                <input type="number" inputMode="numeric" className="form-control" required min="1" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
              </div>
            )}

            {editableForms.map((f) => (
              <div className="form-group" key={f.id || f.label}>
                <label>{f.label}{f.is_mandatory === 'Yes' ? ' *' : ''}</label>
                <DynField f={f} value={answers[f.label] || ''} onChange={(v) => setAnswers((a) => ({ ...a, [f.label]: v }))} />
              </div>
            ))}

            <div className="form-group">
              <label>{t('remark')} *</label>
              <textarea className="form-control" rows={3} required value={remark} onChange={(e) => setRemark(e.target.value)}
                placeholder={t('remarkPlaceholder')} />
            </div>

            <button className="btn btn-primary btn-block" disabled={saving}>
              {saving ? t('wait') : t('saveAction')}
            </button>
          </form>
        )}

        {tab === 'history' && (
          <div className="ls-timeline">
            {acts == null ? <div className="skeleton" style={{ height: 160 }} />
              : acts.length === 0 ? <div className="empty"><i className="fas fa-clock-rotate-left" />{t('noHistory')}</div>
                : acts.map((a, ai) => {
                  const stg = a.to_status && a.to_status !== a.action ? a.to_status : '';
                  // purani entry me scheduled_for field nahi -> remark se, warna newest entry ke liye
                  // lead ki current next_followup (kyunki last action ne hi wo date set ki hogi)
                  const schedTxt = schedFromText(a)
                    || (ai === 0 && !a.scheduled_for && lead.next_followup
                        && ['call back', 'callback', 'no answer', 'followup', 'follow up'].includes(String(stg).toLowerCase())
                      ? fmtDate(lead.next_followup) : null);
                  return (
                  <div className="tl-item" key={a.id}>
                    <div className="tl-dot"><i className={`fas ${ACT_ICON[a.action] || 'fa-circle'}`} /></div>
                    <div className="tl-body">
                      <div className="tl-top">
                        <b>{actLabel(a, t)}</b>
                        <span>{fmtDT(a.at)}</span>
                      </div>
                      {stg && (
                        <div className="tl-stg">
                          {a.from_status ? <><span className="tl-sfrom">{fmtStatus(a.from_status)}</span> <i className="fas fa-arrow-right" /> </> : null}
                          <span className={`status-badge ${statusBadge(stg)}`}>{fmtStatus(stg)}</span>
                        </div>
                      )}
                      <div className="tl-who"><i className="fas fa-user" /> {a.actor_name || a.uid || '—'}{a.amount > 0 && ` · ₹${Number(a.amount).toLocaleString('en-IN')}`}</div>
                      {a.assigned_to_name && <div className="tl-assign"><i className="fas fa-arrow-right-to-bracket" /> {fill(t('tlAssignedTo'), { n: a.assigned_to_name })}</div>}
                      {a.was_due_for && (
                        <div className="tl-sched due"><i className="fas fa-clock-rotate-left" /> {fill(t('tlWasDueFor'), { d: fmtDate(a.was_due_for) })}</div>
                      )}
                      {(a.scheduled_for || schedTxt) && (
                        <div className="tl-sched"><i className="fas fa-calendar-plus" /> {fill(t('tlScheduledFor'), { d: a.scheduled_for ? fmtDate(a.scheduled_for) : schedTxt })}</div>
                      )}
                      {a.remark && <div className="tl-remark">{a.remark}</div>}
                    </div>
                  </div>
                  );
                })}
          </div>
        )}

        {tab === 'details' && !editing && (
          <div className="ls-details">
            <button className="btn btn-ghost btn-block" style={{ marginBottom: 10 }} onClick={() => setEditing(true)}>
              <i className="fas fa-pen" /> {t('editInfo')}
            </button>
            <Row k={t('ldr')} v={ownerLabel(lead.ldr_uid, lead.ldr_name)} />
            <Row k={t('sales')} v={ownerLabel(lead.sales_uid, lead.sales_name)} />
            <Row k={t('source')} v={lead.source} />
            <Row k="Email" v={lead.email} />
            <Row k={t('company')} v={lead.company} />
            <Row k={t('cityState')} v={[lead.city, lead.state].filter(Boolean).join(', ')} />
            <Row k={t('created')} v={fmtDT(lead.created_at)} />
            <Row k={t('followup')} v={fmtDT(lead.next_followup)} />
            {readOnlyAnswers.length > 0 && (
              <>
                <div className="ls-subhead">{t('collectedData')}</div>
                {readOnlyAnswers.map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
              </>
            )}

            {lead.order_count > 0 && (
              <>
                <div className="ls-subhead">{t('ordHistory')}</div>
                <Row k={t('orders')} v={`${lead.order_count} · ₹${Number(lead.total_revenue || 0).toLocaleString('en-IN')}`} />
                {lead.order_count > 1 && (
                  <Row k={t('ordAvg')} v={`₹${Math.round((lead.total_revenue || 0) / lead.order_count).toLocaleString('en-IN')}`} />
                )}
                {orders == null ? (
                  <div className="skeleton" style={{ height: 60, marginTop: 8 }} />
                ) : (
                  <div className="ls-timeline" style={{ marginTop: 6 }}>
                    {orders.map((o) => (
                      <div className="tl-item" key={o.id}>
                        <div className="tl-dot"><i className="fas fa-sack-dollar" /></div>
                        <div className="tl-body">
                          <div className="tl-top">
                            <b>₹{Number(o.amount || 0).toLocaleString('en-IN')}</b>
                            <span>{fmtDate(o.order_date)}</span>
                          </div>
                          <div className="tl-who">{o.sales_name || '—'}</div>
                          {o.remark && <div className="tl-remark">{o.remark}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {can(role, 'leads:reassign', cfg) && lead.review_queue && (
              <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 14 }}
                onClick={async () => {
                  try {
                    await giveMoreAttempts(lead, { uid: user.id, name: user.full_name });
                    toast(t('rqGiveMoreDone'));
                    setLead((L) => ({ ...L, attempts: 0, review_queue: false, review_reason: '' }));
                    onSaved?.();
                  } catch (e2) { console.error(e2); toast(friendlyError(e2, t), 'err'); }
                }}>
                <i className="fas fa-rotate-right" /> {t('rqGiveMore')}
              </button>
            )}

            {can(role, 'leads:reassign', cfg) && (
              <ReassignBox lead={lead} cfg={cfg} t={t}
                actor={{ uid: user.id, name: user.full_name }}
                onDone={(upd) => { setLead((L) => ({ ...L, ...upd })); onSaved?.(); }} />
            )}
          </div>
        )}

        {tab === 'details' && editing && (
          <EditInfo lead={lead} t={t} actor={{ uid: user.id, name: user.full_name }}
            onDone={(updated) => { setEditing(false); if (updated) { setLead((L) => ({ ...L, ...updated })); onSaved?.(); } }} />
        )}
      </div>
    </div>
  );
}

function EditInfo({ lead, t, actor, onDone }) {
  const split = splitDigits(lead.phone_digits);
  const [cc, setCc] = useState(split.cc);
  const [num, setNum] = useState(split.num);
  const [v, setV] = useState({
    name: lead.name || '', company: lead.company || '',
    city: lead.city || '', state: lead.state || '', email: lead.email || '', source: lead.source || '', alt_phone: lead.alt_phone || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const setK = (k, x) => setV((p) => ({ ...p, [k]: x }));

  const lenOk = !num || phoneLenOk(cc, num);
  const expectedLen = byCode(cc).len;
  const dirty = num !== split.num || Object.keys(v).some((k) => v[k] !== (lead[k] || ''));
  const blockEnterSubmit = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.preventDefault(); };
  const cancel = () => { if (dirty && !window.confirm(t('confirmDiscard'))) return; onDone(null); };

  async function save(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    if (!lenOk) { setErr(fill(t('nlPhoneLen'), { n: expectedLen[0] === expectedLen[1] ? expectedLen[0] : `${expectedLen[0]}-${expectedLen[1]}` })); setBusy(false); return; }
    try {
      const patch = { ...v, phone: `+${cc} ${num.trim()}` };
      const r = await updateLeadInfo(lead, patch, actor);
      toast(r.changed ? `${t('save')} ✓` : t('auditNoChange'));
      onDone(r.changed ? patch : null);
    } catch (e2) {
      setErr(e2.message === 'dup-phone' ? t('nlDupTitle') : friendlyError(e2, t));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} onKeyDown={blockEnterSubmit} className="ls-form">
      {err && <div className="alert alert-error">{err}</div>}
      <div className="form-group">
        <label>{t('nlName')}</label>
        <input className="form-control" value={v.name} onChange={(e) => setK('name', e.target.value)} />
      </div>
      <div className="form-group">
        <label>{t('nlPhone')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <CountryPicker value={cc} onChange={setCc} />
          <input className="form-control" type="tel" inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} />
        </div>
        {num && !lenOk && (
          <div className="ph-check bad"><i className="fas fa-circle-exclamation" /> {fill(t('nlPhoneLen'), { n: expectedLen[0] === expectedLen[1] ? expectedLen[0] : `${expectedLen[0]}-${expectedLen[1]}` })}</div>
        )}
      </div>
      {[['company', t('company')], ['city', t('nlCity')], ['state', t('nlState')], ['email', 'Email'], ['source', t('source')], ['alt_phone', t('nlAltPhone')]].map(([k, label]) => (
        <div className="form-group" key={k}>
          <label>{label}</label>
          <input className="form-control" type={k === 'email' ? 'email' : k.includes('phone') ? 'tel' : 'text'}
            value={v[k]} onChange={(e) => setK(k, e.target.value)} />
        </div>
      ))}
      <button className="btn btn-primary btn-block" disabled={busy || !lenOk}>{busy ? t('wait') : t('save')}</button>
      <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={cancel}>{t('cancel')}</button>
    </form>
  );
}

/** Admin-only — kisi bhi khuli lead ka LDR/Sales owner seedha badlo (bina stage-change flow ke) */
function ReassignBox({ lead, cfg, t, actor, onDone }) {
  const [open, setOpen] = useState(false);
  const [ldrUid, setLdrUid] = useState('');
  const [salesUid, setSalesUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go() {
    setErr(''); setBusy(true);
    try {
      const ldrPick = ldrUsers(cfg).find((u) => u.id === ldrUid);
      const salesPick = salesUsers(cfg).find((u) => u.id === salesUid);
      const assignee = {};
      if (ldrUid) { assignee.ldr_uid = ldrUid; assignee.ldr_name = ldrPick?.full_name || ''; }
      if (salesUid) { assignee.sales_uid = salesUid; assignee.sales_name = salesPick?.full_name || ''; }
      const r = await reassignLead(lead, actor, assignee);
      if (r.changed) { toast(t('reassignDone')); onDone(assignee); }
      setOpen(false); setLdrUid(''); setSalesUid('');
    } catch (e2) {
      console.error(e2);
      setErr(friendlyError(e2, t));
    } finally { setBusy(false); }
  }

  return (
    <div className="reassign-box">
      <div className="ls-subhead">{t('reassignTitle')}</div>
      {!open ? (
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setOpen(true)}>
          <i className="fas fa-arrows-rotate" /> {t('reassignTitle')}
        </button>
      ) : (
        <>
          {err && <div className="alert alert-error">{err}</div>}
          <div className="form-group"><label>{t('reassignLdr')}</label>
            <select className="form-control" value={ldrUid} onChange={(e) => setLdrUid(e.target.value)}>
              <option value="">{t('reassignNoChange')}</option>
              {ldrUsers(cfg).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select></div>
          <div className="form-group"><label>{t('reassignSales')}</label>
            <select className="form-control" value={salesUid} onChange={(e) => setSalesUid(e.target.value)}>
              <option value="">{t('reassignNoChange')}</option>
              {salesUsers(cfg).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select></div>
          <button type="button" className="btn btn-primary btn-block" disabled={busy || (!ldrUid && !salesUid)} onClick={go}>
            {busy ? t('wait') : t('reassignSave')}
          </button>
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setOpen(false)}>{t('cancel')}</button>
        </>
      )}
    </div>
  );
}

const Row = ({ k, v }) => (v ? <div className="ls-row"><span>{k}</span><b>{v}</b></div> : null);

/** Dynamic form field — sabhi types handle karta hai */
export function DynField({ f, value, onChange }) {
  const opts = splitList(f.options);
  switch (f.type) {
    case 'textarea':
      return <textarea className="form-control" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input className="form-control" type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input className="form-control" type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input className="form-control" type="tel" inputMode="tel" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input className="form-control" type="email" inputMode="email" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'url':
      return <input className="form-control" type="url" inputMode="url" placeholder="https://" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return (
        <label className="dyn-check">
          <input type="checkbox" checked={value === 'Yes'} onChange={(e) => onChange(e.target.checked ? 'Yes' : 'No')} />
          <span>{value === 'Yes' ? 'Yes' : 'No'}</span>
        </label>
      );
    case 'dropdown':
      return (
        <select className="form-control" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'multiselect': {
      const sel = new Set(String(value).split(',').map((x) => x.trim()).filter(Boolean));
      const toggle = (o) => { sel.has(o) ? sel.delete(o) : sel.add(o); onChange([...sel].join(', ')); };
      return (
        <div className="dyn-multi">
          {opts.map((o) => (
            <button type="button" key={o} className={`dyn-opt ${sel.has(o) ? 'on' : ''}`} onClick={() => toggle(o)}>
              <i className={`fas ${sel.has(o) ? 'fa-square-check' : 'fa-square'}`} /> {o}
            </button>
          ))}
        </div>
      );
    }
    default:
      return <input className="form-control" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
