// Voice session (browser Speech API) — "mic chalu", "awaaz sunai de rahi hai", "pause", "complete" ki saaf state ke saath.
// Bolna shuru -> hearing; chup hone par -> quiet (SILENCE_MS baad apne-aap complete, ya user Complete dabaye); Pause se rok ke baad mein Resume.
// Chrome kabhi beech mein recognition band kar deta hai (khaaskar phone) — session chalu ho to khud dobara shuru kar deta hai.
import { useCallback, useEffect, useRef, useState } from 'react';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const SILENCE_MS = 2500;
export const voiceSupported = () => !!(typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition));

const LANG_KEY = 'pc_voice_lang';
export const readVoiceLang = (appLang) => { try { const v = localStorage.getItem(LANG_KEY); if (v) return v; } catch { /* ignore */ } return appLang === 'en' ? 'en-IN' : 'hi-IN'; };
export const saveVoiceLang = (l) => { try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } };

/**
 * @param lang        'hi-IN' | 'en-IN'
 * @param onUpdate    (fullText) — har naye shabd par (live)
 * @param onComplete  (fullText) — Complete / auto-complete par, text khaali na ho tab
 * @param onError     (code)     — 'denied' | 'nospeech' | 'fail'
 * @returns {{ state, text, start, pause, resume, complete, cancel, silenceMs }}
 *   state: 'idle' | 'wait' (mic chalu, abhi bola nahi) | 'hearing' (awaaz mil rahi) | 'quiet' (chup — auto-complete ka countdown) | 'paused'
 */
export function useVoiceSession({ lang, onUpdate, onComplete, onError }) {
  const [state, setState] = useState('idle');
  const [text, setText] = useState('');
  const recRef = useRef(null);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const stateRef = useRef('idle');
  const stopReason = useRef('');           // 'complete' | 'pause' | 'cancel' | ''
  const silenceTimer = useRef(null);
  const retries = useRef(0);
  const cb = useRef({});
  cb.current = { onUpdate, onComplete, onError, lang };

  const set = (s) => { stateRef.current = s; setState(s); };
  const clearTimer = () => { if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; } };
  const full = () => `${finalRef.current} ${interimRef.current}`.replace(/\s+/g, ' ').trim();

  const finalize = useCallback(() => {
    clearTimer();
    const t = full();
    interimRef.current = '';
    set('idle');
    if (t) cb.current.onComplete?.(t); else cb.current.onError?.('nospeech');
    finalRef.current = ''; setText('');
  }, []);

  const spawn = useCallback(() => {
    if (!SR) return;
    const rec = new SR();
    rec.lang = cb.current.lang; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    rec.onaudiostart = () => { if (mine() && (stateRef.current === 'idle' || stateRef.current === 'paused')) set('wait'); };
    const mine = () => recRef.current === rec; // band ho chuke purane instance ke dair se aaye events ignore
    const hear = () => { if (!mine()) return; clearTimer(); if (stateRef.current !== 'paused') set('hearing'); };
    rec.onsoundstart = hear; rec.onspeechstart = hear;
    rec.onresult = (e) => {
      if (!mine()) return;
      retries.current = 0;
      let fin = ''; let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; const t = r[0]?.transcript || '';
        if (r.isFinal) fin += t; else interim += t;
      }
      if (fin) finalRef.current = `${finalRef.current} ${fin}`.replace(/\s+/g, ' ').trim();
      interimRef.current = interim.trim();
      hear();
      const all = full(); setText(all); cb.current.onUpdate?.(all);
      // engine speechend na bheje (kuch phones) to bhi: kuch der koi naya shabd na aaye -> quiet -> complete
      silenceTimer.current = setTimeout(() => { if (stateRef.current === 'hearing') { set('quiet'); silenceTimer.current = setTimeout(() => complete(), SILENCE_MS); } }, 1200);
    };
    rec.onspeechend = () => {
      if (!mine() || stateRef.current !== 'hearing' || !full()) return;
      clearTimer(); set('quiet'); silenceTimer.current = setTimeout(() => complete(), SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopReason.current = 'cancel'; cb.current.onError?.('denied'); }
      else if (e.error === 'no-speech') { /* continuous mode mein normal — onend par handle */ }
      else if (e.error !== 'aborted') { cb.current.onError?.('fail'); }
    };
    rec.onend = () => {
      if (recRef.current && recRef.current !== rec) return; // stale
      recRef.current = null;
      const why = stopReason.current; stopReason.current = '';
      if (why === 'complete') return finalize();
      if (why === 'pause') return set('paused');
      if (why === 'cancel') { clearTimer(); finalRef.current = ''; interimRef.current = ''; setText(''); return set('idle'); }
      // anayaas band hua (Chrome ne timeout kiya) — session chalu hai to dobara shuru
      if (['wait', 'hearing', 'quiet'].includes(stateRef.current) && retries.current < 6) { retries.current += 1; try { spawn(); } catch { set('idle'); } return undefined; }
      if (stateRef.current !== 'idle') return full() ? finalize() : set('idle');
      return undefined;
    };
    try { rec.start(); recRef.current = rec; } catch { set('idle'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function complete() {
    clearTimer();
    if (stateRef.current === 'idle') return;
    stopReason.current = 'complete';
    if (recRef.current) { try { recRef.current.stop(); } catch { finalize(); } } else finalize();
  }
  const start = useCallback(() => { finalRef.current = ''; interimRef.current = ''; retries.current = 0; setText(''); stopReason.current = ''; set('wait'); spawn(); }, [spawn]);
  const pause = useCallback(() => { clearTimer(); stopReason.current = 'pause'; if (recRef.current) { try { recRef.current.stop(); } catch { set('paused'); } } else set('paused'); }, []);
  const resume = useCallback(() => { retries.current = 0; stopReason.current = ''; set('wait'); spawn(); }, [spawn]);
  const cancel = useCallback(() => { clearTimer(); stopReason.current = 'cancel'; if (recRef.current) { try { recRef.current.abort(); } catch { /* ignore */ } } finalRef.current = ''; interimRef.current = ''; setText(''); set('idle'); }, []);

  useEffect(() => () => { clearTimer(); stopReason.current = 'cancel'; try { recRef.current?.abort(); } catch { /* ignore */ } }, []);

  return { state, text, start, pause, resume, complete, cancel, silenceMs: SILENCE_MS };
}
