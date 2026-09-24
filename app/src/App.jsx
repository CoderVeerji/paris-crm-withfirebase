import { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth';
import { useConfig } from './config';
import { can } from './lib/permissions';
import { useT, LANGS } from './i18n';
import { getTheme, setTheme } from './lib/theme';
import { useBackClose } from './lib/useBackClose';
import { getLead } from './lib/leads';
import { watchForUpdate, reloadForUpdate, dismissUpdate } from './lib/appUpdate';
import { onForegroundPush } from './lib/push';
import { startPresence } from './lib/presence';
import { takePendingCall } from './lib/callLog';
import { toast } from './toast';
import NotifBell from './components/NotifBell';
import InstallAppButton from './components/InstallAppButton';
import LeadSheet from './components/LeadSheet';
import Login from './screens/Login';
import Leads from './screens/Leads';
import Dashboard from './screens/Dashboard';
import CallHistory from './screens/CallHistory';
import Users from './screens/Users';
import Settings from './screens/Settings';
import Builders from './screens/Builders';
import BulkImport from './screens/BulkImport';
import AuditLog from './screens/AuditLog';
import RecycleBin from './screens/RecycleBin';
import Meca from './screens/Meca';
import Followups from './screens/Followups';
import Analytics from './screens/Analytics';
import DataHealth from './screens/DataHealth';
import LiveMonitor from './screens/LiveMonitor';
import WeeklyReport from './screens/WeeklyReport';
import MisReport from './screens/MisReport';
import Reports from './screens/Reports';
import Help from './screens/Help';
import Tickets from './screens/Tickets';

/* Menu — har item ek permission se juda hai (lib/permissions.js). `roleOnly` wale (ldr/sales
 * working screens) role se hi decide hote hain kyunki wo view-scope hai, permission nahi.
 * Security yahan se NAHI aati — wo Firestore rules mein hai. Ye sirf "kya dikhega" hai. */
const MENU = [
  { key: 'dashboard', tKey: 'mDashboard', icon: 'fa-chart-line', perm: 'reports:dashboard' },
  { key: 'leads', tKey: 'mLeads', icon: 'fa-list', perm: 'leads:view' },
  { key: 'calllogs', tKey: 'mCallLogs', icon: 'fa-clipboard-list', perm: 'leads:view' },
  { sep: true, roleOnly: ['admin', 'tl', 'ldr'] },
  { key: 'fresh', tKey: 'mFresh', icon: 'fa-leaf', roleOnly: ['admin', 'tl', 'ldr'] },
  { key: 'pendingcalls', tKey: 'mPendingCalls', icon: 'fa-clock', roleOnly: ['admin', 'tl', 'ldr'] },
  { sep: true, roleOnly: ['admin', 'tl', 'sales'] },
  { key: 'salesfresh', tKey: 'mSalesFresh', icon: 'fa-star', roleOnly: ['admin', 'tl', 'sales'] },
  { key: 'salesfollowup', tKey: 'mSalesFollowup', icon: 'fa-calendar-check', roleOnly: ['admin', 'tl', 'sales'] },
  { sep: true, perm: 'reports:monitor' },
  { key: 'monitor', tKey: 'mMonitor', icon: 'fa-satellite-dish', perm: 'reports:monitor' },
  { key: 'weekly', tKey: 'mWeekly', icon: 'fa-file-lines', perm: 'reports:weekly' },
  { key: 'mis', tKey: 'mMis', icon: 'fa-clipboard-check', perm: 'reports:weekly' },
  { key: 'meca', tKey: 'mMeca', icon: 'fa-chart-line', perm: 'reports:meca' },
  { key: 'analytics', tKey: 'mAnalytics', icon: 'fa-chart-pie', perm: 'reports:analytics' },
  { key: 'reports', tKey: 'mReports', icon: 'fa-file-export', perm: 'reports:export' },
  { key: 'datahealth', tKey: 'mDataHealth', icon: 'fa-heartbeat', roleOnly: ['admin'] },
  { sep: true, roleOnly: ['admin'] },
  { key: 'users', tKey: 'mUsers', icon: 'fa-users-cog', perm: 'users:view' },
  { key: 'settings', tKey: 'mSettings', icon: 'fa-cogs', perm: 'settings:edit' },
  { key: 'builders', tKey: 'mForms', icon: 'fa-list-alt', perm: 'config:builders' },
  { key: 'bulkimport', tKey: 'mBulkImport', icon: 'fa-file-import', perm: 'leads:bulk' },
  { key: 'recycle', tKey: 'mRecycle', icon: 'fa-trash-can', perm: 'recycle:manage' },
  { key: 'audit', tKey: 'mAudit', icon: 'fa-clipboard-list', perm: 'reports:audit' },
  { key: 'tickets', tKey: 'mTickets', icon: 'fa-ticket', perm: 'tickets:manage' },
  { sep: true },
  { key: 'help', tKey: 'mHelp', icon: 'fa-circle-question' },
];

/* lead-list screens -> default view for <Leads> */
const LEAD_VIEWS = {
  leads: 'all', fresh: 'fresh', pendingcalls: 'followup_due',
  salesfresh: 'sales_fresh',
};

/* role ke hisaab se "meri main leads" screen. md/tl business-view hain — inke liye dashboard hi home. */
const primaryLeadNav = (role) => (role === 'ldr' ? 'fresh' : role === 'sales' ? 'salesfresh'
  : role === 'md' || role === 'tl' ? 'dashboard' : 'leads');
const followupNav = (role) => (role === 'ldr' ? 'pendingcalls' : 'salesfollowup');

export default function App() {
  const { loading, fbUser, user, role, signOut } = useAuth();
  const cfg = useConfig();
  const { t, lang, setLang } = useT();
  const [themeMode, setThemeMode] = useState(getTheme());
  const pickTheme = (m) => { setTheme(m); setThemeMode(m); };
  const [nav, setNav] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifLead, setNotifLead] = useState(null);
  const [updateHash, setUpdateHash] = useState('');
  useBackClose(menuOpen, () => setMenuOpen(false));

  // Naya deploy aaya? -> banner. (Sirf tab dikhega jab user login ho.)
  useEffect(() => watchForUpdate((h) => setUpdateHash(h || 'new')), []);

  const openLeadById = async (id) => {
    const l = await getLead(id);
    if (l) setNotifLead(l);
  };

  useEffect(() => { setMenuOpen(false); }, [nav]);
  useEffect(() => { if (role && !nav) setNav(primaryLeadNav(role)); }, [role, nav]);

  // Live Monitor presence — heartbeat jab tak app khuli hai
  useEffect(() => {
    if (!user?.id) return undefined;
    return startPresence(user.id);
  }, [user?.id]);

  // "Call" dabaya, call khatam karke app mein wapas aaye -> usi lead ka action-sheet khud khul jaaye.
  useEffect(() => {
    function onVis() {
      if (document.visibilityState !== 'visible') return;
      const id = takePendingCall();
      if (id) openLeadById(id);
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push notification pe tap -> `/?lead=<id>` khulta hai (naya tab) ya SW message aata hai
  // (pehle se khuli app) -> wahi lead kholo.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const lid = p.get('lead');
      if (lid) {
        openLeadById(lid);
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch { /* ignore */ }
    const onMsg = (e) => {
      if (e.data && e.data.type === 'open-lead' && e.data.leadId) openLeadById(e.data.leadId);
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-side notifications (Cloud Functions) ko pata ho ki is user ki app-language kya hai —
  // warna push/notification text hamesha ek hi language mein aata (client ka i18n wahan kaam nahi karta).
  useEffect(() => {
    if (!user?.id || !lang) return;
    if (user.lang === lang) return;
    updateDoc(doc(db, 'users', user.id), { lang }).catch(() => {});
  }, [user?.id, user?.lang, lang]);

  // Tab khuli ho tab bhi push aaye to (background SW ke bina) toast dikha do
  useEffect(() => {
    let unsub;
    onForegroundPush((payload) => {
      const title = payload.data?.title || '';
      const body = payload.data?.body || '';
      toast(body ? `${title} — ${body}` : title);
    }).then((u) => { unsub = u; }).catch(() => {});
    return () => unsub?.();
  }, []);

  if (loading) return <div className="full-center"><div className="spinner" /><span>{t('loading')}</span></div>;
  if (!fbUser || !user || user.must_reset_password) return <Login />;
  if (user.status && user.status !== 'active') {
    return (
      <div className="full-center">
        <i className="fas fa-lock" style={{ fontSize: 30, color: 'var(--danger)' }} />
        <span>{t('accountInactive')}</span>
        <button className="btn btn-ghost" onClick={signOut}>{t('logout')}</button>
      </div>
    );
  }

  // permission-wale items: can() se; roleOnly-wale: seedha role match. Dono par admin ka
  // config/access.menu override bhi chalta hai (agar admin ne manually set kiya ho).
  const menuOv = cfg?.access?.menu || {};
  const canSee = (m) => {
    if (menuOv[m.key]) return menuOv[m.key].includes(role);
    if (m.roleOnly) return m.roleOnly.includes(role);
    if (!m.perm) return true; // sabko dikhega (e.g. Help)
    return can(role, m.perm, cfg);
  };
  const items = MENU.filter(canSee);
  const activeNav = nav || primaryLeadNav(role);
  const current = MENU.find((m) => m.key === activeNav);

  const oversight = role === 'md' || role === 'tl';
  const BN = [
    { key: 'dashboard', icon: 'fa-house', tKey: 'nHome' },
    { key: oversight ? 'leads' : primaryLeadNav(role), icon: 'fa-users', tKey: 'nLeads' },
    oversight
      ? { key: 'monitor', icon: 'fa-satellite-dish', tKey: 'nMonitor', center: true }
      : { key: followupNav(role), icon: 'fa-phone-volume', tKey: 'nCall', center: true },
    { key: 'calllogs', icon: 'fa-clock-rotate-left', tKey: 'nTasks' },
    { key: '__more', icon: 'fa-bars', tKey: 'nMore' },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="Menu"><i className="fas fa-bars" /></button>
        <h2>{current ? t(current.tKey) : t('appName')}</h2>
        <NotifBell onOpenLead={openLeadById} />
      </header>

      {updateHash && (
        <div className="update-banner">
          <button type="button" className="ub-main" onClick={() => reloadForUpdate(updateHash)}>
            <i className="fas fa-arrows-rotate" /> {t('updateReady')}
          </button>
          <button type="button" className="ub-x" aria-label="dismiss"
            onClick={() => { dismissUpdate(updateHash); setUpdateHash(''); }}>
            <i className="fas fa-xmark" />
          </button>
        </div>
      )}

      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">{t('appName')}</div>
        <div className="sidebar-user">
          <div className="name">{user.full_name}</div>
          <span className="role">{role}</span>
        </div>
        <ul className="sidebar-menu">
          {items.map((m, i) => m.sep
            ? <hr key={`s${i}`} />
            : (
              <li key={m.key}>
                <button className={activeNav === m.key ? 'active' : ''} onClick={() => setNav(m.key)}>
                  <i className={`fas ${m.icon}`} /> {t(m.tKey)}
                </button>
              </li>
            ))}
        </ul>
        <div className="sidebar-foot">
          <button type="button" className="sb-update" onClick={() => reloadForUpdate()}>
            <i className="fas fa-arrows-rotate" /> {t('updateApp')}
          </button>
          <InstallAppButton variant="sidebar" />
          <div className="sidebar-lang">
            {LANGS.map((l) => (
              <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>{l.label}</button>
            ))}
          </div>
          <div className="sidebar-lang sidebar-theme">
            {[['light', 'fa-sun'], ['system', 'fa-circle-half-stroke'], ['dark', 'fa-moon']].map(([m, ic]) => (
              <button key={m} className={themeMode === m ? 'active' : ''} onClick={() => pickTheme(m)} title={t(`th${m[0].toUpperCase()}${m.slice(1)}`)} aria-label={t(`th${m[0].toUpperCase()}${m.slice(1)}`)}>
                <i className={`fas ${ic}`} />
              </button>
            ))}
          </div>
          <button className="logout" onClick={signOut}><i className="fas fa-arrow-right-from-bracket" /> {t('logout')}</button>
        </div>
      </aside>

      <main className="content">
        <div className="desktop-only" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ color: 'var(--navy-primary)', fontSize: 20 }}>
            {current && <i className={`fas ${current.icon}`} style={{ marginRight: 8 }} />}{current ? t(current.tKey) : ''}
          </h2>
          <span className="desk-bell"><NotifBell onOpenLead={openLeadById} /></span>
        </div>

        {(() => {
          switch (activeNav) {
            case 'dashboard': return <Dashboard goNav={setNav} />;
            case 'calllogs': return <CallHistory />;
            case 'users': return <Users />;
            case 'settings': return <Settings />;
            case 'builders': return <Builders />;
            case 'bulkimport': return <BulkImport />;
            case 'audit': return <AuditLog />;
            case 'recycle': return <RecycleBin />;
            case 'meca': return <Meca />;
            case 'analytics': return <Analytics />;
            case 'datahealth': return <DataHealth />;
            case 'monitor': return <LiveMonitor />;
            case 'weekly': return <WeeklyReport />;
            case 'mis': return <MisReport />;
            case 'reports': return <Reports />;
            case 'help': return <Help />;
            case 'tickets': return <Tickets />;
            case 'pendingcalls': return <Followups key="fu-ldr" kind="ldr" />;
            case 'salesfollowup': return <Followups key="fu-sales" kind="sales" />;
            default:
              return activeNav in LEAD_VIEWS
                ? <Leads key={activeNav} initialView={LEAD_VIEWS[activeNav]} />
                : <Placeholder label={current ? t(current.tKey) : ''} msg={t('comingSoon')} />;
          }
        })()}
      </main>

      {notifLead && <LeadSheet lead={notifLead} onClose={() => setNotifLead(null)} onSaved={() => setNotifLead(null)} />}

      <nav className="bottomnav">
        {BN.map((b) => (
          <button key={b.key}
            className={`${b.center ? 'center' : ''} ${activeNav === b.key ? 'active' : ''}`}
            onClick={() => (b.key === '__more' ? setMenuOpen(true) : setNav(b.key))}>
            <i className={`fas ${b.icon}`} />
            <span>{t(b.tKey)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Placeholder({ label, msg }) {
  return (
    <div className="section">
      <div className="empty">
        <i className="fas fa-screwdriver-wrench" />
        <b>{label}</b><br />{msg}
      </div>
    </div>
  );
}
