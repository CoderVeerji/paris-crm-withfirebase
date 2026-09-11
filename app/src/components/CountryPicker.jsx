import { useMemo, useState } from 'react';
import { COUNTRIES, flag } from '../lib/countries';
import { useBackClose } from '../lib/useBackClose';
import { useT } from '../i18n';

/** Phone country-code picker — chhota button + search sheet. value/onChange = calling code string. */
export default function CountryPicker({ value, onChange }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useBackClose(open, () => setOpen(false));

  const cur = COUNTRIES.find((c) => c.code === String(value)) || COUNTRIES[0];
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(k) || c.code.includes(k) || c.iso.toLowerCase() === k);
  }, [q]);

  return (
    <>
      <button type="button" className="cc-btn" onClick={() => { setOpen(true); setQ(''); }}>
        <span className="cc-flag">{flag(cur.iso)}</span>
        <span className="cc-code">+{cur.code}</span>
        <i className="fas fa-chevron-down" />
      </button>

      {open && (
        <div className="sheet-scrim" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="sheet-head">
              <h3>{t('ccTitle')}</h3>
              <button className="sheet-x" onClick={() => setOpen(false)}><i className="fas fa-xmark" /></button>
            </div>
            <div className="searchwrap" style={{ marginBottom: 10 }}>
              <i className="fas fa-magnifying-glass" />
              <input className="form-control" autoFocus placeholder={t('ccSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="cc-list">
              {list.map((c) => (
                <button type="button" key={c.iso + c.code} className={`cc-row ${c.code === String(value) && c.iso === cur.iso ? 'on' : ''}`}
                  onClick={() => { onChange(c.code); setOpen(false); }}>
                  <span className="cc-flag">{flag(c.iso)}</span>
                  <span className="cc-name">{c.name}</span>
                  <span className="cc-code">+{c.code}</span>
                </button>
              ))}
              {list.length === 0 && <div className="empty" style={{ padding: 24 }}>{t('noData')}</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
