// Reports -> "Tally match": Tally ka Party / Phone / Amount paste ya CSV se daalo — system leads se match karke
// Online (lead system mein hai, stage ke saath) aur Offline (lead nahi) sales alag dikhata hai. Kuch save nahi hota.
import { useMemo, useRef, useState } from 'react';
import { useT, fill } from '../i18n';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { downloadCsv } from '../lib/csv';
import { fmtMoney, fmtStatus } from '../lib/format';
import { parseTallyText, matchTally, tallyCsv, TALLY_MAX_ROWS } from '../lib/tallyMatch';

const SHOW = 200;

export default function TallyMatch() {
  const { t } = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [view, setView] = useState('all'); // all | online | offline
  const fileRef = useRef(null);

  const parsed = useMemo(() => parseTallyText(text), [text]);
  const tooMany = parsed.rows.length > TALLY_MAX_ROWS;

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setText(String(r.result || '')); setRes(null); };
    r.readAsText(f);
    e.target.value = '';
  }

  async function run() {
    setBusy(true);
    try { setRes(await matchTally(parsed.rows)); setView('all'); } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); } finally { setBusy(false); }
  }

  const items = res ? res.items.filter((i) => view === 'all' || (view === 'online') === i.online) : [];
  const S = res?.summary;

  return (
    <div className="tm">
      <p className="bld-intro">{t('tmIntro')}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}><i className="fas fa-file-arrow-up" /> {t('tmFile')}</button>
        {text && <button type="button" className="btn btn-ghost" onClick={() => { setText(''); setRes(null); }}><i className="fas fa-xmark" /> {t('dClear')}</button>}
        <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={onFile} style={{ display: 'none' }} />
      </div>
      <textarea className="form-control" rows={6} value={text} placeholder={t('tmPaste')}
        onChange={(e) => { setText(e.target.value); setRes(null); }} style={{ fontFamily: 'monospace', fontSize: 12.5 }} />
      <p className="rp-note"><i className="fas fa-circle-info" /> {t('tmHint')}</p>
      {parsed.rows.length > 0 && (
        <p className={`rp-note ${tooMany ? 'bad' : ''}`}>
          <i className={`fas ${tooMany ? 'fa-triangle-exclamation' : 'fa-table'}`} /> {tooMany ? fill(t('tmTooMany'), { n: TALLY_MAX_ROWS }) : fill(t('tmRows'), { n: parsed.rows.length })}
        </p>
      )}
      <button className="btn btn-primary btn-block" disabled={busy || !parsed.rows.length || tooMany} onClick={run}>
        <i className="fas fa-link" /> {busy ? t('rpBuilding') : t('tmRun')}
      </button>

      {S && (
        <>
          <div className="stat-grid" style={{ marginTop: 14 }}>
            <div className="stat-card tone-good"><div className="val" style={{ color: 'var(--success)' }}>{fmtMoney(S.online.amount)}</div>
              <div className="label">{t('tmOnline')} · {S.online.count}</div></div>
            <div className="stat-card tone-wip"><div className="val" style={{ color: 'var(--warning)' }}>{fmtMoney(S.offline.amount)}</div>
              <div className="label">{t('tmOffline')} · {S.offline.count}</div></div>
            <div className="stat-card"><div className="val">{fmtMoney(S.total.amount)}</div><div className="label">{t('tmTotal')} · {S.total.count}</div></div>
          </div>
          {S.noPhone > 0 && <p className="rp-note"><i className="fas fa-phone-slash" /> {fill(t('tmNoPhone'), { n: S.noPhone })}</p>}

          {S.byStage.length > 0 && (
            <div className="tablewrap" style={{ marginTop: 8 }}>
              <table className="meca-t">
                <thead><tr><th>{t('tmByStage')}</th><th>{t('tmCount')}</th><th>{t('tmAmount')}</th></tr></thead>
                <tbody>{S.byStage.map((b) => <tr key={b.stage}><td className="nm">{b.label}</td><td>{b.count}</td><td>{fmtMoney(b.amount)}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <div className="ls-tabs" style={{ margin: '14px 0 8px' }}>
            {[['all', t('cAll')], ['online', t('tmOnline')], ['offline', t('tmOffline')]].map(([k, l]) => (
              <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '4px 0 8px' }}>
            <button className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 12.5 }}
              onClick={() => { const c = tallyCsv(res.items); downloadCsv(`tally-match-${new Date().toISOString().slice(0, 10)}.csv`, c.headers, c.rows); }}>
              <i className="fas fa-file-csv" /> {t('exportCsv')}
            </button>
          </div>
          <div className="tablewrap">
            <table className="meca-t">
              <thead><tr><th>{t('tmParty')}</th><th>{t('tmPhone')}</th><th>{t('tmAmount')}</th><th>{t('tmType')}</th><th>{t('tmStage')}</th></tr></thead>
              <tbody>
                {items.slice(0, SHOW).map((i, n) => (
                  <tr key={n}>
                    <td className="nm">{i.party || '—'}{i.online && i.leadName && i.leadName !== i.party ? <small style={{ display: 'block', color: 'var(--muted)' }}>{i.leadName}</small> : null}</td>
                    <td>{i.phoneRaw || '—'}</td>
                    <td>{fmtMoney(i.amount)}</td>
                    <td><span className="rep-chip" style={{ fontWeight: 800, color: i.online ? 'var(--success)' : 'var(--warning)' }}>{i.online ? t('tmOnline') : t('tmOffline')}</span></td>
                    <td>{i.online ? (fmtStatus(i.stage) || '—') : '—'}</td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('noData')}</td></tr>}
              </tbody>
            </table>
          </div>
          {items.length > SHOW && <p className="rp-note"><i className="fas fa-circle-info" /> {fill(t('tmShowing'), { n: SHOW })}</p>}
        </>
      )}
    </div>
  );
}
