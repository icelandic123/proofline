import { useState } from 'react';
import { REASON_LABEL } from '../../../shared/playbook';
import { api, fmtMoney, type Overview, type OverviewRow } from '../api';
import { go } from '../App';
import { Activity } from './parts';

export const ACTION_LABEL: Record<string, string> = { FIGHT: 'Fight', REFUND: 'Refund', OFFER: 'Partial refund', WAIT: 'Wait or reship', ASK_BUYER: 'Ask buyer' };

export function statusChip(r: Pick<OverviewRow, 'caseStatus' | 'dispute' | 'decision'>) {
  if (r.dispute.status === 'RESOLVED') {
    const o = r.dispute.outcome;
    if (o === 'RESOLVED_SELLER_FAVOUR') return <span className="chip good">Won</span>;
    if (o === 'RESOLVED_BUYER_FAVOUR') return <span className="chip bad">Lost</span>;
    return <span className="chip">Closed</span>;
  }
  if (r.caseStatus === 'submitted') return <span className="chip info">Sent to PayPal</span>;
  if (r.caseStatus === 'ready') return <span className="chip ink">Ready to approve</span>;
  if (r.caseStatus === 'needs_edit') return <span className="chip warn">Needs your edit</span>;
  return <span className="chip"><span className="spin" style={{ width: 10, height: 10 }} /> Agent working</span>;
}

export function DaysLeft({ days }: { days?: number }) {
  if (days === undefined) return <span className="muted">-</span>;
  const cls = days < 0 ? 'bad' : days <= 3 ? 'warn' : '';
  return <span className={`chip ${cls}`}>{days < 0 ? `${Math.abs(Math.round(days))}d overdue` : `${Math.max(0, Math.round(days))}d left`}</span>;
}

export function WinMeter({ p }: { p?: number }) {
  if (p === undefined) return <span className="muted">-</span>;
  const color = p >= 0.6 ? 'var(--accent)' : p >= 0.35 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <div className="meter" style={{ width: 70 }}><i style={{ width: `${p * 100}%`, background: color }} /></div>
      <span className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(p * 100)}%</span>
    </div>
  );
}

export function CasesView({ overview, onRefresh }: { overview?: Overview; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  if (!overview) return <div className="empty"><span className="spin" /> Loading cases…</div>;
  const s = overview.stats;
  const rows = overview.rows.filter((r) => showClosed || r.dispute.status !== 'RESOLVED');

  const runAgent = async () => {
    setBusy(true);
    try {
      await api.sweep();
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cases</h1>
          <p>Every open PayPal dispute, assessed by the agent. Nothing is sent to PayPal until you approve it.</p>
        </div>
        <button className="btn" onClick={runAgent} disabled={busy}>{busy ? <span className="spin" /> : '↻'} Run agent now</button>
      </div>

      <div className="kpis">
        <div className="card kpi"><div className="label">Open disputes</div><div className="value">{s.open}</div><div className="hint">{s.dueSoon} due within 3 days</div></div>
        <div className="card kpi"><div className="label">Money at risk</div><div className="value">{fmtMoney(s.atRisk)}</div><div className="hint">held by open cases</div></div>
        <div className="card kpi"><div className="label">Waiting for you</div><div className="value">{s.awaitingApproval}</div><div className="hint">drafts ready to approve</div></div>
        <div className="card kpi"><div className="label">Win rate</div><div className="value">{s.winRate === undefined ? '-' : `${s.winRate}%`}</div><div className="hint">{s.won} won, {s.lost} lost</div></div>
        <div className="card kpi"><div className="label">Seller Protection</div><div className="value">{overview.protection.coverage_pct}%</div><div className="hint">of orders have tracking on PayPal</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)' }}>
        <div className="card">
          <div className="row card-pad" style={{ paddingBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Disputes</h2>
            <span className="spacer" />
            <label className="small muted row" style={{ gap: 6 }}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed</label>
          </div>
          {rows.length === 0 ? (
            <div className="empty">No open disputes. Try the Demo lab to have a sandbox buyer open one.</div>
          ) : (
            <table className="cases">
              <thead>
                <tr><th>Dispute</th><th>Reason</th><th className="num">Amount</th><th>Respond by</th><th>Win chance</th><th>Agent says</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dispute.id} className="click" onClick={() => go(`/cases/${r.dispute.id}`)}>
                    <td><div className="mono">{r.dispute.id}</div><div className="small muted">{r.dispute.buyerName ?? r.dispute.buyerEmail ?? ''}</div></td>
                    <td>{REASON_LABEL[r.dispute.reason]}{r.dispute.stage === 'CHARGEBACK' && <div className="small muted">Chargeback</div>}</td>
                    <td className="num">{fmtMoney(r.dispute.amount.value, r.dispute.amount.currency_code)}</td>
                    <td>{r.dispute.status === 'RESOLVED' ? <span className="muted">-</span> : <DaysLeft days={r.daysLeft} />}</td>
                    <td><WinMeter p={r.winProbability} /></td>
                    <td>{r.recommended ? <span className={`chip ${r.recommended === 'FIGHT' ? 'good' : 'warn'}`}>{ACTION_LABEL[r.recommended] ?? r.recommended}</span> : '-'}</td>
                    <td>{statusChip(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card card-pad">
          <h2>Agent activity</h2>
          <Activity />
        </div>
      </div>
    </>
  );
}
