// Ek-tap voice update: "Bolkar update karo" dabao, bolo ("hot lead, kal shaam 4 baje call karna"). Mic chalu / awaaz mil rahi hai / pause dikhta hai;
// chup hone par ya "Complete" dabane par poora text onFinal(text) ko jaata hai — LeadSheet use khud bhar ke 3 second ke countdown ke baad save karta hai.
import { useT } from '../i18n';
import { toast } from '../toast';
import { useVoiceSession, voiceSupported, readVoiceLang } from '../lib/useVoiceSession';
import VoiceStatus from './VoiceStatus';

export default function VoiceQuick({ onFinal, disabled }) {
  const { t, lang: appLang } = useT();
  const v = useVoiceSession({
    lang: readVoiceLang(appLang),
    onComplete: onFinal,
    onError: (c) => toast(c === 'denied' ? t('vaDenied') : c === 'nospeech' ? t('vaNoSpeech') : t('vaFail'), 'err'),
  });
  if (!voiceSupported()) return null;
  const active = v.state !== 'idle';
  return (
    <div className="vq">
      {!active && (
        <>
          <button type="button" className="vq-btn" disabled={disabled} onClick={v.start}>
            <i className="fas fa-microphone" /><span>{t('vqBtn')}</span>
          </button>
          <p className="vq-hint">{t('vqHint')}</p>
        </>
      )}
      <VoiceStatus v={v} />
    </div>
  );
}
