// Ek-tap voice update: mic dabao, bolo ("hot lead, kal shaam 4 baje call karna") — poora text onFinal(text) ko milta hai.
// LeadSheet use khud stage / date / remark / form bhar ke 3 second ke countdown ke baad save karta hai (beech mein "Rok").
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { toast } from '../toast';
import { voiceSupported } from './VoiceAssist';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const LANG_KEY = 'pc_voice_lang';
const readLang = (appLang) => { try { const v = localStorage.getItem(LANG_KEY); if (v) return v; } catch { /* ignore */ } return appLang === 'en' ? 'en-IN' : 'hi-IN'; };

export default function VoiceQuick({ onFinal, disabled }) {
  const { t, lang: appLang } = useT();
  const [on, setOn] = useState(false);
  const [live, setLive] = useState('');
  const recRef = useRef(null);
  const finalRef = useRef('');

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* ignore */ } }, []);
  if (!voiceSupported() || !SR) return null;

  function start() {
    const rec = new SR();
    rec.lang = readLang(appLang); rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    finalRef.current = ''; setLive('');
    rec.onresult = (e) => {
      let fin = ''; let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; const txt = r[0]?.transcript || '';
        if (r.isFinal) fin += txt; else interim += txt;
      }
      if (fin) finalRef.current = `${finalRef.current} ${fin}`.trim();
      setLive((interim || finalRef.current).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast(t('vaDenied'), 'err');
      else if (e.error === 'no-speech') toast(t('vaNoSpeech'), 'err');
      else if (e.error !== 'aborted') toast(t('vaFail'), 'err');
    };
    rec.onend = () => {
      setOn(false); recRef.current = null;
      const txt = finalRef.current.trim();
      setLive('');
      if (txt) onFinal(txt);
    };
    try { rec.start(); recRef.current = rec; setOn(true); } catch { setOn(false); }
  }
  function stop() { try { recRef.current?.stop(); } catch { /* ignore */ } }

  return (
    <div className="vq">
      <button type="button" className={`vq-btn ${on ? 'on' : ''}`} disabled={disabled} onClick={on ? stop : start} aria-pressed={on}>
        <i className={`fas ${on ? 'fa-stop' : 'fa-microphone'}`} />
        <span>{on ? t('vqListening') : t('vqBtn')}</span>
      </button>
      {on && live && <p className="vq-live">“{live}”</p>}
      {!on && <p className="vq-hint">{t('vqHint')}</p>}
    </div>
  );
}
