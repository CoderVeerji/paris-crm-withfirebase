import { usePagedList } from '../lib/usePagedList';
import Pager from './Pager';
import { fetchDashLeadsPage } from '../lib/dashboardLeads';
import { fmtStatus, fmtDate, isPast } from '../lib/format';
import { useT } from '../i18n';

/** Kisi bhi clickable card ke "niche list dikhao" — click karo, yahi khulta hai us card ke neeche.
 * Pagination + lead-tap-to-open, sab reuse karta hai existing infra se. */
export default function DashExpand({ title, teamRole, memberUid, memberIds, filter, onOpenLead, onClose, bare = false }) {
  const { t } = useT();
  const { rows, page, loading, hasNext, hasPrev, goNext, goPrev } = usePagedList(
    ({ cursor }) => fetchDashLeadsPage({ teamRole, memberUid, memberIds, filter, cursor }),
    [teamRole, memberUid, (memberIds || []).join(','), JSON.stringify(filter)],
  );

  return (
    <div className={bare ? 'dx-bare' : 'dx-panel'}>
      {!bare && (
        <div className="dx-head">
          <b><i className="fas fa-list-ul" /> {title}</b>
          <button type="button" className="dx-close" onClick={onClose}><i className="fas fa-xmark" /></button>
        </div>
      )}
      {loading ? (
        <div className="skeleton" style={{ height: 90 }} />
      ) : rows.length === 0 ? (
        <div className="empty" style={{ padding: 20 }}><i className="fas fa-mug-hot" />{t('dAllClear')}</div>
      ) : (
        <div className="due-list">
          {rows.map((l) => (
            <button className="due-row" key={l.id} onClick={() => onOpenLead(l)}>
              <div>
                <div className="due-name">{l.name || t('noName')}</div>
                <div className="due-sub">{l.phone || l.phone_raw} · {fmtStatus(l.sales_status || l.status)}</div>
              </div>
              {l.next_followup ? (
                <span className={`due-when ${isPast(l.next_followup) ? 'over' : ''}`}>
                  <i className="fas fa-clock" /> {fmtDate(l.next_followup)}
                </span>
              ) : (
                <span className="due-when"><i className="fas fa-calendar" /> {fmtDate(l.created_at)}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <Pager page={page} hasPrev={hasPrev} hasNext={hasNext} loading={loading} onPrev={goPrev} onNext={goNext} />
    </div>
  );
}
