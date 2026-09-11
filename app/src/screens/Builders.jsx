import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth';
import { useConfig } from '../config';
import { useT, fill } from '../i18n';
import { toast } from '../toast';
import { saveFormFields, saveStages } from '../lib/admin';
import { DynField } from '../components/LeadSheet';

const uid = () => Math.random().toString(36).slice(2, 8);
const FIELD_TYPES = ['text', 'textarea', 'number', 'dropdown', 'multiselect', 'checkbox', 'date', 'phone', 'email', 'url'];
const HAS_OPTIONS = (tp) => tp === 'dropdown' || tp === 'multiselect';
const TYPE_ICON = {
  text: 'fa-font', textarea: 'fa-align-left', number: 'fa-hashtag', dropdown: 'fa-caret-down',
  multiselect: 'fa-list-check', checkbox: 'fa-square-check', date: 'fa-calendar-day',
  phone: 'fa-phone', email: 'fa-envelope', url: 'fa-link',
};
const roleLabel = (t, r) => (r === 'ldr' ? t('mecaLdrTeam') : r === 'sales' ? t('mecaSalesTeam') : t('both'));

/* delete = confirm popup + ek-level undo (Ctrl+Z ya button). Save/add pe trash clear. */
function useDeleteGuard(setList, t, nameOf) {
  const [trash, setTrash] = useState(null);
  const undo = () => setTrash((tr) => {
    if (tr) setList((arr) => { const n = [...arr]; n.splice(Math.min(tr.index, n.length), 0, tr.item); return n; });
    return null;
  });
  const del = (i, item) => {
    if (!window.confirm(fill(t('bDelConfirm'), { n: nameOf(item) }))) return;
    setTrash({ item, index: i });
    setList((arr) => arr.filter((_, j) => j !== i));
  };
  useEffect(() => {
    if (!trash) return undefined;
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trash]);
  return { del, undo, trash, clearTrash: () => setTrash(null) };
}

function UndoBar({ trash, onUndo, nameOf, t }) {
  if (!trash) return null;
  return (
    <div className="bld-undo">
      <span><i className="fas fa-trash-can" /> {fill(t('bDeleted'), { n: nameOf(trash.item) })}</span>
      <button type="button" onClick={onUndo}><i className="fas fa-rotate-left" /> {t('bRestore')}</button>
    </div>
  );
}

/* segmented pill control */
function Seg({ label, value, onChange, options }) {
  return (
    <div className="seg-row">
      {label && <span className="seg-label">{label}</span>}
      <div className="seg">
        {options.map((o) => (
          <button key={o.v} type="button" className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.t}</button>
        ))}
      </div>
    </div>
  );
}

