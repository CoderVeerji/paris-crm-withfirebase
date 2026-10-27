// Voice: mic dabao, bolo — text remark/sawaal mein aata hai (browser ki free Speech API, koi server/AI nahi). Mic chalu / awaaz mil rahi hai / pause dikhta hai;
// Pause / Complete dono hain. Saath mein (compact=false): bole hue text se "Next call kab" aur form ke options ka SUGGESTION — "Lagao" dabane par hi bharta hai.
import { useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { toast } from '../toast';
import { parseFollowup, toLocalInput, matchFormAnswers } from '../lib/voiceParse';
import { useVoiceSession, voiceSupported, readVoiceLang, saveVoiceLang } from '../lib/useVoiceSession';
import VoiceStatus from './VoiceStatus';

export { voiceSupported };

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
  const [lang, setLang] = useState(() => readVoiceLang(appLang));
  const baseRef = useRef('');
  const valueRef = useRef(value);
  valueRef.current = value;
  const join = (a, b) => (a ? `${a.replace(/\s+$/, '')} ${b}` : b).trim();

  const v = useVoiceSession({
    lang,
    onUpdate: (txt) => onChange(join(baseRef.current, txt)),
    onComplete: (txt) => onChange(join(baseRef.current, txt)),
    onError: (c) => toast(c === 'denied' ? t('vaDenied') : c === 'nospeech' ? t('vaNoSpeech') : t('vaFail'), 'err'),
  });
  const active = v.state !== 'idle';

  function begin() { baseRef.current = valueRef.current || ''; v.start(); }
  function flipLang() { const n = lang === 'hi-IN' ? 'en-IN' : 'hi-IN'; setLang(n); saveVoiceLang(n); }

  // suggestions (sirf jab mic band ho) — bole YA likhe hue remark se
  const sugg = useMemo(() => {
    if (compact || active) return { date: null, ans: [] };
    const d = needsDate ? parseFollowup(value) : null;
    const dStr = d ? toLocalInput(d) : '';
    const date = d && dStr !== nextDt ? { d, v: dStr } : null;
    const m = matchFormAnswers(value, formFields, splitList);
    const ans = Object.entries(m).filter(([l, val]) => String(answers[l] || '') !== val).map(([l, val]) => ({ l, v: val }));
    return { date, ans };
  }, [value, active, compact, needsDate, nextDt, formFields, splitList, answers]);

  if (!voiceSupported()) return null; // Firefox / kuch iPhone browsers — mic hi nahi dikhate

  return (
    <div className={`va ${compact ? 'va-compact' : ''}`}>
      {!active && (
        <button type="button" className="va-mic" onClick={begin} aria-label={t('vaSpeak')} title={t('vaSpeak')}>
          <i className="fas fa-microphone" />{!compact && <span>{t('vaSpeak')}</span>}
        </button>
      )}
      {!active && !compact && (
        <button type="button" className="va-lang" onClick={flipLang} title={t('vaLangTip')} aria-label={t('vaLangTip')}>{lang === 'hi-IN' ? 'हि' : 'EN'}</button>
      )}
      {active && <div className="va-status"><VoiceStatus v={v} showText={false} /></div>}
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
