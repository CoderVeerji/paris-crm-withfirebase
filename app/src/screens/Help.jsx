import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useConfig } from '../config';
import { useT } from '../i18n';
import { toast } from '../toast';
import { GUIDE, gt } from '../lib/helpGuide';
import { askAI, sendHelpFeedback, raiseTicket, myTickets } from '../lib/help';
import InstallAppButton from '../components/InstallAppButton';

const TK_LABEL = (t, s) => t(s === 'open' ? 'hpTkOpen' : s === 'progress' ? 'hpTkProgress' : 'hpTkSolved');
const fmtD = (ts) => { const d = ts?.toDate?.(); return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };

function md(line) {
  return line.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**')
    ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
}
const Bubbles = ({ text }) => text.split('\n').map((l, i) => <p key={i}>{md(l)}</p>);

export default function Help() {
  const { user, role } = useAuth();
  const cfg = useConfig();
  const { t, lang } = useT();
  const [tab, setTab] = useState('guide');
  const aiReady = !!cfg.settings?.ai_ready;

  const topics = useMemo(
    () => GUIDE.filter((g) => g.roles.includes('all') || g.roles.includes(role)),
    [role],
  );
  const [openT, setOpenT] = useState(null);

  // ---- Ask AI (chat) ----
  const [msgs, setMsgs] = useState([]); // { role:'user'|'assistant', content, status? }
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [tkSubject, setTkSubject] = useState('');
  const [tkDetail, setTkDetail] = useState('');
  const [tkBusy, setTkBusy] = useState(false);
  const [ticketDone, setTicketDone] = useState(false);
  const [rated, setRated] = useState(false);
  const lastQid = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs, asking]);

  const newChat = () => { setMsgs([]); setInput(''); setShowTicket(false); setTicketDone(false); setRated(false); lastQid.current = null; };

  async function send() {
    const question = input.trim();
    if (!question || asking) return;
    const history = msgs.filter((m) => !m.status || m.status === 'ok');
    setMsgs((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', status: 'thinking' }]);
    setInput(''); setAsking(true); setRated(false); setShowTicket(false);
    try {
      const r = await askAI({ question, history }, user);
      lastQid.current = r.id;
      setMsgs((m) => { const n = [...m]; n[n.length - 1] = { role: 'assistant', content: r.answer, status: r.status === 'error' ? 'error' : 'ok' }; return n; });
      if (r.status === 'error') prepTicket(question);
    } catch (e) {
      console.error(e);
      setMsgs((m) => { const n = [...m]; n[n.length - 1] = { role: 'assistant', content: t('hpAiFail'), status: 'error' }; return n; });
      prepTicket(question);
    } finally { setAsking(false); }
  }

  function prepTicket(question) {
    const qtext = question || msgs.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
    setTkSubject(qtext.slice(0, 90));
    const convo = msgs.concat(question ? [{ role: 'user', content: question }] : [])
      .filter((m) => !m.status || m.status === 'ok' || m.status === 'error')
      .map((m) => (m.role === 'user' ? 'Q: ' : 'AI: ') + m.content).join('\n\n');
    setTkDetail(convo || qtext);
    setShowTicket(true);
  }

  function rate(helpful) {
    if (lastQid.current) sendHelpFeedback(lastQid.current, helpful, '').catch(() => {});
    setRated(true);
    if (helpful) toast(t('hpThanks'));
    else prepTicket(null);
  }

  async function submitTicket() {
    if (!tkDetail.trim()) return;
    setTkBusy(true);
    try {
      await raiseTicket({ queryId: lastQid.current, subject: tkSubject, detail: tkDetail, aiAnswer: msgs.filter((m) => m.role === 'assistant').slice(-1)[0]?.content }, user);
      toast(t('hpTkRaised'));
      setShowTicket(false); setTicketDone(true);
      setTab('mytickets'); setTickets(null); loadTickets();
    } catch (e) { console.error(e); toast(t('hpTkFail'), 'err'); }
    finally { setTkBusy(false); }
  }

  // ---- My tickets ----
  const [tickets, setTickets] = useState(null);
  const loadTickets = () => myTickets(user.id).then(setTickets).catch(() => setTickets([]));
  useEffect(() => { if (tab === 'mytickets' && tickets == null) loadTickets(); /* eslint-disable-next-line */ }, [tab]);

  const lastMsg = msgs[msgs.length - 1];
  const canRate = aiReady && lastMsg && lastMsg.role === 'assistant' && lastMsg.status === 'ok' && !rated && !showTicket;

  return (
    <div className="section hp">
      <div className="ls-tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'guide' ? 'on' : ''} onClick={() => setTab('guide')}><i className="fas fa-book-open" /> {t('hpGuide')}</button>
        <button className={tab === 'ask' ? 'on' : ''} onClick={() => setTab('ask')}><i className="fas fa-headset" /> {t('hpAsk')}</button>
        <button className={tab === 'mytickets' ? 'on' : ''} onClick={() => setTab('mytickets')}><i className="fas fa-ticket" /> {t('hpMyTickets')}</button>
      </div>

      {tab === 'guide' && (
        <div className="hp-guide">
          <InstallAppButton variant="card" />
          <p className="bld-intro">{t('hpGuideIntro')}</p>
          {topics.map((g) => (
            <div className={`hp-topic ${openT === g.id ? 'open' : ''}`} key={g.id}>
              <button type="button" className="hp-topic-h" onClick={() => setOpenT(openT === g.id ? null : g.id)}>
                <i className={`fas ${g.icon}`} />
                <span>{gt(g.q, lang)}</span>
                <i className={`fas fa-chevron-${openT === g.id ? 'up' : 'down'} hp-caret`} />
              </button>
              {openT === g.id && <div className="hp-topic-b">{gt(g.a, lang).split('\n').map((line, i) => <p key={i}>{md(line)}</p>)}</div>}
            </div>
          ))}
        </div>
      )}

      {tab === 'ask' && (
        <div className="hp-chat">
          {!aiReady ? (
            <>
              <div className="alert alert-info">{t('hpAiOff')}</div>
              {!ticketDone ? (
                <>
                  <label className="hp-tf-label">{t('hpTkSubject')}</label>
                  <input className="form-control" placeholder={t('hpAskPh')} value={tkSubject}
                    onChange={(e) => { setTkSubject(e.target.value); setTkDetail(e.target.value); }} maxLength={160} />
                  <label className="hp-tf-label" style={{ marginTop: 10 }}>{t('hpTkDetail')}</label>
                  <textarea className="form-control" rows={3} value={tkDetail} onChange={(e) => setTkDetail(e.target.value)} />
                  <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={tkBusy || !tkDetail.trim()} onClick={submitTicket}>
                    <i className="fas fa-paper-plane" /> {tkBusy ? t('wait') : t('hpTkSubmit')}
                  </button>
                </>
              ) : <div className="hp-fb-done"><i className="fas fa-circle-check" /> {t('hpTkRaised')}</div>}
            </>
          ) : (
            <>
              <div className="hp-chat-head">
                <span><i className="fas fa-headset" /> {t('hpAgentName')}</span>
                {msgs.length > 0 && <button type="button" className="chip" onClick={newChat}><i className="fas fa-rotate-left" /> {t('hpNewChat')}</button>}
              </div>

              <div className="hp-chat-body">
                {msgs.length === 0 && (
                  <div className="hp-msg bot"><div className="hp-b"><Bubbles text={t('hpGreeting')} /></div></div>
                )}
                {msgs.map((m, i) => (
                  <div className={`hp-msg ${m.role === 'user' ? 'me' : 'bot'}`} key={i}>
                    <div className={`hp-b ${m.status === 'error' ? 'err' : ''}`}>
                      {m.status === 'thinking'
                        ? <span className="hp-typing"><i /><i /><i /></span>
                        : <Bubbles text={m.content} />}
                    </div>
                  </div>
                ))}
                <div ref={scrollRef} />
              </div>

              {canRate && (
                <div className="hp-fb">
                  <span>{t('hpHelped')}</span>
                  <button type="button" className="chip" onClick={() => rate(true)}><i className="fas fa-thumbs-up" /> {t('yes')}</button>
                  <button type="button" className="chip" onClick={() => rate(false)}><i className="fas fa-thumbs-down" /> {t('hpNoTicket')}</button>
                </div>
              )}
              {rated && !showTicket && <div className="hp-fb-done"><i className="fas fa-circle-check" /> {t('hpThanks')}</div>}
              {ticketDone && <div className="hp-fb-done"><i className="fas fa-circle-check" /> {t('hpTkRaised')}</div>}

              {showTicket && !ticketDone && (
                <div className="hp-ticket">
                  <div className="hp-answer-h"><i className="fas fa-ticket" /> {t('hpRaiseTicket')}</div>
                  <p className="field-hint" style={{ marginTop: 0 }}>{t('hpRaiseHint')}</p>
                  <label className="hp-tf-label">{t('hpTkSubject')}</label>
                  <input className="form-control" value={tkSubject} onChange={(e) => setTkSubject(e.target.value)} maxLength={160} />
                  <label className="hp-tf-label" style={{ marginTop: 10 }}>{t('hpTkDetail')}</label>
                  <textarea className="form-control" rows={4} value={tkDetail} onChange={(e) => setTkDetail(e.target.value)} />
                  <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={tkBusy || !tkDetail.trim()} onClick={submitTicket}>
                    <i className="fas fa-paper-plane" /> {tkBusy ? t('wait') : t('hpTkSubmit')}
                  </button>
                </div>
              )}

              {!showTicket && !ticketDone && (
                <form className="hp-chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
                  <input className="form-control" placeholder={t('hpAskPh')} value={input}
                    onChange={(e) => setInput(e.target.value)} disabled={asking} />
                  <button type="submit" className="btn btn-primary" disabled={asking || !input.trim()} aria-label="send">
                    <i className={`fas ${asking ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`} />
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'mytickets' && (
        <div className="hp-mytk">
          <div className="lm-top" style={{ marginBottom: 10 }}>
            <span className="lm-live" style={{ color: 'var(--muted)' }}>{t('hpMyTicketsIntro')}</span>
            <button type="button" className="chip" onClick={() => { setTickets(null); loadTickets(); }}><i className="fas fa-rotate" /> {t('lmRefresh')}</button>
          </div>
          {tickets == null ? <div className="skeleton" style={{ height: 120 }} />
            : tickets.length === 0 ? <div className="empty"><i className="fas fa-ticket" /> {t('hpNoTickets')}</div>
              : tickets.map((tk) => (
                <div className={`hp-tk-card tk-${tk.status}`} key={tk.id}>
                  <div className="hp-tk-top">
                    <b>{tk.subject}</b>
                    <span className={`hp-badge s-${tk.status}`}>{TK_LABEL(t, tk.status)}</span>
                  </div>
                  <div className="hp-tk-meta">{fmtD(tk.created_at)}</div>
                  {tk.detail && <p className="hp-tk-detail">{tk.detail}</p>}
                  {tk.admin_note && (
                    <div className="hp-tk-note"><i className="fas fa-reply" /> <b>{t('hpAdminReply')}:</b> {tk.admin_note}</div>
                  )}
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
