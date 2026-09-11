// App update detect — naya build deploy hone par ek DISMISSIBLE banner. Ek baar hata diya
// (ya update kar liya) to usi version ke liye dobara nahi aata.

// URL se apna purana cache-bust param hata do (address bar saaf)
try {
  const u = new URL(window.location.href);
  if (u.searchParams.has('_v') || u.searchParams.has('_')) {
    u.searchParams.delete('_v');
    u.searchParams.delete('_');
    window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  }
} catch { /* ignore */ }

const RUNNING = (() => {
  try {
    for (const s of document.scripts) {
      const m = String(s.src || '').match(/assets\/index-[\w-]+\.js/);
      if (m) return m[0];
    }
  } catch { /* ignore */ }
  return null;
})();

const DISMISS_KEY = 'pc_update_seen';
function alreadyHandled(hash) {
  try { return localStorage.getItem(DISMISS_KEY) === hash; } catch { return false; }
}
export function dismissUpdate(hash) {
  try { localStorage.setItem(DISMISS_KEY, hash || ''); } catch { /* ignore */ }
}

async function fetchLatest() {
  try {
    const res = await fetch(`/index.html?c=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/assets\/index-[\w-]+\.js/);
    return m ? m[0] : null;
  } catch {
    return null; // offline
  }
}

/** onUpdate(hash) — naya build DO baar confirm hua aur user ne wo version pehle dismiss/update nahi kiya. */
export function watchForUpdate(onUpdate) {
  if (!RUNNING) return () => {};
  let stopped = false;
  let candidate = null;
  const check = async () => {
    if (stopped) return;
    const l = await fetchLatest();
    if (!l || l === RUNNING || alreadyHandled(l)) { candidate = null; return; }
    if (candidate === l) { stopped = true; onUpdate(l); }   // 2nd sighting -> pakka
    else candidate = l;
  };
  const iv = setInterval(check, 15 * 60 * 1000);            // har 15 min
  const onVis = () => { if (!document.hidden) check(); };
  document.addEventListener('visibilitychange', onVis);
  const t0 = setTimeout(check, 90 * 1000);                  // pehli check 90s baad
  return () => { stopped = true; clearInterval(iv); clearTimeout(t0); document.removeEventListener('visibilitychange', onVis); };
}

/** Sab SW-cache clear karke fresh load — "Update app" / banner isko call karta hai. */
export async function reloadForUpdate(hash) {
  dismissUpdate(hash || 'reloading'); // reload ke baad usi version ka banner na aaye
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    }
  } catch { /* best-effort */ }
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('_v'); u.searchParams.delete('_');
    window.location.replace(u.pathname + (u.search || '') + u.hash);
  } catch {
    window.location.reload();
  }
}

export const runningBundle = RUNNING;
