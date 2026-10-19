// Two Proofline widgets for AG Studio: a deadline radar (open disputes by days
// left, sized by money at risk) and a Seller Protection coverage ring. Both
// query through widgetApi, so page filters and cross-filters apply to them.
import { useEffect, useState } from 'react';
import type {
  AgDefaultRegistry,
  AgDefaultWidgetDefinition,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
  AgWidgetMenuGroup,
  AgWidgetParams,
  AgWidgetsConfig,
} from 'ag-studio';
import { createWidgets, type AgRegistry, type AgWidgetDefinition } from 'ag-studio-react';

// ---- Deadline radar ------------------------------------------------------

export interface RadarWidget
  extends AgWidgetData<{ label: AgWidgetFieldReference[]; days: AgWidgetFieldReference[]; amount: AgWidgetFieldReference[] }, AgWidgetDataFormat<object>> {
  type: 'deadline-radar';
}

interface RadarRow { label: string; days: number; amount: number; amountText: string }

function RadarComp(props: AgWidgetParams<RadarWidget>) {
  const { widgetApi, dataMapping } = props;
  const [rows, setRows] = useState<RadarRow[]>([]);
  useEffect(() => {
    const label = dataMapping.label?.[0];
    const days = dataMapping.days?.[0];
    const amount = dataMapping.amount?.[0];
    if (!label || !days || !amount) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }
    let cancelled = false;
    widgetApi.setDisplayState('loading');
    widgetApi
      .getData({ fields: [label, days, amount] })
      .then((res) => {
        if (cancelled) return;
        const out = res.results.rows
          .map((r) => ({
            label: String(r[label.key] ?? ''),
            days: Number(r[days.key]),
            amount: Number(r[amount.key] ?? 0),
            amountText: widgetApi.formatFieldValue(amount, r[amount.key]),
          }))
          .filter((r) => Number.isFinite(r.days) && r.amount > 0)
          .sort((a, b) => a.days - b.days)
          .slice(0, 12);
        setRows(out);
        widgetApi.setDisplayState(out.length ? 'displayed' : 'noData');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props]);

  const maxAmount = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <div style={{ padding: '6px 10px', display: 'grid', gap: 7, fontSize: 12.5 }}>
      {rows.map((r) => {
        const tone = r.days <= 2 ? '#b23b31' : r.days <= 5 ? '#a8660d' : '#1f7a5a';
        return (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 70px 58px', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11.5 }}>{r.label}</span>
            <span style={{ position: 'relative', height: 16, background: 'rgba(23,50,77,.06)', borderRadius: 5 }}>
              <span style={{ position: 'absolute', inset: 0, width: `${Math.max(6, (r.amount / maxAmount) * 100)}%`, background: tone, opacity: 0.85, borderRadius: 5 }} />
            </span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.amountText}</span>
            <span style={{ color: tone, fontWeight: 600, textAlign: 'right' }}>{r.days < 0 ? 'overdue' : `${r.days}d left`}</span>
          </div>
        );
      })}
    </div>
  );
}

const radarDefinition: AgWidgetDefinition<'deadline-radar', RadarWidget> = {
  id: 'deadline-radar',
  label: 'Deadline radar',
  comp: RadarComp,
  defaultSize: { width: 10, height: 14 },
  minSize: { width: 6, height: 8 },
  dataMapping: {
    label: { type: 'field', supportedRoles: ['category'], required: true },
    days: { type: 'field', supportedRoles: ['numeric'], required: true },
    amount: { type: 'field', supportedRoles: ['numeric'], required: true },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: 'label', label: 'Case' }, { key: 'days', label: 'Days left' }, { key: 'amount', label: 'Amount' }] }),
};

// ---- Coverage ring -------------------------------------------------------

export interface CoverageWidget
  extends AgWidgetData<{ covered: AgWidgetFieldReference[]; total: AgWidgetFieldReference[] }, AgWidgetDataFormat<object>> {
  type: 'coverage-ring';
}

function CoverageComp(props: AgWidgetParams<CoverageWidget>) {
  const { widgetApi, dataMapping } = props;
  const [v, setV] = useState<{ covered: number; total: number }>();
  useEffect(() => {
    const covered = dataMapping.covered?.[0];
    const total = dataMapping.total?.[0];
    if (!covered || !total) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }
    let cancelled = false;
    widgetApi.setDisplayState('loading');
    widgetApi
      .getData({ fields: [covered, total] })
      .then((res) => {
        if (cancelled) return;
        const row = res.results.rows[0];
        if (!row) return widgetApi.setDisplayState('noData');
        setV({ covered: Number(row[covered.key] ?? 0), total: Number(row[total.key] ?? 0) });
        widgetApi.setDisplayState('displayed');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props]);

  const pct = v && v.total ? v.covered / v.total : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = pct >= 0.9 ? '#1f7a5a' : pct >= 0.6 ? '#a8660d' : '#b23b31';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 12px', height: '100%' }}>
      <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${Math.round(pct * 100)} percent of orders protected`}>
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(23,50,77,.08)" strokeWidth="9" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" fontSize="17" fontWeight="600" fill="#17324d">{Math.round(pct * 100)}%</text>
      </svg>
      <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>
        <div style={{ fontWeight: 600 }}>{v ? `${v.covered} of ${v.total}` : '-'} shipped orders</div>
        <div style={{ color: '#5f6b7a' }}>have tracking on PayPal, so they qualify for Seller Protection.</div>
      </div>
    </div>
  );
}

const coverageDefinition: AgWidgetDefinition<'coverage-ring', CoverageWidget> = {
  id: 'coverage-ring',
  label: 'Protection coverage',
  comp: CoverageComp,
  defaultSize: { width: 8, height: 8 },
  minSize: { width: 6, height: 6 },
  dataMapping: {
    covered: { type: 'field', supportedRoles: ['numeric'], required: true },
    total: { type: 'field', supportedRoles: ['numeric'], required: true },
  },
  form: (params) => params.createDefaults({ dataMappingItems: [{ key: 'covered', label: 'Covered orders' }, { key: 'total', label: 'All physical orders' }] }),
};

// ---- Registry ------------------------------------------------------------

export interface CustomRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | AgWidgetDefinition<'deadline-radar', RadarWidget> | AgWidgetDefinition<'coverage-ring', CoverageWidget>)[];
}

export const widgets = (defaults: AgWidgetsConfig<AgDefaultRegistry>) =>
  createWidgets<CustomRegistry>({
    additionalTypes: [radarDefinition, coverageDefinition],
    menu: [...(defaults.menu as AgWidgetMenuGroup<CustomRegistry>[]), { label: 'Proofline', widgetIds: ['deadline-radar', 'coverage-ring'] }],
  });
