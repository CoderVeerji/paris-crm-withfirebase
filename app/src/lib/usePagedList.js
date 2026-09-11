import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Firestore cursor-pagination ko "Page 1 / 2 / 3" jaisा UI mein badalता hai.
 * `fetchPage({ cursor }) => { rows, cursor, done }` — jo shape `fetchLeadsPage`/`fetchActivityFeed`/
 * `fetchAudit` already return karte hain, unhi ko seedha yahan pass kar do, koi lib change nahi chahiye.
 *
 * Aage ke liye reusable: koi bhi naya paged screen isi hook + <Pager/> se ban sakta hai.
 *
 * @param fetchPage  (opts:{cursor}) => Promise<{rows, cursor, done}>
 * @param deps       jab ye badlein (search/filter/date-range), page 0 par reset ho jaata hai
 */
export function usePagedList(fetchPage, deps = []) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasNext, setHasNext] = useState(false);
  const [err, setErr] = useState(null);
  const cache = useRef([]); // cache[i] = { rows, cursor, done } — visited pages dobara fetch nahi hote
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const seq = useRef(0); // stale-response guard (fast page-flip ya deps-change ke beech)

  const load = useCallback(async (p) => {
    const mySeq = ++seq.current;
    setLoading(true); setErr(null);
    try {
      if (cache.current[p]) {
        const c = cache.current[p];
        if (mySeq !== seq.current) return;
        setRows(c.rows); setHasNext(!c.done); setLoading(false);
        return;
      }
      const cursor = p === 0 ? null : cache.current[p - 1]?.cursor || null;
      const r = await fetchRef.current({ cursor });
      if (mySeq !== seq.current) return; // ek naya request beech mein aa gaya, ye purana result chhodo
      cache.current[p] = r;
      setRows(r.rows); setHasNext(!r.done);
    } catch (e) {
      if (mySeq !== seq.current) return;
      console.error(e);
      setErr(e);
      setRows([]); setHasNext(false);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cache.current = [];
    setPage(0);
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // App background mein ja kar wapas aaye (dusri app, recents, phone lock) to "purana data hi dikh
  // raha hai jab tak refresh na karo" na lage — kam se kam 20s door rahe ho to current page dobara
  // load karo. (Tabhi zaroori hai jab andar se page chhupa tha, ek jhalak / quick switch se nahi.)
  const pageRef = useRef(page);
  pageRef.current = page;
  const hiddenAtRef = useRef(null);
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAtRef.current) {
        const away = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (away > 20000) {
          cache.current[pageRef.current] = null; // sirf current page — baaki cache waisa hi rahega
          load(pageRef.current);
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [load]);

  const goNext = () => { const p = page + 1; setPage(p); load(p); };
  const goPrev = () => { const p = Math.max(0, page - 1); setPage(p); load(p); };
  const reload = () => { cache.current = []; setPage(0); load(0); };

  return { rows, page, loading, hasNext, hasPrev: page > 0, err, goNext, goPrev, reload };
}
