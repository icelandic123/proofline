import { useEffect, useState } from 'react';
import type { Order } from '../../../shared/types';
import { api, fmtDate, fmtMoney, type Protection, type TrackingProposal } from '../api';

const SAMPLE = `Your label is ready! Order #ORDER_ID for Jo Whitfield
Carrier: UPS Ground  ·  Tracking: TRACKING
Ship by: tomorrow`;

export function ProtectionView({ onChange }: { onChange: () => void }) {
  const [orders, setOrders] = useState<Order[]>();
  const [prot, setProt] = useState<Protection>();
  const [paste, setPaste] = useState('');
  const [proposals, setProposals] = useState<TrackingProposal[]>();
  const [model, setModel] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const load = () => api.orders().then((r) => { setOrders(r.orders); setProt(r.protection); }, (e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const read = async () => {
    setBusy('parse');
    setError(undefined);
    try {
      const r = await api.parseTracking(paste);
      setProposals(r.proposals);
      setModel(r.model);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const apply = async (p: TrackingProposal) => {
    if (!p.orderId || !p.carrier) return;
    setBusy(p.trackingNumber);
    try {
      await api.applyTracking(p.orderId, p.carrier, p.trackingNumber);
      setProposals((list) => list?.filter((x) => x !== p));
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const example = () => {
    const o = orders?.find((x) => !x.intangible && !x.trackers.some((t) => t.uploadedToPayPal));
    const tracking = o?.trackers[0]?.trackingNumber ?? '1Z4F7A2W0312345678';
    setPaste(SAMPLE.replace('ORDER_ID', o?.id ?? 'unknown').replace('Jo Whitfield', o?.buyerName ?? 'Jo Whitfield').replace('TRACKING', tracking.replace(/(.{4})/g, '$1 ').trim()));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Seller Protection</h1>
          <p>PayPal only protects you against “item not received” claims when tracking is on the PayPal transaction. The agent closes those gaps.</p>
        </div>
      </div>
      {error && <div className="banner warn">{error}</div>}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card kpi"><div className="label">Coverage</div><div className="value">{prot ? `${prot.coverage_pct}%` : '-'}</div><div className="hint">physical orders with tracking on PayPal</div></div>
        <div className="card kpi"><div className="label">Unprotected sales</div><div className="value">{prot ? fmtMoney(prot.unprotected_amount) : '-'}</div><div className="hint">exposed to “not received” claims</div></div>
        <div className="card kpi"><div className="label">Shipped</div><div className="value">{prot?.shipped ?? '-'}</div><div className="hint">of {prot?.physical_orders ?? '-'} physical orders</div></div>
        <div className="card kpi"><div className="label">On PayPal</div><div className="value">{prot?.tracking_on_paypal ?? '-'}</div><div className="hint">tracking uploaded</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.3fr)' }}>
        <div className="card card-pad">
          <h2>Paste shipping confirmations</h2>
          <p className="small muted" style={{ marginTop: -4 }}>Label emails, carrier receipts or a CSV export. The AI pulls out each shipment; a format check confirms every tracking number before anything reaches PayPal.</p>
          <div className="editor"><textarea style={{ minHeight: 150 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste here…" aria-label="Shipping confirmations" /></div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={read} disabled={!paste.trim() || busy === 'parse'}>{busy === 'parse' && <span className="spin" />} Read shipments</button>
            <button className="btn ghost" onClick={example}>Use an example</button>
          </div>
          {proposals && (
            <div style={{ marginTop: 14 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>Found {proposals.length} shipment{proposals.length === 1 ? '' : 's'} ({model === 'pattern' ? 'pattern match' : 'AI'})</div>
              {proposals.map((p, i) => (
                <div key={i} className="card" style={{ padding: 10, marginBottom: 8, boxShadow: 'none' }}>
                  <div className="row">
                    <span className="mono">{p.trackingNumber}</span>
                    <span className="chip">{p.carrier ?? 'carrier?'}</span>
                    {p.orderId && <span className="small muted">order {p.orderId}{p.buyer ? `, ${p.buyer}` : ''}</span>}
                    <span className="spacer" />
                    {p.valid ? (
                      <button className="btn small primary" onClick={() => apply(p)} disabled={busy === p.trackingNumber}>Upload to PayPal</button>
                    ) : (
                      <span className="chip bad">Not uploaded</span>
                    )}
                  </div>
                  <div className={`small ${p.valid ? 'muted' : ''}`} style={{ color: p.valid ? undefined : 'var(--bad)', marginTop: 4 }}>{p.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 4 }}><h2>Orders</h2></div>
          {!orders ? <div className="empty"><span className="spin" /></div> : orders.length === 0 ? <div className="empty">No orders yet. Buy something in the demo shop.</div> : (
            <table className="cases">
              <thead><tr><th>Order</th><th>Buyer</th><th className="num">Amount</th><th>Tracking</th><th>Protection</th></tr></thead>
              <tbody>
                {orders.slice(0, 40).map((o) => {
                  const t = o.trackers[0];
                  const covered = o.trackers.some((x) => x.uploadedToPayPal);
                  return (
                    <tr key={o.id}>
                      <td><div className="mono">{o.id}</div><div className="small muted">{fmtDate(o.createdAt)}</div></td>
                      <td>{o.buyerName}</td>
                      <td className="num">{fmtMoney(o.amount.value)}</td>
                      <td>{t ? <><div className="small">{t.carrier}</div><div className="mono" style={{ fontSize: 11.5 }}>{t.trackingNumber}</div></> : <span className="muted small">{o.intangible ? 'Digital' : 'Not shipped'}</span>}</td>
                      <td>{o.intangible ? <span className="chip">Not eligible (digital)</span> : covered ? <span className="chip good">Protected</span> : t ? <span className="chip warn">Upload pending</span> : <span className="chip bad">Exposed</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
