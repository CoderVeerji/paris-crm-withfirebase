import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { fetchFollowups } from '../lib/followups';
import { fmtStatus } from '../lib/format';
import LeadSheet from '../components/LeadSheet';
import NewLeadSheet from '../components/NewLeadSheet';
import LeadsSummary from '../components/LeadsSummary';
import { LeadCard } from './Leads';

const PER = 18;
const MODES = [
  { k: 'overdue', tk: 'fuOverdue' },
  { k: 'today', tk: 'fuToday' },
  { k: 'all', tk: 'fuAllDue' },
];
const TONE = (s) => (
  ['qualified'].includes(s) ? 'good'
    : ['order done'].includes(s) ? 'win'
      : ['dead', 'lost'].includes(s) ? 'lost' : 'wip');

/** Pending Calls (kind='ldr') / My Follow-ups (kind='sales') — dono ek hi screen, alag scope+labels. */
export default function Followups({ kind }) {
  const { user, role } = useAuth();
  const { t } = useT();
  const isOversight = role === 'admin' || role === 'md' || role === 'tl';
  const scopeUid = isOversight ? null : user.id;

  const [mode, setMode] = useState('overdue');
  const [data, setData] = useState(null);
  const [capped, setCapped] = useState(false);
  const [statusF, setStatusF] = useState('');
  const [pick, setPick] = useState(null); // summary card selection
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [openLead, setOpenLead] = useState(null);
  const [newLead, setNewLead] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null); setPage(0); setStatusF('');
    fetchFollowups({ kind, mode, scopeUid })
      .then((r) => { if (alive) { setData(r); setCapped(r.capped); } })
      .catch(() => alive && setData({ rows: [], byStatus: {} }));
    return () => { alive = false; };
  }, [kind, mode, scopeUid, nonce]);

  // status cards — summary card select hone par usi subset ke counts (card == list, hamesha)
  const scopedRows = useMemo(() => {
    if (!data) return [];
    return pick ? data.rows.filter((l) => pick.ids.has(l.id)) : data.rows;
  }, [data, pick]);
  const statusRows = useMemo(() => {
    const by = {};
    scopedRows.forEach((l) => {
      const s = String((kind === 'sales' ? l.sales_status : l.status) || 'other').toLowerCase().trim() || 'other';
      by[s] = (by[s] || 0) + 1;
    });
    return Object.entries(by).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  }, [scopedRows, kind]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const k = q.trim().toLowerCase();
    return data.rows.filter((l) => {
      if (pick && !pick.ids.has(l.id)) return false;
      if (statusF) {
        const s = String((kind === 'sales' ? l.sales_status : l.status) || '').toLowerCase().trim();
        if (s !== statusF) return false;
      }
      if (k && !(l.name || '').toLowerCase().includes(k) && !(l.phone || l.phone_raw || '').includes(q.trim())) return false;
      return true;
    });
  }, [data, statusF, q, kind, pick]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER));
  const pg = Math.min(page, totalPages - 1);
  const rows = filtered.slice(pg * PER, pg * PER + PER);

  const reload = () => setNonce((n) => n + 1);

  return (
    <div>
      <div className="fu-head">
        <p className="fu-desc">{t(kind === 'sales' ? 'fuSalesDesc' : 'fuLdrDesc')}</p>
        <div className="fu-bar">
          <div className="searchwrap">
            <i className="fas fa-magnifying-glass" />
            <input className="form-control" placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
          <select className="form-control fu-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => <option key={m.k} value={m.k}>{t(m.tk)}</option>)}
          </select>
        </div>
      </div>

      <LeadsSummary
        leads={data?.rows} loading={data == null} capped={capped}
        dateField="next_followup"
        side={kind === 'sales' ? 'sales' : 'ldr'}
        onSelect={(s) => { setPick(s); setPage(0); }}
      />

      {/* status-wise pending cards */}
      {data && statusRows.length > 0 && (
        <div className="status-grid" style={{ marginBottom: 14 }}>
          <button type="button" className={`stat-card clickable ${statusF === '' ? 'on' : ''}`} onClick={() => { setStatusF(''); setPage(0); }}>
            <span className="sc-l"><i className="fas fa-layer-group" /> {t('cAll')}</span><span className="sc-v">{scopedRows.length}</span>
          </button>
          {statusRows.map(([s, n]) => (
            <button type="button" key={s} className={`stat-card clickable tone-${TONE(s)} ${statusF === s ? 'on' : ''}`} onClick={() => { setStatusF(statusF === s ? '' : s); setPage(0); }}>
              <span className="sc-l">{fmtStatus(s)}</span><span className="sc-v">{n}</span>
            </button>
          ))}
        </div>
      )}

      {pick && (
        <div className="pickbar">
          <i className="fas fa-filter" />
          <b>{pick.label}</b>
          <span>{fill(t('dhShowing'), { n: pick.count })}</span>
          <button type="button" onClick={() => { setPick(null); setPage(0); }}><i className="fas fa-xmark" /> {t('dClear')}</button>
        </div>
      )}

      {data == null ? (
        Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 128, marginBottom: 9 }} />)
      ) : filtered.length === 0 ? (
        <div className="empty"><i className="fas fa-mug-hot" /> {t('fuClear')}</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{fill(t('dhShowing'), { n: filtered.length })}</div>
          <div className="lead-list">
            {rows.map((l) => (
              <LeadCard key={l.id} lead={l} t={t} selMode={false} selected={false} onOpen={() => setOpenLead(l)} />
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

      <button className="fab" onClick={() => setNewLead(true)} aria-label="Add lead"><i className="fas fa-plus" /></button>

      {openLead && <LeadSheet lead={openLead} onClose={() => setOpenLead(null)} onSaved={reload} />}
      {newLead && <NewLeadSheet onClose={() => setNewLead(false)} onCreated={reload} onOpenExisting={async () => {}} />}
    </div>
  );
}
