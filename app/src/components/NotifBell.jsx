import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { fmtDateTime } from '../lib/format';
import { useBackClose } from '../lib/useBackClose';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { enablePush, pushPermission, getLocalToken, VAPID_KEY } from '../lib/push';

const NOTIF_ICON = {
  new_lead: 'fa-fire', assign_fail: 'fa-triangle-exclamation', sla: 'fa-clock',
  followup: 'fa-phone', morning: 'fa-mug-hot',
  urgent: 'fa-fire', ticket: 'fa-ticket', default: 'fa-bell',
};

export default function NotifBell({ onOpenLead }) {
  const { user } = useAuth();
  const { t } = useT();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'),
      where('to_uid', '==', user.id),
      orderBy('created_at', 'desc'),
      limit(30),
    );
    return onSnapshot(q, (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setItems([]));
  }, [user?.id]);

  const unread = items.filter((i) => !i.read).length;
  const [pushBusy, setPushBusy] = useState(false);
  const [perm, setPerm] = useState(pushPermission());
  // Har baar sheet kholte waqt dobara check karo — user browser/phone settings se permission
  // badal ke aaya ho sakta hai, sirf mount pe ek baar padhna stale ho jaata.
  useEffect(() => { if (open) setPerm(pushPermission()); }, [open]);

  // "Browser ne permission de rakhi hai" (perm==='granted') aur "server ke paas ABHI bhi ye
  // device registered hai" alag-alag cheezein hain — token kabhi bhi silently invalid/expire ho
  // kar server-side apne aap hat sakta hai, tab bhi permission granted hi dikhता rahega.
  const localToken = getLocalToken();
  const tokenRegistered = !!localToken && (user.fcm_tokens || []).includes(localToken);

  async function turnOnPush() {
    setPushBusy(true);
    try {
      await enablePush(user.id);
      toast(t('pushOn'));
    } catch (e) {
      toast(friendlyError(e, t), 'err');
    } finally {
      setPerm(pushPermission());
      setPushBusy(false);
    }
  }

  function markRead(id) {
    updateDoc(doc(db, 'notifications', id), { read: true }).catch(() => {});
  }
  function markAll() {
    items.filter((i) => !i.read).forEach((i) => markRead(i.id));
  }
  function dismiss(id) {
    setItems((list) => list.filter((i) => i.id !== id)); // turant UI se hatao
    deleteDoc(doc(db, 'notifications', id)).catch(() => {});
  }
  function clearRead() {
    const read = items.filter((i) => i.read);
    if (!read.length) return;
    setItems((list) => list.filter((i) => !i.read));
    read.forEach((i) => deleteDoc(doc(db, 'notifications', i.id)).catch(() => {}));
    toast(t('notifCleared'));
  }

  return (
    <>
      <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Notifications" style={{ position: 'relative' }}>
        <i className="fas fa-bell" />
        {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && createPortal(
        <div className="sheet-scrim" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="sheet-head">
              <h3>{t('notifTitle')}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {unread > 0 && <button className="sheet-x" onClick={markAll} aria-label="Mark all read" title={t('notifClearRead')}><i className="fas fa-check-double" /></button>}
                {items.some((i) => i.read) && <button className="sheet-x" onClick={clearRead} aria-label={t('notifClearRead')} title={t('notifClearRead')}><i className="fas fa-trash-can" /></button>}
                <button className="sheet-x" onClick={() => setOpen(false)}><i className="fas fa-xmark" /></button>
              </div>
            </div>

            {VAPID_KEY && (
              perm === 'denied' ? (
                <div className="alert alert-info push-banner"><span>{t('pushDenied')}</span></div>
              ) : perm === 'unsupported' ? (
                <div className="alert alert-info push-banner"><span>{t('pushUnsupported')}</span></div>
              ) : perm === 'granted' && tokenRegistered ? (
                <div className="push-status on"><i className="fas fa-circle-check" /> {t('pushStatusOn')}</div>
              ) : (
                <div className="alert alert-info push-banner">
                  <span>{perm === 'granted' ? t('pushStatusStale') : t('pushBannerText')}</span>
                  <button type="button" className="btn btn-primary" disabled={pushBusy} onClick={turnOnPush}>
                    {pushBusy ? t('wait') : t('pushTurnOn')}
                  </button>
                </div>
              )
            )}

            {items.length === 0 ? (
              <div className="empty"><i className="fas fa-bell-slash" />{t('notifEmpty')}</div>
            ) : (
              <div className="feed">
                {items.map((n) => (
                  <div className={`feed-row notif-row ${n.read ? '' : 'unread'}`} key={n.id}>
                    <button type="button" className="notif-main"
                      onClick={() => { markRead(n.id); if (n.lead_id && onOpenLead) { setOpen(false); onOpenLead(n.lead_id); } }}>
                      <div className="feed-ic"><i className={`fas ${NOTIF_ICON[n.type] || NOTIF_ICON.default}`} /></div>
                      <div className="feed-body">
                        <div className="feed-top"><b>{n.title}</b><span>{fmtDateTime(n.created_at)}</span></div>
                        {n.body && <div className="feed-sub">{n.body}</div>}
                      </div>
                      {!n.read && <span className="unread-mark" />}
                    </button>
                    <button type="button" className="notif-cut" onClick={() => dismiss(n.id)} aria-label={t('notifDismiss')} title={t('notifDismiss')}>
                      <i className="fas fa-xmark" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
