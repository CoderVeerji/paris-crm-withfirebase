import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { useConfig, ldrUsers } from '../config';
import { toast } from '../toast';
import { parseCsv, mapColumns, downloadCsv } from '../lib/csv';
import { normalizePhone } from '../lib/phone';
import { importLeads, checkExistingPhones } from '../lib/admin';
import { friendlyError } from '../lib/errmsg';

const SAMPLE_HEAD = ['name', 'phone', 'email', 'company', 'city', 'state', 'source', 'assign'];
const SAMPLE_ROWS = [
  ['Rahul Sharma', '9876543210', 'rahul@example.com', 'Sharma Textiles', 'Jaipur', 'Rajasthan', 'Facebook', 'Neelam'],
  ['Anita Verma', '+91 8123456789', '', 'Verma Boutique', 'Indore', 'Madhya Pradesh', 'Instagram', 'Mamta'],
  ['Sunil Traders', '07011122233', 'sunil@example.com', 'Sunil Traders', 'Delhi', 'Delhi', 'Referral', ''],
];

export default function BulkImport() {
  const { user } = useAuth();
  const { t } = useT();
  const cfg = useConfig();
  const actor = { uid: user.id, name: user.full_name };
  const fileRef = useRef(null);

  const ldrPool = useMemo(() => ldrUsers(cfg), [cfg.users]);
  const autoPool = useMemo(() => {
    const pure = ldrPool.filter((u) => u.role === 'ldr');
    return pure.length ? pure : ldrPool;
  }, [ldrPool]);

  const [rows, setRows] = useState(null);        // parsed + analyzed
  const [analysis, setAnalysis] = useState(null); // { total, valid, invalid, dup, byName, notFound, blank }
  const [checking, setChecking] = useState(false);
  const [fallback, setFallback] = useState('auto'); // 'auto' | uid | 'none'
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [result, setResult] = useState(null);

  const matchLdr = (raw) => {
    const nm = String(raw || '').trim().toLowerCase();
    if (!nm) return null;
    const P = ldrPool;
    return P.find((u) => u.full_name.toLowerCase() === nm)
      || P.find((u) => u.full_name.toLowerCase().startsWith(nm))
      || P.find((u) => u.full_name.toLowerCase().split(' ')[0] === nm)
      || null;
  };

  function reset() {
    setRows(null); setAnalysis(null); setResult(null); setFallback('auto');
    if (fileRef.current) fileRef.current.value = '';
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const grid = parseCsv(String(reader.result));
      if (grid.length < 2) { toast(t('blkEmpty'), 'err'); reset(); return; }
      const idx = mapColumns(grid[0]);
      if (idx.phone == null) { toast(t('blkNoPhoneCol'), 'err'); reset(); return; }
      if (grid.length - 1 > 3000) { toast(t('blkTooMany'), 'err'); reset(); return; }

      const parsed = grid.slice(1).map((r) => {
        const phone = r[idx.phone] || '';
        const p = normalizePhone(phone);
        const assignRaw = idx.assign != null ? (r[idx.assign] || '') : '';
        const u = matchLdr(assignRaw);
        return {
          name: (idx.name != null ? r[idx.name] : '').trim(),
          phone, email: idx.email != null ? r[idx.email] : '',
          company: idx.company != null ? r[idx.company] : '',
          city: idx.city != null ? r[idx.city] : '', state: idx.state != null ? r[idx.state] : '',
          source: idx.source != null ? r[idx.source] : 'Bulk Import',
          _valid: p.valid, _digits: p.digits, _formatted: p.formatted,
          _dup: false,
          _assignRaw: assignRaw.trim(),
          _matchUid: u ? u.id : null, _matchName: u ? u.full_name : '',
        };
      });

      setRows(parsed);
      setChecking(true);
      try {
        const existing = await checkExistingPhones(parsed.map((r) => r._digits));
        const localSeen = new Set();
        parsed.forEach((r) => {
          if (!r._valid) return;
          if (existing.has(r._digits) || localSeen.has(r._digits)) { r._dup = true; return; }
          localSeen.add(r._digits);
        });
      } catch (err) { console.error(err); toast(t('blkDupFail'), 'err'); }
      setChecking(false);

      const importable = parsed.filter((r) => r._valid && !r._dup);
      const byName = {}; const notFound = {}; let blank = 0;
      importable.forEach((r) => {
        if (r._matchUid) byName[r._matchName] = (byName[r._matchName] || 0) + 1;
        else if (r._assignRaw) notFound[r._assignRaw] = (notFound[r._assignRaw] || 0) + 1;
        else blank++;
      });
      setAnalysis({
        total: parsed.length,
        valid: parsed.filter((r) => r._valid).length,
        invalid: parsed.filter((r) => !r._valid).length,
        dup: parsed.filter((r) => r._dup).length,
        importable: importable.length,
        byName: Object.entries(byName).sort((a, b) => b[1] - a[1]),
        notFound: Object.entries(notFound).sort((a, b) => b[1] - a[1]),
        blank,
        unassigned: blank + Object.values(notFound).reduce((s, n) => s + n, 0),
      });
      setRows([...parsed]);
    };
    reader.readAsText(f);
  }

  async function run() {
    if (!rows || !analysis) return;
    setBusy(true); setProg([0, 0]);
    try {
      // har importable row ka final LDR resolve karo
      let rr = 0;
      const finalRows = rows.map((r) => {
        if (!r._valid || r._dup) return r;
        if (r._matchUid) return { ...r, _ldr_uid: r._matchUid, _ldr_name: r._matchName };
        // no assignee in file -> fallback
        if (fallback === 'auto' && autoPool.length) {
          const u = autoPool[rr++ % autoPool.length];
          return { ...r, _ldr_uid: u.id, _ldr_name: u.full_name };
        }
        if (fallback !== 'auto' && fallback !== 'none') {
          const u = ldrPool.find((x) => x.id === fallback);
          return { ...r, _ldr_uid: fallback, _ldr_name: u ? u.full_name : '' };
        }
        return { ...r, _ldr_uid: null, _ldr_name: '' };
      });
      const res = await importLeads(finalRows, actor, (d, tot) => setProg([d, tot]));
      setResult({ ...res, dup: analysis.dup, invalid: analysis.invalid });
      toast(fill(t('blkResult'), { a: res.added, d: analysis.dup, i: analysis.invalid }));
      reset();
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setBusy(false); setProg(null); }
  }

  return (
    <div className="section">
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>{t('blkIntro')}</p>
      <div className="howto"><b>{t('blkHow1')}</b><br />{t('blkHow2')}<br />{t('blkHow3')}</div>

      <button className="btn btn-ghost btn-block" style={{ marginBottom: 6 }}
        onClick={() => downloadCsv('paris-crm-leads-sample.csv', SAMPLE_HEAD, SAMPLE_ROWS)}>
        <i className="fas fa-download" /> {t('blkSample')}
      </button>
      <p className="field-hint" style={{ marginBottom: 14 }}>{t('blkAssignColHint')}</p>

      <div className="form-group">
        <label>{t('blkChoose')}</label>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="form-control" />
      </div>

      {checking && <div className="alert alert-info"><i className="fas fa-spinner fa-spin" /> {t('blkChecking')}</div>}

      {analysis && !checking && (
        <>
          <div className="stat-grid" style={{ marginTop: 6 }}>
            <div className="stat-card"><div className="val">{analysis.total}</div><div className="label">{t('blkTotal')}</div></div>
            <div className="stat-card"><div className="val" style={{ color: 'var(--success)' }}>{analysis.importable}</div><div className="label">{t('blkWillImport')}</div></div>
            <div className="stat-card"><div className="val" style={{ color: 'var(--warning)' }}>{analysis.dup}</div><div className="label">{t('blkDup')}</div></div>
            <div className="stat-card"><div className="val" style={{ color: 'var(--danger)' }}>{analysis.invalid}</div><div className="label">{t('blkInvalid')}</div></div>
          </div>

          <div className="bi-assign">
            <div className="bi-assign-h">{t('blkFileAssign')}</div>
            {analysis.byName.length === 0 && analysis.notFound.length === 0 && (
              <p className="field-hint" style={{ margin: 0 }}>{t('blkNoAssignCol')}</p>
            )}
            {analysis.byName.map(([n, c]) => (
              <div className="bi-arow" key={n}><span><i className="fas fa-user" /> {n}</span><b>{c}</b></div>
            ))}
            {analysis.notFound.map(([n, c]) => (
              <div className="bi-arow warn" key={n}><span><i className="fas fa-triangle-exclamation" /> {fill(t('blkNameNotFound'), { n })}</span><b>{c}</b></div>
            ))}
            {analysis.blank > 0 && (
              <div className="bi-arow"><span><i className="fas fa-user-slash" /> {t('blkNoAssignee')}</span><b>{analysis.blank}</b></div>
            )}
          </div>

          {analysis.unassigned > 0 && (
            <div className="bi-fallback">
              <div className="bi-assign-h">{fill(t('blkRest'), { n: analysis.unassigned })}</div>
              <label className="bi-radio">
                <input type="radio" checked={fallback === 'auto'} onChange={() => setFallback('auto')} />
                <span><b>{t('blkRestAuto')}</b><em>{fill(t('blkRestAutoHint'), { n: autoPool.length })}</em></span>
              </label>
              <label className="bi-radio">
                <input type="radio" checked={fallback !== 'auto' && fallback !== 'none'} onChange={() => setFallback(ldrPool[0]?.id || 'none')} />
                <span><b>{t('blkRestUser')}</b></span>
              </label>
              {fallback !== 'auto' && fallback !== 'none' && (
                <select className="form-control" value={fallback} onChange={(e) => setFallback(e.target.value)} style={{ margin: '2px 0 6px 26px', width: 'calc(100% - 26px)' }}>
                  {ldrPool.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              )}
              <label className="bi-radio">
                <input type="radio" checked={fallback === 'none'} onChange={() => setFallback('none')} />
                <span><b>{t('blkRestNone')}</b></span>
              </label>
            </div>
          )}

          <button className="btn btn-primary btn-block" disabled={busy || analysis.importable === 0} onClick={run}>
            {busy ? (prog ? `${prog[0]}/${prog[1]}…` : t('wait')) : fill(t('blkImportN'), { n: analysis.importable })}
          </button>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={reset}>{t('cancel')}</button>
        </>
      )}

      {result && (
        <div className="bi-result">
          <div className="bi-result-h"><i className="fas fa-circle-check" /> {fill(t('blkResult'), { a: result.added, d: result.dup, i: result.invalid })}</div>
          {Object.entries(result.byLdr || {}).sort((a, b) => b[1] - a[1]).map(([n, c]) => (
            <div className="bi-arow" key={n}><span><i className="fas fa-user" /> {n === '—' ? t('blkNoAssignee') : n}</span><b>{c}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}
