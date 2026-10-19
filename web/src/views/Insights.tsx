// Insights: an AG Studio dashboard over the seller's disputes and orders,
// with two Proofline widgets and Studio's AI assistant wired to our backend.
import { AgStudioAiModule, createAiHarness, studioTheme, type AgAiHarnessSetup, type AgReportState, type AgStudioMode } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Order } from '../../../shared/types';
import { api, type OverviewRow } from '../api';
import { backendAdapter } from './insights/adapter';
import { buildData } from './insights/data';
import { widgets, type CustomRegistry } from './insights/widgets';

const STORAGE_KEY = 'proofline.insights.v1';

const theme = studioTheme
  .withParams({
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    accentColor: '#1f7a5a',
    chartPaletteFills1Color: '#17324d',
    chartPaletteFills2Color: '#1f7a5a',
    chartPaletteFills3Color: '#c9a227',
    chartPaletteFills4Color: '#b23b31',
    chartPaletteFills5Color: '#2c5f9e',
    chartPaletteFills6Color: '#8b95a3',
  })
  .withParams({ backgroundColor: '#ffffff', foregroundColor: '#1c2430', borderColor: '#e4ded4', studioCanvasBackgroundColor: '#f6f3ee', browserColorScheme: 'light' }, 'light');

const aiModules = [AgStudioAiModule];

const ai: AgAiHarnessSetup = ({ api: studioApi }) =>
  createAiHarness(studioApi, {
    adapter: backendAdapter('/api/studio-agent'),
    promptStarters: [
      { label: 'Costliest reasons', prompt: 'Which dispute reasons put the most money at risk? Add a chart.' },
      { label: 'Unprotected orders', prompt: 'Add a table of orders that are not protected yet, largest first.' },
      { label: 'Only open cases', prompt: 'Filter this page to open disputes only.' },
    ],
  });

const title = (text: string) => ({ title: { text, enabled: true } });

const defaultReport = {
  selectedPageId: 'overview',
  pages: [
    {
      id: 'overview',
      widgets: {
        status: { type: 'button-filter', dataMapping: { value: [{ id: 'disputes.reason' }] } },
        risk: { type: 'value', dataMapping: { value: [{ id: 'disputes.atRisk', aggregation: 'sum' }] }, format: title('Money at risk') },
        count: { type: 'value', dataMapping: { value: [{ id: 'disputes.id', aggregation: 'count' }] }, format: title('Disputes') },
        win: { type: 'value', dataMapping: { value: [{ id: 'disputes.winEstimate', aggregation: 'avg' }] }, format: title('Average win estimate') },
        cover: { type: 'coverage-ring', dataMapping: { covered: [{ id: 'orders.covered', aggregation: 'sum' }], total: [{ id: 'orders.physical', aggregation: 'sum' }] }, format: title('Seller Protection') },
        byReason: {
          type: 'column-chart-grouped',
          dataMapping: { categoryKey: [{ id: 'disputes.reason' }], valueKey: [{ id: 'disputes.amount', aggregation: 'sum' }] },
          format: title('Disputed amount by reason'),
        },
        byAction: {
          type: 'donut-chart',
          dataMapping: { categoryKey: [{ id: 'disputes.recommended' }], valueKey: [{ id: 'disputes.amount', aggregation: 'sum' }] },
          format: title('What the agent recommends, by amount'),
        },
        radar: {
          type: 'deadline-radar',
          dataMapping: { label: [{ id: 'disputes.id' }], days: [{ id: 'disputes.daysLeft', aggregation: 'min' }], amount: [{ id: 'disputes.atRisk', aggregation: 'sum' }] },
          format: title('Deadline radar'),
        },
        cases: {
          type: 'grid',
          dataMapping: { cols: [{ id: 'disputes.id' }, { id: 'disputes.reason' }, { id: 'disputes.amount' }, { id: 'disputes.status' }, { id: 'disputes.winEstimate' }, { id: 'disputes.recommended' }, { id: 'disputes.expectedCost' }] },
          format: title('Cases'),
        },
        protection: {
          type: 'column-chart-grouped',
          dataMapping: { categoryKey: [{ id: 'orders.protection' }], valueKey: [{ id: 'orders.amount', aggregation: 'sum' }] },
          format: title('Order value by protection status'),
        },
        exposed: {
          type: 'grid',
          dataMapping: { cols: [{ id: 'orders.id' }, { id: 'orders.item' }, { id: 'orders.amount' }, { id: 'orders.protection' }, { id: 'orders.carrier' }] },
          format: title('Orders'),
        },
      },
      widgetLayout: {
        status: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 6 },
        risk: { xTrack: 0, yTrack: 6, xSpan: 5, ySpan: 8 },
        count: { xTrack: 5, yTrack: 6, xSpan: 5, ySpan: 8 },
        win: { xTrack: 10, yTrack: 6, xSpan: 5, ySpan: 8 },
        cover: { xTrack: 15, yTrack: 6, xSpan: 9, ySpan: 8 },
        byReason: { xTrack: 0, yTrack: 14, xSpan: 13, ySpan: 15 },
        byAction: { xTrack: 13, yTrack: 14, xSpan: 11, ySpan: 15 },
        radar: { xTrack: 0, yTrack: 29, xSpan: 10, ySpan: 16 },
        cases: { xTrack: 10, yTrack: 29, xSpan: 14, ySpan: 16 },
        protection: { xTrack: 0, yTrack: 45, xSpan: 10, ySpan: 14 },
        exposed: { xTrack: 10, yTrack: 45, xSpan: 14, ySpan: 14 },
      },
    },
  ],
} as unknown as AgReportState<CustomRegistry>;

