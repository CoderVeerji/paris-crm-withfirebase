import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { useConfig, salesUsers, ldrUsers, splitList } from '../config';
import { toast } from '../toast';
import { createLead, reopenArchivedLead, getLead } from '../lib/leads';
import { markUrgent } from '../lib/actions';
import { normalizePhone } from '../lib/phone';
import { byCode, phoneLenOk } from '../lib/countries';
import { fmtStatus } from '../lib/format';
import { friendlyError } from '../lib/errmsg';
import Sheet from './Sheet';
import CountryPicker from './CountryPicker';
import { DynField } from './LeadSheet';

export default function NewLeadSheet({ onClose, onCreated, onOpenExisting }) {
  const { user, role } = useAuth();
  const cfg = useConfig();
  const { t } = useT();
  const actor = { uid: user.id, name: user.full_name };
  const errRef = useRef(null);
  const isAdmin = role === 'admin';

  const [cc, setCc] = useState('91');
  const [f, setF] = useState({
    name: '', phone: '', company: '', city: '', state: '', email: '', alt_phone: '',
    source: '', stage: role === 'sales' ? 'qualified' : 'fresh', sales_uid: '', remark: '',
  });
  const [nextDt, setNextDt] = useState('');
  const [answers, setAnswers] = useState({});
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dupe, setDupe] = useState(null); // submit-time fallback (race condition)

  // ---- live phone check (jaise-jaise number type ho) ----
  const [pCheck, setPCheck] = useState(null); // null | 'checking' | { exists, name, phone, owner, stage, canOpen, existing }
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignUid, setReassignUid] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const lenOk = !f.phone || phoneLenOk(cc, f.phone);
  const expectedLen = byCode(cc).len;

  useEffect(() => {
    setReassignOpen(false); setReassignUid('');
    if (!f.phone.trim() || !lenOk) { setPCheck(null); return; }
    const digits = normalizePhone(`+${cc} ${f.phone}`).digits;
    if (!digits) { setPCheck(null); return; }
    setPCheck('checking');
    const h = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(db, 'phone_index', digits));
        if (!snap.exists()) { setPCheck({ exists: false }); return; }
        const ix = snap.data();
        let full = null;
        try { full = ix.lead_id ? await getLead(ix.lead_id) : null; } catch { /* dusre ki lead */ }
        setPCheck({
          exists: true, canOpen: !!full,
          existing: full || {
            id: ix.lead_id, name: ix.name || '', phone: ix.phone || '',
            sales_name: ix.owner_name || '', status: ix.stage || '', source: ix.source || '',
            sales_uid: null, ldr_uid: null, phone_digits: digits,
          },
        });
      } catch { setPCheck(null); }
    }, 500);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cc, f.phone]);

  const stages = useMemo(() => {
    if (role === 'sales') return [{ v: 'qualified', l: 'Qualified' }];
    const ldrStages = (cfg.stages || []).filter((s) => s.role === 'both' || s.role === 'ldr');
    const base = [{ v: 'fresh', l: 'Fresh' }, { v: 'call back', l: 'Call Back' }, { v: 'qualified', l: 'Qualified' }, { v: 'lost', l: 'Lost' }];
    return ldrStages.length
      ? [...base, ...ldrStages.filter((s) => !base.some((b) => b.v === s.name.toLowerCase()) && s.name.toLowerCase() !== 'dead').map((s) => ({ v: s.name.toLowerCase(), l: s.name }))]
      : base;
  }, [cfg.stages, role]);

  const needsDate = ['call back', 'callback', 'followup', 'follow-up'].includes(f.stage);
  const isQualified = f.stage === 'qualified' || role === 'sales';
  const formFields = isQualified
    ? (cfg.forms || []).filter((x) => x.status === 'active' && (x.role_view === 'both' || x.role_view === (role === 'sales' ? 'sales' : 'ldr')))
    : [];
  const sources = splitList(cfg.settings?.Lead_Sources).length
    ? splitList(cfg.settings.Lead_Sources) : ['Facebook', 'Instagram', 'Google', 'JustDial', 'Referral', 'Walk-in', 'Direct'];

  const reassignOptions = [...ldrUsers(cfg), ...salesUsers(cfg)];

  // Kuch bhi type/select kiya (stage ka default value ginta nahi) — galti se scrim/X/back se band na ho jaaye.
  const dirty = ['name', 'phone', 'company', 'city', 'state', 'email', 'alt_phone', 'remark', 'source', 'sales_uid']
    .some((k) => String(f[k] || '').trim())
    || !!nextDt || Object.values(answers).some((v) => String(v || '').trim());
  const guardClose = () => !dirty || window.confirm(t('confirmDiscard'));
  const blockEnterSubmit = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.preventDefault(); };

  function fail(m) { setErr(m); setTimeout(() => errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30); }

  async function sendBackToOwner() {
    setResolveBusy(true);
    try {
      await markUrgent(pCheck.existing, actor, f.remark || 'Customer ne dobara contact kiya');
      toast(t('nlResurrected'));
      if (pCheck.canOpen) onOpenExisting?.(pCheck.existing.id);
      onClose();
    } catch (e2) { console.error(e2); toast(friendlyError(e2, t), 'err'); setResolveBusy(false); }
  }

  async function reassignToOther() {
    const target = reassignOptions.find((u) => u.id === reassignUid);
    if (!target) return;
    setResolveBusy(true);
    try {
      await markUrgent(pCheck.existing, actor, f.remark || 'Re-assigned on new inquiry',
        { uid: target.id, name: target.full_name, role: target.role });
      toast(`${t('nlResurrected')} — ${target.full_name}`);
      onClose();
    } catch (e2) { console.error(e2); toast(friendlyError(e2, t), 'err'); setResolveBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!f.phone.trim()) return fail(t('nlPhoneReq'));
    if (!lenOk) return fail(t('nlBadPhone'));
    const archivedMatch = pCheck?.exists && pCheck.existing.archived;
    if (pCheck?.exists && !archivedMatch) return fail(t('nlDupBlocked'));
    if (needsDate && !nextDt) return fail(t('dateReq'));
    const reqMiss = formFields.find((x) => x.is_mandatory === 'Yes' && !String(answers[x.label] || '').trim());
    if (reqMiss) return fail(`"${reqMiss.label}" *`);
    setBusy(true);
    try {
      const payload = {
        ...f,
        phone: `+${cc} ${f.phone.trim()}`,
        form_answers: isQualified ? answers : {},
        next_followup: nextDt ? new Date(nextDt) : null,
        sales_uid: isQualified ? (f.sales_uid || null) : null,
        sales_name: isQualified && f.sales_uid ? (salesUsers(cfg).find((u) => u.id === f.sales_uid)?.full_name || '') : '',
      };
      const res = archivedMatch
        ? await reopenArchivedLead(pCheck.existing.id, payload, actor, role)
        : await createLead(payload, actor, role);
      if (res.duplicate) { setDupe({ ...res.existing, _canOpen: res.canOpen }); setBusy(false); return; }
      toast(archivedMatch ? `${t('nlReopened')} — #${res.id}` : `${t('nlCreated')} — #${res.id}`);
      onCreated?.(res.id);
      onClose();
    } catch (e2) {
      console.error(e2);
      fail(friendlyError(e2, t));
      setBusy(false);
    }
  }

  async function resurrect() {
    setBusy(true);
    try {
      await markUrgent(dupe, actor, f.remark || 'Customer ne dobara contact kiya');
      toast(t('nlResurrected'));
      if (dupe._canOpen) onOpenExisting?.(dupe.id);
      onClose();
    } catch (e2) { console.error(e2); toast(friendlyError(e2, t), 'err'); setBusy(false); }
  }

  // submit ke baad ka fallback dup screen (race condition — bahut kam hoga ab)
  if (dupe) {
    return (
      <Sheet title={t('nlDupTitle')} onClose={onClose}>
        <div className="alert alert-info">{t('nlDupMsg')}</div>
        <div className="lead-card" style={{ marginBottom: 14 }}>
          <div className="top">
            <div className="lc-main">
              <div className="name">{dupe.name || t('noName')}</div>
              <div className="sub">{dupe.phone || dupe.phone_raw}{dupe.company ? ` · ${dupe.company}` : ''}</div>
            </div>
            <span className="status-badge bg-default">{fmtStatus(dupe.sales_status || dupe.status)}</span>
          </div>
          <div className="meta">
            <span><i className="fas fa-user" /> {dupe.sales_name || dupe.ldr_name || dupe.owner_name || '—'}</span>
            {dupe.source && <span>{t('source')}: <b>{dupe.source}</b></span>}
          </div>
        </div>
        {dupe._canOpen && (
          <button className="btn btn-primary btn-block" onClick={() => { onOpenExisting?.(dupe.id); onClose(); }}>
            <i className="fas fa-arrow-right" /> {t('nlOpenExisting')}
          </button>
        )}
        <button className="btn btn-danger btn-block" style={{ marginTop: dupe._canOpen ? 8 : 0 }} disabled={busy} onClick={resurrect}>
          <i className="fas fa-fire" /> {busy ? t('wait') : t('nlResurrect')}
        </button>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setDupe(null)}>{t('cancel')}</button>
      </Sheet>
    );
  }

  return (
    <Sheet title={t('nlTitle')} onClose={onClose} guardClose={guardClose}>
      <form onSubmit={submit} onKeyDown={blockEnterSubmit}>
        <div ref={errRef}>{err && <div className="alert alert-error">{err}</div>}</div>

        <div className="form-group"><label>{t('nlName')}</label>
          <input className="form-control" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={t('nlNamePh')} /></div>
        <div className="form-group"><label>{t('nlPhone')} *</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <CountryPicker value={cc} onChange={setCc} />
            <input className="form-control" type="tel" inputMode="numeric" required value={f.phone}
              onChange={(e) => set('phone', e.target.value.replace(/[^\d]/g, ''))} placeholder="98765 43210" />
          </div>
          {f.phone && !lenOk && (
            <div className="ph-check bad"><i className="fas fa-circle-exclamation" /> {fill(t('nlPhoneLen'), { n: expectedLen[0] === expectedLen[1] ? expectedLen[0] : `${expectedLen[0]}-${expectedLen[1]}` })}</div>
          )}
          {lenOk && pCheck === 'checking' && <div className="ph-check checking"><span className="spinner sm" /> {t('nlChecking')}</div>}
          {lenOk && pCheck?.exists === false && <div className="ph-check clear"><i className="fas fa-circle-check" /> {t('nlPhoneClear')}</div>}
        </div>

        {/* Archived lead -> sirf ek note, form neeche normal bhardo (LDR/Sales apna) */}
        {pCheck?.exists && pCheck.existing.archived && (
          <div className="ph-check" style={{ background: 'var(--warning-soft, #fff4e5)', color: 'var(--warning, #b45309)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}>
            <i className="fas fa-box-archive" /> {t('nlDupArchived')} — {t('nlDupArchivedShort')}
          </div>
        )}

        {pCheck?.exists && !pCheck.existing.archived && (
          <div className="dup-card">
            <div className="dup-head"><i className="fas fa-triangle-exclamation" /> {t('nlDupTitle')}</div>
            <div className="lead-card" style={{ margin: '10px 0', boxShadow: 'none' }}>
              <div className="top">
                <div className="lc-main">
                  <div className="name">{pCheck.existing.name || t('noName')}</div>
                  <div className="sub">{pCheck.existing.phone}</div>
                </div>
                <span className="status-badge bg-default">{fmtStatus(pCheck.existing.sales_status || pCheck.existing.status)}</span>
              </div>
              <div className="meta"><span><i className="fas fa-user" /> {pCheck.existing.sales_name || pCheck.existing.ldr_name || t('nlUnassigned')}</span></div>
            </div>

            {!reassignOpen ? (
              <>
                <button type="button" className="btn btn-danger btn-block" disabled={resolveBusy} onClick={sendBackToOwner}>
                  <i className="fas fa-rotate-left" /> {resolveBusy ? t('wait') : pCheck.existing.archived ? t('nlReopenArchived') : t('nlSendBack')}
                </button>
                <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setReassignOpen(true)}>
                  <i className="fas fa-user-check" /> {t('nlReassignBtn')}
                </button>
                {pCheck.canOpen && (
                  <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }}
                    onClick={() => { onOpenExisting?.(pCheck.existing.id); onClose(); }}>
                    <i className="fas fa-arrow-right" /> {t('nlOpenExisting')}
                  </button>
                )}
              </>
            ) : (
              <>
                <select className="form-control" value={reassignUid} onChange={(e) => setReassignUid(e.target.value)}>
                  <option value="">{t('nlPickPerson')}</option>
                  {reassignOptions.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
                </select>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setReassignOpen(false)}>{t('cancel')}</button>
                  <button type="button" className="btn btn-primary" style={{ flex: 2 }} disabled={!reassignUid || resolveBusy} onClick={reassignToOther}>
                    {resolveBusy ? t('wait') : t('nlSendTo')}
                  </button>
                </div>
              </>
            )}
            <p className="dup-note">{t('nlDupBlocked')}</p>
          </div>
        )}

        <div className="form-group"><label>{t('company')}</label>
          <input className="form-control" value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="form-group"><label>{t('nlCity')}</label>
            <input className="form-control" value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div className="form-group"><label>{t('nlState')}</label>
            <input className="form-control" list="statelist" value={f.state} onChange={(e) => set('state', e.target.value)} />
            <datalist id="statelist">{splitList(cfg.settings?.State_List).map((s) => <option key={s} value={s} />)}</datalist>
          </div>
        </div>

        <div className="form-group"><label>{t('source')}</label>
          <input className="form-control" list="srclist" value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="—" />
          <datalist id="srclist">{sources.map((s) => <option key={s} value={s} />)}</datalist>
        </div>

        {!more && <button type="button" className="opt-add" onClick={() => setMore(true)}><i className="fas fa-plus" /> {t('nlMore')}</button>}
        {more && (
          <>
            <div className="form-group"><label>Email</label>
              <input className="form-control" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="form-group"><label>{t('nlAltPhone')}</label>
              <input className="form-control" type="tel" value={f.alt_phone} onChange={(e) => set('alt_phone', e.target.value)} /></div>
          </>
        )}

        {role !== 'sales' && (
          <div className="form-group"><label>{t('nextStage')}</label>
            <select className="form-control" value={f.stage} onChange={(e) => set('stage', e.target.value)}>
              {stages.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select></div>
        )}

        {needsDate && (
          <div className="form-group"><label style={{ color: 'var(--warning)' }}>{t('nextCallAt')} *</label>
            <input className="form-control" type="datetime-local" required value={nextDt} onChange={(e) => setNextDt(e.target.value)} /></div>
        )}

        {isQualified && role !== 'sales' && (
          <div className="form-group"><label style={{ color: 'var(--navy-accent)' }}>{t('assignSales')}</label>
            <select className="form-control" value={f.sales_uid} onChange={(e) => set('sales_uid', e.target.value)}>
              <option value="">{t('assignLater')}</option>
              {salesUsers(cfg).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            {!f.sales_uid && <p className="field-hint">{t('assignAutoHint')}</p>}</div>
        )}

        {formFields.map((x) => (
          <div className="form-group" key={x.id || x.label}>
            <label>{x.label}{x.is_mandatory === 'Yes' ? ' *' : ''}</label>
            <DynField f={x} value={answers[x.label] || ''} onChange={(v) => setAnswers((a) => ({ ...a, [x.label]: v }))} />
          </div>
        ))}

        <div className="form-group"><label>{t('remark')}</label>
          <textarea className="form-control" rows={2} value={f.remark} onChange={(e) => set('remark', e.target.value)}
            placeholder={t('nlRemarkPh')} /></div>

        <button className="btn btn-primary btn-block" disabled={busy || (pCheck?.exists && !pCheck.existing.archived) || !lenOk}>
          {busy ? t('wait') : pCheck?.exists && pCheck.existing.archived ? t('nlReopenSubmit') : t('nlSubmit')}
        </button>
      </form>
    </Sheet>
  );
}
