// App config — stages, dynamic form fields, settings, users list. Ek baar load, sab jagah use.
import { createContext, useContext, useEffect, useState } from 'react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './auth';

const ConfigCtx = createContext(null);
export const useConfig = () => useContext(ConfigCtx);

export function ConfigProvider({ children }) {
  const { fbUser } = useAuth();
  const [cfg, setCfg] = useState({ stages: [], forms: [], settings: {}, users: [], ready: false });

  useEffect(() => {
    if (!fbUser) { setCfg((c) => ({ ...c, ready: false })); return; }
    let alive = true;
    (async () => {
      try {
        const [stagesS, formsS, setS, accessS, adS, usersS] = await Promise.all([
          getDoc(doc(db, 'config', 'stages')),
          getDoc(doc(db, 'config', 'forms')),
          getDoc(doc(db, 'config', 'settings')),
          getDoc(doc(db, 'config', 'access')),
          getDoc(doc(db, 'config', 'ad_spend')).catch(() => null), // ldr/sales ko read allowed nahi
          getDocs(collection(db, 'users')),
        ]);
        if (!alive) return;
        setCfg({
          stages: (stagesS.data()?.stages || []).filter((s) => s.status !== 'inactive'),
          forms: (formsS.data()?.fields || []).filter((f) => f.status === 'active'),
          settings: setS.data() || {},
          access: accessS.data() || {}, // { menu: {key: [roles]}, dash: {role: 'variant'} }
          adSpend: adS?.data() || null,  // { standing: {fb, insta}, days: {'YYYY-MM-DD': {...}} }
          users: usersS.docs.map((d) => ({ id: d.id, ...d.data() })),
          ready: true,
        });
      } catch (e) {
        console.error('config load fail', e);
        if (alive) setCfg((c) => ({ ...c, ready: true }));
      }
    })();
    return () => { alive = false; };
  }, [fbUser]);

  return <ConfigCtx.Provider value={cfg}>{children}</ConfigCtx.Provider>;
}

/* helpers */
export const salesUsers = (cfg) => cfg.users.filter((u) => u.role === 'sales' && (u.status || 'active') === 'active');
export const ldrUsers = (cfg) => cfg.users.filter((u) => (u.role === 'ldr' || u.role === 'admin') && (u.status || 'active') === 'active');
// "Workers" = sirf wo log jo asal mein leads pe kaam karte hain (ldr + sales). admin / md / tl
// oversight hain — inhe kabhi bhi performance / dashboard / report ke per-person breakdown mein
// nahi dikhana. (ldrUsers admin ko include karta hai kyunki admin ko lead ASSIGN ki ja sakti hai.)
export const workerUsers = (cfg) => cfg.users.filter((u) => (u.role === 'ldr' || u.role === 'sales') && (u.status || 'active') === 'active');
export const isWorkerUid = (cfg, uid) => {
  const u = (cfg.users || []).find((x) => x.id === uid);
  return !!u && (u.role === 'ldr' || u.role === 'sales');
};
export const userName = (cfg, uid) => cfg.users.find((u) => u.id === uid)?.full_name || '';
export const splitList = (str) => String(str || '').split(',').map((s) => s.trim()).filter(Boolean);
