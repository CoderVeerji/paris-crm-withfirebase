import { useState } from 'react';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { updateUser } from '../lib/admin';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import LeadSheet from '../components/LeadSheet';
import TeamDashboard from '../components/TeamDashboard';
import { bustDashCache } from '../lib/dashboardStats';

/* Dashboard = poora TeamDashboard. Pehle yahan sabse upar ek "pipeline funnel" card-row thi
 * (Total / Fresh / Hot / Urgent / Review Queue) jo date-range se nahi badalti thi — usse
 * "sab jagah same number" wali confusion hoti thi. Woh hata di gayi; ab har cheez ek hi
 * jagah (TeamDashboard) se aati hai aur selected range ke hisaab se badalti hai. */
export default function Dashboard() {
  const { user, role } = useAuth();
  const { t } = useT();
  const [openLead, setOpenLead] = useState(null);
  const [dashKey, setDashKey] = useState(0); // lead action ke baad dashboard ko fresh data se dobara banao

  const isOversight = role === 'admin' || role === 'md' || role === 'tl';

  // ---- attendance (sirf ldr/sales) ----
  const present = (user.attendance || 'Present') !== 'Absent';
  const [attBusy, setAttBusy] = useState(false);
  async function toggleAttendance() {
    setAttBusy(true);
    try {
      await updateUser(user.id, { attendance: present ? 'Absent' : 'Present' }, user, { uid: user.id, name: user.full_name });
      toast(present ? t('attOut') : t('attIn'));
    } catch (e) { toast(friendlyError(e, t), 'err'); }
    finally { setAttBusy(false); }
  }

  return (
    <div>
      <div className="dash-greet">
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
          {t('hello')}, <b style={{ color: 'var(--navy-primary)' }}>{user.full_name}</b> 👋
        </p>
        {(role === 'ldr' || role === 'sales') && (
          <button type="button" className={`att-pill ${present ? 'in' : 'out'}`} disabled={attBusy} onClick={toggleAttendance}>
            <i className={`fas ${present ? 'fa-toggle-on' : 'fa-toggle-off'}`} />
            {present ? t('attToggle') : t('attOut')}
          </button>
        )}
      </div>

      <TeamDashboard
        key={dashKey}
        mode={isOversight ? 'admin' : 'personal'}
        role={role}
        uid={user.id}
        team={user.team || ''}
        onOpenLead={setOpenLead}
      />

      {openLead && (
        <LeadSheet
          lead={openLead}
          onClose={() => setOpenLead(null)}
          onSaved={() => { setOpenLead(null); bustDashCache(); setDashKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}
