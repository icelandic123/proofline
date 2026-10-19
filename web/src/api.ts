import type { CaseFacts, CasePlan, Dispute, Draft, GroundingIssue, Listing, Order, StorePolicy } from '../../shared/types';

export interface CaseRow {
  disputeId: string;
  status: 'new' | 'ready' | 'needs_edit' | 'submitted' | 'resolved';
  plan?: CasePlan;
  draft?: Draft;
  decision?: { kind: string; at: string; note?: string; amount?: number };
  updatedAt: string;
}

export interface Activity {
  id: number;
  ts: string;
  actor: 'agent' | 'seller' | 'paypal' | 'demo';
  kind: string;
  disputeId?: string;
  orderId?: string;
  text: string;
}

export interface OverviewRow {
  dispute: Dispute;
  caseStatus: CaseRow['status'];
  winProbability?: number;
  recommended?: string;
  expectedLoss?: number;
  verified?: boolean;
  decision?: CaseRow['decision'];
  daysLeft?: number;
}

export interface Protection {
  physical_orders: number;
  shipped: number;
  tracking_on_paypal: number;
  coverage_pct: number;
  unprotected_amount: number;
  missing: { order: string; buyer?: string; amount: string; has_tracking_not_uploaded: boolean }[];
}

export interface Overview {
  mode: 'sandbox' | 'offline';
  rows: OverviewRow[];
  stats: { open: number; atRisk: number; dueSoon: number; awaitingApproval: number; won: number; lost: number; winRate?: number };
  protection: Protection;
}

export interface Config {
  mode: 'sandbox' | 'offline';
  paypalClientId: string | null;
  store: StorePolicy;
  model: string | null;
  listings: (Listing & { price: string })[];
  scenarios: { id: string; title: string; expect: string }[];
}

export interface TrackingProposal {
  orderId?: string;
  buyer?: string;
  carrier?: string;
  trackingNumber: string;
  valid: boolean;
  reason: string;
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    method: init?.json !== undefined ? 'POST' : init?.method,
    headers: init?.json !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error ?? `Request failed (${res.status})`) as Error & { data?: unknown; status?: number };
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const api = {
  config: () => call<Config>('/api/config'),
  overview: () => call<Overview>('/api/overview'),
  orders: () => call<{ orders: Order[]; protection: Protection }>('/api/orders'),
  activity: (dispute?: string) => call<{ activity: Activity[] }>(`/api/activity${dispute ? `?dispute=${dispute}` : ''}`),
  case: (id: string) => call<{ facts: CaseFacts; case: CaseRow | null; plan: CasePlan; activity: Activity[] }>(`/api/cases/${id}`),
  analyze: (id: string) => call<{ case: CaseRow }>(`/api/cases/${id}/analyze`, { json: {} }),
  check: (id: string, text: string) => call<{ ok: boolean; issues: GroundingIssue[]; checkedTokens: number }>(`/api/cases/${id}/check`, { json: { text } }),
  submit: (id: string, body: { kind: 'FIGHT' | 'REFUND' | 'OFFER'; response?: string; buyerMessage?: string; offerAmount?: number }) =>
    call<{ ok: boolean; issues?: GroundingIssue[] }>(`/api/cases/${id}/submit`, { json: body }),
  parseTracking: (text: string) => call<{ proposals: TrackingProposal[]; model: string }>('/api/tracking/parse', { json: { text } }),
  applyTracking: (orderId: string, carrier: string, trackingNumber: string) => call<{ ok: boolean }>('/api/tracking/apply', { json: { orderId, carrier, trackingNumber } }),
  ask: (question: string) => call<{ answer: string; trace: { tool: string; args: Record<string, unknown> }[]; model: string }>('/api/ask', { json: { question } }),
  sweep: () => call<{ analysed: number; uploaded: number; disputes: number }>('/api/sweep', { json: {} }),
  demoDispute: (scenario: string) => call<{ disputeId: string; orderId: string }>('/api/demo/dispute', { json: { scenario } }),
  adjudicate: (id: string, sellerWins: boolean) => call<{ ok: boolean }>(`/api/demo/adjudicate/${id}`, { json: { sellerWins } }),
  shopCreate: (sku: string) => call<{ id: string }>('/api/shop/orders', { json: { sku } }),
  shopCapture: (id: string) => call<{ order: Order }>(`/api/shop/orders/${id}/capture`, { json: {} }),
};

export const fmtMoney = (v: string | number, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(v));

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
