import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useConfig } from '../config';
import { fmtMoney } from '../lib/format';
import { mecaFromActivity } from '../lib/dashboardStats';
import { downloadCsv } from '../lib/csv';
import { RANGE_PRESETS as QUICK, rangeFor } from '../lib/daterange';

export default function Meca() {
  const { t } = useT();
  const cfg = useConfig();
  const [quick, setQuick] = useState('w');
  const [from, setFrom] = useState(() => rangeFor('w')[0]);
  const [to, setTo] = useState(() => rangeFor('w')[1]);
  const [role, setRole] = useState('sales');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [capped, setCapped] = useState(false);

  function pick(k) {
    setQuick(k);
    const [f, tt] = rangeFor(k);
    setFrom(f); setTo(tt);
  }

  useEffect(() => {
    setLoading(true);
    mecaFromActivity(from, to).then((r) => {
      setData(r); setCapped(r.capped); setLoading(false);
    }).catch(() => { setData({ rows: [] }); setLoading(false); });
  }, [from, to]);

  // activity docs role nahi rakhte — uid se role/naam config se le lete hain
  const roleByUid = useMemo(() => {
    const m = {};
    (cfg.users || []).forEach((u) => { m[u.id] = u.role; });
    return m;
  }, [cfg.users]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => roleByUid[r.uid] === role)
      .map((r) => ({
        ...r,
        result: role === 'sales' ? r.closed : r.qualified,
        conv: r.handled ? ((role === 'sales' ? r.closed : r.qualified) / r.handled) * 100 : 0,
        avgVal: (role === 'sales' && r.closed) ? Math.round(r.revenue / r.closed) : 0,
      }))
      .sort((a, b) => b.result - a.result || b.revenue - a.revenue || b.handled - a.handled);
  }, [data, role, roleByUid]);

  const tot = rows.reduce((s, r) => ({
    handled: s.handled + r.handled, touches: s.touches + r.touches,
    fresh: s.fresh + (r.fresh || 0), old: s.old + (r.old || 0),
    result: s.result + r.result, revenue: s.revenue + r.revenue,
  }), { handled: 0, touches: 0, fresh: 0, old: 0, result: 0, revenue: 0 });
  const hasFresh = rows.some((r) => r.fresh != null);
  const totConv = tot.handled ? (tot.result / tot.handled) * 100 : 0;
  const totAvgTouch = tot.handled ? (tot.touches / tot.handled).toFixed(1) : '0';

  function exportCsv() {
    downloadCsv(`meca-${role}-${from}_${to}.csv`,
      ['Name', 'Handled', 'Fresh', 'Old', 'Follow-ups', 'Avg touch', role === 'sales' ? 'Orders' : 'Qualified', 'Conv %', 'Revenue', 'Avg value'],
      rows.map((r) => [r.name, r.handled, r.fresh ?? '', r.old ?? '', r.touches, r.avgTouch, r.result, r.conv.toFixed(1), r.revenue, r.avgVal || '']));
  }

  return (
    <div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {QUICK.map((q) => <button key={q.k} className={`chip ${quick === q.k ? 'active' : ''}`} onClick={() => pick(q.k)}>{t(q.tk)}</button>)}
      </div>
      <div className="toolbar">
        <input className="form-control" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setQuick(''); }} />
        <input className="form-control" type="date" value={to} onChange={(e) => { setTo(e.target.value); setQuick(''); }} />
      </div>
      <div className="ls-tabs" style={{ marginBottom: 14 }}>
        <button className={role === 'sales' ? 'on' : ''} onClick={() => setRole('sales')}>{t('mecaSalesTeam')}</button>
        <button className={role === 'ldr' ? 'on' : ''} onClick={() => setRole('ldr')}>{t('mecaLdrTeam')}</button>
      </div>

      {capped && <div className="alert alert-warn">{t('mecaCapped')}</div>}

      {loading ? <div className="skeleton" style={{ height: 240 }} /> : (
        <>
          <div className="stat-grid">
            <div className="stat-card"><div className="val">{tot.handled.toLocaleString('en-IN')}</div><div className="label">{t('cHandled')}</div></div>
            <div className="stat-card"><div className="val">{totAvgTouch}x</div><div className="label">{t('mecaAvgTouch')}</div></div>
            <div className="stat-card"><div className="val" style={{ color: 'var(--success)' }}>{tot.result}</div><div className="label">{role === 'sales' ? t('dealsClosed') : t('cQualified')}</div></div>
            <div className="stat-card"><div className="val">{totConv.toFixed(1)}%</div><div className="label">{t('convRate')}</div></div>
          </div>
          {role === 'sales' && (
            <div className="stat-grid">
              <div className="stat-card tone-good"><div className="val" style={{ color: 'var(--success)' }}>{fmtMoney(tot.revenue)}</div><div className="label">{t('totalSales')}</div></div>
              <div className="stat-card"><div className="val">{tot.result ? fmtMoney(Math.round(tot.revenue / tot.result)) : '—'}</div><div className="label">{t('cAvgR')}</div></div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '4px 0 8px' }}>
            <button className="btn btn-ghost" style={{ padding: '7px 12px', fontSize: 12.5 }} disabled={!rows.length} onClick={exportCsv}>
              <i className="fas fa-file-csv" /> {t('exportCsv')}
            </button>
          </div>

          <div className="tablewrap">
            <table className="meca-t">
              <thead>
                <tr>
                  <th>{t('uName')}</th><th>{t('cHandled')}</th>
                  {hasFresh && <th title="Leads created in this range">🌱 {t('mecaFresh')}</th>}
                  {hasFresh && <th title="Older pipeline leads touched">🔄 {t('mecaOld')}</th>}
                  <th title={t('mecaFollowups')}>{t('mecaFollowupsShort')}</th>
                  <th>{t('mecaAvgTouch')}</th><th>{role === 'sales' ? t('cClosed') : t('cQualified')}</th>
                  <th>{t('cConv')}</th>{role === 'sales' && <th>{t('cTotalR')}</th>}{role === 'sales' && <th>{t('cAvgR')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('noData')}</td></tr>
                  : rows.map((r) => (
                    <tr key={r.uid}>
                      <td className="nm">{r.name || r.uid}</td>
                      <td>{r.handled}</td>
                      {hasFresh && <td style={{ color: 'var(--navy-accent)', fontWeight: 700 }}>{r.fresh ?? '—'}</td>}
                      {hasFresh && <td>{r.old ?? '—'}</td>}
                      <td>{r.touches}</td>
                      <td><span className="rep-chip tone-wip" style={{ fontWeight: 800 }}>{r.avgTouch}x</span></td>
                      <td className="hl">{r.result}</td>
                      <td>{r.conv.toFixed(1)}%</td>
                      {role === 'sales' && <td>{fmtMoney(r.revenue)}</td>}
                      {role === 'sales' && <td>{r.avgVal ? fmtMoney(r.avgVal) : '—'}</td>}
                    </tr>
                  ))}
                {rows.length > 0 && (
                  <tr style={{ background: 'var(--navy-primary)', color: '#fff', fontWeight: 800 }}>
                    <td className="nm" style={{ color: '#fff' }}>{t('grandTotal')}</td>
                    <td>{tot.handled}</td>
                    {hasFresh && <td>{tot.fresh}</td>}
                    {hasFresh && <td>{tot.old}</td>}
                    <td>{tot.touches}</td>
                    <td>{totAvgTouch}x</td>
                    <td>{tot.result}</td>
                    <td>{totConv.toFixed(1)}%</td>
                    {role === 'sales' && <td>{fmtMoney(tot.revenue)}</td>}
                    {role === 'sales' && <td>{tot.result ? fmtMoney(Math.round(tot.revenue / tot.result)) : '—'}</td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
