import { useEffect, useState } from 'react';
import { ago, api, type Activity as A } from '../api';
import { go } from '../App';

export function Activity({ dispute, items }: { dispute?: string; items?: A[] }) {
  const [list, setList] = useState<A[] | undefined>(items);
  useEffect(() => {
    if (items) {
      setList(items);
      return;
    }
    let live = true;
    const load = () => api.activity(dispute).then((r) => live && setList(r.activity), () => undefined);
    load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [dispute, items]);
  if (!list) return <div className="muted small"><span className="spin" /> Loading…</div>;
  if (!list.length) return <div className="muted small">Nothing yet.</div>;
  return (
    <ul className="feed">
      {list.slice(0, 14).map((a) => (
        <li key={a.id}>
          <div>
            <div className={`who ${a.actor}`}>{a.actor === 'paypal' ? 'PayPal' : a.actor === 'seller' ? 'You' : a.actor === 'demo' ? 'Demo' : 'Agent'}</div>
            <div className="when">{ago(a.ts)}</div>
          </div>
          <div>
            {a.text}
            {a.disputeId && !dispute && (
              <> <a href={`#/cases/${a.disputeId}`} onClick={(e) => { e.preventDefault(); go(`/cases/${a.disputeId}`); }} className="small">Open</a></>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WinRing({ p }: { p: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = p >= 0.6 ? 'var(--accent)' : p >= 0.35 ? 'var(--warn)' : 'var(--bad)';
  return (
    <svg className="win-ring" viewBox="0 0 74 74" role="img" aria-label={`${Math.round(p * 100)} percent estimated win chance`}>
      <circle cx="37" cy="37" r={r} fill="none" stroke="var(--line-2)" strokeWidth="7" />
      <circle cx="37" cy="37" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 37 37)" />
      <text x="37" y="42" textAnchor="middle" fontSize="17">{Math.round(p * 100)}%</text>
    </svg>
  );
}
