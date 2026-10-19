import { useEffect, useState } from 'react';
import { api, fmtMoney, type Config, type Overview } from '../api';
import { go } from '../App';
import { REASON_LABEL } from '../../../shared/playbook';

export function DemoView({ config, onChange }: { config?: Config; onChange: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn'; text: string; link?: string }>();
  const [overview, setOverview] = useState<Overview>();

  const load = () => api.overview().then(setOverview, () => undefined);
  useEffect(() => { load(); }, []);

  const create = async (id: string) => {
    setBusy(id);
    setMsg(undefined);
    try {
      const r = await api.demoDispute(id);
      setMsg({ tone: 'good', text: `The sandbox buyer opened ${r.disputeId}. The agent is assessing it now.`, link: r.disputeId });
      onChange();
      load();
    } catch (e) {
      setMsg({ tone: 'warn', text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  };

  const decide = async (id: string, sellerWins: boolean) => {
    setBusy(id);
    try {
      await api.adjudicate(id, sellerWins);
      onChange();
      load();
    } catch (e) {
      setMsg({ tone: 'warn', text: (e as Error).message });
    } finally {
      setBusy(undefined);
    }
  };

  const pending = overview?.rows.filter((r) => r.caseStatus === 'submitted' && r.dispute.status !== 'RESOLVED') ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Demo lab</h1>
          <p>
            {config?.mode === 'sandbox'
              ? 'Each scenario makes a real PayPal sandbox payment, records the shipment, and has a sandbox buyer open a real dispute through PayPal\'s sandbox API.'
              : 'Offline mode: scenarios are simulated locally because no PayPal sandbox credentials are configured.'}
          </p>
        </div>
      </div>
      {msg && (
        <div className={`banner ${msg.tone}`}>
          {msg.text}
          {msg.link && <a href={`#/cases/${msg.link}`} onClick={(e) => { e.preventDefault(); go(`/cases/${msg.link}`); }} style={{ marginLeft: 'auto' }}>Open the case →</a>}
        </div>
      )}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>1. Have a buyer open a dispute</h2>
        <div className="scenarios">
          {config?.scenarios.map((s) => (
            <button key={s.id} className="card scenario" onClick={() => create(s.id)} disabled={!!busy}>
              <span className="t">{s.title}</span>
              <span className="e">{s.expect}</span>
              <span className="small" style={{ color: 'var(--accent)', marginTop: 'auto' }}>{busy === s.id ? <><span className="spin" /> Creating in the sandbox…</> : 'Open this dispute →'}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card card-pad">
        <h2>2. Let PayPal decide a submitted case</h2>
        <p className="small muted" style={{ marginTop: -4 }}>The sandbox lets us play PayPal's dispute team. In production PayPal reviews the evidence itself.</p>
        {pending.length === 0 ? (
          <div className="muted small">No case is waiting on PayPal. Approve a response on a case first.</div>
        ) : (
          <table className="cases">
            <tbody>
              {pending.map((r) => (
                <tr key={r.dispute.id}>
                  <td className="mono">{r.dispute.id}</td>
                  <td>{REASON_LABEL[r.dispute.reason]}</td>
                  <td className="num">{fmtMoney(r.dispute.amount.value)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn small" onClick={() => decide(r.dispute.id, true)} disabled={!!busy}>Seller wins</button>{' '}
                    <button className="btn small danger" onClick={() => decide(r.dispute.id, false)} disabled={!!busy}>Buyer wins</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
