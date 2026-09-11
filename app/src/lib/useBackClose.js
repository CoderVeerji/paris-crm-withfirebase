import { useEffect, useRef } from 'react';

/**
 * Jab koi sheet/modal khula ho, phone/browser ka BACK button usko band kare —
 * poori site se bahar na le jaye.
 *
 * Nested sheets (sheet ke andar sheet, jaise New Lead -> Country Picker) safe hain:
 * har instance ko apna unique id milta hai, aur woh sirf tab band hoti hai jab
 * navigation uski APNI pushed history-entry se aage nikal jaaye — na ki jab koi
 * andar wali (child) sheet apni entry consume karke band ho.
 */
export function useBackClose(open, onClose) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    window.history.pushState({ __modal: id }, '');
    const h = () => {
      // abhi bhi apni hi pushed state par khade hain -> ye kisi child sheet ka pop tha, hum nahi bandenge
      if (window.history.state && window.history.state.__modal === id) return;
      cb.current();
    };
    window.addEventListener('popstate', h);
    return () => {
      window.removeEventListener('popstate', h);
      if (window.history.state && window.history.state.__modal === id) window.history.back();
    };
  }, [open]);
}
