import { useBackClose } from '../lib/useBackClose';

/** Standard bottom-sheet / modal — grip + title + close (X). Back button bhi band karta hai.
 * `guardClose` (optional): true/false lautao — false hone par close cancel ho jaata hai
 * (e.g. window.confirm se "unsaved changes?" poochna). Scrim-click, X, aur back-button teeno isse guard hote hain. */
export default function Sheet({ title, subtitle, onClose, children, wide, guardClose }) {
  const handleClose = () => {
    if (guardClose && !guardClose()) return;
    onClose();
  };
  useBackClose(true, handleClose);
  return (
    <div className="sheet-scrim" onClick={handleClose}>
      <div className={`sheet ${wide ? 'sheet-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="sheet-sub">{subtitle}</p>}
          </div>
          <button className="sheet-x" onClick={handleClose} aria-label="Close"><i className="fas fa-xmark" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