function loadSaved(): AgReportState<CustomRegistry> | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AgReportState<CustomRegistry>) : undefined;
  } catch {
    return undefined;
  }
}

export default function InsightsView() {
  const [source, setSource] = useState<{ rows: OverviewRow[]; orders: Order[] }>();
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<AgStudioMode>('view');
  const studioRef = useRef<AgStudio<CustomRegistry>>(null);

  useEffect(() => {
    Promise.all([api.overview(), api.orders()]).then(
      ([o, r]) => setSource({ rows: o.rows, orders: r.orders }),
      (e) => setError((e as Error).message),
    );
  }, []);

  const data = useMemo(() => (source ? buildData(source.rows, source.orders) : undefined), [source]);
  const initialState = useMemo(() => loadSaved() ?? defaultReport, []);

  const save = () => {
    try {
      if (studioRef.current) localStorage.setItem(STORAGE_KEY, JSON.stringify(studioRef.current.api.getState()));
    } catch {
      // Private windows can refuse storage; the dashboard still works.
    }
  };
  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    studioRef.current?.api.setState(defaultReport);
    studioRef.current?.api.clearHistory();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Insights</h1>
          <p>Where disputes cost you money and which sales are still unprotected. Click any chart to cross-filter. In edit mode, ask the AI to build new views.</p>
        </div>
        <div className="row">
          {mode === 'edit' && <button className="btn ghost" onClick={reset}>Reset layout</button>}
          <button className="btn" onClick={() => { if (mode === 'edit') save(); setMode(mode === 'edit' ? 'view' : 'edit'); }}>
            {mode === 'edit' ? 'Save and close editor' : '✦ Edit with AI'}
          </button>
        </div>
      </div>
      {error && <div className="banner warn">{error}</div>}
      <div className="card" style={{ height: 'calc(100vh - 150px)', minHeight: 620, overflow: 'hidden', padding: 0 }}>
        {data ? (
          <AgStudioProvider licenseKey={import.meta.env.VITE_AG_STUDIO_LICENSE} modules={aiModules}>
            <AgStudio<CustomRegistry>
              ref={studioRef}
              style={{ height: '100%', width: '100%' }}
              theme={theme}
              data={data}
              widgets={widgets}
              ai={ai}
              initialState={initialState}
              mode={mode}
            />
          </AgStudioProvider>
        ) : (
          <div className="empty"><span className="spin" /> Loading data…</div>
        )}
      </div>
    </>
  );
}
