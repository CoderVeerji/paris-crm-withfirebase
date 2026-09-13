// WhatsApp quick-message — jab humara koi user (LDR/Sales) kisi lead ko WhatsApp pe
// message karta hai, wa.me link ke saath ek pehle-se-likha intro message bhi khul jaaye
// (customer ko turant pata chal jaaye kaun hai, kahan se hai). Admin `config/settings`
// ke "WhatsApp message template" (Settings screen) mein ise customize kar sakta hai —
// {name} {user} {company} placeholders. Template khaali ho to DEFAULT use hota hai.
// Bold/highlight sirf WhatsApp ka apna markdown hai (*text*) — koi font-size control nahi hota
// wa.me text mein, isliye jo hissa "bada dikhna" chahiye wahi *is tarah* likha hai.
const DEFAULT_WA_TEMPLATE = 'Hi *{name}*! 👋\nThis is *{user}* from *{company}*.\nThanks for your enquiry — how can I help you today?';

export function buildWaMessage(tpl, { name, user, company }) {
  const t = (tpl && tpl.trim()) || DEFAULT_WA_TEMPLATE;
  return t
    .replaceAll('{name}', name || 'there')
    .replaceAll('{user}', user || '')
    .replaceAll('{company}', company || '');
}

/** @returns wa.me link with the pre-filled message (or bare link if phoneDigits missing) */
export function waLink(phoneDigits, tpl, vars) {
  if (!phoneDigits) return '';
  const msg = buildWaMessage(tpl, vars);
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
}
