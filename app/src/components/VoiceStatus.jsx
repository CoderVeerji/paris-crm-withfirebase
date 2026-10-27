// Voice session ka saaf UI: mic chalu / awaaz mil rahi hai (bars) / pause / complete + live text. VoiceQuick aur VoiceAssist dono isi ko use karte hain.
import { useT } from '../i18n';
import { SILENCE_MS } from '../lib/useVoiceSession';

export default function VoiceStatus({ v, showText = true }) {
  const { t } = useT();
  if (v.state === 'idle') return null;
  const msg = { wait: t('vsWait'), hearing: t('vsHearing'), quiet: t('vsQuiet'), paused: t('vsPaused') }[v.state];
  return (
    <div className={`vs vs-${v.state}`} role="status" aria-live="polite">
      <div className="vs-top">
        <span className="vs-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <b className="vs-msg">{msg}</b>
        {v.state === 'quiet' && <span className="vs-timer" style={{ animationDuration: `${SILENCE_MS}ms` }} aria-hidden="true" />}
      </div>
      {showText && v.text && <p className="vs-text">“{v.text}”</p>}
      <div className="vs-btns">
        {v.state === 'paused'
          ? <button type="button" className="btn btn-ghost" onClick={v.resume}><i className="fas fa-microphone" /> {t('vsResume')}</button>
          : <button type="button" className="btn btn-ghost" onClick={v.pause}><i className="fas fa-pause" /> {t('vsPause')}</button>}
        <button type="button" className="btn btn-primary" onClick={v.complete} disabled={!v.text}><i className="fas fa-check" /> {t('vsComplete')}</button>
        <button type="button" className="btn btn-ghost vs-x" onClick={v.cancel} aria-label={t('vsCancel')}><i className="fas fa-xmark" /></button>
      </div>
    </div>
  );
}
