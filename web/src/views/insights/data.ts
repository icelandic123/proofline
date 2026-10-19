// Flattens cases and orders into the two related tables AG Studio analyses.
import type { AgDataSourcesDefinition } from 'ag-studio';
import { REASON_LABEL } from '../../../../shared/playbook';
import type { Order } from '../../../../shared/types';
import type { OverviewRow } from '../../api';
import type { CustomRegistry } from './widgets';

const ACTION: Record<string, string> = { FIGHT: 'Fight', REFUND: 'Refund', OFFER: 'Partial refund', WAIT: 'Wait or reship', ASK_BUYER: 'Ask buyer' };
const usd = { formatOptions: { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) } };
const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

export function disputeRows(rows: OverviewRow[]) {
  return rows.map((r) => {
    const d = r.dispute;
    const resolved = d.status === 'RESOLVED';
    const won = d.outcome === 'RESOLVED_SELLER_FAVOUR';
    return {
      id: d.id,
      orderId: d.sellerTransactionIds[0] ?? '',
      buyer: d.buyerName ?? d.buyerEmail ?? '',
      reason: REASON_LABEL[d.reason],
      stage: d.stage === 'CHARGEBACK' ? 'Chargeback' : 'PayPal claim',
      amount: Number(d.amount.value),
      opened: day(d.createdAt),
      due: day(d.sellerResponseDueDate),
      daysLeft: resolved ? null : Math.round(r.daysLeft ?? 0),
      status: resolved ? (won ? 'Won' : d.outcome === 'RESOLVED_BUYER_FAVOUR' ? 'Lost' : 'Closed') : r.caseStatus === 'submitted' ? 'Sent to PayPal' : 'Open',
      atRisk: resolved ? 0 : Number(d.amount.value),
      winEstimate: r.winProbability ?? null,
      recommended: r.recommended ? ACTION[r.recommended] ?? r.recommended : 'Not assessed',
      expectedCost: r.expectedLoss ?? null,
      decision: r.decision ? ACTION[r.decision.kind] ?? r.decision.kind : 'None yet',
      resolved: resolved ? 1 : 0,
      won: won ? 1 : 0,
    };
  });
}

export function orderRows(orders: Order[]) {
  return orders.map((o) => {
    const uploaded = o.trackers.some((t) => t.uploadedToPayPal);
    return {
      id: o.id,
      captureId: o.captureId ?? '',
      created: day(o.createdAt),
      buyer: o.buyerName ?? '',
      item: o.items.map((i) => i.name).join(', '),
      amount: Number(o.amount.value),
      carrier: o.trackers[0]?.carrier ?? (o.intangible ? 'Digital' : 'Not shipped'),
      protection: o.intangible ? 'Digital (not eligible)' : uploaded ? 'Protected' : o.trackers.length ? 'Upload pending' : 'Exposed',
      physical: o.intangible ? 0 : 1,
      covered: !o.intangible && uploaded ? 1 : 0,
      exposedAmount: !o.intangible && !uploaded ? Number(o.amount.value) : 0,
    };
  });
}

export function buildData(rows: OverviewRow[], orders: Order[]): AgDataSourcesDefinition<CustomRegistry> {
  const disputes = disputeRows(rows);
  // Disputes reference the capture id; map it to the order id for the join.
  const byCapture = new Map(orders.map((o) => [o.captureId, o.id]));
  for (const d of disputes) d.orderId = byCapture.get(d.orderId) ?? d.orderId;
  return {
    description:
      'PayPal disputes and orders for a small ceramics shop (Fernhill Ceramics). Amounts are USD. ' +
      'A dispute is "at risk" while open. winEstimate is the evidence-based chance to win (0 to 1). ' +
      'expectedCost is the expected money lost for the recommended action. An order is "Protected" when its tracking is on the PayPal transaction, which Seller Protection needs.',
    sources: [
      {
        id: 'disputes',
        name: 'Disputes',
        data: disputes,
        fields: [
          { id: 'id', name: 'Dispute', format: 'textFormat' },
          { id: 'orderId', name: 'Order', format: 'textFormat', hide: true },
          { id: 'buyer', name: 'Buyer', format: 'textFormat' },
          { id: 'reason', name: 'Reason', format: 'textFormat' },
          { id: 'stage', name: 'Stage', format: 'textFormat' },
          { id: 'amount', name: 'Disputed amount', format: 'currencyFormat', ...usd },
          { id: 'atRisk', name: 'Money at risk', format: 'currencyFormat', ...usd },
          { id: 'opened', name: 'Opened', format: 'dateFormat' },
          { id: 'due', name: 'Response due', format: 'dateFormat' },
          { id: 'daysLeft', name: 'Days left', format: 'integerFormat' },
          { id: 'status', name: 'Status', format: 'textFormat' },
          { id: 'winEstimate', name: 'Win estimate', format: 'percentageFormat' },
          { id: 'recommended', name: 'Agent recommends', format: 'textFormat' },
          { id: 'expectedCost', name: 'Expected cost', format: 'currencyFormat', ...usd },
          { id: 'decision', name: 'Seller decision', format: 'textFormat' },
          { id: 'resolved', name: 'Resolved', format: 'integerFormat' },
          { id: 'won', name: 'Won', format: 'integerFormat' },
        ],
      },
      {
        id: 'orders',
        name: 'Orders',
        data: orderRows(orders),
        fields: [
          { id: 'id', name: 'Order', format: 'textFormat' },
          { id: 'captureId', name: 'Capture', format: 'textFormat', hide: true },
          { id: 'created', name: 'Paid on', format: 'dateFormat' },
          { id: 'buyer', name: 'Buyer', format: 'textFormat' },
          { id: 'item', name: 'Item', format: 'textFormat' },
          { id: 'amount', name: 'Order value', format: 'currencyFormat', ...usd },
          { id: 'carrier', name: 'Carrier', format: 'textFormat' },
          { id: 'protection', name: 'Protection', format: 'textFormat' },
          { id: 'physical', name: 'Physical', format: 'integerFormat' },
          { id: 'covered', name: 'Tracking on PayPal', format: 'integerFormat' },
          { id: 'exposedAmount', name: 'Unprotected value', format: 'currencyFormat', ...usd },
        ],
      },
    ],
    relationships: [
      { id: 'dispute-order', type: 'many-to-one', source: { tableId: 'disputes', fieldId: 'orderId' }, target: { tableId: 'orders', fieldId: 'id' } },
    ],
    expressions: [
      {
        id: 'winRate', name: 'Win rate', format: 'percentageFormat', isMeasure: true,
        expression: { operator: 'divide', inputs: [{ id: 'disputes.won', aggregation: 'sum' }, { id: 'disputes.resolved', aggregation: 'sum' }] },
      },
      {
        id: 'coverage', name: 'Protection coverage', format: 'percentageFormat', isMeasure: true,
        expression: { operator: 'divide', inputs: [{ id: 'orders.covered', aggregation: 'sum' }, { id: 'orders.physical', aggregation: 'sum' }] },
      },
    ],
  } as AgDataSourcesDefinition<CustomRegistry>;
}
