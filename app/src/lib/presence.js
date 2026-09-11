// Live Monitor ke liye presence — har user apne hi users/{uid} doc mein last_seen likhta hai.
// Rules: user apna last_seen / last_login / updated_at khud likh sakta hai (aur kuch nahi).
// Cost: ~1 chhota write / 2 min PER OPEN TAB, sirf tab jab tab visible ho. Session shuru pe
// last_login set hota hai (— "kisne app kabhi khola hi nahi" ka pata isi se chalta hai).
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const BEAT_MS = 120_000;

/** @returns {() => void}  cleanup */
export function startPresence(uid) {
  if (!uid) return () => {};
  let stopped = false;
  const ref = doc(db, 'users', uid);

  const beat = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    updateDoc(ref, { last_seen: serverTimestamp(), updated_at: serverTimestamp() }).catch(() => {});
  };

  // session start — is app-open ke liye ek baar (last_login = "aakhri baar app khola")
  updateDoc(ref, {
    last_seen: serverTimestamp(), last_login: serverTimestamp(), updated_at: serverTimestamp(),
  }).catch(() => {});

  const iv = setInterval(beat, BEAT_MS);
  const onVis = () => { if (document.visibilityState === 'visible') beat(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);

  return () => {
    stopped = true;
    clearInterval(iv);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', onVis);
  };
}
