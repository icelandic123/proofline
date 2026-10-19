import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ago, type Config, type Overview } from './api';
import { AskView } from './views/Ask';
import { CasesView } from './views/Cases';
import { CaseView } from './views/Case';
import { DemoView } from './views/Demo';
import { ProtectionView } from './views/Protection';
import { ShopView } from './views/Shop';

// The two heavy sponsor components load only when their screen opens.
const TimelineView = lazy(() => import('./views/Timeline'));
const InsightsView = lazy(() => import('./views/Insights'));

function useHash() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || '/cases');
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/cases');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function go(path: string) {
  location.hash = path;
}

const NAV = [
  { path: '/cases', label: 'Cases', icon: '⚖' },
  { path: '/timeline', label: 'Deadlines', icon: '◷' },
  { path: '/insights', label: 'Insights', icon: '▤' },
  { path: '/protection', label: 'Protection', icon: '⛨' },
  { path: '/ask', label: 'Ask Rebuttal', icon: '✦' },
  { path: '/demo', label: 'Demo lab', icon: '⚗' },
  { path: '/shop', label: 'Demo shop', icon: '⌂' },
];

export default function App() {
  const hash = useHash();
  const [config, setConfig] = useState<Config>();
  const [overview, setOverview] = useState<Overview>();
  const [refreshedAt, setRefreshedAt] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const o = await api.overview();
      setOverview(o);
      setRefreshedAt(new Date().toISOString());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api.config().then(setConfig, (e) => setError((e as Error).message));
    refresh();
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [refresh]);

  const [, section, id] = hash.split('/');
  const waiting = overview?.stats.awaitingApproval ?? 0;

  let view;
  if (section === 'cases' && id) view = <CaseView id={id} onChange={refresh} />;
  else if (section === 'timeline') view = <TimelineView overview={overview} />;
  else if (section === 'insights') view = <InsightsView />;
  else if (section === 'protection') view = <ProtectionView onChange={refresh} />;
  else if (section === 'ask') view = <AskView />;
  else if (section === 'demo') view = <DemoView config={config} onChange={refresh} />;
  else if (section === 'shop') view = <ShopView config={config} />;
  else view = <CasesView overview={overview} onRefresh={refresh} />;

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">Rebuttal</div>
            <div className="brand-sub">Dispute defense for {config?.store.storeName ?? 'your store'}</div>
          </div>
        </div>
        {NAV.map((n) => (
          <a key={n.path} href={`#${n.path}`} className={`/${section}` === n.path ? 'active' : ''}>
            <span aria-hidden>{n.icon}</span>
            {n.label}
            {n.path === '/cases' && waiting > 0 && <span className="count">{waiting}</span>}
          </a>
        ))}
        <div className="nav-foot">
          <div className="row">
            <span className={`dot ${config?.mode === 'sandbox' ? 'live' : ''}`} />
            {config?.mode === 'sandbox' ? 'PayPal sandbox, live' : 'Offline demo data'}
          </div>
          <div style={{ marginTop: 4 }}>{config?.model ? `AI: ${config.model.split('/').pop()}` : 'AI: template mode'}</div>
          {refreshedAt && <div style={{ marginTop: 4 }}>Synced {ago(refreshedAt)}</div>}
        </div>
      </nav>
      <main className="main">
        {error && <div className="banner warn">{error}</div>}
        <Suspense fallback={<div className="empty"><span className="spin" /> Loading…</div>}>{view}</Suspense>
      </main>
    </div>
  );
}
