// Firebase init — ye keys public hain (client-side). Asli security Firestore Rules karti hain.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const firebaseConfig = {
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

// Offline cache on — reads dobara nahi lagti (free-tier bachat + mobile pe fast)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
