// Live Monitor ka shareable report — (1) colourful PNG canvas, (2) WhatsApp-ready text.
// Sab client-side, koi extra read/write nahi. Team-wise (LDR / Sales) grouped.
import { fmtMoney } from './format';

// LIGHT report palette — easy to read, print/WhatsApp friendly
const C = {
  page: '#eef1f6', card: '#ffffff', ink: '#132133', mut: '#5b6b80', line: '#dde3ec',
  navy: '#12233c',
  green: '#15803d', greenBg: '#eafaef',
  red: '#c62828', redBg: '#fdecec',
  amber: '#b45309', blue: '#1d4ed8', grey: '#8794a5',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const statusColor = (s) => (s === 'online' ? C.green : s === 'idle' ? C.amber : s === 'never' ? C.red : C.grey);

/** chhota "2h" / "3d" / "now" */
export function shortAgo(ts) {
  if (!ts) return '—';
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 2) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** { n, unit } — component i18n se "5 min ago" bana leta hai */
export function agoParts(ms) {
  if (!ms) return null;
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return { n: 0, unit: 'now' };
  if (mins < 60) return { n: mins, unit: 'min' };
  const h = Math.floor(mins / 60);
  if (h < 24) return { n: h, unit: 'hr' };
  return { n: Math.floor(h / 24), unit: 'day' };
}

/** "2:30 PM" (aaj) / "8 Sep 2:30 PM" */
export function clockStr(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const today = new Date().toDateString() === d.toDateString();
  return today ? time : `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${time}`;
}

export function dur(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const seenLine = (r) => {
  if (r.state === 'working') return `working · last ${shortAgo(r.workedTodayTs)} ago`;
  if (r.state === 'stalled') return r.workedTodayTs ? `no work ${shortAgo(r.workedTodayTs)}` : 'zero work today';
  if (r.state === 'idle') return r.workedTodayTs ? `idle · last work ${shortAgo(r.workedTodayTs)} ago` : 'idle';
  if (r.state === 'absent') return 'absent';
  // legacy fallback
  return r.status === 'online' ? `active ${dur(r.sessionMs)}` : `seen ${shortAgo(r.lastAct)} ago`;
};

function nowStr() {
  return new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** WhatsApp / message-group ke liye plain-text (emoji ke saath), team-wise */
export function buildText(groups, sum) {
  const L = [];
  L.push('📊 *PARIS CRM — Team Status*');
  L.push(`🕒 ${nowStr()}`);
  L.push('');
  L.push(`🟢 Online ${sum.online}   •   📋 Present ${sum.present}/${sum.total}   •   🔕 Alerts off ${sum.pushOff}   •   ⏰ Overdue ${sum.overdue}`);

  const line = (r) => {
    const work = `${r.calls} call, ${r.result} ${r.role === 'sales' ? 'ord' : 'qual'}`;
    return `${r.name} — ${seenLine(r)} · ${work}${r.overdue ? ` · ${r.overdue} overdue` : ''}`;
  };

  groups.forEach((g) => {
    if (!g.rows.length) return;
    const attn = g.rows.filter((r) => r.flags.length).sort((a, b) => b.flags.length - a.flags.length);
    const ok = g.rows.filter((r) => !r.flags.length).sort((a, b) => b.worked - a.worked);
    L.push('');
    L.push(`*━━ ${g.label.toUpperCase()} ━━*  (${g.stats.present} present · ${g.stats.absent} absent · ${g.stats.online} online)`);
    if (attn.length) {
      L.push(`🔴 *Needs attention (${attn.length})*`);
      attn.forEach((r) => L.push(`   • ${line(r)}\n     ⚠ ${r.flags.join(', ')}`));
    }
    if (ok.length) {
      L.push(`🟢 *On track (${ok.length})*`);
      ok.forEach((r) => L.push(`   • ${line(r)}`));
    }
  });
  return L.join('\n');
}

/** Light, easy-to-read PNG -> Blob. Har team ke andar: pehle "NEEDS ATTENTION" (laal),
 *  fir "ON TRACK" (hara) — mix nahi. */
export function buildImage(groups, sum) {
  const W = 960;
  const PAD = 34;
  const headH = 132;
  const tileH = 92;
  const bandH = 46;
  const subH = 34;
  const attnH = 62;  // taller — flag line ke liye
  const okH = 44;

  // sub-sections per group
  const secs = groups.map((g) => {
    const attn = g.rows.filter((r) => r.flags.length).sort((a, b) => b.flags.length - a.flags.length);
    const ok = g.rows.filter((r) => !r.flags.length).sort((a, b) => b.worked - a.worked);
    return { ...g, attn, ok };
  }).filter((g) => g.attn.length || g.ok.length);

  let bodyH = 0;
  secs.forEach((g) => {
    bodyH += bandH;
    if (g.attn.length) bodyH += subH + g.attn.length * attnH;
    if (g.ok.length) bodyH += subH + g.ok.length * okH;
    bodyH += 16;
  });
  const H = headH + tileH + 22 + bodyH + 54;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = H * dpr;
  const x = cv.getContext('2d');
  x.scale(dpr, dpr);
  x.textBaseline = 'middle';

  x.fillStyle = C.page; x.fillRect(0, 0, W, H);

  // ---- header (navy band, white text) ----
  x.fillStyle = C.navy; x.fillRect(0, 0, W, headH);
  x.fillStyle = '#7fd4ff'; x.font = `800 13px ${FONT}`;
  x.fillText('LIVE TEAM MONITOR', PAD, 34);
  x.fillStyle = '#ffffff'; x.font = `800 34px ${FONT}`;
  x.fillText('Team Status Report', PAD, 68);
  x.fillStyle = 'rgba(255,255,255,.72)'; x.font = `400 15px ${FONT}`;
  x.fillText(`${nowStr()}   ·   Paris Fashion`, PAD, 100);

  // ---- summary tiles ----
  const T = [
    ['ONLINE', sum.online, sum.online ? C.green : C.grey],
    ['PRESENT', `${sum.present}/${sum.total}`, C.blue],
    ['ABSENT', sum.total - sum.present, sum.total - sum.present ? C.red : C.grey],
    ['ALERTS OFF', sum.pushOff, sum.pushOff ? C.amber : C.grey],
    ['NEVER OPENED', sum.never, sum.never ? C.red : C.grey],
    ['OVERDUE', sum.overdue, sum.overdue ? C.red : C.grey],
  ];
  const tw = (W - PAD * 2 - (T.length - 1) * 10) / T.length;
  T.forEach(([lbl, val, col], i) => {
    const tx = PAD + i * (tw + 10); const ty = headH + 14;
    x.fillStyle = C.card; roundRect(x, tx, ty, tw, tileH - 24, 10); x.fill();
    x.strokeStyle = C.line; x.lineWidth = 1; roundRect(x, tx, ty, tw, tileH - 24, 10); x.stroke();
    x.fillStyle = col; roundRect(x, tx, ty, tw, 4, 2); x.fill();
    x.fillStyle = col; x.font = `800 24px ${FONT}`; x.fillText(String(val), tx + 14, ty + 28);
    x.fillStyle = C.mut; x.font = `700 10.5px ${FONT}`; x.fillText(lbl, tx + 14, ty + 50);
  });

  // ---- team groups ----
  let y = headH + tileH + 22;

  const drawRow = (r, ry, rh, tint) => {
    x.fillStyle = tint; x.fillRect(PAD, ry, W - PAD * 2, rh - 4);
    const sc = r.flags.length ? C.red : statusColor(r.status);
    x.fillStyle = sc; x.fillRect(PAD, ry, 4, rh - 4);

    const top = r.flags.length ? ry + 16 : ry + rh / 2 - 2;
    x.fillStyle = C.ink; x.font = `700 14.5px ${FONT}`;
    x.fillText(clip(x, r.name, 165), PAD + 16, top);
    if (!r.present) { x.fillStyle = C.red; x.font = `700 10px ${FONT}`; x.fillText('ABSENT', PAD + 16, top + 15); }
    else { x.fillStyle = C.mut; x.font = `500 10.5px ${FONT}`; x.fillText(r.role.toUpperCase(), PAD + 16, top + 15); }

    x.fillStyle = sc; x.font = `600 11.5px ${FONT}`;
    x.fillText(clip(x, seenLine(r), 240), 245, top);

    x.fillStyle = r.push ? C.green : C.red; x.font = `700 11px ${FONT}`;
    x.fillText(r.push ? 'ALERTS ON' : 'ALERTS OFF', 505, top);

    x.fillStyle = C.ink; x.font = `500 11.5px ${FONT}`;
    x.fillText(`${r.calls} call · ${r.result} ${r.role === 'sales' ? 'ord' : 'qual'}`, 610, top);

    x.fillStyle = r.overdue ? C.red : C.grey; x.font = `700 12px ${FONT}`;
    x.textAlign = 'right';
    x.fillText(r.overdue ? `${r.overdue} overdue` : '0 overdue', W - PAD - 4, top);
    x.textAlign = 'left';

    if (r.flags.length) {
      x.fillStyle = C.red; x.font = `600 10.5px ${FONT}`;
      x.fillText('⚠ ' + clip(x, r.flags.join('  ·  '), W - PAD * 2 - 40), PAD + 16, ry + rh - 14);
    }
  };

  secs.forEach((g) => {
    // team band
    x.fillStyle = C.navy; x.fillRect(PAD, y, W - PAD * 2, bandH);
    x.fillStyle = '#ffffff'; x.font = `800 15px ${FONT}`;
    x.fillText(g.label.toUpperCase(), PAD + 14, y + bandH / 2);
    x.fillStyle = 'rgba(255,255,255,.72)'; x.font = `600 11.5px ${FONT}`;
    x.textAlign = 'right';
    x.fillText(`${g.stats.present} present  ·  ${g.stats.absent} absent  ·  ${g.stats.online} online`, W - PAD - 14, y + bandH / 2);
    x.textAlign = 'left';
    y += bandH;

    if (g.attn.length) {
      x.fillStyle = C.redBg; x.fillRect(PAD, y, W - PAD * 2, subH);
      x.fillStyle = C.red; x.font = `800 12px ${FONT}`;
      x.fillText(`NEEDS ATTENTION  (${g.attn.length})`, PAD + 12, y + subH / 2);
      y += subH;
      g.attn.forEach((r) => { drawRow(r, y, attnH, C.redBg); y += attnH; });
    }
    if (g.ok.length) {
      x.fillStyle = C.greenBg; x.fillRect(PAD, y, W - PAD * 2, subH);
      x.fillStyle = C.green; x.font = `800 12px ${FONT}`;
      x.fillText(`ON TRACK  (${g.ok.length})`, PAD + 12, y + subH / 2);
      y += subH;
      g.ok.forEach((r) => { drawRow(r, y, okH, C.greenBg); y += okH; });
    }
    y += 16;
  });

  x.fillStyle = C.mut; x.font = `400 11.5px ${FONT}`;
  x.fillText('calls / orders = today   ·   overdue = all pending follow-ups   ·   "seen" = last time the app was open', PAD, H - 26);

  return new Promise((res) => {
    if (cv.toBlob) cv.toBlob((b) => res(b || dataUrlToBlob(cv.toDataURL('image/png'))), 'image/png');
    else res(dataUrlToBlob(cv.toDataURL('image/png')));
  });
}

function dataUrlToBlob(u) {
  const [meta, b64] = u.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function roundRect(x, X, Y, w, h, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}
function clip(x, s, max) {
  s = String(s || '');
  if (x.measureText(s).width <= max) return s;
  while (s.length > 1 && x.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}

/**
 * Mobile (touch) par share-sheet (WhatsApp group), desktop par seedha DOWNLOAD.
 */
export async function shareOrSave(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' });
  let touch = false;
  try { touch = window.matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }
  const canShare = touch && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  if (canShare) {
    try { await navigator.share({ files: [file], title: 'Team Status' }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, filename);
  return 'saved';
}
