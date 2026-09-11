// Help / Ask-AI / Tickets — data layer.
// Ask-AI: client `help_queries/{id}` doc likhta hai (status:'pending'), Cloud Function `helpAsk`
// use pick karke Anthropic API call karta hai aur `answer` + status:'done' wapas likhta hai.
// (Callable ki jagah doc-trigger — org policy allUsers-invoker block karta hai; adminTask jaisa.)
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDocs, onSnapshot,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

/** Sawaal poochho (chat). `history` = prior turns [{role:'user'|'assistant', content}].
 *  Resolve hota hai jab function jawab de deta hai (ya ~65s timeout). */
export function askAI({ question, history = [] }, user) {
  const ref = doc(collection(db, 'help_queries'));
  const base = {
    by_uid: user.id, by_name: user.full_name || '', role: user.role || '',
    question: String(question || '').trim().slice(0, 1000),
    history: (history || []).slice(-6).map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 1200) })),
    status: 'pending', answer: '', helpful: null, feedback_note: '', ticket_id: null,
    created_at: serverTimestamp(),
  };
  return setDoc(ref, base).then(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const unsub = onSnapshot(ref, (s) => {
      const d = s.data();
      if (!d || d.created_at == null) return; // local echo
      if (d.status === 'done' || d.status === 'error') {
        unsub(); clearInterval(iv);
        resolve({ id: ref.id, answer: d.answer || '', status: d.status });
      }
    }, (e) => { unsub(); clearInterval(iv); reject(e); });
    const iv = setInterval(() => {
      if (Date.now() - started > 92000) { clearInterval(iv); unsub(); reject(new Error('ai-timeout')); }
    }, 4000);
  }));
}

export const sendHelpFeedback = (queryId, helpful, note) => updateDoc(doc(db, 'help_queries', queryId), {
  helpful: !!helpful, feedback_note: String(note || '').slice(0, 500), feedback_at: serverTimestamp(),
});

export async function raiseTicket({ queryId, subject, detail, aiAnswer }, user) {
  const t = await addDoc(collection(db, 'tickets'), {
    by_uid: user.id, by_name: user.full_name || '', role: user.role || '',
    subject: String(subject || '').trim().slice(0, 160) || 'Help needed',
    detail: String(detail || '').trim().slice(0, 2000),
    from_query: queryId || null, ai_answer: String(aiAnswer || '').slice(0, 4000),
    status: 'open', admin_note: '', handled_by: '', handled_by_name: '',
    created_at: serverTimestamp(), updated_at: serverTimestamp(),
  });
  if (queryId) await updateDoc(doc(db, 'help_queries', queryId), { ticket_id: t.id }).catch(() => {});
  return t.id;
}

export async function myTickets(uid, max = 50) {
  try {
    const snap = await getDocs(query(
      collection(db, 'tickets'), where('by_uid', '==', uid), orderBy('created_at', 'desc'), limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // composite index abhi ban raha ho to bina orderBy — client-side sort
    if (e.code !== 'failed-precondition') throw e;
    const snap = await getDocs(query(collection(db, 'tickets'), where('by_uid', '==', uid), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
  }
}

export async function allTickets(status = '', max = 200) {
  const run = async (withOrder) => {
    const parts = [collection(db, 'tickets')];
    if (status) parts.push(where('status', '==', status));
    if (withOrder) parts.push(orderBy('created_at', 'desc'));
    parts.push(limit(max));
    const snap = await getDocs(query(...parts));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };
  try { return await run(true); } catch (e) {
    if (e.code !== 'failed-precondition') throw e;
    return (await run(false)).sort((a, b) => (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0));
  }
}

export const resolveTicket = (id, patch, actor) => updateDoc(doc(db, 'tickets', id), {
  ...patch, handled_by: actor.uid, handled_by_name: actor.name || '',
  updated_at: serverTimestamp(),
  ...(patch.status === 'solved' ? { solved_at: serverTimestamp() } : {}),
});

/* ---- Knowledge base (AI training) — admin only ---- */
export async function kbList(max = 200) {
  const snap = await getDocs(query(collection(db, 'help_kb'), orderBy('updated_at', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function kbSave(id, { q, a, tags }) {
  const data = {
    q: String(q || '').trim().slice(0, 300), a: String(a || '').trim().slice(0, 1500),
    tags: String(tags || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 10),
    updated_at: serverTimestamp(),
  };
  if (id) return updateDoc(doc(db, 'help_kb', id), data);
  // manually likhi entry = verified (admin ne khud daali)
  return addDoc(collection(db, 'help_kb'), {
    ...data, source: 'manual', verified: true, bad: false, uses: 0, created_at: serverTimestamp(),
  });
}
export const kbDelete = (id) => deleteDoc(doc(db, 'help_kb', id));
/** Admin: AI-cached entry ko approve karo (verified) ya galat mark karo (bad -> AI use nahi karega). */
export const kbVerify = (id, ok) => updateDoc(doc(db, 'help_kb', id), {
  verified: !!ok, bad: ok ? false : true, updated_at: serverTimestamp(),
});

/** Admin analytics — help_queries ka bounded sample + tickets counts. */
export async function helpStats() {
  const [qSnap, tOpen, tProg, tSolved, kbSnap] = await Promise.all([
    getDocs(query(collection(db, 'help_queries'), orderBy('created_at', 'desc'), limit(500))),
    getDocs(query(collection(db, 'tickets'), where('status', '==', 'open'), limit(500))),
    getDocs(query(collection(db, 'tickets'), where('status', '==', 'progress'), limit(500))),
    getDocs(query(collection(db, 'tickets'), where('status', '==', 'solved'), limit(500))),
    getDocs(query(collection(db, 'help_kb'), limit(500))).catch(() => ({ size: 0 })),
  ]);
  const qs = qSnap.docs.map((d) => d.data());
  return {
    kb: kbSnap.size,
    asked: qs.length,
    helpful: qs.filter((q) => q.helpful === true).length,
    notHelpful: qs.filter((q) => q.helpful === false).length,
    noFeedback: qs.filter((q) => q.helpful == null && q.status === 'done').length,
    errored: qs.filter((q) => q.status === 'error').length,
    tickets: { open: tOpen.size, progress: tProg.size, solved: tSolved.size },
    recent: qs.slice(0, 40).map((q) => ({
      by_name: q.by_name, role: q.role, question: q.question, helpful: q.helpful,
      status: q.status, ticket_id: q.ticket_id || null,
    })),
  };
}

/** Admin: AI provider + key + model set (config/ai_secret — sirf Cloud Function Admin SDK se padhta hai).
 *  provider: 'nvidia' (OpenAI-compatible, build.nvidia.com) | 'anthropic'. Client-side ai_ready flag
 *  config/settings mein — taaki Help screen ko pata ho ki AI on hai ya nahi. */
export async function setAiConfig({ provider, key, model }) {
  const k = String(key || '').trim();
  await setDoc(doc(db, 'config', 'ai_secret'), {
    provider: provider === 'anthropic' ? 'anthropic' : 'nvidia',
    api_key: k,
    // purane naam bhi rakhe (backward compat)
    anthropic_key: provider === 'anthropic' ? k : '',
    model: String(model || '').trim() || (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'openai/gpt-oss-20b'),
    updated_at: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(db, 'config', 'settings'), { ai_ready: !!k }, { merge: true });
}
