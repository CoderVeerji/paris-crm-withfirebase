// Auth context — current Firebase user + uska users/{uid} doc (role, naam, must_reset_password)
import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [fbUser, setFbUser] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(undefined);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setFbUser(u || null);
    if (!u) setProfile(null);
  }), []);

  useEffect(() => {
    if (!fbUser) return;
    return onSnapshot(
      doc(db, 'users', fbUser.uid),
      (snap) => setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      () => setProfile(null),
    );
  }, [fbUser]);

  const loading = fbUser === undefined || (fbUser && profile === undefined);
  const value = {
    loading,
    fbUser,
    user: profile,                       // { id, full_name, role, must_reset_password, ... }
    role: profile?.role || null,
    signOut: () => fbSignOut(auth),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
