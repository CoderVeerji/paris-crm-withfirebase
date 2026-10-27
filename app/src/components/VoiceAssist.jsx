// Voice: mic dabao, bolo — text remark/sawaal mein aa jata hai (browser ki free Speech API, koi server/AI nahi).
// Saath mein (compact=false): bole hue text se "Next call kab" aur form ke options (jaise Customer Type) ka SUGGESTION — "Lagao" dabane par hi bharta hai.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { toast } from '../toast';
import { parseFollowup, toLocalInput, matchFormAnswers } from '../lib/voiceParse';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const voiceSupported = () => !!(typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition));

const LANG_KEY = 'pc_voice_lang';
const readLang = (appLang) => { try { const v = localStorage.getItem(LANG_KEY); if (v) return v; } catch { /* ignore */ } return appLang === 'en' ? 'en-IN' : 'hi-IN'; };

function when(d, t) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((dd - today) / 86400000);
  const day = diff === 0 ? t('tcToday') : diff === 1 ? t('vaTomorrow') : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `${day}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

export default function VoiceAssist({
  value, onChange, compact = false, needsDate = false, nextDt = '', onSetDate, formFields = [], splitList, answers = {}, onSetAnswer,
}) {
  const { t, lang: appLang } = useT();
  const [lang, setLang] = useState(() => readLang(appLang));
  const [on, setOn] = useState(false);
  const recRef = useRef(null);
  const baseRef = useRef('');
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* ignore */ } }, []);

  const join = (a, b) => (a ? `${a.replace(/\s+$/, '')} ${b}` : b).trim();

  function start() {
    if (!SR) return;
    const rec = new SR();
    rec.lang = lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    baseRef.current = valueRef.current || '';
    rec.onresult = (e) => {
      let fin = ''; let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; const txt = r[0]?.transcript || '';
        if (r.isFinal) fin += txt; else interim += txt;
      }
      if (fin) baseRef.current = join(baseRef.current, fin.trim());
      onChange(interim ? join(baseRef.current, interim.trim()) : baseRef.current);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast(t('vaDenied'), 'err');
      else if (e.error === 'no-speech') toast(t('vaNoSpeech'), 'err');
      else if (e.error !== 'aborted') toast(t('vaFail'), 'err');
    };
    rec.onend = () => { setOn(false); recRef.current = null; };
    try { rec.start(); recRef.current = rec; setOn(true); } catch { setOn(false); }
  }
  function stop() { try { recRef.current?.stop(); } catch { /* ignore */ } }
  function flipLang() {
    const n = lang === 'hi-IN' ? 'en-IN' : 'hi-IN'; setLang(n);
    try { localStorage.setItem(LANG_KEY, n); } catch { /* ignore */ }
  }

  // suggestions (sirf jab mic band ho) — bole YA likhe hue remark se
  const sugg = useMemo(() => {
    if (compact || on) return { date: null, ans: [] };
    const d = needsDate ? parseFollowup(value) : null;
    const dStr = d ? toLocalInput(d) : '';
    const date = d && dStr !== nextDt ? { d, v: dStr } : null;
    const m = matchFormAnswers(value, formFields, splitList);
    const ans = Object.entries(m).filter(([l, v]) => String(answers[l] || '') !== v).map(([l, v]) => ({ l, v }));
    return { date, ans };
  }, [value, on, compact, needsDate, nextDt, formFields, splitList, answers]);

  if (!SR) return null; // Firefox / kuch iPhone browsers — mic hi nahi dikhate

  return (
    <div className={`va ${compact ? 'va-compact' : ''}`}>
      <button type="button" className={`va-mic ${on ? 'on' : ''}`} onClick={on ? stop : start} aria-pressed={on}
        aria-label={on ? t('vaStop') : t('vaSpeak')} title={on ? t('vaStop') : t('vaSpeak')}>
        <i className={`fas ${on ? 'fa-stop' : 'fa-microphone'}`} />{!compact && <span>{on ? t('vaListening') : t('vaSpeak')}</span>}
      </button>
      {!compact && (
        <button type="button" className="va-lang" onClick={flipLang} disabled={on} title={t('vaLangTip')} aria-label={t('vaLangTip')}>
          {lang === 'hi-IN' ? 'हि' : 'EN'}
        </button>
      )}
      {(sugg.date || sugg.ans.length > 0) && (
        <div className="va-sugg">
          <small><i className="fas fa-wand-magic-sparkles" /> {t('vaSuggest')}</small>
          {sugg.date && (
            <button type="button" className="va-chip" onClick={() => onSetDate?.(sugg.date.v)}>
              <i className="fas fa-clock" /> {t('nextCallAt')}: <b>{when(sugg.date.d, t)}</b> <em>{t('vaApply')}</em>
            </button>
          )}
          {sugg.ans.map((a) => (
            <button type="button" className="va-chip" key={a.l} onClick={() => onSetAnswer?.(a.l, a.v)}>
              {a.l}: <b>{a.v}</b> <em>{t('vaApply')}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
