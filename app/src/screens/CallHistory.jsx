import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { fetchActivityFeed } from '../lib/activity';
import { getLead } from '../lib/leads';
import { fmtStatus, fmtDateTime, fmtMoney } from '../lib/format';
import { RANGE_PRESETS, rangeFor, dayStart, dayEnd } from '../lib/daterange';
import { usePagedList } from '../lib/usePagedList';
import Pager from '../components/Pager';
import LeadSheet from '../components/LeadSheet';

const ICON = {
  created: 'fa-circle-plus', order: 'fa-sack-dollar', assigned: 'fa-user-check',
  reassign: 'fa-arrows-rotate', urgent: 'fa-triangle-exclamation', stage_change: 'fa-arrow-right',
  note: 'fa-comment', bulk: 'fa-layer-group', merge: 'fa-clone', review_resolve: 'fa-gavel',
};
const fmtDT = fmtDateTime;

export default function CallHistory() {
  const { user, role } = useAuth();
  const { t } = useT();
  const [openLead, setOpenLead] = useState(null);
  const [quick, setQuick] = useState('w');
  const [from, setFrom] = useState(() => rangeFor('w')[0]);
  const [to, setTo] = useState(() => rangeFor('w')[1]);
  const [actionFilter, setActionFilter] = useState('');

  function pick(k) {
    setQuick(k);
    const [f, tt] = rangeFor(k);
    setFrom(f); setTo(tt);
  }

  const fetchPage = useCallback(({ cursor }) => fetchActivityFeed({
    role, uid: user.id, cursor, pageSize: 30,
    from: from ? dayStart(from) : null, to: to ? dayEnd(to) : null,
  }), [role, user.id, from, to]);
  const { rows, page, loading, hasNext, hasPrev, err, goNext, goPrev, reload } = usePagedList(fetchPage, [role, user.id, from, to]);

  async function openLeadById(id) {
    const l = await getLead(id);
    if (l) setOpenLead(l);
  }

  const actionTypes = useMemo(() => [...new Set(rows.map((r) => r.action))].sort(), [rows]);
  const shown = actionFilter ? rows.filter((r) => r.action === actionFilter) : rows;

  return (
    <div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {RANGE_PRESETS.map((q) => <button key={q.k} className={`chip ${quick === q.k ? 'active' : ''}`} onClick={() => pick(q.k)}>{t(q.tk)}</button>)}
      </div>
      <div className="toolbar">
        <input className="form-control" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setQuick(''); }} />
        <input className="form-control" type="date" value={to} onChange={(e) => { setTo(e.target.value); setQuick(''); }} />
      </div>
      {actionTypes.length > 1 && (
        <select className="form-control" style={{ marginBottom: 10 }} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="">{t('audAllTypes')}</option>
          {actionTypes.map((a) => <option key={a} value={a}>{fmtStatus(a.replace(/_/g, ' '))}</option>)}
        </select>
      )}

      {err && <div className="alert alert-error">{t('loadFail')}</div>}

      {loading ? (
        Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 62, marginBottom: 8 }} />)
      ) : shown.length === 0 ? (
        <div className="empty"><i className="fas fa-clock-rotate-left" />{t('noHistory')}</div>
      ) : (
        <>
          <div className="feed">
            {shown.map((a) => (
              <button className="feed-row" key={a.id} onClick={() => openLeadById(a.lead_id)}>
                <div className="feed-ic"><i className={`fas ${ICON[a.action] || 'fa-circle'}`} /></div>
                <div className="feed-body">
                  <div className="feed-top">
                    <b>{a.lead_name || `#${a.lead_id}`}</b>
                    <span>{fmtDT(a.at)}</span>
                  </div>
                  <div className="feed-sub">
                    <span className="feed-stage">{fmtStatus(a.to_status || a.action)}</span>
                    {a.amount > 0 && <span className="feed-amt">{fmtMoney(a.amount)}</span>}
                    {role === 'admin' && a.actor_name && <span> · {a.actor_name}</span>}
                  </div>
                  {a.remark && <div className="feed-remark">{a.remark}</div>}
                </div>
              </button>
            ))}
          </div>
          <Pager page={page} hasPrev={hasPrev} hasNext={hasNext} loading={loading} onPrev={goPrev} onNext={goNext} />
        </>
      )}

      {openLead && <LeadSheet lead={openLead} onClose={() => setOpenLead(null)} onSaved={reload} />}
    </div>
  );
}
