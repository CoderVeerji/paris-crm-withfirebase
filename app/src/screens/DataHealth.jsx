import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth';
import { useConfig, ldrUsers, salesUsers } from '../config';
import { useT, fill } from '../i18n';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { scanDuplicates, mergeLead, bulkAssign } from '../lib/admin';
import { reassignLead } from '../lib/actions';
import { downloadCsv } from '../lib/csv';
import { fmtDate, fmtStatus, isPast } from '../lib/format';
import { healthOverview, healthByPerson, fetchHealthLeads, bustHealthCache, HEALTH_CHECKS } from '../lib/dataHealth';
import LeadSheet from '../components/LeadSheet';

const PER = 20;

const TONE = { ink: 'var(--ink)', warn: '#e65100', bad: 'var(--danger)', brown: '#795548', red: '#d32f2f', purple: '#9c27b0' };

export default function DataHealth() {
  const { t } = useT();
  const cfg = useConfig();
  const [tab, setTab] = useState('overview');
  const [ov, setOv] = useState(null);
  const [pp, setPp] = useState(null);
  const [bucket, setBucket] = useState('overdue');
  const [openLead, setOpenLead] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setOv(null);
    healthOverview().then(setOv).catch(() => setOv(false));
  }, [nonce]);

  useEffect(() => {
    if (tab !== 'people' || !cfg.ready) return;
    const users = (cfg.users || []).filter((u) => ['ldr', 'sales'].includes(u.role) && (u.status || 'active') === 'active');
    setPp(null);
    healthByPerson(users).then(setPp).catch(() => setPp([]));
  }, [tab, cfg.ready, nonce]);

  function refresh() { bustHealthCache(); setNonce((n) => n + 1); }
  function openBucket(k) { setBucket(k); setTab('leads'); }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['overview', 'fa-chart-pie', t('dhTabOverview')], ['people', 'fa-users', t('dhTabPeople')], ['leads', 'fa-list', t('dhTabLeads')]].map(([k, ic, lbl]) => (
          <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '8px 13px', fontSize: 13 }} onClick={() => setTab(k)}>
            <i className={`fas ${ic}`} /> {lbl}
          </button>
        ))}
        <button className="btn btn-ghost" style={{ padding: '8px 13px', fontSize: 13, marginLeft: 'auto' }} onClick={refresh}><i className="fas fa-rotate" /> {t('dRefresh')}</button>
      </div>

      {tab === 'overview' && (
        <>
          <div className="an-kpi-grid">
            {ov == null ? Array.from({ length: 7 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 92 }} />)
              : ov === false ? <div className="alert alert-error">{t('loadFail')}</div>
                : HEALTH_CHECKS.map((c) => {
                  const val = ov[c.key];
                  const clickable = !!c.wheres;
                  return (
                    <button key={c.key} type="button" disabled={!clickable}
                      className="an-kpi" style={{ borderLeftColor: TONE[c.tone], textAlign: 'left', cursor: clickable ? 'pointer' : 'default', outline: clickable && bucket === c.key && tab === 'leads' ? `2px solid ${TONE[c.tone]}` : 'none' }}
                      onClick={() => clickable && openBucket(c.key)}>
                      <div className="an-kpi-v" style={{ color: c.key === 'total' ? 'var(--ink)' : TONE[c.tone] }}>{val == null ? '—' : val.toLocaleString('en-IN')}</div>
                      <div className="an-kpi-l">{t(c.tk)}</div>
                    </button>
                  );
                })}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 18 }}>{t('dhFixHint')}</p>
          <DupFinder />
        </>
      )}

      {tab === 'people' && (
        <div className="section">
          <h3><i className="fas fa-users" /> {t('dhPerPerson')}</h3>
          <div className="tablewrap">
            <table className="meca-t">
              <thead><tr><th>{t('uName')}</th><th>{t('uRole')}</th><th>{t('dhTotal')}</th><th>{t('daOverdueCol')}</th><th>{t('dhNever')}</th></tr></thead>
              <tbody>
                {pp == null ? <tr><td colSpan={5}><div className="skeleton" style={{ height: 44 }} /></td></tr>
                  : pp.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('noData')}</td></tr>
                    : pp.map((r) => (
                      <tr key={r.uid}>
                        <td className="nm">{r.name}</td>
                        <td style={{ textTransform: 'uppercase', fontSize: 11 }}>{r.role}</td>
                        <td>{r.total.toLocaleString('en-IN')}</td>
                        <td style={{ color: r.overdue ? '#795548' : 'var(--muted)', fontWeight: r.overdue ? 700 : 400 }}>{r.overdue}</td>
                        <td style={{ color: r.never ? '#d32f2f' : 'var(--muted)', fontWeight: r.never ? 700 : 400 }}>{r.never}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'leads' && (
        <div className="section">
          <div className="chips" style={{ marginBottom: 12 }}>
            {HEALTH_CHECKS.filter((c) => c.wheres).map((c) => (
              <button key={c.key} className={`chip ${bucket === c.key ? 'active' : ''}`} onClick={() => setBucket(c.key)}>{t(c.tk)}</button>
            ))}
          </div>
          <BucketLeads bucket={bucket} onOpenLead={setOpenLead} onChanged={refresh} />
        </div>
      )}

      {openLead && <LeadSheet lead={openLead} onClose={() => setOpenLead(null)} onSaved={() => { setOpenLead(null); refresh(); }} />}
    </div>
  );
}

function BucketLeads({ bucket, onOpenLead, onChanged }) {
  const { t } = useT();
  const { user } = useAuth();
  const cfg = useConfig();
  const actor = { uid: user.id, name: user.full_name };
  const ldrs = ldrUsers(cfg); const sales = salesUsers(cfg);
  const allUsers = [...ldrs, ...sales];
  const nameOf = (uid) => (cfg.users || []).find((u) => u.id === uid)?.full_name || '';

  const [all, setAll] = useState(null);
  const [capped, setCapped] = useState(false);
  const [q, setQ] = useState('');
  const [ownerF, setOwnerF] = useState('');
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(() => new Set());
  const [reOpen, setReOpen] = useState(null);
  const [bulkTo, setBulkTo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setAll(null); setSel(new Set()); setPage(0);
    fetchHealthLeads(bucket).then((r) => { setAll(r.rows); setCapped(r.capped); }).catch(() => setAll([]));
  };
  useEffect(load, [bucket]);

  if (all == null) return <div className="skeleton" style={{ height: 160 }} />;

  const filtered = all.filter((l) => {
    if (ownerF && l.ldr_uid !== ownerF && l.sales_uid !== ownerF) return false;
    if (q) {
      const k = q.toLowerCase();
      if (!(l.name || '').toLowerCase().includes(k) && !(l.phone || l.phone_raw || '').includes(q)) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
  const pg = Math.min(page, totalPages - 1);
  const rows = filtered.slice(pg * PER, pg * PER + PER);
  const selRows = filtered.filter((l) => sel.has(l.id));

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((l) => sel.has(l.id));

  async function doReassign(lead, { ldr_uid, sales_uid }) {
    const assignee = {};
    if (ldr_uid !== undefined) { assignee.ldr_uid = ldr_uid || null; assignee.ldr_name = nameOf(ldr_uid); }
    if (sales_uid !== undefined) { assignee.sales_uid = sales_uid || null; assignee.sales_name = nameOf(sales_uid); }
    try {
      await reassignLead(lead, actor, assignee);
      toast(`${lead.name || t('noName')} — ${t('dhReassigned')} ✓`);
      setReOpen(null); load(); onChanged?.();
    } catch (e) { toast(friendlyError(e, t), 'err'); }
  }

  async function bulkReassign() {
    if (!bulkTo || !selRows.length) return;
    const u = allUsers.find((x) => x.id === bulkTo);
    const isSales = u?.role === 'sales';
    setBusy(true);
    try {
      await bulkAssign(selRows.map((l) => l.id),
        isSales ? { sales_uid: bulkTo } : { ldr_uid: bulkTo },
        isSales ? { sales: u.full_name } : { ldr: u.full_name }, actor);
      toast(fill(t('dhBulkDone'), { n: selRows.length, name: u.full_name }));
      setBulkTo(''); load(); onChanged?.();
    } catch (e) { toast(friendlyError(e, t), 'err'); }
    finally { setBusy(false); }
  }

  function exportCsv() {
    downloadCsv(`data-health-${bucket}.csv`,
      ['Name', 'Phone', 'Status', 'LDR', 'Sales', 'Next follow-up', 'Created'],
      filtered.map((l) => [l.name || '', l.phone || l.phone_raw || '', fmtStatus(l.sales_status || l.status),
        nameOf(l.ldr_uid), nameOf(l.sales_uid), l.next_followup ? fmtDate(l.next_followup) : '', l.created_at ? fmtDate(l.created_at) : '']));
  }

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input className="form-control" placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <select className="form-control" value={ownerF} onChange={(e) => { setOwnerF(e.target.value); setPage(0); }}>
          <option value="">{t('dhAllOwners')}</option>
          {allUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
        </select>
        <button type="button" className="btn btn-ghost" style={{ flex: '0 0 auto', minWidth: 0 }} disabled={!filtered.length} onClick={exportCsv}><i className="fas fa-file-csv" /> CSV</button>
      </div>

      {capped && <div className="rep-note"><i className="fas fa-circle-info" /> {t('daRangeTooBig')}</div>}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{fill(t('dhShowing'), { n: filtered.length })}</div>

      {filtered.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}><i className="fas fa-circle-check" /> {t('dhClean')}</div>
      ) : (
        <>
          <label className="dh-selall">
            <input type="checkbox" checked={allOnPage} onChange={() => setSel((s) => {
              const n = new Set(s); if (allOnPage) rows.forEach((l) => n.delete(l.id)); else rows.forEach((l) => n.add(l.id)); return n;
            })} /> {t('dhSelectPage')}
          </label>
          <div className="feed">
            {rows.map((l) => (
              <div className="feed-row" key={l.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} style={{ width: 18, height: 18, marginTop: 3, flexShrink: 0 }} />
                  <button className="user-row-main" style={{ flex: 1 }} onClick={() => onOpenLead(l)}>
                    <div className="feed-body">
                      <div className="feed-top"><b>{l.name || t('noName')}</b><span className="status-badge bg-default" style={{ fontSize: 10 }}>{fmtStatus(l.sales_status || l.status)}</span></div>
                      <div className="feed-sub" style={{ textTransform: 'none' }}>
                        {l.phone || l.phone_raw} · LDR: <b>{nameOf(l.ldr_uid) || '—'}</b> · Sales: <b>{nameOf(l.sales_uid) || '—'}</b>
                        {l.next_followup && <> · <span style={{ color: isPast(l.next_followup) ? 'var(--danger)' : 'var(--muted)' }}>{fmtDate(l.next_followup)}</span></>}
                      </div>
                    </div>
                  </button>
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <button type="button" className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 11.5 }} onClick={() => setReOpen(reOpen === l.id ? null : l.id)}>
                      <i className="fas fa-arrows-turn-right" /> {t('dhReassign')}
                    </button>
                    <button type="button" className="btn btn-primary" style={{ padding: '6px 10px', fontSize: 11.5 }} onClick={() => onOpenLead(l)}><i className="fas fa-bolt" /></button>
                  </div>
                </div>
                {reOpen === l.id && (
                  <div className="dh-reassign">
                    <div className="form-group" style={{ margin: 0, flex: 1 }}>
                      <label style={{ fontSize: 11 }}>LDR</label>
                      <select className="form-control" defaultValue={l.ldr_uid || ''} onChange={(e) => doReassign(l, { ldr_uid: e.target.value })}>
                        <option value="">— {t('dhUnassign')} —</option>
                        {ldrs.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0, flex: 1 }}>
                      <label style={{ fontSize: 11 }}>Sales</label>
                      <select className="form-control" defaultValue={l.sales_uid || ''} onChange={(e) => doReassign(l, { sales_uid: e.target.value })}>
                        <option value="">— {t('dhUnassign')} —</option>
                        {sales.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {filtered.length > PER && (
            <div className="pager">
              <button type="button" className="btn btn-ghost" disabled={pg === 0} onClick={() => setPage(pg - 1)}><i className="fas fa-chevron-left" /> {t('prevPage')}</button>
              <span className="pager-page">{pg + 1} / {totalPages}</span>
              <button type="button" className="btn btn-ghost" disabled={pg >= totalPages - 1} onClick={() => setPage(pg + 1)}>{t('nextPage')} <i className="fas fa-chevron-right" /></button>
            </div>
          )}
        </>
      )}

      {selRows.length > 0 && (
        <div className="bulkbar">
          <span>{fill(t('dhNsel'), { n: selRows.length })}</span>
          <select className="form-control" style={{ minWidth: 160 }} value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
            <option value="">— {t('dhReassignTo')} —</option>
            {allUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
          </select>
          <button className="btn btn-ghost" disabled={busy || !bulkTo} onClick={bulkReassign}>{busy ? t('wait') : t('go')}</button>
          <button className="btn btn-ghost" onClick={() => setSel(new Set())}><i className="fas fa-xmark" /></button>
        </div>
      )}
    </>
  );
}

/** Phone-number duplicate leads dhoondo + merge karo. */
function DupFinder() {
  const { user } = useAuth();
  const { t } = useT();
  const actor = { uid: user.id, name: user.full_name };
  const [scanning, setScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [groups, setGroups] = useState(null);
  const [busyDigits, setBusyDigits] = useState(null);
  const [picks, setPicks] = useState({});

  async function runScan() {
    setScanning(true); setScannedCount(0); setGroups(null);
    try {
      const found = await scanDuplicates((n) => setScannedCount(n));
      const nextPicks = {};
      await Promise.all(found.map(async (g) => {
        let canonicalId = null;
        try {
          const idx = await getDoc(doc(db, 'phone_index', g.digits));
          if (idx.exists() && g.leads.some((l) => l.id === idx.data().lead_id)) canonicalId = idx.data().lead_id;
        } catch { /* ignore */ }
        if (!canonicalId) {
          const sorted = [...g.leads].sort((a, b) => (a.created_at?.seconds || 0) - (b.created_at?.seconds || 0));
          canonicalId = sorted[0].id;
        }
        nextPicks[g.digits] = canonicalId;
      }));
      setPicks(nextPicks);
      setGroups(found);
    } catch (e) { toast(friendlyError(e, t), 'err'); }
    finally { setScanning(false); }
  }

  async function doMerge(group) {
    const canonicalId = picks[group.digits];
    const canonical = group.leads.find((l) => l.id === canonicalId);
    const dupes = group.leads.filter((l) => l.id !== canonicalId);
    setBusyDigits(group.digits);
    try {
      let movedTotal = 0;
      for (const dupe of dupes) { const r = await mergeLead(canonical, dupe, actor); movedTotal += r.movedCount; }
      toast(fill(t('dupMerged'), { n: dupes.length, o: movedTotal }));
      setGroups((gs) => gs.filter((g) => g.digits !== group.digits));
    } catch (e) { toast(friendlyError(e, t), 'err'); }
    finally { setBusyDigits(null); }
  }

  return (
    <div className="section">
      <h3><i className="fas fa-clone" /> {t('dupTitle')}</h3>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>{t('dupIntro')}</p>
      <button className="btn btn-ghost btn-block" disabled={scanning} onClick={runScan}>
        {scanning ? fill(t('dupScanning'), { n: scannedCount }) : t('dupScanBtn')}
      </button>
      {groups != null && (
        groups.length === 0 ? <div className="empty" style={{ padding: 20 }}><i className="fas fa-circle-check" /> {t('dupNone')}</div> : (
          <div style={{ marginTop: 12 }}>
            {groups.map((g) => (
              <div className="dup-group" key={g.digits}>
                <div className="dup-group-head">+{g.digits} · {fill(t('dupCount'), { n: g.leads.length })}</div>
                {g.leads.map((l) => (
                  <label className="dup-pick-row" key={l.id}>
                    <input type="radio" name={`pick-${g.digits}`} checked={picks[g.digits] === l.id}
                      onChange={() => setPicks((p) => ({ ...p, [g.digits]: l.id }))} />
                    <div className="dup-pick-body">
                      <b>{l.name || t('noName')}</b>
                      <span>{l.sales_status || l.status || '—'} · {t('created')} {fmtDate(l.created_at)}{l.order_count > 0 ? ` · ${l.order_count} ${t('orders')}` : ''}</span>
                    </div>
                  </label>
                ))}
                <button className="btn btn-primary btn-block" disabled={busyDigits === g.digits} onClick={() => doMerge(g)} style={{ marginTop: 8 }}>
                  {busyDigits === g.digits ? t('wait') : t('dupMergeBtn')}
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
