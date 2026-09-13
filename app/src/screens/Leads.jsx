import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { fetchLeadsPage, fetchLeadsAll, fetchLeadsForFilter, getLead, searchLeads, leadStatusCounts, bustStatusCounts, PAGE_SIZE } from '../lib/leads';
import { downloadCsv } from '../lib/csv';
import { fmtStatus, fmtDate, fmtMoney, isPast } from '../lib/format';
import { computeScore, TIER_LABEL, TIER_CLASS } from '../lib/scoring';
import { useConfig, salesUsers, ldrUsers, userName } from '../config';
import { can } from '../lib/permissions';
import { toast } from '../toast';
import { bulkArchive, bulkAssign, softDeleteLead } from '../lib/admin';
import { friendlyError } from '../lib/errmsg';
import { usePagedList } from '../lib/usePagedList';
import { markCalling } from '../lib/callLog';
import { waLink } from '../lib/waMessage';
import Pager from '../components/Pager';
import LeadsSummary from '../components/LeadsSummary';
import LeadSheet from '../components/LeadSheet';
import NewLeadSheet from '../components/NewLeadSheet';
import Sheet from '../components/Sheet';
import WaIcon from '../components/WaIcon';

const STATUS_CLASS = {
  fresh: ['bg-fresh', 's-fresh'], new: ['bg-fresh', 's-fresh'],
  qualified: ['bg-qualified', 's-qualified'],
  'call back': ['bg-callback', 's-callback'], callback: ['bg-callback', 's-callback'],
  dead: ['bg-lost', 's-lost'], lost: ['bg-lost', 's-lost'],
  'order done': ['bg-order', 's-order'], 'order won': ['bg-order', 's-order'],
};
const stClass = (s) => STATUS_CLASS[(s || '').toLowerCase()] || ['bg-default', ''];

// LDR = LDR ka apna kaam (fresh/call back/lost). Sales = hand-off ke baad ka.
const LDR_STATUS_FALLBACK = ['fresh', 'call back', 'dead'];
const SALES_STATUS_FALLBACK = ['hot lead', 'visit customer', 'video call', 'followup', 'order done', 'lost'];
const FLAG_OPTS = [
  { v: 'overdue', tk: 'cOverdue' },
  { v: 'hot', tk: 'cHot' },
  { v: 'urgent', tk: 'cUrgent', oversight: true },
  { v: 'review', tk: 'cReviewQueue', oversight: true },
  { v: 'needs_review', tk: 'cReview', oversight: true },
  { v: 'archived', tk: 'cArchived', oversight: true },
];

