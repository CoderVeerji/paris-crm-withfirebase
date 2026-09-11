import { useState } from 'react';
import { signInWithEmailAndPassword, updatePassword, signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuth } from '../auth';
import { useT, LANGS } from '../i18n';

const MSG = {
  'auth/invalid-credential': { en: 'Wrong email or password.', hi: 'ईमेल या पासवर्ड ग़लत है।', hinglish: 'Email ya password galat hai.' },
  'auth/invalid-email': { en: 'Email is not valid.', hi: 'ईमेल सही नहीं है।', hinglish: 'Email theek nahi hai.' },
  'auth/user-disabled': { en: 'This account is disabled. Contact admin.', hi: 'यह अकाउंट बंद है। एडमिन से बात करें।', hinglish: 'Ye account band hai. Admin se baat karein.' },
  'auth/too-many-requests': { en: 'Too many attempts. Try again later.', hi: 'बहुत बार कोशिश हुई। बाद में करें।', hinglish: 'Bahut baar try hua. Baad me karein.' },
  'auth/network-request-failed': { en: 'No internet. Check connection.', hi: 'इंटरनेट नहीं है।', hinglish: 'Internet nahi mil raha.' },
};

export default function Login() {
  const { fbUser, user } = useAuth();
  const { t, lang, setLang } = useT();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [np1, setNp1] = useState('');
  const [np2, setNp2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const mustReset = fbUser && user && user.must_reset_password;
  const em = (code, fb) => (MSG[code] && (MSG[code][lang] || MSG[code].en)) || fb;

  async function doLogin(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass);
    } catch (e2) {
      setErr(em(e2.code, 'Login failed. Try again.'));
    } finally { setBusy(false); }
  }

  async function doReset(e) {
    e.preventDefault();
    setErr('');
    if (np1.length < 6) return setErr(t('pwShort'));
    if (np1 !== np2) return setErr(t('pwMismatch'));
    setBusy(true);
    try {
      await updatePassword(auth.currentUser, np1);
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { must_reset_password: false });
    } catch (e2) {
      if (e2.code === 'auth/requires-recent-login') { setErr(t('firstLogin')); await signOut(auth); }
      else setErr(em(e2.code, 'Could not set password.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-logo"><i className="fas fa-gem" /></div>
        <h1>{t('appName')}</h1>
        <p className="sub">{mustReset ? t('resetSub') : t('loginSub')}</p>

        {err && <div className="alert alert-error">{err}</div>}

        {!mustReset ? (
          <form onSubmit={doLogin}>
            <div className="form-group">
              <label>{t('email')}</label>
              <input className="form-control" type="email" autoComplete="username" inputMode="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aap@example.com" />
            </div>
            <div className="form-group">
              <label>{t('password')}</label>
              <input className="form-control" type="password" autoComplete="current-password" required
                value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t('wait') : t('login')}</button>
          </form>
        ) : (
          <form onSubmit={doReset}>
            <div className="alert alert-info">{t('firstLogin')}</div>
            <div className="form-group">
              <label>{t('newPassword')}</label>
              <input className="form-control" type="password" autoComplete="new-password" required
                value={np1} onChange={(e) => setNp1(e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('confirmPassword')}</label>
              <input className="form-control" type="password" autoComplete="new-password" required
                value={np2} onChange={(e) => setNp2(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t('wait') : t('setPassword')}</button>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => signOut(auth)}>
              {t('cancel')}
            </button>
          </form>
        )}

        <div className="lang-row">
          {LANGS.map((l) => (
            <button key={l.code} className={lang === l.code ? 'active' : ''} onClick={() => setLang(l.code)}>{l.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
