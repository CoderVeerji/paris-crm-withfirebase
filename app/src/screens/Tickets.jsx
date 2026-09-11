import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { useT } from '../i18n';
import { toast } from '../toast';
import { allTickets, resolveTicket, helpStats, kbList, kbSave, kbDelete, kbVerify } from '../lib/help';

const fmtD = (ts) => { const d = ts?.toDate?.(); return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };

export default function Tickets() {
  const { user } = useAuth();
  const { t } = useT();
  const actor = { uid: user.id, name: user.full_name };
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState(null);
  const [noteFor, setNoteFor] = useState(null); // ticket id being resolved
  const [note, setNote] = useState('');
  const [noKb, setNoKb] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRows = () => allTickets(filter === 'all' ? '' : filter).then(setRows).catch(() => setRows([]));
  const loadStats = () => helpStats().then(setStats).catch(() => setStats(null));
  useEffect(() => { setRows(null); loadRows(); /* eslint-disable-next-line */ }, [filter]);
  useEffect(() => { loadStats(); loadKb(); /* eslint-disable-next-line */ }, []);

  // Note dono par chalta hai — "In progress" par bhi admin remark likh sakta hai taaki
  // user ko dikhe ki kaam ho raha hai (sirf solve par nahi).
  async function act(tk, status) {
    setBusy(true);
    try {
      const n = (noteFor === tk.id ? note : tk.admin_note || '').trim();
      const patch = { status, admin_note: n };
      if (status === 'solved') patch.kb_skip = noKb;
      await resolveTicket(tk.id, patch, actor);
      toast(status === 'solved' && n && !noKb ? t('tkSolvedKb') : t('tkUpdated'));
      setNoteFor(null); setNote(''); setNoKb(false);
      loadRows(); loadStats(); setTimeout(loadKb, 1500);
    } catch (e) { console.error(e); toast(t('saveFail'), 'err'); }
    finally { setBusy(false); }
  }

  // ---- Knowledge base ----
  const [kb, setKb] = useState(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [kbEdit, setKbEdit] = useState(null); // { id?, q, a, tags }
  const loadKb = () => kbList().then(setKb).catch(() => setKb([]));
  async function saveKbEntry() {
    if (!kbEdit?.q?.trim() || !kbEdit?.a?.trim()) return;
    setBusy(true);
    try {
      await kbSave(kbEdit.id, kbEdit);
      toast(t('save') + ' ✓'); setKbEdit(null); loadKb(); loadStats();
    } catch (e) { console.error(e); toast(t('saveFail'), 'err'); }
    finally { setBusy(false); }
  }
  async function delKb(id) {
    if (!window.confirm(t('tkKbDelC'))) return;
    try { await kbDelete(id); loadKb(); loadStats(); } catch (e) { console.error(e); toast(t('saveFail'), 'err'); }
  }
  async function verifyKb(id, ok) {
    try { await kbVerify(id, ok); toast(t('save') + ' ✓'); loadKb(); } catch (e) { console.error(e); toast(t('saveFail'), 'err'); }
  }

  return (
    <div className="section">
      <p className="bld-intro">{t('tkIntro')}</p>

      {stats && (
        <div className="tk-stats">
          <div className="tk-stat"><b>{stats.tickets.open}</b><span>{t('hpTkOpen')}</span></div>
          <div className="tk-stat"><b>{stats.tickets.progress}</b><span>{t('hpTkProgress')}</span></div>
          <div className="tk-stat"><b>{stats.tickets.solved}</b><span>{t('hpTkSolved')}</span></div>
          <div className="tk-stat"><b>{stats.asked}</b><span>{t('tkAsked')}</span></div>
          <div className="tk-stat"><b style={{ color: 'var(--success)' }}>{stats.helpful}</b><span>{t('tkHelpful')}</span></div>
          <div className="tk-stat"><b style={{ color: 'var(--navy-accent)' }}>{stats.kb || 0}</b><span>{t('tkKbCount')}</span></div>
        </div>
      )}

      <div className="rp-chips" style={{ marginBottom: 12 }}>
        {['open', 'progress', 'solved', 'all'].map((f) => (
          <button key={f} type="button" className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? t('cAll') : f === 'open' ? t('hpTkOpen') : f === 'progress' ? t('hpTkProgress') : t('hpTkSolved')}
          </button>
        ))}
      </div>

      {rows == null ? <div className="skeleton" style={{ height: 160 }} />
        : rows.length === 0 ? <div className="empty"><i className="fas fa-ticket" /> {t('tkNone')}</div>
          : rows.map((tk) => (
            <div className={`hp-tk-card tk-${tk.status}`} key={tk.id}>
              <div className="hp-tk-top">
                <b>{tk.subject}</b>
                <span className={`hp-badge s-${tk.status}`}>{tk.status === 'open' ? t('hpTkOpen') : tk.status === 'progress' ? t('hpTkProgress') : t('hpTkSolved')}</span>
              </div>
              <div className="hp-tk-meta">{tk.by_name} · {tk.role} · {fmtD(tk.created_at)}</div>
              {tk.detail && <p className="hp-tk-detail">{tk.detail}</p>}
              {tk.ai_answer && (
                <details className="tk-ai">
                  <summary>{t('tkAiAnswer')}</summary>
                  <div>{tk.ai_answer}</div>
                </details>
              )}
              {tk.admin_note && <div className="hp-tk-note"><i className="fas fa-reply" /> {tk.admin_note}</div>}

              {tk.status !== 'solved' && (
                <div className="tk-work">
                  <label className="hp-tf-label">{t('tkNoteLabel')}</label>
                  <input className="form-control" placeholder={t('tkNotePh')}
                    value={noteFor === tk.id ? note : (tk.admin_note || '')}
                    onFocus={() => { if (noteFor !== tk.id) { setNoteFor(tk.id); setNote(tk.admin_note || ''); } }}
                    onChange={(e) => { setNoteFor(tk.id); setNote(e.target.value); }} />
                  <div className="tk-actions">
                    {tk.status === 'open' && (
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(tk, 'progress')}>
                        <i className="fas fa-person-digging" /> {t('tkMarkProgress')}
                      </button>
                    )}
                    {tk.status === 'progress' && (
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(tk, 'progress')}>
                        <i className="fas fa-pen" /> {t('tkSaveNote')}
                      </button>
                    )}
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(tk, 'solved')}>
                      <i className="fas fa-circle-check" /> {t('tkSolve')}
                    </button>
                  </div>
                  <label className="tk-kbchk">
                    <input type="checkbox" checked={noKb} onChange={(e) => setNoKb(e.target.checked)} />
                    <span>{t('tkNoKb')}</span>
                  </label>
                </div>
              )}
            </div>
          ))}

      {/* ---- Knowledge base ---- */}
      <div className="tk-kb">
        <button type="button" className="tk-kb-h" onClick={() => setKbOpen((v) => !v)}>
          <i className={`fas fa-chevron-${kbOpen ? 'down' : 'right'}`} />
          <i className="fas fa-graduation-cap" /> {t('tkKbTitle')} <span className="tk-kb-n">{kb?.length || 0}</span>
        </button>
        {kbOpen && (
          <div className="tk-kb-body">
            <p className="field-hint" style={{ marginTop: 0 }}>{t('tkKbHint')}</p>
            <button type="button" className="chip" onClick={() => setKbEdit({ q: '', a: '', tags: '' })}><i className="fas fa-plus" /> {t('tkKbAdd')}</button>
            {kbEdit && (
              <div className="hp-ticket" style={{ marginTop: 10 }}>
                <label className="hp-tf-label">{t('tkKbQ')}</label>
                <input className="form-control" value={kbEdit.q} onChange={(e) => setKbEdit({ ...kbEdit, q: e.target.value })} maxLength={300} />
                <label className="hp-tf-label" style={{ marginTop: 8 }}>{t('tkKbA')}</label>
                <textarea className="form-control" rows={3} value={kbEdit.a} onChange={(e) => setKbEdit({ ...kbEdit, a: e.target.value })} />
                <label className="hp-tf-label" style={{ marginTop: 8 }}>{t('tkKbTags')}</label>
                <input className="form-control" placeholder="lead, import, phone" value={kbEdit.tags} onChange={(e) => setKbEdit({ ...kbEdit, tags: e.target.value })} />
                <div className="tk-actions">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveKbEntry}>{t('save')}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setKbEdit(null)}>{t('cancel')}</button>
                </div>
              </div>
            )}
            {kb == null ? <div className="skeleton" style={{ height: 80, marginTop: 8 }} />
              : kb.length === 0 ? <p className="field-hint">{t('tkKbEmpty')}</p>
                : kb.map((e) => (
                  <div className={`tk-kb-row${e.bad ? ' bad' : ''}`} key={e.id}>
                    <div>
                      <div className="tk-kb-badges">
                        {e.bad
                          ? <span className="tk-kb-b flag">{t('tkKbFlag')}</span>
                          : (e.verified || (e.source && e.source !== 'ai'))
                            ? <span className="tk-kb-b ok">{t('tkKbVerified')}</span>
                            : <span className="tk-kb-b ai">{t('tkKbAiGuess')}</span>}
                        <span className="tk-kb-b src">{e.source || 'ai'}</span>
                        {e.uses > 0 && <span className="tk-kb-b use">{e.uses}×</span>}
                      </div>
                      <b>{e.q}</b>
                      <p>{e.a}</p>
                      {(e.tags || []).length > 0 && <span className="tk-kb-tags">{e.tags.join(' · ')}</span>}
                    </div>
                    <div className="tk-kb-act">
                      {(!e.verified || e.bad) && (
                        <button type="button" className="ok" onClick={() => verifyKb(e.id, true)} aria-label="verify" title={t('tkKbApprove')}><i className="fas fa-check" /></button>
                      )}
                      {!e.bad && (
                        <button type="button" onClick={() => verifyKb(e.id, false)} aria-label="flag" title={t('tkKbReject')}><i className="fas fa-ban" /></button>
                      )}
                      <button type="button" onClick={() => setKbEdit({ id: e.id, q: e.q, a: e.a, tags: (e.tags || []).join(', ') })} aria-label="edit"><i className="fas fa-pen" /></button>
                      <button type="button" className="del" onClick={() => delKb(e.id)} aria-label="delete"><i className="fas fa-trash-can" /></button>
                    </div>
                  </div>
                ))}
          </div>
        )}
      </div>

      {stats && stats.recent.length > 0 && (
        <div className="tk-recent">
          <div className="bi-assign-h" style={{ marginTop: 18 }}>{t('tkRecentQ')}</div>
          {stats.recent.map((r, i) => (
            <div className="tk-q" key={i}>
              <span className="tk-q-fb">{r.helpful === true ? '👍' : r.helpful === false ? '👎' : r.ticket_id ? '🎫' : '·'}</span>
              <span className="tk-q-txt"><b>{r.by_name}</b> ({r.role}): {r.question}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
