import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';
import { toast } from '../toast';
import { useBackClose } from '../lib/useBackClose';
import { useInstallPrompt } from '../lib/pwa';

/**
 * "App ki tarah install karo" button.
 *   variant='sidebar' -> chhota full-width button (sidebar footer ke liye)
 *   variant='card'     -> Help/Settings screen ka bada card
 * Installed (standalone) ho to kuch render nahi hota.
 */
export default function InstallAppButton({ variant = 'card' }) {
  const { t } = useT();
  const { installed, canPrompt, ios, promptInstall } = useInstallPrompt();
  const [howto, setHowto] = useState(false);

  if (installed) return null;

  async function onClick() {
    if (canPrompt) {
      const r = await promptInstall();
      if (r === 'accepted') toast(t('pwaInstalled'));
      else if (r === 'unavailable') setHowto(true);
      return;
    }
    setHowto(true); // iOS ya jis browser me native prompt nahi
  }

  const btn = variant === 'sidebar'
    ? (
      <button type="button" className="sidebar-install" onClick={onClick}>
        <i className="fas fa-circle-down" /> {t('pwaInstall')}
      </button>
    )
    : (
      <div className="install-card">
        <div className="install-card-ic"><i className="fas fa-mobile-screen-button" /></div>
        <div className="install-card-body">
          <b>{t('pwaCardTitle')}</b>
          <p>{t('pwaCardHint')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onClick}>
          <i className="fas fa-circle-down" /> {t('pwaInstall')}
        </button>
      </div>
    );

  return (
    <>
      {btn}
      {howto && createPortal(<HowtoSheet ios={ios} onClose={() => setHowto(false)} t={t} />, document.body)}
    </>
  );
}

function HowtoSheet({ ios, onClose, t }) {
  useBackClose(true, onClose);
  const steps = ios
    ? [t('pwaIos1'), t('pwaIos2'), t('pwaIos3')]
    : [t('pwaAnd1'), t('pwaAnd2'), t('pwaAnd3')];
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h3><i className="fas fa-mobile-screen-button" /> {t('pwaCardTitle')}</h3>
          <button className="sheet-x" onClick={onClose}><i className="fas fa-xmark" /></button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>{t('pwaHowtoIntro')}</p>
        <ol className="install-steps">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      </div>
    </div>
  );
}
