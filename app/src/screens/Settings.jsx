import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useConfig } from '../config';
import { useT, fill } from '../i18n';
import { toast } from '../toast';
import { saveSettings, saveMailConfig, saveAccess, saveAdSpend } from '../lib/admin';
import { parseAdCsv } from '../lib/adspend';
import { ALL_PERMS, ROLE_PERMS, CONFIGURABLE_ROLES } from '../lib/permissions';
import { backfillStats, istDay, rescoreLeads, sendTestPush } from '../lib/stats';
import { friendlyError } from '../lib/errmsg';
import { getTheme, setTheme, getBrand, setBrand, THEME_MODES, BRAND_PRESETS } from '../lib/theme';
import { setAiConfig } from '../lib/help';

const TEXT_FIELDS = [
  { key: 'Company_Name', tk: 'sCompany' },
  { key: 'Lead_Sources', tk: 'sSources', area: true },
  { key: 'State_List', tk: 'sStates', area: true },
  { key: 'Whatsapp_Template', tk: 'sWaTpl', area: true, hintk: 'sWaHint' },
  { key: 'Logo_URL', tk: 'sLogo' },
];

// value + unit ("30m" | "2h" | "1d") — automation rules
const DUR_UNITS = [
  { v: 'm', tk: 'unitMin' },
  { v: 'h', tk: 'unitHr' },
  { v: 'd', tk: 'unitDay' },
];
const RULES = [
  { key: 'SLA_FirstContact', tk: 'slaFirst', descK: 'slaFirstDesc', def: '5m' },
  { key: 'SLA_FreshTouch', tk: 'slaFresh', descK: 'slaFreshDesc', def: '30m' },
  { key: 'SLA_SalesTouch', tk: 'slaSales', descK: 'slaSalesDesc', def: '2h' },
  { key: 'SLA_FollowupOverdue', tk: 'slaFollow', descK: 'slaFollowDesc', def: '2h' },
  { key: 'SLA_StaleDays', tk: 'slaStale', descK: 'slaStaleDesc', def: '3d' },
  { key: 'SLA_QualifiedUnassigned', tk: 'slaUnassigned', descK: 'slaUnassignedDesc', def: '15m' },
];

const TABS = [
  { key: 'general', tk: 'sTabGeneral' },
  { key: 'theme', tk: 'sTabTheme' },
  { key: 'automation', tk: 'sTabAutomation' },
  { key: 'adspend', tk: 'sTabAdSpend' },
  { key: 'roles', tk: 'sTabRoles' },
  { key: 'notify', tk: 'sTabNotify' },
  { key: 'tools', tk: 'sTabTools' },
];

const THEME_ICON = { light: 'fa-sun', dark: 'fa-moon', system: 'fa-circle-half-stroke' };

const AD_PLATFORMS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'google', label: 'Google' },
  { key: 'youtube', label: 'YouTube' },
];

// Permissions matrix — admin hamesha sab, isliye columns sirf md/tl/ldr/sales.
const PERM_GRPS = [...new Set(ALL_PERMS.map((p) => p.grp))];

function parseDur(s) {
  const m = String(s || '').match(/^(\d+)\s*([mhd])$/);
  return m ? { n: m[1], u: m[2] } : { n: '', u: 'h' };
}

