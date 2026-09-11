// PWA install — "app ki tarah install karo" button ke liye.
// `beforeinstallprompt` React mount se pehle fire ho sakta hai, isliye module-level capture.
import { useEffect, useState } from 'react';

let deferred = null;                       // stashed beforeinstallprompt event
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true            // iOS Safari
    || document.referrer.startsWith('android-app://');
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
}

/**
 * @returns {{ installed:boolean, canPrompt:boolean, ios:boolean, promptInstall:() => Promise<'accepted'|'dismissed'|'unavailable'> }}
 */
export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  const promptInstall = async () => {
    if (!deferred) return 'unavailable';
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') deferred = null;
    emit();
    return outcome;
  };

  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    ios: isIOS(),
    promptInstall,
  };
}
