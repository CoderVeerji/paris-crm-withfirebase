// FCM push notifications — permission maangna, token save karna, foreground messages.
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from 'firebase/messaging';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { app, db } from '../firebase';

// Firebase Console -> Project Settings -> Cloud Messaging -> Web configuration -> "Generate key pair".
export const VAPID_KEY = 'BKFEXGqDS1QABHBv5is2SIhFZ5Cof009Vz6uMY7sgpZBFOqI2wtC9IMfQjg2e4rCXU3rKbpt8ZSzSVyUj8R_Qrk';

// Is device ne aakhri baar jo token save kiya tha, wahi yaad rakhte hain — taaki "browser ne
// permission de rakhi hai" aur "server ke paas abhi bhi wahi token hai" alag-alag check ho sakein
// (token expire/invalid ho kar server-side apne aap hat sakta hai — tab bhi permission "granted" hi dikhta hai).
const LOCAL_TOKEN_KEY = 'crm_fcm_token';
export function getLocalToken() {
  try { return localStorage.getItem(LOCAL_TOKEN_KEY); } catch { return null; }
}
function setLocalToken(t) {
  try { localStorage.setItem(LOCAL_TOKEN_KEY, t); } catch { /* private mode */ }
}

let messagingInstance = null;
async function getMessagingSafe() {
  if (!(await isSupported().catch(() => false))) return null; // Safari/old browsers
  if (!messagingInstance) messagingInstance = getMessaging(app);
  return messagingInstance;
}

/** Permission maango + token lekar users/{uid}.fcm_tokens mein save karo. */
export async function enablePush(uid) {
  if (!VAPID_KEY) throw new Error('vapid-key-missing');
  if (!('serviceWorker' in navigator)) throw new Error('sw-unsupported');
  const messaging = await getMessagingSafe();
  if (!messaging) throw new Error('push-unsupported');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('push-permission-denied');

  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready; // SW active hone ka wait — warna getToken timing race kar sakta hai

  // Purani subscription saaf karo pehle — warna browser kabhi-kabhi wahi PURANI (ab kaam na
  // karne wali) subscription cache se laut deta hai chahe kitni baar "turn on" dabao. Isi wajah
  // se token "connect" to ho jaata tha par server ka bheja push kabhi pahunchta hi nahi tha
  // (aur agli baar check karne par phir se "disconnected" dikhta — dead-token cleanup usko
  // hata deta hai kyunki bhejna hamesha fail hota hai).
  try {
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) await existingSub.unsubscribe();
  } catch { /* best-effort */ }
  try { await deleteToken(messaging); } catch { /* purana token na ho to bhi chalega */ }

  let token;
  try {
    token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  } catch (e) {
    // asli Firebase error code aage bhejो (messaging/token-subscribe-failed jaisा) — generic na bane
    throw new Error(e.code || 'no-token');
  }
  if (!token) throw new Error('no-token');

  await updateDoc(doc(db, 'users', uid), { fcm_tokens: arrayUnion(token) });
  setLocalToken(token);
  return token;
}

/** Tab khuli ho (foreground) tab bhi push aaye to yahan se pata chalता hai — caller toast dikha sakta hai. */
export async function onForegroundPush(cb) {
  const messaging = await getMessagingSafe();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => cb(payload));
}

export function pushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}
