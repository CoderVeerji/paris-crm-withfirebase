import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth';
import { useT, fill } from '../i18n';
import { fmtMoney } from '../lib/format';
import { toast } from '../toast';
import { friendlyError } from '../lib/errmsg';
import { listWeekly, runWeekly } from '../lib/stats';
import { weekOptions, weekId, weekLabel, reportLabel, latestCompleteWeek } from '../lib/weeks';

const TREND_ICON = { up: 'fa-arrow-trend-up', down: 'fa-arrow-trend-down', flat: 'fa-minus' };
const TREND_CLR = { up: 'var(--success)', down: 'var(--danger)', flat: 'var(--muted)' };

const shortDay = (d) => `${Number(d.slice(8, 10))}/${d.slice(5, 7)}`;

export default function WeeklyReport() {
  const { role } = useAuth();
  const { t } = useT();
  const isAdmin = role === 'admin';

  const [reports, setReports] = useState(null); // { [id]: doc }
  const [selId, setSelId] = useState('');
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => weekOptions(), []); // Week 1 → latest complete, newest first

  async function load() {
    const list = await listWeekly(60);
    const map = {};
    list.forEach((w) => { map[w.id] = w; });
    setReports(map);
    setSelId((cur) => {
      if (cur && (map[cur] || options.some((o) => weekId(o) === cur))) return cur;
      if (list[0]) return list[0].id;                       // latest generated
      return weekId(latestCompleteWeek());                  // latest complete week
    });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // dropdown rows: har week-range + koi legacy report jo range se match na kare
  const rows = useMemo(() => {
    if (!reports) return [];
    const r = options.map((o) => {
      const id = weekId(o);
      return { id, label: weekLabel(o), range: o, has: !!reports[id] };
    });
    const known = new Set(r.map((x) => x.id));
    Object.values(reports)
      .filter((w) => !known.has(w.id))
      .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
      .forEach((w) => r.push({ id: w.id, label: reportLabel(w), range: null, has: true }));
    return r;
  }, [reports, options]);

  const cur = rows.find((x) => x.id === selId) || rows[0];
  const rep = cur && reports[cur.id];

  async function generate(range) {
    setBusy(true);
    try {
      const r = await runWeekly(range ? { week_num: range.num, year: range.year } : undefined);
      toast(`${t('wkGenerated')} ✓${r?.email?.sent ? ` · ${t('wkEmailSent')}` : ''}`);
      if (r?.id) setSelId(r.id);
      await load();
    } catch (e) { console.error(e); toast(friendlyError(e, t), 'err'); }
    finally { setBusy(false); }
  }

  function copyText() {
    if (!rep) return;
    const L = [];
    L.push(`📊 *${t('mWeekly')} — ${cur.label}*`);
    L.push(`📞 ${rep.team?.calls || 0} calls · ✅ ${rep.team?.closed || 0} orders · 💰 ${fmtMoney(rep.team?.revenue)}`);
    L.push('');
    (rep.people || []).forEach((p) => {
      L.push(`#${p.rank} ${p.name} — ${p.calls} calls, ${p.closed} ord, ${p.conv_pct}% conv${p.revenue ? `, ${fmtMoney(p.revenue)}` : ''}`);
      (p.insights || []).forEach((ins) => L.push(`   ${ins.type === 'good' ? '🟢' : '🔴'} ${ins.text}`));
    });
    navigator.clipboard.writeText(L.join('\n')).then(() => toast(t('lmCopied'))).catch(() => toast(t('loadFail'), 'err'));
  }

  if (reports == null) return <div className="skeleton" style={{ height: 320 }} />;

  const teamTrend = (k) => {
    const now = rep?.team?.[k] || 0; const prev = rep?.team_prev?.[k] || 0;
    return prev === 0 ? (now > 0 ? 'up' : 'flat') : now > prev * 1.1 ? 'up' : now < prev * 0.9 ? 'down' : 'flat';
  };

  return (
    <div className="wk">
      <div className="wk-bar">
        <select className="form-control" value={cur?.id || ''} onChange={(e) => setSelId(e.target.value)}>
          {rows.map((x) => (
            <option key={x.id} value={x.id}>{x.has ? '● ' : '○ '}{x.label}</option>
          ))}
        </select>
        <div className="wk-bar-btns">
          {rep && <button type="button" className="chip" onClick={copyText}><i className="fas fa-comment-dots" /> {t('lmCopyMsg')}</button>}
          {isAdmin && <button type="button" className="chip" disabled={busy} onClick={() => generate(cur?.range)} title={t('wkGenNow')}>
            <i className="fas fa-rotate" /> {busy ? t('wkGenerating') : (rep ? t('wkRegen') : t('wkGenNow'))}
          </button>}
        </div>
      </div>

      {rep && rep.week_start && (
        <p className="wk-range">{t('wkWindow')}: {shortDay(rep.data_from || rep.week_start)} – {shortDay(rep.data_to || rep.week_end)} ({t('wkTueSun')})</p>
      )}

      {!rep ? (
        <div className="empty">
          <i className="fas fa-file-circle-question" />
          {t('wkNotReady')}
          {isAdmin && cur?.range && (
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" disabled={busy} onClick={() => generate(cur.range)}>
                {busy ? t('wkGenerating') : fill(t('wkGenThis'), { w: cur.range.num })}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="stat-grid">
            {[['calls', t('wkCalls')], ['qualified', t('wkQualified')], ['closed', t('wkOrders')], ['revenue', '₹']].map(([k, lbl]) => (
              <div className="stat-card" key={k}>
                <div className="val">
                  {k === 'revenue' ? fmtMoney(rep.team?.[k]) : (rep.team?.[k] || 0)}
                  <i className={`fas ${TREND_ICON[teamTrend(k)]}`} style={{ fontSize: 12, marginLeft: 6, color: TREND_CLR[teamTrend(k)] }} />
                </div>
                <div className="label">{lbl}</div>
              </div>
            ))}
          </div>
          <p className="wk-vs">{t('wkVsPrev')}</p>

          {rep.pipeline?.fresh_unworked > 0 && (
            <div className="alert alert-info">{fill(t('wkPipeline'), { n: rep.pipeline.fresh_unworked })}</div>
          )}

          <div className="wk-people">
            {(rep.people || []).length === 0 && <div className="empty"><i className="fas fa-inbox" /> {t('wkNoActivity')}</div>}
            {(rep.people || []).map((p) => (
              <div className="wk-card" key={p.uid}>
                <div className="wk-top">
                  <div>
                    <span className="wk-rank">#{p.rank}</span>
                    <b>{p.name}</b> <em>{p.role}</em>
                  </div>
                  <b style={{ color: 'var(--success)' }}>{fmtMoney(p.revenue)}</b>
                </div>
                <div className="wk-stats">
                  <span>{p.calls} {t('wkCalls').toLowerCase()} <i className={`fas ${TREND_ICON[p.vs_last.calls]}`} style={{ color: TREND_CLR[p.vs_last.calls] }} /></span>
                  <span>{p.closed} {t('wkOrders').toLowerCase()} <i className={`fas ${TREND_ICON[p.vs_last.closed]}`} style={{ color: TREND_CLR[p.vs_last.closed] }} /></span>
                  <span>{p.conv_pct}% {t('wkConv')} <i className={`fas ${TREND_ICON[p.vs_last.conv]}`} style={{ color: TREND_CLR[p.vs_last.conv] }} /></span>
                  {p.overdue > 0 && <span style={{ color: 'var(--danger)' }}>{p.overdue} {t('lmOverdue')}</span>}
                </div>
                {p.insights?.length > 0 && (
                  <div className="wk-insights">
                    {p.insights.map((ins, i) => (
                      <div key={i} className={`wk-ins ${ins.type}`}>
                        <i className={`fas ${ins.type === 'good' ? 'fa-circle-check' : 'fa-triangle-exclamation'}`} /> {ins.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
