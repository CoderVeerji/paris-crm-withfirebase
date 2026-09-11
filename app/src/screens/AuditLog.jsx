import { useCallback, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { fmtDateTime } from '../lib/format';
import { fetchAudit } from '../lib/admin';
import { RANGE_PRESETS, rangeFor, dayStart, dayEnd } from '../lib/daterange';
import { usePagedList } from '../lib/usePagedList';
import Pager from '../components/Pager';

const LABEL = {
  'user.create': 'User banaya', 'user.update': 'User update', 'user.password_reset_email': 'Reset email',
  'leads.transfer': 'Leads transfer', 'settings.save': 'Settings badli', 'config.forms': 'Form fields badle',
  'config.stages': 'Pipeline stages badle', 'lead.delete': 'Lead delete', 'lead.restore': 'Lead restore',
  'leads.archive': 'Bulk archive', 'leads.unarchive': 'Bulk unarchive', 'leads.bulk_assign': 'Bulk assign',
  'leads.import': 'Bulk import', 'lead.edit': 'Lead info badli', 'lead.reassign': 'Reassign', 'lead.merge': 'Duplicate merge',
};

export default function AuditLog() {
  const { t } = useT();
  const [quick, setQuick] = useState('w');
  const [from, setFrom] = useState(() => rangeFor('w')[0]);
  const [to, setTo] = useState(() => rangeFor('w')[1]);
  const [actionFilter, setActionFilter] = useState('');

  function pick(k) {
    setQuick(k);
    const [f, tt] = rangeFor(k);
    setFrom(f); setTo(tt);
  }

  const fetchPage = useCallback(({ cursor }) => fetchAudit({
    cursor, from: from ? dayStart(from) : null, to: to ? dayEnd(to) : null,
  }), [from, to]);
  const { rows, page, loading, hasNext, hasPrev, goNext, goPrev } = usePagedList(fetchPage, [from, to]);

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
          {actionTypes.map((a) => <option key={a} value={a}>{LABEL[a] || a}</option>)}
        </select>
      )}

      {loading ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 62, marginBottom: 8 }} />)
        : shown.length === 0 ? <div className="empty"><i className="fas fa-clipboard-list" />{t('audEmpty')}</div>
          : (
            <>
              <div className="feed">
                {shown.map((a) => (
                  <div className="feed-row" key={a.id} style={{ cursor: 'default', alignItems: 'flex-start' }}>
                    <div className="feed-ic"><i className="fas fa-pen" /></div>
                    <div className="feed-body">
                      <div className="feed-top">
                        <b>{LABEL[a.action] || a.action}{a.target ? `: ${a.target}` : ''}</b>
                        <span>{fmtDateTime(a.at)}</span>
                      </div>
                      <div className="feed-sub">{a.actor_name || a.uid}</div>
                      {a.note && <div className="aud-note">{a.note}</div>}
                      {Array.isArray(a.changes) && a.changes.length > 0 && (
                        <div className="aud-changes">
                          {a.changes.map((c, i) => (
                            <div key={i} className="aud-chg">
                              <span className="k">{c.field}</span>
                              {c.from ? <><span className="from">{c.from}</span><i className="fas fa-arrow-right" /></> : null}
                              <span className="to">{c.to || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Pager page={page} hasPrev={hasPrev} hasNext={hasNext} loading={loading} onPrev={goPrev} onNext={goNext} />
            </>
          )}
    </div>
  );
}