export default function Settings() {
  const { user } = useAuth();
  const cfg = useConfig();
  const { t } = useT();
  const [tab, setTab] = useState('general');
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const [bf, setBf] = useState({ running: false, done: 0, total: 0 });
  const [rs, setRs] = useState({ running: false, done: 0, total: 0 });
  const [testUid, setTestUid] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [mailEmail, setMailEmail] = useState('');
  const [mailPw, setMailPw] = useState('');
  const [mailBusy, setMailBusy] = useState(false);
  const [perms, setPerms] = useState({});   // { role: { permKey: true/false } } — overrides only
  const [permBusy, setPermBusy] = useState(false);
  const [standing, setStanding] = useState({}); // { facebook: 2000, ... }
  const [adBusy, setAdBusy] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvMsg, setCsvMsg] = useState('');
  const [themeMode, setThemeMode] = useState(getTheme());
  const [brand, setBrandState] = useState(getBrand());
  const pickTheme = (m) => { setTheme(m); setThemeMode(m); };
  const pickBrand = (hex) => { setBrand(hex); setBrandState(hex); };

  useEffect(() => {
    if (cfg.ready) {
      const d = { Attempt_Limit: '7' };
      RULES.forEach((r) => { d[r.key] = '0'; }); // default OFF — admin enables
      setVals({ ...d, ...cfg.settings });
      setMailEmail(cfg.settings?.Report_Email || '');
      setPerms(cfg.access?.perms || {});
      setStanding(cfg.adSpend?.standing || {});
    }
  }, [cfg.ready]);

  async function saveStanding() {
    setAdBusy(true);
    try {
      const clean = {};
      Object.entries(standing).forEach(([k, v]) => { if (Number(v) > 0) clean[k] = Number(v); });
      await saveAdSpend({ standing: clean }, { uid: user.id, name: user.full_name });
      toast(`${t('save')} ✓`);
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setAdBusy(false); }
  }

  async function importCsv() {
    const { days, count, error } = parseAdCsv(csvText);
    if (error) { setCsvMsg(error); return; }
    setAdBusy(true);
    try {
      await saveAdSpend({ days }, { uid: user.id, name: user.full_name });
      setCsvMsg(fill(t('sAdCsvOk'), { n: count }));
      setCsvText('');
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setAdBusy(false); }
  }

  const permOn = (role, key) => {
    const ov = perms[role];
    if (ov && key in ov) return !!ov[key];
    return (ROLE_PERMS[role] || []).includes(key);
  };
  const togglePerm = (role, key) => setPerms((p) => {
    const cur = { ...(p[role] || {}) };
    const nowOn = !permOn(role, key);
    const isDefault = (ROLE_PERMS[role] || []).includes(key);
    if (nowOn === isDefault) delete cur[key]; else cur[key] = nowOn; // default pe wapas = override hata do
    return { ...p, [role]: cur };
  });

  async function savePerms() {
    setPermBusy(true);
    try {
      const clean = {};
      Object.entries(perms).forEach(([r, o]) => { if (o && Object.keys(o).length) clean[r] = o; });
      await saveAccess({ perms: clean }, { uid: user.id, name: user.full_name });
      toast(`${t('save')} ✓ — ${t('sAccessReload')}`);
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setPermBusy(false); }
  }

  const setV = (k, v) => setVals((p) => ({ ...p, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await saveSettings(vals, cfg.settings || {}, { uid: user.id, name: user.full_name });
      toast(`${t('save')} ✓`);
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setBusy(false); }
  }

  async function saveMail() {
    setMailBusy(true);
    try {
      await saveMailConfig({ email: mailEmail, appPassword: mailPw.trim() || null }, { uid: user.id, name: user.full_name });
      setMailPw('');
      toast(`${t('save')} ✓`);
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setMailBusy(false); }
  }

  const [aiProvider, setAiProvider] = useState('nvidia');
  const [aiKey, setAiKeyV] = useState('');
  const [aiModel, setAiModel] = useState('openai/gpt-oss-20b');
  const [aiBusy, setAiBusy] = useState(false);
  const AI_MODELS = aiProvider === 'anthropic'
    ? [['claude-haiku-4-5-20251001', 'Haiku 4.5 (fast, cheap)'], ['claude-sonnet-5', 'Sonnet 5 (better)']]
    : [['openai/gpt-oss-20b', 'GPT-OSS 20B (recommended — fast, clean)'],
      ['nvidia/nemotron-3-super-120b-a12b', 'Nemotron 3 Super (slower, verbose)'],
      ['mistralai/mistral-nemotron', 'Mistral Nemotron']];
  async function saveAi() {
    if (!aiKey.trim()) return;
    setAiBusy(true);
    try {
      await setAiConfig({ provider: aiProvider, key: aiKey.trim(), model: aiModel });
      setAiKeyV('');
      toast(`${t('save')} ✓`);
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setAiBusy(false); }
  }

  async function rebuild() {
    setBf({ running: true, done: 0, total: 0 });
    try {
      const r = await backfillStats('2026-04-01', istDay(), (p) => setBf({ running: true, done: p.done, total: p.total }));
      toast(fill(t('sStatsDone'), { n: r.days || '?' }));
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setBf({ running: false, done: 0, total: 0 }); }
  }

  async function sendTest() {
    if (!testUid) return;
    setTestBusy(true);
    try {
      await sendTestPush(testUid);
      toast(t('pushTestSent'));
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setTestBusy(false); }
  }

  if (!cfg.ready) return <div className="skeleton" style={{ height: 300 }} />;

  return (
    <div>
      <div className="ls-tabs">
        {TABS.map((tb) => (
          <button key={tb.key} className={tab === tb.key ? 'on' : ''} onClick={() => setTab(tb.key)}>{t(tb.tk)}</button>
        ))}
      </div>

      <div className="section">
        {tab === 'general' && (
          <>
            {TEXT_FIELDS.map((f) => (
              <div className="form-group" key={f.key}>
                <label>{t(f.tk)}</label>
                {f.area
                  ? <textarea className="form-control" rows={2} value={vals[f.key] || ''} onChange={(e) => setV(f.key, e.target.value)} />
                  : <input className="form-control" value={vals[f.key] || ''} onChange={(e) => setV(f.key, e.target.value)} />}
                {f.hintk && <small style={{ color: 'var(--muted)' }}>{t(f.hintk)}</small>}
              </div>
            ))}
            <button className="btn btn-primary btn-block" disabled={busy} onClick={save} style={{ marginTop: 8 }}>
              {busy ? t('wait') : t('save')}
            </button>
          </>
        )}

        {tab === 'theme' && (
          <>
            <div className="ls-subhead" style={{ marginTop: 0 }}>{t('thAppearance')}</div>
            <div className="theme-opts">
              {THEME_MODES.map((m) => (
                <button key={m} type="button" className={`theme-opt ${themeMode === m ? 'on' : ''}`} onClick={() => pickTheme(m)}>
                  <span className={`swatch ${m}`} />
                  <span><i className={`fas ${THEME_ICON[m]}`} /> {t(`th${m[0].toUpperCase()}${m.slice(1)}`)}</span>
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 20 }}>{t('thDevice')}</p>

            <div className="ls-subhead">{t('thBrand')}</div>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>{t('thBrandHelp')}</p>
            <div className="brand-row">
              <input type="color" value={brand || '#001f3f'} onChange={(e) => pickBrand(e.target.value)} />
              <div className="brand-swatches">
                {BRAND_PRESETS.map((p) => (
                  <button key={p.hex || 'def'} type="button" title={p.label}
                    className={`brand-sw ${(brand || '') === p.hex ? 'on' : ''}`}
                    style={{ background: p.hex || 'linear-gradient(135deg,#001f3f,#0074d9)' }}
                    onClick={() => pickBrand(p.hex)} />
                ))}
              </div>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
              {(brand || '') === '' ? t('thBrandDefault') : brand}
            </p>
          </>
        )}

        {tab === 'automation' && (
          <>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('sAutoIntro')}</p>
            {RULES.map((r) => {
              const { n, u } = parseDur(vals[r.key]);
              const on = n !== '' && n !== '0';
              return (
                <div className="rule-card" key={r.key}>
                  <div className="rule-top">
                    <span>{t(r.tk)}</span>
                    <label className="rule-toggle">
                      <input type="checkbox" checked={on}
                        onChange={(e) => setV(r.key, e.target.checked ? r.def : '0h')} />
                      <span>{on ? t('active') : t('inactive')}</span>
                    </label>
                  </div>
                  <div className="rule-desc">{t(r.descK)}</div>
                  {on && (
                    <div className="rule-input">
                      <input className="form-control" type="number" min="1" style={{ maxWidth: 90 }}
                        value={n} onChange={(e) => setV(r.key, `${e.target.value || 1}${u}`)} />
                      <select className="form-control" value={u} onChange={(e) => setV(r.key, `${n || 1}${e.target.value}`)}>
                        {DUR_UNITS.map((x) => <option key={x.v} value={x.v}>{t(x.tk)}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="rule-card">
              <div className="rule-top"><span>{t('sAttempt')}</span></div>
              <div className="rule-desc">{t('sAttemptDesc')}</div>
              <input className="form-control" type="number" min="1" style={{ maxWidth: 110 }}
                value={vals.Attempt_Limit || '7'} onChange={(e) => setV('Attempt_Limit', e.target.value)} />
            </div>

            <div className="rule-card">
              <div className="rule-top"><span>{t('sWorkHours')}</span></div>
              <div className="rule-desc">{t('sWorkHoursDesc')}</div>
              <div className="rule-input">
                <input className="form-control" type="time" value={vals.Work_Start || '09:00'} onChange={(e) => setV('Work_Start', e.target.value)} />
                <span style={{ color: 'var(--muted)' }}>→</span>
                <input className="form-control" type="time" value={vals.Work_End || '21:00'} onChange={(e) => setV('Work_End', e.target.value)} />
              </div>
            </div>

            <div className="rule-card">
              <div className="rule-top">
                <span>{t('sMorningBrief')}</span>
                <label className="rule-toggle">
                  <input type="checkbox" checked={vals.Morning_Brief !== 'off'}
                    onChange={(e) => setV('Morning_Brief', e.target.checked ? 'on' : 'off')} />
                  <span>{vals.Morning_Brief !== 'off' ? t('active') : t('inactive')}</span>
                </label>
              </div>
              <div className="rule-desc">{t('sMorningBriefDesc')}</div>
            </div>

            <button className="btn btn-primary btn-block" disabled={busy} onClick={save} style={{ marginTop: 8 }}>
              {busy ? t('wait') : t('save')}
            </button>
          </>
        )}

        {tab === 'adspend' && (
          <>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('sAdIntro')}</p>

            <div className="ls-subhead" style={{ marginTop: 0 }}>{t('sAdStanding')}</div>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>{t('sAdStandingHelp')}</p>
            {AD_PLATFORMS.map((p) => (
              <div className="form-group" key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ minWidth: 90, marginBottom: 0 }}>{p.label}</label>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>₹</span>
                  <input className="form-control" type="number" min="0" style={{ paddingLeft: 24 }}
                    value={standing[p.key] || ''} onChange={(e) => setStanding((s) => ({ ...s, [p.key]: e.target.value }))}
                    placeholder={t('sAdPerDay')} />
                </div>
              </div>
            ))}
            <button className="btn btn-primary btn-block" disabled={adBusy} onClick={saveStanding} style={{ marginTop: 6 }}>
              {adBusy ? t('wait') : t('save')}
            </button>

            <div className="ls-subhead">{t('sAdImport')}</div>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>{t('sAdImportHelp')}</p>
            <textarea className="form-control" rows={4} style={{ fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'date,facebook,instagram\n2026-09-01,2000,500\n2026-09-02,0,0'}
              value={csvText} onChange={(e) => { setCsvText(e.target.value); setCsvMsg(''); }} />
            {csvMsg && <div className="alert alert-info" style={{ marginTop: 8 }}>{csvMsg}</div>}
            <button className="btn btn-ghost btn-block" disabled={adBusy || !csvText.trim()} onClick={importCsv} style={{ marginTop: 8 }}>
              <i className="fas fa-file-import" /> {t('sAdImportBtn')}
            </button>
            {cfg.adSpend?.days && (
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
                {fill(t('sAdDaysStored'), { n: Object.keys(cfg.adSpend.days).length })}
              </p>
            )}
          </>
        )}

        {tab === 'roles' && (
          <>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t('sRolesIntro')}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
              <i className="fas fa-lock" style={{ color: 'var(--warning)' }} /> {t('sRolesHardNote')}
            </p>
            <div className="tablewrap">
              <table className="meca-t access-t">
                <thead>
                  <tr><th>{t('sRolesPerm')}</th>{CONFIGURABLE_ROLES.map((r) => <th key={r}>{r.toUpperCase()}</th>)}</tr>
                </thead>
                <tbody>
                  {PERM_GRPS.map((grp) => (
                    <React.Fragment key={grp}>
                      <tr className="perm-grp"><td colSpan={CONFIGURABLE_ROLES.length + 1}>{grp}</td></tr>
                      {ALL_PERMS.filter((p) => p.grp === grp).map((p) => (
                        <tr key={p.key}>
                          <td className="nm">{p.label} {p.hard && <i className="fas fa-lock" title={t('sRolesHardTip')} style={{ color: 'var(--warning)', fontSize: 10 }} />}</td>
                          {CONFIGURABLE_ROLES.map((r) => (
                            <td key={r}>
                              <input type="checkbox" checked={permOn(r, p.key)} onChange={() => togglePerm(r, p.key)} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-primary btn-block" disabled={permBusy} onClick={savePerms} style={{ marginTop: 12 }}>
              {permBusy ? t('wait') : t('save')}
            </button>
          </>
        )}

        {tab === 'notify' && (
          <>
            <div className="ls-subhead" style={{ marginTop: 0 }}>{t('sMailTitle')}</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{t('sMailHelp')}</p>
            <div className="form-group">
              <label>{t('sMailFrom')}</label>
              <input className="form-control" type="email" placeholder="you@gmail.com" value={mailEmail} onChange={(e) => setMailEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('sMailPass')}</label>
              <input className="form-control" type="password" placeholder={cfg.settings?.mail_password_set ? '••••••••••••••••' : t('sMailPassPh')}
                value={mailPw} onChange={(e) => setMailPw(e.target.value)} />
              <small style={{ color: 'var(--muted)' }}>
                {cfg.settings?.mail_password_set ? t('sMailAlready') : t('sMailNotSet')}
              </small>
            </div>
            <button className="btn btn-primary btn-block" disabled={mailBusy} onClick={saveMail}>
              {mailBusy ? t('wait') : t('save')}
            </button>

            <div className="ls-subhead">{t('sAiTitle')}</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{t('sAiHelp')}</p>
            {cfg.settings?.ai_ready && <p className="field-hint" style={{ marginTop: -4 }}><i className="fas fa-circle-check" style={{ color: 'var(--success)' }} /> {t('sAiOn')}</p>}
            <div className="form-group">
              <label>{t('sAiProvider')}</label>
              <select className="form-control" value={aiProvider} onChange={(e) => { setAiProvider(e.target.value); setAiModel(e.target.value === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'openai/gpt-oss-20b'); }}>
                <option value="nvidia">NVIDIA (build.nvidia.com)</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t('sAiKey')}</label>
              <input className="form-control" type="password" placeholder={aiProvider === 'anthropic' ? 'sk-ant-...' : 'nvapi-...'} value={aiKey} onChange={(e) => setAiKeyV(e.target.value)} />
              <small style={{ color: 'var(--muted)' }}>{t('sAiKeyHint')}</small>
            </div>
            <div className="form-group">
              <label>{t('sAiModel')}</label>
              <select className="form-control" value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
                {AI_MODELS.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-block" disabled={aiBusy || !aiKey.trim()} onClick={saveAi}>
              {aiBusy ? t('wait') : t('save')}
            </button>

            <div className="ls-subhead">{t('pushTestTitle')}</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('pushTestHelp')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="form-control" value={testUid} onChange={(e) => setTestUid(e.target.value)}>
                <option value="">— {t('uName')} —</option>
                {cfg.users.filter((u) => (u.status || 'active') === 'active').map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={testBusy || !testUid} onClick={sendTest} style={{ flexShrink: 0 }}>
                {testBusy ? t('wait') : t('pushTestBtn')}
              </button>
            </div>
          </>
        )}

        {tab === 'tools' && (
          <>
            <div className="ls-subhead" style={{ marginTop: 0 }}>{t('sReports')}</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('sStatsHelp')}</p>
            <button className="btn btn-ghost btn-block" disabled={bf.running} onClick={rebuild}>
              {bf.running
                ? (bf.total ? `${bf.done} / ${bf.total} ${t('unitDay')}…` : t('sStatsRunning'))
                : t('sStatsBtn')}
            </button>
            {bf.running && bf.total > 0 && (
              <div className="bf-bar"><div className="bf-fill" style={{ width: `${(bf.done / bf.total) * 100}%` }} /></div>
            )}

            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '14px 0 8px' }}>{t('sScoreHelp')}</p>
            <button className="btn btn-ghost btn-block" disabled={rs.running}
              onClick={async () => {
                setRs({ running: true, done: 0, total: 0 });
                try {
                  const r = await rescoreLeads((p) => setRs({ running: true, done: p.done, total: p.total }));
                  toast(fill(t('sRescoreDone'), { n: r.done || 0 }));
                } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
                finally { setRs({ running: false, done: 0, total: 0 }); }
              }}>
              {rs.running ? (rs.total ? `${rs.done} / ${rs.total}…` : t('sStatsRunning')) : t('sRescore')}
            </button>
            {rs.running && rs.total > 0 && (
              <div className="bf-bar"><div className="bf-fill" style={{ width: `${(rs.done / rs.total) * 100}%` }} /></div>
            )}
          </>
        )}

        <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>
          {t('sBuildLabel')}: {new Date(__BUILD_TIME__).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
