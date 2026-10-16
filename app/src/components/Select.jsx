// Drop-in replacement for native <select> — wahi <option>/<optgroup> children, wahi value/onChange(e.target.value).
// Kyun: native dropdown popup browser ka hota hai — page re-render hone par (ya options badalne par) achanak band ho jaata tha,
// aur lambi list (users / states) mein search nahi tha. Ye apna popover hai: stable, searchable (8+ options par), keyboard-friendly,
// aur phone par bottom-sheet ban jaata hai.
import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackClose } from '../lib/useBackClose';
import { useT } from '../i18n';

const SEARCH_MIN = 8; // itne ya zyada options par search box
const textOf = (n) => Children.toArray(n).filter((x) => typeof x === 'string' || typeof x === 'number').join('');

function parse(children) {
  const groups = []; // [{ label, items:[{value,label,disabled}] }]
  const cur = (label) => {
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) { g = { label, items: [] }; groups.push(g); }
    return g;
  };
  const item = (o) => ({ value: String(o.props.value ?? textOf(o.props.children)), label: textOf(o.props.children), disabled: !!o.props.disabled });
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === 'optgroup') {
      Children.forEach(c.props.children, (o) => { if (isValidElement(o)) cur(c.props.label || '').items.push(item(o)); });
    } else if (c.type === 'option') {
      cur('').items.push(item(c));
    }
  });
  return groups;
}

export default function Select({ value, defaultValue, onChange, children, className = '', style, disabled, id, 'aria-label': ariaLabel }) {
  const { t } = useT();
  const [inner, setInner] = useState(defaultValue ?? '');
  const controlled = value !== undefined;
  const cur = String(controlled ? value ?? '' : inner);
  const groups = parse(children);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = flat.find((o) => o.value === cur);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState(null);
  const [narrow, setNarrow] = useState(false);
  const btn = useRef(null); const panel = useRef(null); const listRef = useRef(null);
  const searchable = flat.length >= SEARCH_MIN;
  const close = useCallback(() => setOpen(false), []);
  useBackClose(open && narrow, close);

  const k = q.trim().toLowerCase();
  const shown = k
    ? groups.map((g) => ({ ...g, items: g.items.filter((o) => o.label.toLowerCase().includes(k)) })).filter((g) => g.items.length)
    : groups;
  const shownFlat = shown.flatMap((g) => g.items.filter((o) => !o.disabled));

  const place = useCallback(() => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const isNarrow = window.innerWidth <= 600;
    setNarrow(isNarrow);
    if (isNarrow) { setPos(null); return; }
    const maxH = 320; const below = window.innerHeight - r.bottom - 12; const above = r.top - 12;
    const up = below < 220 && above > below;
    const width = Math.max(r.width, 240);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width,
      ...(up ? { bottom: window.innerHeight - r.top + 6, maxH: Math.min(maxH, above) } : { top: r.bottom + 6, maxH: Math.min(maxH, below) }),
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (panel.current?.contains(e.target) || btn.current?.contains(e.target)) return; close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.current?.focus(); } };
    const onMove = (e) => { if (window.innerWidth > 600 && !(e.target && panel.current?.contains(e.target))) place(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, place]);

  // khulte hi chuni hui value par scroll, aur highlight wahi
  useEffect(() => {
    if (!open) return;
    const i = shownFlat.findIndex((o) => o.value === cur);
    setHi(i >= 0 ? i : 0);
    requestAnimationFrame(() => listRef.current?.querySelector('.ss-opt.on')?.scrollIntoView({ block: 'nearest' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { if (open) listRef.current?.querySelector('.ss-opt.hi')?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);

  function pick(v) {
    if (!controlled) setInner(v);
    onChange?.({ target: { value: v }, currentTarget: { value: v } });
    close();
    btn.current?.focus();
  }
  function onSearchKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shownFlat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (shownFlat[hi]) pick(shownFlat[hi].value); }
  }

  const placeholderOpt = flat.find((o) => o.value === '');
  const label = selected ? selected.label : (cur || placeholderOpt?.label || '');
  const isPlaceholder = !selected || selected.value === '';

  const list = (
    <div className="ss-list" ref={listRef} role="listbox">
      {shown.map((g, gi) => (
        <div key={gi}>
          {g.label && <div className="ss-group">{g.label}</div>}
          {g.items.map((o) => {
            const idx = shownFlat.indexOf(o);
            return (
              <button type="button" role="option" aria-selected={o.value === cur} key={o.value + o.label} disabled={o.disabled}
                className={`ss-opt ${o.value === cur ? 'on' : ''} ${idx === hi ? 'hi' : ''}`}
                onMouseEnter={() => idx >= 0 && setHi(idx)} onClick={() => pick(o.value)}>
                <span>{o.label || '—'}</span>{o.value === cur && <i className="fas fa-check" />}
              </button>
            );
          })}
        </div>
      ))}
      {shownFlat.length === 0 && <div className="ss-empty">{t('noData')}</div>}
    </div>
  );
  const search = searchable && (
    <div className="ss-search">
      <i className="fas fa-magnifying-glass" />
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder={t('ccSearch')} />
    </div>
  );

  // wrapper `display: contents` — button hi layout/spacing ka element hai (native <select> jaisa): className + style seedha button par
  return (
    <div className="ss">
      <button type="button" id={id} ref={btn} className={`form-control ${className.replace(/form-control/, '').trim()} ss-btn ${isPlaceholder ? 'ph' : ''}`} style={style} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => { setQ(''); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setQ(''); setOpen(true); } }}>
        <span className="ss-val">{label || '—'}</span><i className="fas fa-chevron-down" />
      </button>
      {open && createPortal(
        narrow ? (
          <div className="sheet-scrim ss-scrim" onClick={close}>
            <div className="sheet ss-sheet" ref={panel} onClick={(e) => e.stopPropagation()}>
              <div className="sheet-grip" />
              {search}{list}
            </div>
          </div>
        ) : (
          <div className="ss-panel" ref={panel}
            style={pos ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, '--ss-max': `${pos.maxH}px` } : { visibility: 'hidden' }}>
            {search}{list}
          </div>
        ),
        document.body,
      )}
    </div>
  );
}
