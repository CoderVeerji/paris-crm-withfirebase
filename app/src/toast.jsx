// Chhota toast system — "✓ Saved" jaise feedback ke liye. Kahin se bhi toast(msg) call karo.
import { useEffect, useState } from 'react';

let push = () => {};
export function toast(message, type = 'ok') { push({ id: Date.now() + Math.random(), message, type }); }

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    push = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), 2600);
    };
    return () => { push = () => {}; };
  }, []);
  return (
    <div className="toaster">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <i className={`fas ${t.type === 'err' ? 'fa-circle-exclamation' : 'fa-circle-check'}`} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