/* compact expandable row — collapsed = one line, expanded = editor */
function Row({ open, onOpen, strip, icon, iconColor, title, meta, onUp, onDown, onDel, children }) {
  return (
    <div className={`bld-row ${open ? 'open' : ''}`} style={strip ? { borderLeftColor: strip } : undefined}>
      <div className="bld-row-head" onClick={onOpen}>
        <div className="bld-reorder" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={onUp} aria-label="up"><i className="fas fa-chevron-up" /></button>
          <button type="button" onClick={onDown} aria-label="down"><i className="fas fa-chevron-down" /></button>
        </div>
        {icon && <span className="bld-ic" style={iconColor ? { background: iconColor } : undefined}>
          {typeof icon === 'string' ? <i className={`fas ${icon}`} /> : icon}
        </span>}
        <div className="bld-row-main">
          <div className="bld-row-title">{title}</div>
          {meta && <div className="bld-row-meta">{meta}</div>}
        </div>
        <button type="button" className="bld-x" onClick={(e) => { e.stopPropagation(); onDel(); }} aria-label="delete"><i className="fas fa-trash-can" /></button>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} bld-caret`} />
      </div>
      {open && <div className="bld-row-body">{children}</div>}
    </div>
  );
}

export default function Builders() {
  const { user } = useAuth();
  const { t } = useT();
  const actor = { uid: user.id, name: user.full_name };
  const [tab, setTab] = useState('forms');
  return (
    <div>
      <div className="ls-tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'forms' ? 'on' : ''} onClick={() => setTab('forms')}>{t('bFormsTab')}</button>
        <button className={tab === 'stages' ? 'on' : ''} onClick={() => setTab('stages')}>{t('bStagesTab')}</button>
      </div>
      {tab === 'forms' ? <FormBuilder actor={actor} t={t} /> : <StageBuilder actor={actor} t={t} />}
    </div>
  );
}

function ModeBar({ mode, setMode, t }) {
  return (
    <div className="bld-modebar">
      <button type="button" className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
        <i className="fas fa-pen" /> {t('bModeEdit')}
      </button>
      <button type="button" className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
        <i className="fas fa-eye" /> {t('bModePreview')}
      </button>
    </div>
  );
}

function FormBuilder({ actor, t }) {
  const [fields, setFields] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('edit');
  const [openId, setOpenId] = useState(null);
  const [asRole, setAsRole] = useState('sales');
  const [pvVals, setPvVals] = useState({}); // preview mein form fill karke dekh sako

  useEffect(() => {
    getDoc(doc(db, 'config', 'forms')).then((s) => setFields((s.data()?.fields || []).map((f) => ({
      id: f.id || uid(), label: f.label || '', type: f.type || 'text',
      role_view: f.role_view || 'both', role_edit: f.role_edit || 'both',
      status: f.status || 'active', is_mandatory: f.is_mandatory === 'Yes' ? 'Yes' : 'No',
      opts: String(f.options || '').split(',').map((x) => x.trim()).filter(Boolean),
    }))));
  }, []);

  const guard = useDeleteGuard(setFields, t, (f) => f.label || t('bNewField'));
  const set = (i, patch) => setFields((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => {
    const id = uid();
    guard.clearTrash();
    setFields((f) => [...f, { id, label: '', type: 'text', role_view: 'both', role_edit: 'both', status: 'active', is_mandatory: 'No', opts: [] }]);
    setOpenId(id);
  };
  const move = (i, d) => setFields((f) => {
    const n = [...f]; const j = i + d; if (j < 0 || j >= n.length) return f;
    [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  async function save() {
    setBusy(true);
    try {
      const payload = fields.filter((f) => f.label.trim()).map((f) => ({
        id: f.id, label: f.label.trim(), type: f.type, role_view: f.role_view, role_edit: f.role_edit,
        status: f.status, is_mandatory: f.is_mandatory || 'No',
        options: HAS_OPTIONS(f.type) ? f.opts.map((x) => x.trim()).filter(Boolean).join(',') : '',
      }));
      await saveFormFields(payload, actor);
      guard.clearTrash();
      toast(t('saveAll') + ' ✓');
    } catch (e) { console.error(e); toast(t('saveFail'), 'err'); }
    finally { setBusy(false); }
  }

  const previewFields = useMemo(() => (fields || []).filter(
    (f) => f.label.trim() && f.status === 'active' && (f.role_view === 'both' || f.role_view === asRole),
  ), [fields, asRole]);

  if (fields == null) return <div className="skeleton" style={{ height: 250 }} />;

  if (mode === 'preview') {
    return (
      <div>
        <p className="bld-intro">{t('bFormsIntro')}</p>
        <ModeBar mode={mode} setMode={setMode} t={t} />
        <div className="bld-preview">
          <Seg label={t('bPreviewAs')} value={asRole} onChange={setAsRole}
            options={[{ v: 'sales', t: t('mecaSalesTeam') }, { v: 'ldr', t: t('mecaLdrTeam') }]} />
          {previewFields.length === 0 ? (
            <div className="empty"><i className="fas fa-inbox" /> {t('bPreviewEmpty')}</div>
          ) : previewFields.map((f) => (
            <div className="form-group" key={f.id}>
              <label>{f.label}{f.is_mandatory === 'Yes' ? ' *' : ''}</label>
              <DynField f={{ ...f, options: f.opts.join(',') }} value={pvVals[f.id] || ''}
                onChange={(v) => setPvVals((p) => ({ ...p, [f.id]: v }))} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="bld-intro">{t('bFormsIntro')}</p>
      <ModeBar mode={mode} setMode={setMode} t={t} />
      <UndoBar trash={guard.trash} onUndo={guard.undo} nameOf={(f) => f.label || t('bNewField')} t={t} />
      <div className="bld-list">
        {fields.map((f, i) => (
          <Row key={f.id} open={openId === f.id} onOpen={() => setOpenId(openId === f.id ? null : f.id)}
            icon={TYPE_ICON[f.type] || 'fa-font'}
            title={f.label || <span className="bld-untitled">{t('bNewField')}</span>}
            meta={(
              <>
                <span>{t('bt_' + f.type)}</span>
                {HAS_OPTIONS(f.type) && <span>· {f.opts.filter(Boolean).length} {t('bOptions').toLowerCase()}</span>}
                {f.role_view !== 'both' && <span>· {roleLabel(t, f.role_view)}</span>}
                {f.is_mandatory === 'Yes' && <span className="req">· {t('bMandatory').toLowerCase()}</span>}
                {f.status !== 'active' && <span className="off">· {t('inactive')}</span>}
              </>
            )}
            onUp={() => move(i, -1)} onDown={() => move(i, 1)} onDel={() => guard.del(i, f)}>
            <input className="form-control bld-label" placeholder={t('bLabel')} value={f.label} onChange={(e) => set(i, { label: e.target.value })} />
            <div className="seg-row">
              <span className="seg-label">{t('bType')}</span>
              <select className="form-control" value={f.type} onChange={(e) => set(i, { type: e.target.value })}>
                {FIELD_TYPES.map((tp) => <option key={tp} value={tp}>{t('bt_' + tp)}</option>)}
              </select>
            </div>
            <Seg label={t('bWhoSees')} value={f.role_view} onChange={(v) => set(i, { role_view: v })}
              options={[{ v: 'both', t: t('both') }, { v: 'ldr', t: t('bLdrOnly') }, { v: 'sales', t: t('bSalesOnly') }]} />
            <Seg label={t('bWhoEdits')} value={f.role_edit} onChange={(v) => set(i, { role_edit: v })}
              options={[{ v: 'both', t: t('both') }, { v: 'ldr', t: t('bLdrOnly') }, { v: 'sales', t: t('bSalesOnly') }]} />
            <div className="bld-two">
              <Seg label={t('bMandatory')} value={f.is_mandatory || 'No'} onChange={(v) => set(i, { is_mandatory: v })}
                options={[{ v: 'No', t: t('no') }, { v: 'Yes', t: t('yes') }]} />
              <Seg label={t('bStatus')} value={f.status} onChange={(v) => set(i, { status: v })}
                options={[{ v: 'active', t: t('active') }, { v: 'inactive', t: t('inactive') }]} />
            </div>
            {HAS_OPTIONS(f.type) && (
              <div className="opt-editor">
                <div className="opt-label">{t('bOptions')}</div>
                {f.opts.map((o, oi) => (
                  <div className="opt-row" key={oi}>
                    <input className="form-control" placeholder={t('bOptionPh')} value={o}
                      onChange={(e) => set(i, { opts: f.opts.map((x, k) => (k === oi ? e.target.value : x)) })} />
                    <button type="button" className="ic danger" onClick={() => set(i, { opts: f.opts.filter((_, k) => k !== oi) })}>
                      <i className="fas fa-xmark" />
                    </button>
                  </div>
                ))}
                <button type="button" className="opt-add" onClick={() => set(i, { opts: [...f.opts, ''] })}>
                  <i className="fas fa-plus" /> {t('bAddOption')}
                </button>
              </div>
            )}
          </Row>
        ))}
      </div>
      <button className="btn btn-ghost btn-block" onClick={add} style={{ marginBottom: 10 }}><i className="fas fa-plus" /> {t('bAddField')}</button>
      <p className="bld-note">{t('bEmptyWarn')}</p>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>{busy ? t('wait') : t('saveAll')}</button>
    </div>
  );
}

function StageBuilder({ actor, t }) {
  const cfg = useConfig();
  const [stages, setStages] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('edit');
  const [openId, setOpenId] = useState(null);
  const [asRole, setAsRole] = useState('sales');
  const [pvStage, setPvStage] = useState('');

  useEffect(() => {
    getDoc(doc(db, 'config', 'stages')).then((s) => setStages((s.data()?.stages || []).map((x) => ({
      id: x.id || uid(), name: x.name || '', role: x.role || 'sales',
      requires_date: x.requires_date === 'No' ? 'No' : 'Yes', color: x.color || '#0074d9',
      shows_form: x.shows_form === 'Yes' || String(x.name || '').toLowerCase() === 'qualified' ? 'Yes' : 'No',
    }))));
  }, []);

  const guard = useDeleteGuard(setStages, t, (s) => s.name || t('bNewStage'));
  const set = (i, patch) => setStages((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => {
    const id = uid();
    guard.clearTrash();
    setStages((f) => [...f, { id, name: '', role: 'sales', requires_date: 'Yes', color: '#0074d9', shows_form: 'No' }]);
    setOpenId(id);
  };
  const move = (i, d) => setStages((f) => {
    const n = [...f]; const j = i + d; if (j < 0 || j >= n.length) return f;
    [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  async function save() {
    setBusy(true);
    try {
      await saveStages(stages.filter((s) => s.name.trim()).map((s) => ({
        id: s.id, name: s.name.trim(), role: s.role, requires_date: s.requires_date, color: s.color,
        shows_form: s.shows_form === 'Yes' ? 'Yes' : 'No',
      })), actor);
      guard.clearTrash();
      toast(t('saveAll') + ' ✓');
    } catch (e) { console.error(e); toast(t('saveFail'), 'err'); }
    finally { setBusy(false); }
  }

  const pvList = useMemo(() => (stages || []).filter(
    (s) => s.name.trim() && (s.role === 'both' || s.role === asRole),
  ), [stages, asRole]);
  const pvSel = pvList.find((s) => s.id === pvStage) || pvList[0];
  const pvForm = useMemo(() => (cfg.forms || []).filter(
    (f) => f.status === 'active' && (f.role_edit === 'both' || f.role_edit === asRole),
  ), [cfg.forms, asRole]);

  if (stages == null) return <div className="skeleton" style={{ height: 250 }} />;

  if (mode === 'preview') {
    return (
      <div>
        <p className="bld-intro">{t('bStagesIntro')}</p>
        <ModeBar mode={mode} setMode={setMode} t={t} />
        <div className="bld-preview">
          <Seg label={t('bPreviewAs')} value={asRole} onChange={(v) => { setAsRole(v); setPvStage(''); }}
            options={[{ v: 'sales', t: t('mecaSalesTeam') }, { v: 'ldr', t: t('mecaLdrTeam') }]} />
          {pvList.length === 0 ? (
            <div className="empty"><i className="fas fa-inbox" /> {t('bPreviewEmpty')}</div>
          ) : (
            <>
              <div className="form-group">
                <label>{t('nextStage')} *</label>
                <div className="pv-stagepick">
                  {pvList.map((s) => (
                    <button type="button" key={s.id} className={`pv-stage ${(pvSel?.id === s.id) ? 'on' : ''}`}
                      style={{ '--c': s.color }} onClick={() => setPvStage(s.id)}>
                      <span className="pv-dot" style={{ background: s.color }} /> {s.name}
                    </button>
                  ))}
                </div>
              </div>
              {pvSel?.requires_date === 'Yes' && (
                <div className="form-group">
                  <label style={{ color: 'var(--warning)' }}>{t('nextCallAt')} *</label>
                  <input type="datetime-local" className="form-control" disabled />
                </div>
              )}
              {pvSel?.shows_form === 'Yes' && (
                <div className="pv-formbox">
                  <div className="pv-formbox-h"><i className="fas fa-clipboard-list" /> {fill(t('bPvFormShown'), { s: pvSel.name })}</div>
                  {pvForm.length === 0 ? (
                    <p className="bld-note" style={{ margin: 0 }}>{t('bPreviewEmpty')}</p>
                  ) : pvForm.map((f) => (
                    <div className="form-group" key={f.id || f.label}>
                      <label>{f.label}{f.is_mandatory === 'Yes' ? ' *' : ''}</label>
                      <DynField f={f} value="" onChange={() => {}} />
                    </div>
                  ))}
                </div>
              )}
              <p className="bld-note">
                {pvSel
                  ? [
                    pvSel.requires_date === 'Yes' ? t('bPvDateYes') : t('bPvDateNo'),
                    pvSel.shows_form === 'Yes' ? t('bPvFormYes') : '',
                  ].filter(Boolean).join(' ')
                  : ''}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="bld-intro">{t('bStagesIntro')}</p>
      <ModeBar mode={mode} setMode={setMode} t={t} />
      <UndoBar trash={guard.trash} onUndo={guard.undo} nameOf={(s) => s.name || t('bNewStage')} t={t} />
      <div className="bld-list">
        {stages.map((s, i) => (
          <Row key={s.id} open={openId === s.id} onOpen={() => setOpenId(openId === s.id ? null : s.id)}
            strip={s.color}
            icon={<span className="bld-swatch" style={{ background: s.color }} />}
            title={s.name || <span className="bld-untitled">{t('bNewStage')}</span>}
            meta={(
              <>
                <span>{roleLabel(t, s.role)}</span>
                <span className={s.requires_date === 'Yes' ? 'req' : ''}>· {s.requires_date === 'Yes' ? t('bMetaAsksDate') : t('bMetaNoDate')}</span>
                {s.shows_form === 'Yes' && <span className="req">· {t('bMetaForm')}</span>}
              </>
            )}
            onUp={() => move(i, -1)} onDown={() => move(i, 1)} onDel={() => guard.del(i, s)}>
            <div className="stage-name-row">
              <input type="color" value={s.color} onChange={(e) => set(i, { color: e.target.value })} aria-label="color" />
              <input className="form-control bld-label" placeholder={t('bStageName')} value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
            </div>
            <Seg label={t('bStageFor')} value={s.role} onChange={(v) => set(i, { role: v })}
              options={[{ v: 'sales', t: t('mecaSalesTeam') }, { v: 'ldr', t: t('mecaLdrTeam') }, { v: 'both', t: t('both') }]} />
            <div className="bld-two">
              <Seg label={t('bAskDate')} value={s.requires_date} onChange={(v) => set(i, { requires_date: v })}
                options={[{ v: 'Yes', t: t('yes') }, { v: 'No', t: t('no') }]} />
              <Seg label={t('bShowForm')} value={s.shows_form || 'No'} onChange={(v) => set(i, { shows_form: v })}
                options={[{ v: 'No', t: t('no') }, { v: 'Yes', t: t('yes') }]} />
            </div>
            {s.shows_form === 'Yes' && <p className="bld-note" style={{ margin: '6px 0 0' }}>{t('bShowFormHint')}</p>}
          </Row>
        ))}
      </div>
      <button className="btn btn-ghost btn-block" onClick={add} style={{ marginBottom: 10 }}><i className="fas fa-plus" /> {t('bAddStage')}</button>
      <p className="bld-note">{t('bStageNote')}</p>
      <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>{busy ? t('wait') : t('saveAll')}</button>
    </div>
  );
}
