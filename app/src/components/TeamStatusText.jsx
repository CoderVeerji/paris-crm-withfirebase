// Reports -> "Team report": date range + team + person filter. Name - Leads - Pending - Followup (definitions: lib/teamStatus.js).
// Text "Excel se copy kiya hua" jaisa (tab-separated) — copy karke Excel / Sheets mein paste karo to columns mein bantta hai. Excel / CSV download bhi.
// WhatsApp = wa.me share link (user khud chat/group chunke Send dabata hai) — koi WhatsApp API nahi (decisions.md: API out).
import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useConfig } from '../config';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { downloadCsv, downloadXlsx } from '../lib/csv';
import { istDay } from '../lib/stats';
import { fetchTeamReport, groupTeams, buildTsv, buildWhatsappText, buildTable } from '../lib/teamStatus';
import Select from './Select';

const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TEAMS = [['both', 'tsBoth', ['ldr', 'sales']], ['ldr', 'tsLdr', ['ldr']], ['sales', 'tsSales', ['sales']]];

export default function TeamStatusText() {
  const { t } = useT();
  const cfg = useConfig();
  const today = istDay();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [team, setTeam] = useState('both');
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);   // { rows, from, to, teams, sig } — jis range/filter se nikla

  // sirf active LDR / Sales (admin / md / tl performance mein nahi aate)
  const everyone = useMemo(() => cfg.users.filter((u) => (u.role === 'ldr' || u.role === 'sales') && (u.status || 'active') === 'active'), [cfg.users]);
  const teams = TEAMS.find((x) => x[0] === team)[2];
  const pool = useMemo(() => everyone.filter((u) => teams.includes(u.role)), [everyone, team]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(() => (person ? pool.filter((u) => u.id === person) : pool), [pool, person]);

  const quick = useMemo(() => [
    ['tsQToday', today, today], ['tsQYst', addDays(today, -1), addDays(today, -1)],
    ['tsQ7', addDays(today, -6), today], ['tsQMonth', `${today.slice(0, 7)}-01`, today], ['tsQ30', addDays(today, -29), today],
  ], [today]);

  const L = useMemo(() => ({
    title: t('tsTitle'), period: t('tsPeriod'), ldr: t('tsLdrTeam'), sales: t('tsSalesTeam'), team: t('tsHTeam'),
    name: t('tsHName'), leads: t('tsHLeads'), pending: t('tsHPend'), followup: t('tsHFu'), total: t('tsTotal'),
  }), [t]);

  const groups = useMemo(() => (res ? groupTeams(res.rows, res.teams) : []), [res]);
  const text = useMemo(() => (res ? buildTsv(groups, { from: res.from, to: res.to, L }) : ''), [res, groups, L]);
  const unknown = res ? res.rows.some((r) => r.leads == null || r.pending == null || r.followup == null) : false;
  const bad = from > to;

  async function generate() {
    if (bad || !chosen.length) return;
    setBusy(true);
    try { setRes({ rows: await fetchTeamReport(chosen, from, to), from, to, teams, sig: `${team}|${person}` }); } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); } finally { setBusy(false); }
  }
  const stale = () => res && (res.from !== from || res.to !== to || res.sig !== `${team}|${person}`);

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast(t('tsCopied')); } catch {
      const ta = document.getElementById('ts-box'); if (ta) { ta.select(); try { document.execCommand('copy'); toast(t('tsCopied')); } catch { toast(t('loadFail'), 'err'); } }
    }
  }
  const fileStamp = () => (res.from === res.to ? res.from : `${res.from}_${res.to}`);
  function excel() { const { headers, rows } = buildTable(groups, { L }); downloadXlsx(`team-report-${fileStamp()}`, [{ name: 'Team report', headers, rows }]); }
  function csv() { const { headers, rows } = buildTable(groups, { L }); downloadCsv(`team-report-${fileStamp()}.csv`, headers, rows); }
  function whatsapp() { window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsappText(groups, { from: res.from, to: res.to, L }))}`, '_blank', 'noopener'); }

  return (
    <div className="ts">
      <p className="bld-intro">{t('tsIntro')}</p>
      <div className="rp-range">
        <div className="rp-chips">
          {quick.map(([tk, f, e]) => <button type="button" key={tk} className={`chip ${from === f && to === e ? 'on' : ''}`} onClick={() => { setFrom(f); setTo(e); }}>{t(tk)}</button>)}
        </div>
        <div className="dfilter-dates">
          <label>{t('dDateFrom')}<input type="date" className="form-control" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{t('dDateTo')}<input type="date" className="form-control" value={to} min={from} max={addDays(today, 30)} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="ts-row" style={{ marginTop: 10 }}><span>{t('tsTeams')}</span>
          <div className="rp-chips">{TEAMS.map(([k, tk]) => <button type="button" key={k} className={`chip ${team === k ? 'on' : ''}`} onClick={() => { setTeam(k); setPerson(''); }}>{t(tk)}</button>)}</div>
        </div>
        <Select className="form-control" value={person} onChange={(e) => setPerson(e.target.value)} aria-label={t('tsPerson')}>
          <option value="">{t('tsAllPeople')}</option>
          {pool.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
        </Select>
        <p className="rp-note"><i className="fas fa-circle-info" /> {t('tsNote')}</p>
      </div>

      <button className="btn btn-primary btn-block" disabled={busy || bad || !chosen.length} onClick={generate}>
        <i className={`fas ${res ? 'fa-rotate' : 'fa-list-check'}`} /> {busy ? t('rpBuilding') : res ? t('tsRefresh') : t('tsGen')}
      </button>

      {res && (
        <div className="ts-out">
          {stale() && <p className="rp-note bad"><i className="fas fa-triangle-exclamation" /> {t('tsStale')}</p>}
          {unknown && <p className="rp-note bad"><i className="fas fa-triangle-exclamation" /> {t('tsIdxWait')}</p>}
          <textarea id="ts-box" className="form-control ts-box" rows={Math.min(30, Math.max(8, text.split('\n').length + 1))} value={text} readOnly spellCheck={false} />
          <div className="ts-btns">
            <button type="button" className="btn btn-primary" onClick={copy}><i className="fas fa-copy" /> {t('tsCopy')}</button>
            <button type="button" className="btn btn-ghost" onClick={excel}><i className="fas fa-file-excel" /> {t('tsExcel')}</button>
            <button type="button" className="btn btn-ghost" onClick={csv}><i className="fas fa-file-csv" /> CSV</button>
            <button type="button" className="btn btn-wa" onClick={whatsapp}><i className="fas fa-paper-plane" /> {t('tsWa')}</button>
          </div>
          <p className="rp-limit">{t('tsWaNote')}</p>
        </div>
      )}
    </div>
  );
}
