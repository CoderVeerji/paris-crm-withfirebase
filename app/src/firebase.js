// Firebase init — ye keys public hain (client-side). Asli security Firestore Rules karti hain.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, connectFirestoreEmulator,
} from 'firebase/firestore';

// LOCAL TEST LAB: `VITE_EMULATOR=1` ke saath build/dev chalao to app asli project ki jagah local
// emulators (project "demo-paris-crm") se judti hai — asli users/leads/notifications ko kabhi nahi chhoti.
// Production build mein ye env set nahi hota, isliye ye poora hissa bundle se hat jaata hai.
export const EMU = import.meta.env.VITE_EMULATOR === '1';

const firebaseConfig = EMU
  ? { apiKey: 'demo-key', authDomain: 'demo-paris-crm.firebaseapp.com', projectId: 'demo-paris-crm', appId: 'demo-app' }
  : {
    apiKey: 'AIzaSyDp1I8EluT0vn5F5buuiEaT0Q0Uv_XM47w',
    authDomain: 'paris-crm.firebaseapp.com',
    projectId: 'paris-crm',
    storageBucket: 'paris-crm.firebasestorage.app',
    messagingSenderId: '806081881341',
    appId: '1:806081881341:web:3de692cb64bd952b7e0a94',
  };

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'asia-south1');

// Offline cache on — reads dobara nahi lagti (free-tier bachat + mobile pe fast).
// (Emulator mein memory cache — har test run saaf rahe, purana cache na bache.)
export const db = initializeFirestore(app, {
  localCache: EMU ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (EMU) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
