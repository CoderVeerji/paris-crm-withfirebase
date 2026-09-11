// "Daily Leads" — finished visual report (Sales + LDR), rendered as a self-contained HTML
// document and opened in a new tab. Same data as the CSV export (`buildReport('daily_leads')`).
// No framework: inline CSS + inline JSON + minimal JS (tab hack is CSS-only; only the
// "Save as PNG" button pulls html2canvas from cdnjs, and degrades gracefully offline).

const CATS = ['Fresh', 'Scheduled', 'Off-Schedule', 'Urgent'];
const CAT_KEYS = { Fresh: 'fresh', Scheduled: 'sched', 'Off-Schedule': 'offsch', Urgent: 'urgent' };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (n) => (n == null || Number.isNaN(n) ? '—' : `${Math.round(n * 100)}%`);
const num = (n) => (n == null || Number.isNaN(n) ? '0' : Number(n).toLocaleString('en-IN'));
const nkey = (p) => String(p || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** sheet {headers, rows[]} -> array of row objects (skips [] spacer rows). */
function parseSheet(sheet) {
  if (!sheet) return [];
  return sheet.rows
    .filter((r) => Array.isArray(r) && r.length)
    .map((r) => ({
      date: r[0], person: r[1], category: r[2], status: r[3],
      connected: r[4] === 'Connected', calls: Number(r[5]) || 0,
      leadId: String(r[8] == null ? '' : r[8]),
    }))
    .filter((r) => CATS.includes(r.category));
}

/** most-common original spelling per normalised name key */
function displayNames(rows) {
  const g = new Map();
  for (const r of rows) {
    const k = nkey(r.person);
    if (!g.has(k)) g.set(k, new Map());
    const c = g.get(k); c.set(r.person, (c.get(r.person) || 0) + 1);
  }
  const out = new Map();
  for (const [k, c] of g) {
    let best = k; let bn = -1;
    for (const [orig, n] of c) if (n > bn) { bn = n; best = orig; }
    out.set(k, best);
  }
  return out;
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** per-person + team aggregation for one team's rows. */
function computeTeam(rows, team) {
  const names = displayNames(rows);
  const byKey = new Map();
  for (const r of rows) {
    const k = nkey(r.person);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }

  const persons = [];
  for (const [k, prows] of byKey) {
    const s = {
      key: k, name: names.get(k) || r0(prows),
      interactions: prows.length,
      calls: prows.reduce((a, x) => a + x.calls, 0),
      connected: prows.filter((x) => x.connected).length,
      leadIds: new Set(prows.map((x) => x.leadId).filter(Boolean)),
      dates: new Set(prows.map((x) => x.date)),
      cat: {}, status: {},
    };
    for (const c of CATS) s.cat[c] = { total: 0, connected: 0 };
    for (const x of prows) {
      s.cat[x.category].total += 1;
      if (x.connected) s.cat[x.category].connected += 1;
      const st = x.status || '—';
      s.status[st] = (s.status[st] || 0) + 1;
    }
    s.uniqueLeads = s.leadIds.size;
    s.connectRate = s.interactions ? s.connected / s.interactions : 0;
    s.activeDays = s.dates.size;
    s.avgPerDay = s.activeDays ? s.interactions / s.activeDays : 0;
    s.unknown = s.status['—'] || 0;
    if (team === 'sales') {
      s.lost = s.status.Lost || 0;
      s.lostRate = s.uniqueLeads ? s.lost / s.uniqueLeads : 0;
      s.visits = s.status['Visit Customer'] || 0;
      s.schedAdh = s.cat.Scheduled.total ? s.cat.Scheduled.connected / s.cat.Scheduled.total : null;
      s.offShare = s.interactions ? s.cat['Off-Schedule'].total / s.interactions : 0;
    } else {
      s.qualified = s.status.Qualified || 0;
      s.qualRate = s.connected ? s.qualified / s.connected : 0;
      s.dead = s.status.Dead || 0;
      s.callBack = s.status['Call Back'] || 0;
      s.freshCov = s.interactions ? s.cat.Fresh.total / s.interactions : 0;
    }
    persons.push(s);
  }
  persons.sort((a, b) => b.interactions - a.interactions || b.connected - a.connected);

  // team totals from raw rows (true-distinct leads)
  const allDates = new Set(rows.map((r) => r.date));
  const T = {
    interactions: rows.length,
    calls: rows.reduce((a, x) => a + x.calls, 0),
    connected: rows.filter((x) => x.connected).length,
    uniqueLeads: new Set(rows.map((x) => x.leadId).filter(Boolean)).size,
    activeDays: allDates.size,
    people: persons.length,
    cat: {}, status: {},
  };
  for (const c of CATS) T.cat[c] = { total: 0, connected: 0 };
  for (const x of rows) {
    T.cat[x.category].total += 1;
    if (x.connected) T.cat[x.category].connected += 1;
    const st = x.status || '—';
    T.status[st] = (T.status[st] || 0) + 1;
  }
  T.connectRate = T.interactions ? T.connected / T.interactions : 0;
  for (const c of CATS) T.cat[c].rate = T.cat[c].total ? T.cat[c].connected / T.cat[c].total : null;
  if (team === 'sales') {
    T.lost = T.status.Lost || 0;
    T.lostRate = T.uniqueLeads ? T.lost / T.uniqueLeads : 0;
    T.schedAdh = T.cat.Scheduled.total ? T.cat.Scheduled.connected / T.cat.Scheduled.total : null;
  } else {
    T.qualified = T.status.Qualified || 0;
    T.qualRate = T.connected ? T.qualified / T.connected : 0;
    T.dead = T.status.Dead || 0;
  }
  T.unknown = T.status['—'] || 0;

  const med = {
    interactions: median(persons.map((p) => p.interactions)),
    avgPerDay: median(persons.map((p) => p.avgPerDay)),
  };

  // ---- daily series (for trend + per-day flags) ----
  const series = [...allDates].sort().map((d) => {
    const dr = rows.filter((r) => r.date === d);
    return { date: d, interactions: dr.length, connected: dr.filter((x) => x.connected).length };
  });

  const multiDay = allDates.size > 1;
  const flags = buildFlags(persons, T, med, team, multiDay);
  return { persons, T, med, series, flags };
}
function r0(rows) { return rows[0] ? rows[0].person : ''; }

/** §4e — every flag comes from a rule, none hardcoded. */
function buildFlags(persons, T, med, team, multiDay) {
  const F = [];
  const add = (sev, title, ctx, val) => F.push({ sev, title, ctx, val });
  const teamAvgQual = T.connected ? T.qualified / T.connected : 0;
  const teamAvgLost = persons.length
    ? persons.reduce((a, p) => a + (p.lostRate || 0), 0) / persons.length : 0;

  for (const p of persons) {
    if (p.interactions >= 5 && p.connected === 0) {
      add('warn', `${p.name} — ${p.interactions} interactions, 0 connect`,
        `Volume hai par ek bhi baat nahi hui. Team avg connect ${pct(T.connectRate)}.`, '0%');
    }
    if (p.cat.Scheduled.total >= 3 && p.cat.Scheduled.connected === 0) {
      add('warn', `${p.name} — ${p.cat.Scheduled.total} scheduled calls miss`,
        'Customer ne time diya tha, ek bhi connect nahi. Ye fresh miss se mehnga hai.', '0%');
    }
    if (team === 'ldr' && p.connected >= 10 && teamAvgQual > 0 && p.qualRate < teamAvgQual / 2) {
      add('warn', `${p.name} — qualification rate ${pct(p.qualRate)}`,
        `${p.connected} connect huye par kam qualify. Team avg ${pct(teamAvgQual)}.`, pct(p.qualRate));
    }
    if (team === 'sales' && p.uniqueLeads >= 5 && teamAvgLost > 0 && p.lostRate > teamAvgLost * 2) {
      add('warn', `${p.name} — lost rate ${pct(p.lostRate)}`,
        `Team avg lost rate ${pct(teamAvgLost)} se 2x zyada.`, pct(p.lostRate));
    }
    if (multiDay) {
      if (med.avgPerDay > 0 && p.avgPerDay < med.avgPerDay * 0.25) {
        add('info', `${p.name} — kam activity`,
          `${p.avgPerDay.toFixed(1)}/day — team median ${med.avgPerDay.toFixed(1)}/day ka 25% se kam. Under-utilised ya log nahi kar raha.`, `${p.avgPerDay.toFixed(1)}/d`);
      }
    } else if (med.interactions > 0 && p.interactions < med.interactions * 0.25) {
      add('info', `${p.name} — kam activity`,
        `${p.interactions} interactions — team median ${num(med.interactions)} ka 25% se kam. Under-utilised ya log nahi kar raha.`, num(p.interactions));
    }
  }

  // workload skew — top 2
  if (persons.length >= 3) {
    const top2 = persons.slice(0, 2);
    const share = T.interactions ? top2.reduce((a, p) => a + p.interactions, 0) / T.interactions : 0;
    if (share > 0.5) {
      add('info', `Workload skew — ${top2.map((p) => p.name).join(' + ')}`,
        `Do log akele ${pct(share)} volume kar rahe hain. Baaki ${persons.length - 2} logon me kaam baraabar nahi.`, pct(share));
    }
  }
  // off-schedule concentration
  const totOff = persons.reduce((a, p) => a + p.cat['Off-Schedule'].total, 0);
  if (totOff > 0) {
    const worst = [...persons].sort((a, b) => b.cat['Off-Schedule'].total - a.cat['Off-Schedule'].total)[0];
    const sh = worst.cat['Off-Schedule'].total / totOff;
    if (sh > 0.4) {
      add('info', `${worst.name} — team ki ${pct(sh)} off-schedule calls`,
        'Check karo ye genuine follow-ups hain ya apni list chhod ke random leads.', num(worst.cat['Off-Schedule'].total));
    }
  }
  // weakest category
  let weak = null;
  for (const c of CATS) {
    const r = T.cat[c].rate;
    if (r != null && T.cat[c].total >= 3 && r < 0.5 && (!weak || r < weak.r)) weak = { c, r };
  }
  if (weak) {
    add('warn', `Sabse kamzor channel — ${weak.c}`,
      `Poori team ka ${weak.c} connect rate sirf ${pct(weak.r)}.`, pct(weak.r));
  }

  return F;
}

/** §4c — plain Hinglish, ~60 words. */
function summaryText(R, team, rangeLabel) {
  const T = R.T;
  let weak = null;
  for (const c of CATS) {
    const r = T.cat[c].rate;
    if (r != null && T.cat[c].total >= 3 && (!weak || r < weak.r)) weak = { c, r };
  }
  const top = R.persons[0];
  const topShare = top && T.interactions ? Math.round((top.interactions / T.interactions) * 100) : 0;
  const parts = [];
  parts.push(`${team === 'sales' ? 'Sales' : 'LDR'} team ne ${rangeLabel} me ${num(T.interactions)} interactions ki, ${pct(T.connectRate)} connect (${num(T.uniqueLeads)} alag leads, ${num(T.calls)} calls).`);
  if (team === 'sales' && T.schedAdh != null) parts.push(`Scheduled adherence ${pct(T.schedAdh)}.`);
  if (team === 'ldr') parts.push(`Qualification rate ${pct(T.qualRate)}.`);
  if (weak) parts.push(`Sabse kamzor: ${weak.c} (${pct(weak.r)} connect).`);
  if (top && topShare >= 30) parts.push(`${top.name} ne akele ${topShare}% volume kiya.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------

const TOKENS = `
  --paper:#FBFAF8; --ink:#16202B; --ink-soft:#5A6672; --rule:#DEDDD8;
  --fresh:#2563A8; --offsch:#8E4F86; --sched:#3F7A4E; --urgent:#B4432C; --warn:#B45309;
`;
const CATCOLOR = { Fresh: 'var(--fresh)', Scheduled: 'var(--sched)', 'Off-Schedule': 'var(--offsch)', Urgent: 'var(--urgent)' };

function meter(rate, color) {
  const w = rate == null ? 0 : Math.round(rate * 100);
  return `<span class="meter"><span style="width:${w}%;background:${color || 'var(--ink)'}"></span></span>`;
}
function z(n) { return n === 0 || n == null ? '<span class="z">0</span>' : num(n); }

function panelsHtml(R, team, multiDay) {
  const T = R.T;
  const p = [];
  const per = (v) => (multiDay && T.activeDays ? ` · ${(v / T.activeDays).toFixed(1)}/day` : '');
  p.push(panel('All interactions', num(T.interactions), T.connectRate, 'var(--ink)',
    `${num(T.connected)} connected · ${pct(T.connectRate)}${per(T.interactions)}`));
  p.push(panel('Unique leads touched', num(T.uniqueLeads), null, 'var(--ink)',
    `${num(T.calls)} total calls${per(T.uniqueLeads)}`));
  for (const c of CATS) {
    p.push(panel(c, num(T.cat[c].total), T.cat[c].rate, CATCOLOR[c],
      `${pct(T.cat[c].rate)} connect${per(T.cat[c].total)}`));
  }
  if (team === 'sales') {
    p.push(panel('Scheduled adherence', pct(T.schedAdh), T.schedAdh, 'var(--sched)', 'connected ÷ scheduled'));
    p.push(panel('Lost', num(T.lost), null, 'var(--urgent)', `${pct(T.lostRate)} of unique leads`));
  } else {
    p.push(panel('Qualification rate', pct(T.qualRate), T.qualRate, 'var(--fresh)', `${num(T.qualified)} qualified ÷ ${num(T.connected)} connected`));
    p.push(panel('Dead', num(T.dead), null, 'var(--ink-soft)', 'closed as dead'));
  }
  return `<div class="panels">${p.join('')}</div>`;
}
function panel(label, big, rate, color, sub) {
  return `<div class="panel">
    <div class="pl">${esc(label)}</div>
    <div class="pb">${big}</div>
    ${meter(rate, color)}
    <div class="ps">${esc(sub)}</div>
  </div>`;
}

function trendHtml(series) {
  if (series.length < 2) return '';
  const W = 900; const H = 150; const pad = { l: 34, r: 34, t: 12, b: 22 };
  const maxI = Math.max(1, ...series.map((s) => s.interactions));
  const n = series.length;
  const bw = (W - pad.l - pad.r) / n;
  const x = (i) => pad.l + i * bw + bw * 0.15;
  const bh = (v) => (v / maxI) * (H - pad.t - pad.b);
  const y = (v) => H - pad.b - bh(v);
  const bars = series.map((s, i) => `<rect x="${x(i).toFixed(1)}" y="${y(s.interactions).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh(s.interactions).toFixed(1)}" fill="#C4C1B9"/>`).join('');
  const line = series.map((s, i) => {
    const cr = s.interactions ? s.connected / s.interactions : 0;
    return `${(x(i) + bw * 0.35).toFixed(1)},${(H - pad.b - cr * (H - pad.t - pad.b)).toFixed(1)}`;
  }).join(' ');
  const labStep = n > 20 ? 5 : n > 10 ? 2 : 1;
  const labels = series.map((s, i) => (i % labStep === 0
    ? `<text x="${(x(i) + bw * 0.35).toFixed(1)}" y="${H - 6}" class="tick">${s.date.slice(5)}</text>` : '')).join('');
  return `<div class="sec">
    <h3>Daily trend</h3>
    <div class="scroll"><svg viewBox="0 0 ${W} ${H}" class="trend" preserveAspectRatio="xMidYMid meet">
      <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="var(--rule)"/>
      ${bars}
      <polyline points="${line}" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
      ${labels}
      <text x="${pad.l}" y="${pad.t + 4}" class="tick">bars = interactions</text>
      <text x="${W - pad.r}" y="${pad.t + 4}" class="tick" text-anchor="end">line = connect rate</text>
    </svg></div>
  </div>`;
}

function tableHtml(R, team, multiDay) {
  const T = R.T;
  const last = CATS.length - 1;
  const catCols = CATS.map((c, i) => `<th colspan="3" class="cg ${i === last ? 'zoneend' : 'gend'}" style="--catc:${CATCOLOR[c]}">${c}</th>`).join('');
  const sub = CATS.map((c, i) => `<th>T</th><th>C</th><th class="${i === last ? 'zoneend' : 'gend'}">N</th>`).join('');

  const rowFor = (p, isTot) => {
    const cells = CATS.map((c, i) => {
      const g = p.cat[c]; const miss = g.total > 0 && g.connected === 0;
      const end = i === last ? 'zoneend' : 'gend';
      return `<td>${z(g.total)}</td><td class="${miss ? 'miss' : ''}">${z(g.connected)}</td><td class="${end}">${z(g.total - g.connected)}</td>`;
    }).join('');
    const extra = team === 'sales' ? `<td>${z(p.lost)}</td>` : `<td>${z(p.qualified)}</td>`;
    const days = multiDay ? `<td>${z(p.activeDays)}</td><td>${p.avgPerDay ? p.avgPerDay.toFixed(1) : '<span class=z>0</span>'}</td>` : '';
    return `<tr class="${isTot ? 'tot' : ''}">
      <td class="pn">${esc(p.name)}</td>
      ${cells}
      <td>${num(p.interactions)}</td>
      <td>${num(p.uniqueLeads)}</td>
      <td>${z(p.connected)}</td>
      <td class="cr">${meter(p.connectRate, 'var(--ink)')}<span>${pct(p.connectRate)}</span></td>
      ${extra}${days}
    </tr>`;
  };

  const totRow = {
    name: 'TEAM TOTAL', cat: T.cat, interactions: T.interactions, uniqueLeads: T.uniqueLeads,
    connected: T.connected, connectRate: T.connectRate, lost: T.lost, qualified: T.qualified,
    activeDays: T.activeDays, avgPerDay: T.activeDays ? T.interactions / T.activeDays : 0,
  };

  return `<div class="sec">
    <h3>Person-wise</h3>
    <div class="scroll"><table class="pw">
      <thead>
        <tr><th rowspan="2" class="pn">Person</th>${catCols}<th rowspan="2">Inter&shy;actions</th><th rowspan="2">Unique leads</th><th rowspan="2">Conn.</th><th rowspan="2">Connect rate</th>${team === 'sales' ? '<th rowspan="2">Lost</th>' : '<th rowspan="2">Qual</th>'}${multiDay ? '<th rowspan="2">Days</th><th rowspan="2">Avg/day</th>' : ''}</tr>
        <tr>${sub}</tr>
      </thead>
      <tbody>
        ${R.persons.map((p) => rowFor(p, false)).join('')}
        ${rowFor(totRow, true)}
      </tbody>
    </table></div>
    <p class="foot-note">T = total, C = connected, N = not connected. Amber = kaam hua par 0 connect.${T.unknown ? ` ${num(T.unknown)} rows ka status "—" (unknown) — rate calc me nahi.` : ''} Unique-leads total team-distinct hai (2 logon ne ek lead ki to 1 gini).</p>
  </div>`;
}

function flagsHtml(flags) {
  if (!flags.length) {
    return `<div class="sec"><h3>Isko dekhna zaroori hai</h3><p class="ok-line">Sab theek — abhi kisi cheez pe dhyaan dene ki zaroorat nahi.</p></div>`;
  }
  const item = (f) => `<div class="flag ${f.sev}">
    <div class="ftext"><b>${esc(f.title)}</b><span>${esc(f.ctx)}</span></div>
    <div class="fval">${esc(f.val)}</div>
  </div>`;
  return `<div class="sec"><h3>Isko dekhna zaroori hai</h3>${flags.map(item).join('')}</div>`;
}

function teamSection(id, teamName, R, team, meta, multiDay) {
  const empty = R.T.interactions === 0;
  if (empty) {
    return `<section class="panelpage" id="${id}">
      <div class="mast"><div><h2>${esc(meta.title)}</h2><div class="msub">${esc(teamName)} · ${esc(meta.rangeLabel)}</div></div></div>
      <p class="empty">Is range me ${esc(teamName)} ki koi activity nahi.</p>
    </section>`;
  }
  return `<section class="panelpage" id="${id}">
    <div class="mast">
      <div><h2>${esc(meta.title)}</h2>
        <div class="msub">${esc(teamName)} · ${esc(meta.rangeLabel)} · ${R.T.people} log</div></div>
      <button class="png" data-target="${id}" type="button">Save as PNG</button>
    </div>
    ${panelsHtml(R, team, multiDay)}
    <p class="summary">${esc(summaryText(R, team, meta.rangeLabel))}</p>
    ${multiDay ? trendHtml(R.series) : ''}
    ${tableHtml(R, team, multiDay)}
    ${flagsHtml(R.flags)}
    <div class="pgfoot">
      Data: pre-aggregated daily activity (stats_daily). Generated ${esc(meta.stamp)}.<br>
      Ek din ke numbers tabhi matlab rakhte hain jab pichhle period se compare karo.
    </div>
  </section>`;
}

/** entry — returns a complete HTML document string. */
export function buildDailyLeadsReportHtml({ sheets, from, to }) {
  const ldrRows = parseSheet(sheets.find((s) => /ldr/i.test(s.name)));
  const salesRows = parseSheet(sheets.find((s) => /sales/i.test(s.name)));
  const allDates = new Set([...ldrRows, ...salesRows].map((r) => r.date));
  const multiDay = allDates.size > 1;

  const fmtD = (d) => { try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; } };
  const rangeLabel = multiDay ? `${fmtD(from)} – ${fmtD(to)} · ${allDates.size} days` : fmtD(from);
  const stamp = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const meta = { title: 'Daily Leads Report', rangeLabel, stamp };

  const salesR = computeTeam(salesRows, 'sales');
  const ldrR = computeTeam(ldrRows, 'ldr');

  const body = `
  <input type="radio" name="tab" id="t-sales" checked>
  <input type="radio" name="tab" id="t-ldr">
  <div class="tabs">
    <label for="t-sales">Sales team</label>
    <label for="t-ldr">LDR team</label>
  </div>
  ${teamSection('p-sales', 'Sales team', salesR, 'sales', meta, multiDay)}
  ${teamSection('p-ldr', 'LDR team', ldrR, 'ldr', meta, multiDay)}
  `;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily Leads Report · ${esc(rangeLabel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,600&display=swap">
<style>
  :root{ ${TOKENS} }
  *{box-sizing:border-box;}
  html,body{margin:0;background:var(--paper);color:var(--ink);
    font-family:"IBM Plex Sans",system-ui,Arial,sans-serif;font-size:14px;line-height:1.5;}
  .page{max-width:1180px;margin:0 auto;padding:26px 20px 60px;}
  h2{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-size:1.6rem;margin:0;}
  h3{font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);
    margin:0 0 12px;padding-bottom:6px;border-bottom:1px solid var(--rule);}
  .num,td,th{font-variant-numeric:tabular-nums;}
  .z{color:#B8BCC0;}

  input[name=tab]{position:absolute;opacity:0;pointer-events:none;}
  .tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:2px solid var(--ink);}
  .tabs label{padding:9px 16px;font-weight:600;font-size:.92rem;cursor:pointer;color:var(--ink-soft);
    border:1px solid var(--rule);border-bottom:0;border-radius:6px 6px 0 0;background:#F2F0EC;}
  #t-sales:checked ~ .tabs label[for=t-sales],
  #t-ldr:checked ~ .tabs label[for=t-ldr]{background:var(--ink);color:#fff;border-color:var(--ink);}
  .panelpage{display:none;}
  #t-sales:checked ~ #p-sales{display:block;}
  #t-ldr:checked ~ #p-ldr{display:block;}

  .mast{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;
    padding-bottom:12px;border-bottom:2px solid var(--ink);margin-bottom:20px;}
  .msub{color:var(--ink-soft);font-size:.9rem;margin-top:3px;}
  .png{border:1px solid var(--rule);background:#fff;color:var(--ink);font:inherit;font-size:.82rem;
    font-weight:600;padding:7px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;}
  .png:hover{background:#F2F0EC;}

  .panels{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--rule);
    border:1px solid var(--rule);margin-bottom:18px;}
  .panel{background:var(--paper);padding:12px 13px;}
  .pl{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);}
  .pb{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-size:1.7rem;line-height:1.15;margin:2px 0 6px;}
  .ps{font-size:.76rem;color:var(--ink-soft);margin-top:5px;}
  .meter{display:block;height:4px;background:#D8D6D0;border-radius:2px;overflow:hidden;}
  .meter>span{display:block;height:100%;}

  .summary{font-size:.98rem;line-height:1.6;margin:0 0 22px;max-width:70ch;}
  .sec{margin-bottom:26px;}
  .scroll{overflow-x:auto;}

  table.pw{border-collapse:collapse;width:100%;font-size:.82rem;min-width:720px;border:1px solid var(--ink);}
  table.pw th,table.pw td{padding:6px 9px;text-align:right;border-bottom:1px solid var(--rule);border-right:1px solid #EBEAE5;white-space:nowrap;}
  table.pw th{font-weight:600;color:var(--ink-soft);font-size:.74rem;}
  table.pw thead th{border-bottom:1px solid var(--ink-soft);}
  table.pw th.cg{text-align:center;color:var(--ink);font-weight:700;font-size:.78rem;letter-spacing:.02em;
    border-bottom:3px solid var(--catc);}
  table.pw thead tr:nth-child(2) th{background:#F0EEEA;color:var(--ink);border-bottom:2px solid var(--ink);}
  /* group separators */
  table.pw .gend{border-right:2px solid var(--ink-soft);}
  table.pw .zoneend{border-right:3px solid var(--ink);}
  table.pw .pn{text-align:left;position:sticky;left:0;background:var(--paper);font-weight:600;
    border-right:3px solid var(--ink);}
  table.pw tbody tr{border-bottom:1px solid var(--rule);}
  table.pw tbody tr:hover td{background:#F1EFEA;}
  table.pw tr.tot td{background:var(--ink);color:#fff;font-weight:700;border-bottom:0;border-right-color:#3a4650;}
  table.pw tr.tot .pn{background:var(--ink);color:#fff;border-right-color:#fff;}
  table.pw td.miss{background:#F6D9B0;color:#8a3d05;font-weight:700;}
  table.pw td.cr{display:flex;align-items:center;gap:7px;justify-content:flex-end;}
  table.pw td.cr .meter{width:52px;height:5px;}
  .foot-note{font-size:.76rem;color:var(--ink-soft);margin:8px 0 0;}

  .trend{width:100%;height:auto;min-width:560px;}
  .trend .tick{font-size:9px;fill:var(--ink-soft);}

  .flag{display:flex;justify-content:space-between;gap:12px;align-items:center;
    padding:11px 13px;border-left:3px solid var(--ink-soft);background:#fff;
    border:1px solid var(--rule);border-left-width:3px;margin-bottom:7px;}
  .flag.warn{border-left-color:var(--warn);}
  .flag.info{border-left-color:var(--fresh);}
  .flag .ftext b{display:block;font-size:.9rem;}
  .flag .ftext span{font-size:.82rem;color:var(--ink-soft);}
  .flag .fval{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-size:1.15rem;white-space:nowrap;}
  .ok-line{font-size:.9rem;color:var(--ink-soft);}

  .empty{padding:40px 0;color:var(--ink-soft);font-size:.95rem;}
  .pgfoot{font-size:.76rem;color:var(--ink-soft);border-top:1px solid var(--rule);padding-top:12px;margin-top:22px;}

  @media (max-width:720px){
    .page{padding:18px 12px 48px;}
    .panels{grid-template-columns:repeat(2,1fr);}
    .mast{flex-direction:column;}
    table.pw{display:none;}
    .pw-cards{display:block;}
    .flag{flex-direction:column;align-items:flex-start;gap:5px;}
  }
  .pw-cards{display:none;}
  .pcard{border:1px solid var(--rule);background:#fff;border-radius:8px;padding:12px;margin-bottom:8px;}
  .pcard .ph{display:flex;justify-content:space-between;font-weight:700;margin-bottom:7px;}
  .pcard .pm{display:flex;align-items:center;gap:7px;margin-bottom:7px;font-size:.82rem;}
  .pcard .pm .meter{flex:1;height:5px;}
  .pcard .pg{font-size:.82rem;color:var(--ink-soft);line-height:1.7;}
  .pcard .pg b{color:var(--ink);}

  @media print{
    @page{size:A4 landscape;margin:12mm;}
    input[name=tab],.tabs,.png{display:none;}
    .panelpage{display:block !important;page-break-after:always;}
    body{background:#fff;}
    .scroll{overflow:visible;}
    table.pw{min-width:0;font-size:8pt;}
  }
</style>
</head>
<body>
<div class="page">
${body}
</div>
${mobileCards(salesR, 'p-sales')}
${mobileCards(ldrR, 'p-ldr')}
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script>
  document.querySelectorAll('.png').forEach(function(btn){
    btn.addEventListener('click', function(){
      var el = document.getElementById(btn.dataset.target);
      if (!el || typeof html2canvas === 'undefined'){ alert('PNG export offline available nahi — Ctrl+P se PDF bana lo.'); return; }
      btn.textContent = 'Saving…';
      html2canvas(el, { backgroundColor: '#FBFAF8', scale: 2 }).then(function(canvas){
        var a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'daily-leads-' + btn.dataset.target.replace('p-','') + '.png';
        a.click();
        btn.textContent = 'Save as PNG';
      }).catch(function(){ btn.textContent = 'Save as PNG'; alert('PNG banane me dikkat aayi.'); });
    });
  });
</script>
</body></html>`;
}

/** §6 — one card per person, shown only < 720px (injected right after the table). */
function mobileCards(R, sectionId) {
  if (!R.persons.length) return '';
  const cards = R.persons.map((p) => `<div class="pcard">
    <div class="ph"><span>${esc(p.name)}</span><span>${num(p.interactions)} int</span></div>
    <div class="pm">${meter(p.connectRate, 'var(--ink)')}<span>${pct(p.connectRate)} connected</span></div>
    <div class="pg">
      <b>Fresh</b> ${num(p.cat.Fresh.total)} &middot; <b>Sched</b> ${num(p.cat.Scheduled.total)} &middot; <b>Off-Sch</b> ${num(p.cat['Off-Schedule'].total)} &middot; <b>Urgent</b> ${num(p.cat.Urgent.total)}<br>
      ${num(p.connected)} connected &middot; ${num(p.uniqueLeads)} unique leads
    </div>
  </div>`).join('');
  return `<script>(function(){
    var host = document.getElementById('${sectionId}');
    if(!host) return;
    var tbl = host.querySelector('table.pw');
    var box = tbl && tbl.closest('.scroll');
    if(!box || !box.parentNode) return;
    var wrap = document.createElement('div');
    wrap.className = 'pw-cards';
    wrap.innerHTML = ${JSON.stringify(cards)};
    box.parentNode.insertBefore(wrap, box.nextSibling);
  })();</script>`;
}
