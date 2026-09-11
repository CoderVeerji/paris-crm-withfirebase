// Ad-spend hisaab. config/ad_spend = { standing: {facebook: 2000, instagram: 500},
//   days: { '2026-09-05': {facebook: 1800, instagram: 0}, ... } }
//  - standing  = har din ka default kharcha per platform
//  - days[d]   = us din ka actual/override (band-wale din 0, ya Excel import se)
import { daysBetween } from './stats';

/** date-range mein total ad spend + per-platform breakdown */
export function spendForRange(adSpend, fromDay, toDay) {
  if (!adSpend) return null;
  const standing = adSpend.standing || {};
  const days = adSpend.days || {};
  const platforms = new Set([...Object.keys(standing), ...Object.values(days).flatMap((x) => Object.keys(x || {}))]);
  const byPlatform = {};
  let total = 0;
  let anyData = false;
  for (const d of daysBetween(fromDay, toDay)) {
    const dayOv = days[d];
    for (const p of platforms) {
      const amt = dayOv && p in dayOv ? Number(dayOv[p]) || 0 : Number(standing[p]) || 0;
      if (dayOv && p in dayOv) anyData = true;
      if (standing[p]) anyData = true;
      byPlatform[p] = (byPlatform[p] || 0) + amt;
      total += amt;
    }
  }
  return { total, byPlatform, hasData: anyData };
}

/** source-name -> ad platform key (thoda flexible matching, kyunki config mein "Facebook"/"FB" etc) */
export function platformKey(source) {
  const s = String(source || '').toLowerCase();
  if (s.includes('face') || s === 'fb') return 'facebook';
  if (s.includes('insta') || s === 'ig') return 'instagram';
  if (s.includes('you') || s === 'yt') return 'youtube';
  if (s.includes('google') || s === 'adwords') return 'google';
  return s;
}

/** "date,facebook,instagram\n2026-09-05,1800,0" jaisa CSV -> { '2026-09-05': {facebook:1800, instagram:0} } */
export function parseAdCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { days: {}, error: 'CSV mein header + kam se kam 1 row chahiye' };
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const dateIdx = header.findIndex((h) => h.includes('date') || h.includes('din'));
  if (dateIdx < 0) return { days: {}, error: 'CSV mein "date" column nahi mila' };
  const platCols = header.map((h, i) => ({ key: platformKey(h), i })).filter((c) => c.i !== dateIdx && c.key);
  const out = {};
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(',');
    let d = (cells[dateIdx] || '').trim();
    // dd/mm/yyyy ya dd-mm-yyyy -> yyyy-mm-dd
    const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    out[d] = {};
    for (const c of platCols) out[d][c.key] = Number((cells[c.i] || '0').trim()) || 0;
  }
  return { days: out, count: Object.keys(out).length };
}
