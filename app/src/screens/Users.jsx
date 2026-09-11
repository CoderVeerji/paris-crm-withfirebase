import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth';
import { useConfig } from '../config';
import { can } from '../lib/permissions';
import { useT, fill } from '../i18n';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import Sheet from '../components/Sheet';
import { createUser, updateUser, sendReset, transferLeads, audit } from '../lib/admin';
import { changeUserEmail, deleteUserAccount } from '../lib/stats';

// md = Managing Director (business ka poora view), tl = Team Leader (team ka operational view).
// Technical control (settings/users/builders) sirf admin ke paas rehta hai.
const ROLES = ['ldr', 'sales', 'tl', 'md', 'admin'];

export default function Users() {
  const { user, role } = useAuth();
  const cfg = useConfig();
  const { t } = useT();
  const actor = { uid: user.id, name: user.full_name };
  const canManage = can(role, 'users:manage', cfg); // md/tl sirf view kar sakte hain
  const [users, setUsers] = useState(null);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const load = () => getDocs(collection(db, 'users')).then((s) =>
    setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    if (!users) return null;
    const k = q.trim().toLowerCase();
    return users.filter((u) => {
      if (k && !(u.full_name || '').toLowerCase().includes(k) && !(u.email || '').toLowerCase().includes(k)) return false;
      if (roleFilter && u.role !== roleFilter) return false;
      if (statusFilter && (u.status || 'active') !== statusFilter) return false;
      return true;
    });
  }, [users, q, roleFilter, statusFilter]);

  const [attBusyId, setAttBusyId] = useState(null);
  async function quickToggleAttendance(u, e) {
    e.stopPropagation();
    setAttBusyId(u.id);
    const next = (u.attendance || 'Present') === 'Absent' ? 'Present' : 'Absent';
    try {
      await updateUser(u.id, { attendance: next }, u, actor);
      setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, attendance: next } : x)));
    } catch (e2) { toast(friendlyError(e2, t), 'err'); }
    finally { setAttBusyId(null); }
  }

  return (
    <div>
      <div className="toolbar">
        <input className="form-control" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {canManage && <button className="btn btn-primary" onClick={() => setEdit('new')}><i className="fas fa-plus" /> {t('uNew')}</button>}
      </div>
      {!canManage && <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}><i className="fas fa-eye" /> {t('uViewOnly')}</p>}

      <div className="chips" style={{ marginBottom: 8 }}>
        {['', 'ldr', 'sales', 'tl', 'md', 'admin'].map((v) => (
          <button key={v || 'all'} className={`chip ${roleFilter === v ? 'active' : ''}`} onClick={() => setRoleFilter(v)}>
            {v ? v : t('cAll')}
          </button>
        ))}
      </div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {['active', 'inactive', ''].map((v) => (
          <button key={v || 'all'} className={`chip ${statusFilter === v ? 'active' : ''}`} onClick={() => setStatusFilter(v)}>
            {v ? t(v) : t('cAll')}
          </button>
        ))}
      </div>

      {shown == null ? (
        Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 60, marginBottom: 8 }} />)
      ) : (
        <div className="feed">
          {shown.map((u) => {
            const present = (u.attendance || 'Present') !== 'Absent';
            return (
              <div className="feed-row user-row" key={u.id}>
                <button className="user-row-main" onClick={() => canManage && setEdit(u)} style={canManage ? undefined : { cursor: 'default' }}>
                  <div className="feed-ic" style={{ background: `color-mix(in srgb, var(--${u.status === 'active' ? 'success' : 'danger'}) 16%, var(--card))`, color: u.status === 'active' ? 'var(--success)' : 'var(--danger)' }}>
                    <i className="fas fa-user" />
                  </div>
                  <div className="feed-body">
                    <div className="feed-top">
                      <b>{u.full_name || '—'}</b>
                      <span className={`role-badge role-${u.role}`}>{u.role}</span>
                    </div>
                    <div className="feed-sub" style={{ textTransform: 'none' }}>{u.email}</div>
                    {(u.status !== 'active' || u.must_reset_password) && (
                      <div className="user-chips">
                        {u.status !== 'active' && <span className="u-chip u-chip-bad">{t('inactive')}</span>}
                        {u.must_reset_password && <span className="u-chip">{t('uResetPending')}</span>}
                      </div>
                    )}
                  </div>
                </button>
                {(u.role === 'ldr' || u.role === 'sales') && (
                  <button type="button" className={`att-chip ${present ? 'in' : 'out'}`}
                    disabled={attBusyId === u.id} onClick={(e) => quickToggleAttendance(u, e)}>
                    <i className={`fas ${present ? 'fa-circle-check' : 'fa-circle-xmark'}`} />
                    {present ? t('attIn2') : t('attOut2')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <UserSheet
          user={edit === 'new' ? null : edit}
          allUsers={users || []}
          actor={actor} t={t}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
    </div>
  );
}

function UserSheet({ user, allUsers, actor, t, onClose, onSaved }) {
  const isNew = !user;
  const [full_name, setName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [role, setRole] = useState(user?.role || 'ldr');
  const [team, setTeam] = useState(user?.team || '');
  const [status, setStatus] = useState(user?.status || 'active');
  const [attendance, setAttendance] = useState(user?.attendance || 'Present');
  const [transferTo, setTransferTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const teamVal = role === 'tl' ? team : '';
      if (isNew) {
        const { tempPassword } = await createUser({ full_name, email, phone, role, team: teamVal }, actor);
        toast(`${t('uCreate')} ✓ — ${tempPassword}`);
      } else {
        // pehle baaki fields save karo — taaki login-email badalna fail bhi ho jaye
        // (server permission missing) to naam/phone/role kam se kam save ho jaayein
        await updateUser(user.id, { full_name, phone, role, team: teamVal, status, attendance }, user, actor);
        const newEmail = email.trim().toLowerCase();
        const oldEmail = (user.email || '').toLowerCase();
        if (newEmail && newEmail !== oldEmail) {
          await changeUserEmail(user.id, newEmail);
          await audit(actor, 'user.email_change', full_name || user.id, [{ field: 'email', from: oldEmail, to: newEmail }]);
          toast(t('uEmailChanged') + ' ✓');
        }
        toast(`${full_name} ✓`);
      }
      onSaved();
    } catch (e2) {
      console.error(e2);
      const msg = String(e2.message || '');
      setErr(['auth/email-already-exists', 'auth/email-already-in-use'].includes(e2.code) || msg.includes('already-exists') || msg.includes('already-in-use')
        ? t('uEmailDup')
        : e2.code === 'auth/invalid-email' || msg.includes('invalid-email') ? t('uEmailBad')
          : msg.includes('insufficient permission') || msg.includes('Credential implementation') ? t('uEmailPerm')
            : msg.includes('did not respond') ? t('uEmailPerm')
              : t('saveFail'));
    } finally { setBusy(false); }
  }

  async function doDelete() {
    if (!window.confirm(fill(t('uDeleteConfirm'), { name: full_name }))) return;
    setBusy(true); setErr('');
    try {
      try {
        await deleteUserAccount(user.id, false);
      } catch (e3) {
        if (String(e3.message || '').includes('has-leads')) {
          if (!window.confirm(t('uDeleteHasLeads'))) { setBusy(false); return; }
          await deleteUserAccount(user.id, true);
        } else throw e3;
      }
      await audit(actor, 'user.delete', full_name || user.email, [], { note: user.email || '' });
      toast(t('uDeleted'));
      onSaved();
    } catch (e2) { console.error(e2); toast(friendlyError(e2, t), 'err'); }
    finally { setBusy(false); }
  }

  async function doTransfer() {
    if (!transferTo) return;
    setBusy(true);
    try {
      const n = await transferLeads(user.id, transferTo, actor);
      toast(fill(t('uTransferred'), { n }));
      setTransferTo('');
    } catch (e2) { console.error(e2); toast(friendlyError(e2, t), 'err'); }
    finally { setBusy(false); }
  }

  return (
    <Sheet title={isNew ? t('uNew') : full_name} onClose={onClose}>
      {err && <div className="alert alert-error">{err}</div>}
      <form onSubmit={save}>
        <div className="form-group"><label>{t('uName')} *</label>
          <input className="form-control" required value={full_name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label>{t('email')} *</label>
          <input className="form-control" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {!isNew && <small style={{ color: 'var(--muted)' }}>{t('uEmailHelp')}</small>}</div>
        <div className="form-group"><label>{t('uPhone')}</label>
          <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="form-group"><label>{t('uRole')} *</label>
          <select className="form-control" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></div>
        {role === 'tl' && (
          <div className="form-group"><label>{t('uTeam')} *</label>
            <select className="form-control" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">{t('teamBoth')}</option>
              <option value="ldr">{t('mecaLdrTeam')}</option>
              <option value="sales">{t('mecaSalesTeam')}</option>
            </select>
            <small style={{ color: 'var(--muted)' }}>{t('uTeamHelp')}</small></div>
        )}
        {!isNew && (
          <div className="form-group"><label>{t('uStatus')}</label>
            <select className="form-control" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">{t('active')}</option>
              <option value="inactive">{t('inactive')}</option>
            </select>
            <small style={{ color: 'var(--muted)' }}>{t('uInactiveNote')}</small></div>
        )}
        {!isNew && (role === 'ldr' || role === 'sales') && (
          <div className="form-group"><label>{t('attToggle')}</label>
            <select className="form-control" value={attendance} onChange={(e) => setAttendance(e.target.value)}>
              <option value="Present">{t('attIn')}</option>
              <option value="Absent">{t('attOut')}</option>
            </select></div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t('wait') : (isNew ? t('uCreate') : t('save'))}</button>
      </form>

      {isNew && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{t('uTempNote')}</p>}

      {!isNew && (
        <>
          <div className="ls-subhead">{t('uPassword')}</div>
          <button className="btn btn-ghost btn-block" disabled={busy}
            onClick={() => sendReset(user.email, actor).then(() => toast(t('uResetSent'))).catch((e2) => toast(friendlyError(e2, t), 'err'))}>
            <i className="fas fa-envelope" /> {t('uSendReset')}
          </button>

          <div className="ls-subhead">{t('uTransferTitle')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="form-control" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
              <option value="">— {t('uTransferTo')} —</option>
              {allUsers.filter((u) => u.id !== user.id && u.status === 'active').map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={busy || !transferTo} onClick={doTransfer}>{t('go')}</button>
          </div>

          {user.id !== actor.uid && (
            <>
              <div className="ls-subhead" style={{ color: 'var(--danger)' }}>{t('uDangerZone')}</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>{t('uDeleteHelp')}</p>
              <button className="btn btn-ghost btn-block" disabled={busy} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={doDelete}>
                <i className="fas fa-trash-can" /> {t('uDelete')}
              </button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
