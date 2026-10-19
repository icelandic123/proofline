import { useState } from 'react';
import { api } from '../api';

const SUGGESTIONS = [
  'Which disputes should I deal with first?',
  'Why shouldn\'t I fight the biggest case?',
  'Which orders are missing tracking on PayPal?',
  'What did the agent do today?',
];

export function AskView() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string; trace: { tool: string }[] }[]>([]);
  const [error, setError] = useState<string>();

  const send = async (question = q) => {
    if (!question.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.ask(question);
      setHistory((h) => [{ q: question, a: r.answer, trace: r.trace }, ...h]);
      setQ('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ask Rebuttal</h1>
          <p>Questions about your disputes and orders, answered from live PayPal data. The assistant can look things up but cannot move money.</p>
        </div>
      </div>
      <div className="card card-pad">
        <form className="ask-box" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a dispute, an order or your protection coverage…" aria-label="Question" />
          <button className="btn primary" disabled={busy || !q.trim()}>{busy ? <span className="spin" /> : 'Ask'}</button>
        </form>
        <div className="suggest">
          {SUGGESTIONS.map((s) => <button key={s} className="btn small" onClick={() => send(s)} disabled={busy}>{s}</button>)}
        </div>
      </div>
      {error && <div className="banner warn" style={{ marginTop: 14 }}>{error}</div>}
      <div className="grid" style={{ marginTop: 14 }}>
        {history.map((h, i) => (
          <div key={i} className="card card-pad">
            <div className="small muted">{h.q}</div>
            <div className="answer" style={{ marginTop: 6 }}>{h.a}</div>
            {h.trace.length > 0 && (
              <div className="trace">
                {h.trace.map((t, k) => <span key={k} className="chip info">looked up: {t.tool.replace(/_/g, ' ')}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
