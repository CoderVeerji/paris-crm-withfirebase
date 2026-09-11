import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { fmtDateTime } from '../lib/format';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { fetchRecycle, restoreLead } from '../lib/admin';

export default function RecycleBin() {
  const { user } = useAuth();
  const { t } = useT();
  const actor = { uid: user.id, name: user.full_name };
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => fetchRecycle().then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  async function doRestore(id) {
    setBusy(id);
    try { await restoreLead(id, actor); toast(`${t('restore')} ✓`); load(); }
    catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setBusy(''); }
  }

  if (items == null) return <div className="skeleton" style={{ height: 200 }} />;
  if (items.length === 0) return <div className="empty"><i className="fas fa-trash-can" />{t('recEmpty')}</div>;

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('recIntro')}</p>
      <div className="feed">
        {items.map((it) => (
          <div className="feed-row" key={it.id} style={{ cursor: 'default' }}>
            <div className="feed-ic"><i className="fas fa-trash-can" /></div>
            <div className="feed-body">
              <div className="feed-top"><b>{it.data?.name || `#${it.id}`}</b><span>{fmtDateTime(it.deleted_at)}</span></div>
              <div className="feed-sub">{it.data?.phone || it.data?.phone_raw} · {fill(t('recDeletedBy'), { n: it.deleted_by_name || '—' })}</div>
            </div>
            <button className="btn btn-ghost" disabled={busy === it.id} onClick={() => doRestore(it.id)}>
              {busy === it.id ? '…' : <><i className="fas fa-rotate-left" /> {t('restore')}</>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
