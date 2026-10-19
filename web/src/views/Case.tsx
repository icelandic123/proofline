import { useEffect, useMemo, useRef, useState } from 'react';
import { REASON_LABEL } from '../../../shared/playbook';
import type { ActionKind, CaseFacts, CasePlan, GroundingIssue } from '../../../shared/types';
import { api, fmtDate, fmtMoney, type Activity as A, type CaseRow } from '../api';
import { go } from '../App';
import { ACTION_LABEL, DaysLeft, statusChip } from './Cases';
import { Activity, WinRing } from './parts';

interface Data { facts: CaseFacts; case: CaseRow | null; plan: CasePlan; activity: A[] }

function FactsTimeline({ facts }: { facts: CaseFacts }) {
  const o = facts.order;
  const d = facts.dispute;
  const items: { when?: string; text: string; tone?: 'good' | 'bad' | 'warn'; source: string }[] = [];
  if (o) items.push({ when: o.createdAt, text: `Paid ${fmtMoney(o.amount.value, o.amount.currency_code)} for ${o.items.map((i) => i.name).join(', ')}`, source: 'PayPal order' });
  for (const t of o?.trackers ?? []) {
    items.push({ when: t.shippedAt, text: `Shipped with ${t.carrier} ${t.trackingNumber}`, source: 'Store' });
    items.push(t.uploadedToPayPal
      ? { when: t.uploadedAt, text: 'Tracking uploaded to PayPal', tone: 'good', source: 'PayPal tracking' }
      : { text: 'Tracking not on PayPal yet', tone: 'bad', source: 'PayPal tracking' });
    if (t.carrierStatus === 'DELIVERED') items.push({ when: t.deliveredAt, text: `Delivered${t.signatureConfirmed ? ', signed for' : ''}${t.deliveredTo ? ` to ${t.deliveredTo.line1}, ${t.deliveredTo.city}` : ''}`, tone: 'good', source: 'Carrier' });
    else items.push({ text: `Carrier status: ${(t.carrierStatus ?? 'unknown').toLowerCase().replace('_', ' ')}`, tone: 'warn', source: 'Carrier' });
  }
  for (const r of o?.refunds ?? []) items.push({ when: r.createdAt, text: `Refunded ${fmtMoney(r.amount.value)} (${r.id})`, tone: 'good', source: 'PayPal refund' });
  items.push({ when: d.createdAt, text: `Buyer opened a ${REASON_LABEL[d.reason].toLowerCase()} ${d.stage === 'CHARGEBACK' ? 'chargeback' : 'dispute'}`, tone: 'bad', source: 'PayPal dispute' });
  for (const m of d.messages) items.push({ when: m.time, text: `${m.postedBy === 'BUYER' ? 'Buyer' : m.postedBy === 'SELLER' ? 'You' : 'PayPal'}: “${m.content}”`, source: 'PayPal messages' });
  if (d.sellerResponseDueDate && d.status !== 'RESOLVED') items.push({ when: d.sellerResponseDueDate, text: 'Your response is due', tone: 'warn', source: 'PayPal dispute' });
  items.sort((a, b) => (a.when ?? '9') < (b.when ?? '9') ? -1 : 1);
  return (
    <ul className="facts-tl">
      {items.map((it, i) => (
        <li key={i}>
          <span className={`pin ${it.tone ?? ''}`} />
          <div>
            <div>{it.text}<span className="source">{it.source}</span></div>
            {it.when && <div className="when">{fmtDate(it.when)}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CaseView({ id, onChange }: { id: string; onChange: () => void }) {
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();
  const [text, setText] = useState('');
  const [buyerMsg, setBuyerMsg] = useState('');
  const [choice, setChoice] = useState<ActionKind>();
  const [check, setCheck] = useState<{ ok: boolean; issues: GroundingIssue[]; checkedTokens: number }>();
  const [busy, setBusy] = useState<string>();
  const [done, setDone] = useState<string>();
  const timer = useRef<number>();

  const load = async (reanalyse = false) => {
    try {
      if (reanalyse) await api.analyze(id);
      const d = await api.case(id);
      setData(d);
      setText(d.case?.draft?.response ?? '');
      setBuyerMsg(d.case?.draft?.buyerMessage ?? '');
      setChoice(d.case?.plan?.recommended ?? d.plan.recommended);
      setCheck(d.case?.draft?.grounding);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    setData(undefined);
    setDone(undefined);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Re-run the fact check as the seller edits.
  const onEdit = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.check(id, v).then(setCheck, () => undefined), 450);
  };

  const plan = data?.case?.plan ?? data?.plan;
  const maxLoss = useMemo(() => Math.max(1, ...(plan?.options.map((o) => o.expectedLoss) ?? [1])), [plan]);

  if (error) return <div className="banner warn">{error}</div>;
  if (!data || !plan) return <div className="empty"><span className="spin" /> The agent is gathering the facts…</div>;

  const { facts } = data;
  const d = facts.dispute;
  const closed = d.status === 'RESOLVED';
  const submitted = data.case?.status === 'submitted' || closed;
  const offer = plan.options.find((o) => o.kind === 'OFFER');
  const offerAmount = offer ? Number(offer.label.match(/[\d.]+/)?.[0]) : undefined;
  const canSubmit = !submitted && (choice === 'REFUND' || choice === 'OFFER' || (choice === 'FIGHT' && check?.ok));

  const submit = async () => {
    if (!choice || choice === 'WAIT' || choice === 'ASK_BUYER') return;
    setBusy('submit');
    try {
      const r = await api.submit(id, { kind: choice, response: text, buyerMessage: buyerMsg || undefined, offerAmount });
      if (!r.ok && r.issues) setCheck({ ok: false, issues: r.issues, checkedTokens: 0 });
      else {
        setDone(choice === 'FIGHT' ? 'Evidence sent to PayPal. The agent will watch for the decision.' : choice === 'REFUND' ? 'Claim accepted and refunded.' : 'Offer sent to the buyer.');
        onChange();
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/cases" className="small" onClick={(e) => { e.preventDefault(); go('/cases'); }}>← All cases</a>
          <h1 style={{ marginTop: 6 }}>
            {REASON_LABEL[d.reason]} · {fmtMoney(d.amount.value, d.amount.currency_code)}
          </h1>
          <p className="row">
            <span className="mono">{d.id}</span>
            <span>{d.buyerName ?? d.buyerEmail}</span>
            {statusChip({ caseStatus: data.case?.status ?? 'new', dispute: d, decision: data.case?.decision })}
            {!closed && <DaysLeft days={d.sellerResponseDueDate ? (Date.parse(d.sellerResponseDueDate) - Date.now()) / 86_400_000 : undefined} />}
          </p>
        </div>
        {!submitted && <button className="btn" onClick={() => { setBusy('analyse'); load(true).finally(() => setBusy(undefined)); }} disabled={!!busy}>{busy === 'analyse' ? <span className="spin" /> : '↻'} Re-assess</button>}
      </div>

      {done && <div className="banner good">{done}</div>}
      {data.case?.decision && <div className="banner info">You chose “{ACTION_LABEL[data.case.decision.kind] ?? data.case.decision.kind}” on {fmtDate(data.case.decision.at)}.{closed ? ` PayPal outcome: ${(d.outcome ?? 'closed').toLowerCase().replace(/_/g, ' ')}.` : ' Waiting for PayPal.'}</div>}

      <div className="case-grid">
        <div className="grid">
          <div className="card card-pad">
            <h2>What happened</h2>
            <FactsTimeline facts={facts} />
          </div>
          <div className="card card-pad">
            <h2>Evidence check</h2>
            <ul className="checks">
              {plan.checks.map((c) => (
                <li key={c.id}>
                  <span className={`mark ${c.status}`}>{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : c.status === 'na' ? '–' : '?'}</span>
                  <div>
                    <div style={{ fontWeight: 500 }}>{c.label}</div>
                    <div className="small muted">{c.detail}</div>
                    {c.fix && c.status !== 'pass' && <div className="fix">→ {c.fix}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="card card-pad">
            <h2>Case log</h2>
            <Activity items={data.activity} dispute={id} />
          </div>
        </div>

        <div className="grid">
          <div className="card card-pad">
            <h2>Decision</h2>
            <div className="win" style={{ marginBottom: 12 }}>
              <WinRing p={plan.winProbability} />
              <div>
                <div style={{ fontWeight: 600 }}>Estimated chance to win: {Math.round(plan.winProbability * 100)}%</div>
                <div className="small muted">From the evidence checks, not from the AI. The cheapest option is suggested.</div>
              </div>
            </div>
            <div className="options">
              {plan.options.map((o) => (
                <button key={o.kind} type="button" disabled={submitted} className={`option ${o.kind === plan.recommended ? 'rec' : ''} ${o.kind === choice ? 'sel' : ''}`} onClick={() => setChoice(o.kind)}>
                  <span className="ol">{o.label} {o.kind === plan.recommended && <span className="chip good" style={{ marginLeft: 6 }}>Suggested</span>}</span>
                  <span className="loss">{fmtMoney(o.expectedLoss)}<div className="small muted" style={{ fontWeight: 400 }}>expected cost</div></span>
                  <span className="lossbar"><i style={{ width: `${(o.expectedLoss / maxLoss) * 100}%` }} /></span>
                  <span className="why">{o.explanation}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>{choice === 'FIGHT' ? 'Response to PayPal' : 'Note for PayPal'}</h2>
              <span className="spacer" />
              <span className="chip">{data.case?.draft?.model === 'template' ? 'Template draft' : data.case?.draft ? 'AI draft' : 'No draft yet'}</span>
            </div>
            <div className="editor">
              <textarea value={text} onChange={(e) => onEdit(e.target.value)} disabled={submitted} aria-label="Response to PayPal" />
            </div>
            <div className="verify">
              {check?.ok ? (
                <span className="chip good">✓ Every fact verified ({check.checkedTokens} checked)</span>
              ) : check ? (
                <span className="chip bad">✕ {check.issues.length} statement{check.issues.length === 1 ? '' : 's'} not backed by the case record</span>
              ) : null}
              <span className="small muted">Amounts, dates, ids and claims are checked against PayPal and store records.</span>
            </div>
            {check && !check.ok && (
              <ul className="issues">
                {check.issues.map((i, k) => <li key={k}><mark>{i.text}</mark>: {i.message}</li>)}
              </ul>
            )}
            {buyerMsg !== '' && (
              <>
                <hr className="soft" />
                <h2>Message to the buyer</h2>
                <div className="editor"><textarea style={{ minHeight: 90 }} value={buyerMsg} onChange={(e) => setBuyerMsg(e.target.value)} disabled={submitted} aria-label="Message to the buyer" /></div>
              </>
            )}
            <hr className="soft" />
            <div className="row">
              {choice === 'WAIT' ? (
                <span className="small muted">Reshipping happens outside PayPal. Upload the new tracking on the Protection screen and the agent will add it to this case.</span>
              ) : (
                <button className="btn primary" disabled={!canSubmit || !!busy} onClick={submit}>
                  {busy === 'submit' && <span className="spin" />}
                  {choice === 'FIGHT' ? 'Approve and send evidence to PayPal' : choice === 'REFUND' ? `Approve refund of ${fmtMoney(d.amount.value)}` : `Approve offer of ${fmtMoney(offerAmount ?? 0)}`}
                </button>
              )}
              {choice === 'FIGHT' && !check?.ok && !submitted && <span className="small muted">Fix the flagged statements to enable sending.</span>}
            </div>
            {choice === 'FIGHT' && plan.evidence.length > 0 && (
              <div className="small muted" style={{ marginTop: 10 }}>
                Attached evidence: {plan.evidence.map((e) => e.type.toLowerCase().replace(/_/g, ' ')).join(', ')}.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

