// Reports -> "Team status (text)": Naam - Leads - Pending - Followup pending. Text box mein banta hai (edit bhi kar sakte ho), Copy dabao ya WhatsApp mein bhejo.
// WhatsApp = wa.me share link (user khud chat/group chunke Send dabata hai) — koi WhatsApp API nahi (decisions.md: API out).
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useConfig } from '../config';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { fetchTeamStatus, buildTeamStatusText, FU_WINDOWS } from '../lib/teamStatus';

const TEAMS = [['both', 'tsBoth', ['ldr', 'sales']], ['ldr', 'tsLdr', ['ldr']], ['sales', 'tsSales', ['sales']]];

export default function TeamStatusText() {
  const { t } = useT();
  const cfg = useConfig();
  const [rows, setRows] = useState(null);
  const [at, setAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [team, setTeam] = useState('both');
  const [win, setWin] = useState('all');
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);

  // sirf active LDR / Sales (admin / md / tl performance mein nahi aate)
  const people = useMemo(() => cfg.users.filter((u) => (u.role === 'ldr' || u.role === 'sales') && (u.status || 'active') === 'active'), [cfg.users]);
  const labels = useMemo(() => ({ title: t('tsTitle'), cols: t('tsCols'), ldr: t('tsLdrTeam'), sales: t('tsSalesTeam'), total: t('tsTotal') }), [t]);

  async function generate() {
    setBusy(true);
    try { setRows(await fetchTeamStatus(people)); setAt(new Date()); setEdited(false); } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); } finally { setBusy(false); }
  }

  // chips badalne par text turant dobara banta hai (jab tak user ne khud text edit na kiya ho)
  useEffect(() => {
    if (!rows || edited) return;
    setText(buildTeamStatusText(rows, { teams: TEAMS.find((x) => x[0] === team)[2], win, labels, at }));
  }, [rows, team, win, labels, at, edited]);

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast(t('tsCopied')); } catch {
      const ta = document.getElementById('ts-box'); if (ta) { ta.select(); try { document.execCommand('copy'); toast(t('tsCopied')); } catch { toast(t('loadFail'), 'err'); } }
    }
  }
  function whatsapp() { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); }

  return (
    <div className="ts">
      <p className="bld-intro">{t('tsIntro')}</p>
      <div className="rp-range">
        <div className="ts-row"><span>{t('tsTeams')}</span>
          <div className="rp-chips">{TEAMS.map(([k, tk]) => <button type="button" key={k} className={`chip ${team === k ? 'on' : ''}`} onClick={() => { setTeam(k); setEdited(false); }}>{t(tk)}</button>)}</div>
        </div>
        <div className="ts-row"><span>{t('tsWin')}</span>
          <div className="rp-chips">{FU_WINDOWS.map((w) => <button type="button" key={w} className={`chip ${win === w ? 'on' : ''}`} onClick={() => { setWin(w); setEdited(false); }}>{t(`tsW${w}`)}</button>)}</div>
        </div>
        <p className="rp-note"><i className="fas fa-circle-info" /> {t('tsNote')}</p>
      </div>

      <button className="btn btn-primary btn-block" disabled={busy} onClick={generate}>
        <i className={`fas ${rows ? 'fa-rotate' : 'fa-list-check'}`} /> {busy ? t('rpBuilding') : rows ? t('tsRefresh') : t('tsGen')}
      </button>

      {rows && (
        <div className="ts-out">
          <textarea id="ts-box" className="form-control ts-box" rows={Math.min(30, Math.max(8, text.split('\n').length + 1))} value={text}
            onChange={(e) => { setText(e.target.value); setEdited(true); }} spellCheck={false} />
          <div className="ts-btns">
            <button type="button" className="btn btn-primary" onClick={copy}><i className="fas fa-copy" /> {t('tsCopy')}</button>
            <button type="button" className="btn btn-wa" onClick={whatsapp}><i className="fas fa-paper-plane" /> {t('tsWa')}</button>
          </div>
          <p className="rp-limit">{t('tsWaNote')}</p>
        </div>
      )}
    </div>
  );
}
