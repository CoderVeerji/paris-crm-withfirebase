import { useT, fill } from '../i18n';

/** Page 1 / 2 / 3 navigation — Prev/Next. Koi bhi paginated list yahi use kare (usePagedList ke saath). */
export default function Pager({ page, hasPrev, hasNext, loading, onPrev, onNext }) {
  const { t } = useT();
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="pager">
      <button type="button" className="btn btn-ghost" disabled={!hasPrev || loading} onClick={onPrev}>
        <i className="fas fa-chevron-left" /> {t('prevPage')}
      </button>
      <span className="pager-page">{fill(t('pageN'), { n: page + 1 })}</span>
      <button type="button" className="btn btn-ghost" disabled={!hasNext || loading} onClick={onNext}>
        {t('nextPage')} <i className="fas fa-chevron-right" />
      </button>
    </div>
  );
}
