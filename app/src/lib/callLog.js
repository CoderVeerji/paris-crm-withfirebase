// "Call" dabane ke baad, call khatam karke app mein wapas aate hi usi lead ka action-sheet
// khud khul jaaye (Runo jaisa "log this call" flow) — bina extra tap ke, list mein dhoondhna nahi padega.
const KEY = 'crm_pending_call';

export function markCalling(leadId) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ id: leadId, at: Date.now() })); } catch { /* ignore */ }
}

/** App visible hote hi ek baar check karo — pending call ho, na bahut jaldi (galti se tap) na bahut purani (stale) ho, tabhi return karo. */
export function takePendingCall() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const data = JSON.parse(raw);
    const age = Date.now() - data.at;
    if (age < 3000 || age > 10 * 60 * 1000) return null;
    return data.id;
  } catch { return null; }
}
