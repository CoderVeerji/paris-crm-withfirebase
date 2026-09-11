// App theme — appearance (light / dark / system) + brand accent hue.
// Choice localStorage mein (per-device). index.html ka inline script paint se pehle laga deta hai;
// yeh module React ke andar se change karne ke liye + OS-theme-change sunne ke liye.

const THEME_KEY = 'pc_theme';   // 'light' | 'dark' | 'system'
const BRAND_KEY = 'pc_brand';   // '#rrggbb' | ''

export const THEME_MODES = ['light', 'dark', 'system'];

// achhe-dikhne wale brand presets (Settings mein swatch ke roop mein)
export const BRAND_PRESETS = [
  { hex: '', label: 'Default' },
  { hex: '#001f3f', label: 'Navy' },
  { hex: '#0d7d6f', label: 'Teal' },
  { hex: '#6d28d9', label: 'Violet' },
  { hex: '#b0475e', label: 'Rose' },
  { hex: '#c2410c', label: 'Amber' },
  { hex: '#15803d', label: 'Forest' },
];

const read = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* private mode */ } };

export const getTheme = () => { const v = read(THEME_KEY, 'system'); return THEME_MODES.includes(v) ? v : 'system'; };
export const getBrand = () => read(BRAND_KEY, '');

const prefersDark = () => {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
};
export const isDark = (mode = getTheme()) => (mode === 'dark' || (mode === 'system' && prefersDark()));

/* hex ko lighten(+)/darken(-) — amt [-1..1] */
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = amt < 0 ? c * (1 + amt) : c + (255 - c) * amt;
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function applyBrand(hex = getBrand()) {
  const s = document.documentElement.style;
  if (!hex) {
    ['--brand', '--brand-dark', '--brand-light', '--brand-accent'].forEach((p) => s.removeProperty(p));
    return;
  }
  s.setProperty('--brand', hex);
  s.setProperty('--brand-dark', shade(hex, -0.45));
  s.setProperty('--brand-light', shade(hex, 0.22));
  s.setProperty('--brand-accent', shade(hex, 0.28));
}

export function applyTheme(mode = getTheme()) {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  const dark = isDark(mode);
  root.classList.toggle('dark', dark);
  const mc = document.querySelector('meta[name="theme-color"]');
  if (mc) mc.setAttribute('content', dark ? '#0e1116' : (getBrand() || '#001f3f'));
}

export function setTheme(mode) { write(THEME_KEY, mode === 'system' ? '' : mode); applyTheme(mode); }
export function setBrand(hex) { write(BRAND_KEY, hex || ''); applyBrand(hex || ''); applyTheme(); }

let inited = false;
export function initTheme() {
  if (inited) return;
  inited = true;
  applyBrand();
  applyTheme();
  try {
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { if (getTheme() === 'system') applyTheme('system'); });
  } catch { /* older browsers */ }
}