export default function Leads({ initialView = 'all' }) {
  const { user, role } = useAuth();
  const { t } = useT();
  const cfg = useConfig();
  const view = initialView;
  const isOversight = ['admin', 'md', 'tl'].includes(role);
  const isAllLeads = initialView === 'all';

  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [bulkSheet, setBulkSheet] = useState(null); // 'assign' | null
  const [bulkBusy, setBulkBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [pull, setPull] = useState(0);
  const [openLead, setOpenLead] = useState(null);
  const [newLead, setNewLead] = useState(false);
  const touchY = useRef(null);

  // ---- All Leads: filters + saved-default (star) + view type ----
  const readPref = () => { try { return JSON.parse(localStorage.getItem('pc_leads_pref') || 'null'); } catch { return null; } };
  const pref0 = isAllLeads ? readPref() : null;
  // non-oversight ka team locked hai — ldr sirf 'ldr', sales sirf 'sales' dekh sakta hai
  const lockedTeam = role === 'sales' ? 'sales' : role === 'ldr' ? 'ldr' : '';
  const [team, setTeam] = useState(lockedTeam || (pref0?.team ?? ''));
  const [status, setStatus] = useState(pref0?.status ?? '');
  const [flag, setFlag] = useState(pref0?.flag ?? '');
  const [member, setMember] = useState(pref0?.member ?? '');
  const [saved, setSaved] = useState(!!pref0);
  const [viewType, setViewType] = useState(() => { try { return localStorage.getItem('pc_leads_view') || 'cards'; } catch { return 'cards'; } });
  useEffect(() => { try { localStorage.setItem('pc_leads_view', viewType); } catch { /* private mode */ } }, [viewType]);
  // team badla -> baaki filters reset (team button + status-card dono yahi se). non-oversight ka team locked.
  function pickTeam(v) { setTeam(lockedTeam || v); setStatus(''); setFlag(''); setMember(''); }
  function applyStatusCard(f) { setTeam(lockedTeam || f.team || ''); setStatus(f.status || ''); setFlag(f.flag || ''); setMember(''); }

  function saveDefault() {
    try { localStorage.setItem('pc_leads_pref', JSON.stringify({ team, status, flag, member })); setSaved(true); toast(t('lfSavedOk')); }
    catch { /* private mode */ }
  }
  function clearDefault() { try { localStorage.removeItem('pc_leads_pref'); } catch { /* ignore */ } setSaved(false); }

  const ldrPeople = useMemo(() => ldrUsers(cfg), [cfg.users]);
  const salesPeople = useMemo(() => salesUsers(cfg), [cfg.users]);
  const people = team === 'sales' ? salesPeople : team === 'ldr' ? ldrPeople : [...ldrPeople, ...salesPeople];

  // status options, "ldr:x" / "sales:x". LDR = fresh/call back/lost + custom. Sales = new + stages.
  const statusGroups = useMemo(() => {
    const cfgStages = (rolev) => (cfg.stages || []).filter((x) => x.role === rolev || x.role === 'both')
      .map((x) => x.name.toLowerCase()).filter((n) => n !== 'qualified' && n !== 'new' && n !== 'fresh');
    const ldrExtra = cfgStages('ldr');
    const salesExtra = cfgStages('sales');
    const ldr = [...new Set([...LDR_STATUS_FALLBACK, ...ldrExtra])];
    const sales = ['new', ...new Set([...SALES_STATUS_FALLBACK, ...salesExtra].filter((n) => n !== 'new'))];
    return { ldr, sales };
  }, [cfg.stages]);

  const filters = isAllLeads ? { team, status, flag, member } : null;
  const pageSz = view === 'sales_fresh' ? PAGE_SIZE * 3 : PAGE_SIZE;
  const fetchPage = useCallback(({ cursor }) => fetchLeadsPage({
    role, uid: user.id, view, filters, cursor, pageSize: pageSz,
  }), [role, user.id, view, pageSz, JSON.stringify(filters)]);
  const { rows, page, loading, hasNext, hasPrev, err: loadErr, goNext, goPrev, reload } = usePagedList(fetchPage, [role, user.id, view, JSON.stringify(filters)]);
  const err = loadErr ? (loadErr.code === 'failed-precondition' ? t('indexNeeded') : t('loadFail')) : '';

  function nextPage() { setSel(new Set()); goNext(); }
  function prevPage() { setSel(new Set()); goPrev(); }

  // All Leads — status-wise clickable count cards (upar). Har status 1 count(), 15-min cached.
  const [statusCounts, setStatusCounts] = useState(null);
  const [scNonce, setScNonce] = useState(0);
  useEffect(() => {
    if (!isAllLeads) return undefined;
    let alive = true;
    setStatusCounts(null);
    leadStatusCounts({ role, uid: user.id, team, member })
      .then((r) => { if (alive) setStatusCounts(r); })
      .catch(() => { if (alive) setStatusCounts([]); });
    return () => { alive = false; };
  }, [isAllLeads, role, user.id, team, member, scNonce]);
  function refetchAll() { bustStatusCounts(); setScNonce((n) => n + 1); reload(); }

  // Fresh Pool / New Qualified — person/date summary cards (bounded fetch, 30-min cached)
  const showSummary = view === 'fresh' || view === 'sales_fresh';
  const [sumData, setSumData] = useState(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [pick, setPick] = useState(null);   // summary card selection
  const [pickPage, setPickPage] = useState(0);
  useEffect(() => {
    if (!showSummary) return undefined;
    let alive = true;
    setSumBusy(true); setSumData(null);
    fetchLeadsAll({ role, uid: user.id, view })
      .then((r) => { if (alive) setSumData(r); })
      .catch((e) => { console.error(e); if (alive) setSumData({ rows: [], capped: false }); })
      .finally(() => { if (alive) setSumBusy(false); });
    return () => { alive = false; };
  }, [showSummary, role, user.id, view]);
  useEffect(() => { setPickPage(0); }, [pick]);

  // pull-to-refresh (mobile)
  function onTouchStart(e) { if (window.scrollY <= 0) touchY.current = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (touchY.current == null) return;
    const dy = e.touches[0].clientY - touchY.current;
    if (dy > 0) setPull(Math.min(dy * 0.5, 60));
  }
  function onTouchEnd() {
    if (pull > 45) refetchAll();
    setPull(0); touchY.current = null;
  }

  // Search — poore data mein (server-side prefix search), sirf is page mein nahi.
  const [searchResults, setSearchResults] = useState(null); // null = search band hai, browse mode
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = search.trim();
    if (!q) { setSearchResults(null); setSearching(false); return undefined; }
    setSearching(true);
    const h = setTimeout(() => {
      searchLeads({ role, uid: user.id, q })
        .then((res) => setSearchResults(res.filter((l) => !l.archived)))
        .catch((e) => { console.error(e); setSearchResults([]); })
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(h);
  }, [search, role, user.id]);

  const isSearching = search.trim().length > 0;
  // summary card select -> list usi subset ki (bounded set se, local pagination)
  const picked = useMemo(
    () => (pick && sumData ? sumData.rows.filter((l) => pick.ids.has(l.id)) : null),
    [pick, sumData],
  );
  const pickPages = picked ? Math.max(1, Math.ceil(picked.length / PAGE_SIZE)) : 1;
  const ppg = Math.min(pickPage, pickPages - 1);
  const archivedView = isAllLeads && flag === 'archived';
  const shown = useMemo(() => {
    if (isSearching) return searchResults || [];
    if (picked) return picked.slice(ppg * PAGE_SIZE, ppg * PAGE_SIZE + PAGE_SIZE);
    return archivedView ? rows : rows.filter((l) => !l.archived);
  }, [isSearching, searchResults, rows, picked, ppg, archivedView]);
  const busy = isSearching ? searching : (picked ? false : loading);

  // card pe kaun sa status dikhe — filter/team ke hisaab se (warna 'qualified' lead pe sales_status leak)
  const statusMode = view === 'sales_fresh' ? 'sales'
    : status.startsWith('sales:') || team === 'sales' ? 'sales'
      : status.startsWith('ldr:') || team === 'ldr' ? 'ldr'
        : 'effective';

  const canBulk = can(role, 'leads:bulk', cfg);      // multi-select + bulk archive/assign
  const canDelete = can(role, 'leads:delete', cfg);  // recycle
  const canCreate = can(role, 'leads:create', cfg);

  function toggleSel(id) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function exitSel() { setSelMode(false); setSel(new Set()); }

  async function runBulk(fn, okMsg) {
    setBulkBusy(true);
    try { await fn(); toast(okMsg); exitSel(); setBulkSheet(null); refetchAll(); }
    catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setBulkBusy(false); }
  }
  const ids = [...sel];
  const actor = { uid: user.id, name: user.full_name };

  // "Select all matching" — current filter ki SAARI leads (page ki nahi). CSV ke liye rows bhi rakho.
  const [allMatch, setAllMatch] = useState(null); // { rows, capped } | null
  useEffect(() => { setAllMatch(null); }, [team, status, flag, member, view]);
  async function selectAllMatching() {
    setBulkBusy(true);
    try {
      const r = allMatch || await fetchLeadsForFilter({ role, uid: user.id, filters: { team, status, flag, member } });
      setAllMatch(r);
      setSel(new Set(r.rows.map((l) => l.id)));
      if (r.capped) toast(fill(t('lfSelCapped'), { n: r.rows.length }), 'err');
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setBulkBusy(false); }
  }
  function exportSelectedCsv() {
    const src = (allMatch?.rows || []).concat(rows).filter((l) => sel.has(l.id));
    const seen = new Set(); const uniq = src.filter((l) => (seen.has(l.id) ? false : seen.add(l.id)));
    downloadCsv(`leads-${flag || status || team || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Lead ID', 'Name', 'Phone', 'Company', 'City', 'State', 'Source', 'LDR Status', 'Sales Status', 'LDR', 'Sales', 'Created'],
      uniq.map((l) => [l.id, l.name || '', l.phone || l.phone_raw || '', l.company || '', l.city || '', l.state || '',
        l.source || '', fmtStatus(l.status), fmtStatus(l.sales_status), l.ldr_name || '', l.sales_name || '', fmtDate(l.created_at)]));
  }
  async function archiveAndExport(archived) {
    if (archived) exportSelectedCsv();
    await bulkArchive(ids, archived, actor);
  }

  return (
    <div onTouchStart={selMode ? undefined : onTouchStart} onTouchMove={selMode ? undefined : onTouchMove} onTouchEnd={selMode ? undefined : onTouchEnd}>
      <div className="filterbar">
        <div className="searchrow">
          <div className="searchwrap">
            <i className="fas fa-magnifying-glass" />
            <input className="form-control" placeholder={t('search')} value={search}
              onChange={(e) => setSearch(e.target.value)} />
            {canBulk && (
              <button className={`sel-toggle ${selMode ? 'active' : ''}`} onClick={() => (selMode ? exitSel() : setSelMode(true))}>
                {selMode ? t('cancel') : <i className="fas fa-check-double" />}
              </button>
            )}
          </div>
          {canCreate && (
            <button className="btn btn-primary new-lead-btn" onClick={() => setNewLead(true)}>
              <i className="fas fa-plus" /> <span>{t('nlTitle')}</span>
            </button>
          )}
        </div>
      </div>

      {isAllLeads && (
        <div className="lf-wrap">
          <div className="lf">
            {isOversight && (
              <div className="lf-seg">
                {[['', t('cAll')], ['ldr', t('mecaLdrTeam')], ['sales', t('mecaSalesTeam')]].map(([v, lbl]) => (
                  <button key={v || 'all'} type="button" className={team === v ? 'on' : ''} onClick={() => pickTeam(v)}>{lbl}</button>
                ))}
              </div>
            )}
            <select className="form-control lf-sel" value={status} onChange={(e) => { setStatus(e.target.value); setFlag(''); }}>
              <option value="">{t('lfAllStatus')}</option>
              {(team === '' || team === 'ldr') && (
                <optgroup label={`— ${t('mecaLdrTeam')} —`}>
                  {statusGroups.ldr.map((s) => <option key={`ldr:${s}`} value={`ldr:${s}`}>{fmtStatus(s === 'dead' ? 'lost' : s)}</option>)}
                </optgroup>
              )}
              {(team === '' || team === 'sales') && (
                <optgroup label={`— ${t('mecaSalesTeam')} —`}>
                  {statusGroups.sales.map((s) => <option key={`sales:${s}`} value={`sales:${s}`}>{s === 'new' ? t('lfStNewQ') : fmtStatus(s)}</option>)}
                </optgroup>
              )}
            </select>
            <select className="form-control lf-sel" value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">{t('lfAllPeople')}</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
            <select className="form-control lf-sel" value={flag} onChange={(e) => { setFlag(e.target.value); setStatus(''); }}>
              <option value="">{t('lfMore')}</option>
              {FLAG_OPTS.filter((f) => !f.oversight || isOversight).map((f) => <option key={f.v} value={f.v}>{t(f.tk)}</option>)}
            </select>
            {(team || status || flag || member) && (
              <button type="button" className="lf-clear" onClick={() => { setTeam(role === 'sales' ? 'sales' : role === 'ldr' ? 'ldr' : ''); setStatus(''); setFlag(''); setMember(''); }}>
                <i className="fas fa-xmark" /> {t('dClear')}
              </button>
            )}
            <div className="lf-bottom">
              <div className="lf-viewseg">
                {[['cards', 'fa-table-cells-large'], ['compact', 'fa-list']].map(([v, ic]) => (
                  <button key={v} type="button" className={viewType === v ? 'on' : ''} title={t(`lfView_${v}`)} onClick={() => setViewType(v)}>
                    <i className={`fas ${ic}`} /> {t(`lfView_${v}`)}
                  </button>
                ))}
              </div>
              <button type="button" className={`lf-star ${saved ? 'on' : ''}`} onClick={saved ? clearDefault : saveDefault}
                title={saved ? t('lfSavedTip') : t('lfSaveTip')}>
                <i className="fas fa-star" /> {saved ? t('lfSaved') : t('lfSave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAllLeads && !isSearching && !selMode && (
        <StatusCards data={statusCounts} active={status} t={t} onPick={applyStatusCard} />
      )}

      {showSummary && (
        <LeadsSummary
          leads={sumData?.rows} loading={sumBusy} capped={sumData?.capped}
          dateField={view === 'sales_fresh' ? ['qualified_at', 'created_at'] : 'created_at'}
          side={view === 'sales_fresh' ? 'sales' : 'ldr'}
          onSelect={setPick}
        />
      )}

      {picked && (
        <div className="pickbar">
          <i className="fas fa-filter" />
          <b>{pick.label}</b>
          <span>{fill(t('dhShowing'), { n: picked.length })}</span>
          <button type="button" onClick={() => setPick(null)}><i className="fas fa-xmark" /> {t('dClear')}</button>
        </div>
      )}

      <div className={`ptr ${pull > 45 ? 'armed' : ''}`} style={{ height: pull }}>
        {pull > 6 && <i className="fas fa-arrow-down" />}
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      {busy ? (
        Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 128, marginBottom: 9 }} />)
      ) : shown.length === 0 ? (
        <div className="empty">
          <i className="fas fa-inbox" />
          {isSearching ? t('noSearch') : t('noLeads')}
        </div>
      ) : (
        <>
          {isAllLeads && viewType === 'compact' && !selMode ? (
            <div className="lead-compact">
              {shown.map((l) => <LeadRow key={l.id} lead={l} t={t} statusMode={statusMode} onOpen={() => setOpenLead(l)} />)}
            </div>
          ) : (
            <div className="lead-list">
              {shown.map((l) => (
                <LeadCard key={l.id} lead={l} t={t} statusMode={statusMode}
                  selMode={selMode} selected={sel.has(l.id)}
                  onOpen={() => (selMode ? toggleSel(l.id) : setOpenLead(l))} />
              ))}
            </div>
          )}
          {!isSearching && (picked ? (
            picked.length > PAGE_SIZE && (
              <div className="pager">
                <button type="button" className="btn btn-ghost" disabled={ppg === 0} onClick={() => setPickPage(ppg - 1)}>
                  <i className="fas fa-chevron-left" /> {t('prevPage')}
                </button>
                <span className="pager-page">{ppg + 1} / {pickPages}</span>
                <button type="button" className="btn btn-ghost" disabled={ppg >= pickPages - 1} onClick={() => setPickPage(ppg + 1)}>
                  {t('nextPage')} <i className="fas fa-chevron-right" />
                </button>
              </div>
            )
          ) : (
            <Pager page={page} hasPrev={hasPrev} hasNext={hasNext} loading={loading} onPrev={prevPage} onNext={nextPage} />
          ))}
        </>
      )}


      {openLead && (
        <LeadSheet
          lead={openLead}
          onClose={() => setOpenLead(null)}
          onSaved={refetchAll}
        />
      )}

      {newLead && (
        <NewLeadSheet
          onClose={() => setNewLead(false)}
          onCreated={refetchAll}
          onOpenExisting={async (id) => {
            const lead = shown.find((r) => r.id === id) || rows.find((r) => r.id === id) || await getLead(id);
            if (lead) setOpenLead(lead);
          }}
        />
      )}

      {selMode && isAllLeads && !isSearching && !picked && (
        <div className="bulkbar bulkbar-sel">
          <button className="btn btn-ghost" disabled={bulkBusy} onClick={selectAllMatching}>
            <i className="fas fa-list-check" /> {allMatch ? fill(t('lfSelectedAll'), { n: allMatch.rows.length }) : t('lfSelectAll')}
          </button>
          {sel.size > 0 && <button className="btn btn-ghost" onClick={() => setSel(new Set())}><i className="fas fa-xmark" /> {t('dClear')}</button>}
        </div>
      )}

      {selMode && sel.size > 0 && (
        <div className="bulkbar">
          <span>{sel.size} ✓</span>
          {archivedView ? (
            <>
              <button className="btn btn-ghost" disabled={bulkBusy} onClick={exportSelectedCsv}>
                <i className="fas fa-file-csv" /> {t('lfExportCsv')}
              </button>
              <button className="btn btn-primary" disabled={bulkBusy}
                onClick={() => runBulk(() => archiveAndExport(false), fill(t('blkUnarchived'), { n: ids.length }))}>
                <i className="fas fa-box-open" /> {t('blkUnarchive')}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" disabled={bulkBusy} onClick={() => setBulkSheet('assign')}>
                <i className="fas fa-user-check" /> {t('assignSales')}
              </button>
              <button className="btn btn-ghost" disabled={bulkBusy} onClick={exportSelectedCsv}>
                <i className="fas fa-file-csv" /> {t('lfExportCsv')}
              </button>
              <button className="btn btn-ghost" disabled={bulkBusy}
                onClick={() => { if (!window.confirm(fill(t('lfArchiveConfirm'), { n: ids.length }))) return; runBulk(() => archiveAndExport(true), fill(t('blkArchived'), { n: ids.length })); }}>
                <i className="fas fa-box-archive" /> {t('blkArchive')}
              </button>
            </>
          )}
          {!archivedView && canDelete && (
            <button className="btn btn-danger" disabled={bulkBusy}
              onClick={() => {
                if (!window.confirm(fill(t('confirmDelete'), { n: ids.length }))) return;
                runBulk(async () => { for (const id of ids) { const l = shown.find((r) => r.id === id) || rows.find((r) => r.id === id); if (l) await softDeleteLead(l, actor); } }, fill(t('blkDeleted'), { n: ids.length }));
              }}>
              <i className="fas fa-trash" /> {t('del')}
            </button>
          )}
        </div>
      )}

      {bulkSheet === 'assign' && (
        <BulkAssignSheet cfg={cfg} busy={bulkBusy} onClose={() => setBulkSheet(null)}
          onGo={({ ldr_uid, sales_uid }) => runBulk(
            () => bulkAssign(ids, { ldr_uid, sales_uid }, { ldr: userName(cfg, ldr_uid), sales: userName(cfg, sales_uid) }, actor),
            fill(t('blkAssigned'), { n: ids.length }))} />
      )}
    </div>
  );
}

const SC_TONE = {
  fresh: 'tone-fresh', callback: 'tone-wip', qualified: 'tone-good',
  'hot lead': 'tone-wip', 'visit customer': 'tone-wip', 'video call': 'tone-wip',
  followup: 'tone-wip', 'order done': 'tone-win', lost: 'tone-lost',
};
function StatusCards({ data, active, t, onPick }) {
  if (data == null) return <div className="sc-row"><div className="skeleton" style={{ height: 62 }} /></div>;
  if (!data.length) return null;
  const isOn = (f) => (f.status ? active === f.status : false);
  return (
    <div className="sc-row">
      {data.map((c) => (
        <button type="button" key={c.key}
          className={`stat-card clickable ${SC_TONE[c.key] || ''} ${isOn(c.filter) ? 'on' : ''}`}
          onClick={() => onPick(c.filter)}>
          <div className="val">{(c.count ?? 0).toLocaleString('en-IN')}</div>
          <div className="label">{fmtStatus(c.key === 'callback' ? 'call back' : c.key === 'lost' ? 'lost' : c.key)}</div>
        </button>
      ))}
    </div>
  );
}

function BulkAssignSheet({ cfg, busy, onClose, onGo }) {
  const { t } = useT();
  const [ldr_uid, setLdr] = useState('');
  const [sales_uid, setSales] = useState('');
  return (
    <Sheet title={t('assignSales')} onClose={onClose}>
      <div className="form-group"><label>LDR</label>
        <select className="form-control" value={ldr_uid} onChange={(e) => setLdr(e.target.value)}>
          <option value="">— koi change nahi —</option>
          {ldrUsers(cfg).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select></div>
      <div className="form-group"><label>Sales</label>
        <select className="form-control" value={sales_uid} onChange={(e) => setSales(e.target.value)}>
          <option value="">— koi change nahi —</option>
          {salesUsers(cfg).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select></div>
      <button className="btn btn-primary btn-block" disabled={busy || (!ldr_uid && !sales_uid)}
        onClick={() => onGo({ ldr_uid: ldr_uid || null, sales_uid: sales_uid || null })}>
        {busy ? t('wait') : t('assignSales')}
      </button>
    </Sheet>
  );
}

export function LeadCard({ lead, t, onOpen, selMode, selected, statusMode = 'effective' }) {
  const { user } = useAuth();
  const cfg = useConfig();
  const st = statusMode === 'ldr' ? lead.status
    : statusMode === 'sales' ? (lead.sales_status || lead.status)
      : (lead.sales_status || lead.status);
  const [badge, strip] = stClass(st);
  const dialNum = lead.phone_raw || lead.phone || '';
  const waNum = (lead.phone_digits || '').replace(/\D/g, '');
  const waHref = waLink(waNum, cfg.settings?.Whatsapp_Template, {
    name: lead.name, user: user.full_name, company: cfg.settings?.Company_Name,
  });

  const who = lead.sales_name || lead.ldr_name;
  const fu = lead.next_followup;
  const tier = lead.tier || computeScore(lead).tier;

  return (
    <div className={`lead-card ${strip} ${selMode ? 'selecting' : ''} ${selected ? 'sel' : ''}`} onClick={onOpen}>
      {selMode && (
        <span className={`lc-check ${selected ? 'on' : ''}`}>{selected && <i className="fas fa-check" />}</span>
      )}
      <div className="top">
        <div className="lc-main">
          <div className={`name ${lead.name ? '' : 'blank'}`}>
            {lead.name || t('noName')}
            {tier === 'hot' && <span className={`tag ${TIER_CLASS.hot}`}>{TIER_LABEL.hot}</span>}
            {lead.needs_review && <span className="tag tag-review">{t('review')}</span>}
            {lead.is_urgent && <span className="tag tag-urgent">{t('urgent')}</span>}
            {lead.review_queue && <span className="tag tag-rq"><i className="fas fa-gavel" /> {t('cReviewQueue')}</span>}
          </div>
          <div className="sub">{lead.phone || lead.phone_raw || '—'}{lead.company ? ` · ${lead.company}` : ''}</div>
        </div>
        <span className={`status-badge ${badge}`}>{fmtStatus(st)}</span>
      </div>

      <div className="meta">
        {who && <span><i className="fas fa-user" /> {who}</span>}
        {lead.order_count > 0 && <span><i className="fas fa-sack-dollar" /> {lead.order_count} · {fmtMoney(lead.total_revenue)}</span>}
        {fu
          ? <span className={isPast(fu) ? 'over' : ''}><i className="fas fa-clock" /> {fmtDate(fu)}</span>
          : <span><i className="fas fa-calendar" /> {fmtDate(lead.created_at)}</span>}
      </div>

      {!selMode && (
        <div className="actions" onClick={(e) => e.stopPropagation()}>
          {dialNum && <a className="btn act-call" href={`tel:${dialNum}`} onClick={() => markCalling(lead.id)}><i className="fas fa-phone" /> {t('call')}</a>}
          {waNum && <a className="btn act-wa" href={waHref} target="_blank" rel="noreferrer" aria-label="WhatsApp"><WaIcon /></a>}
          <button className="btn act-open" onClick={onOpen} aria-label="Details"><i className="fas fa-chevron-right" /></button>
        </div>
      )}
    </div>
  );
}

/** Compact single-line row — dense list view */
export function LeadRow({ lead, t, onOpen, statusMode = 'effective' }) {
  const st = statusMode === 'ldr' ? lead.status : (lead.sales_status || lead.status);
  const [badge, strip] = stClass(st);
  const who = lead.sales_name || lead.ldr_name;
  const fu = lead.next_followup;
  const dialNum = lead.phone_raw || lead.phone || '';
  return (
    <div className={`lrow ${strip}`} onClick={onOpen}>
      <div className="lrow-main">
        <div className="lrow-top">
          <b className={lead.name ? '' : 'blank'}>{lead.name || t('noName')}</b>
          <span className={`status-badge ${badge}`}>{fmtStatus(st)}</span>
        </div>
        <div className="lrow-sub">
          {lead.phone || lead.phone_raw}
          {who && <> · <i className="fas fa-user" /> {who}</>}
          {fu && <> · <span className={isPast(fu) ? 'over' : ''}><i className="fas fa-clock" /> {fmtDate(fu)}</span></>}
        </div>
      </div>
      {dialNum && (
        <a className="lrow-call" href={`tel:${dialNum}`} onClick={(e) => { e.stopPropagation(); markCalling(lead.id); }} aria-label={t('call')}>
          <i className="fas fa-phone" />
        </a>
      )}
      <i className="fas fa-chevron-right lrow-arr" />
    </div>
  );
}
