// Deterministic evidence playbook: which facts win which dispute reason, an
// explainable win estimate, and the expected cost of each way to respond.
// The LLM never decides these numbers; it only explains and drafts.

import type {
  ActionKind,
  ActionOption,
  Address,
  CaseFacts,
  CasePlan,
  DisputeReason,
  EvidenceCheck,
  EvidenceItem,
  Tracker,
} from './types';

/** PayPal (US) requires signature confirmation for Seller Protection at or above this amount. */
export const SIGNATURE_THRESHOLD_USD = 750;

/** Starting win estimate per reason before any evidence is counted. */
const BASE_WIN: Record<DisputeReason, number> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 0.1,
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 0.08,
  UNAUTHORISED: 0.1,
  CREDIT_NOT_PROCESSED: 0.1,
  DUPLICATE_TRANSACTION: 0.1,
  INCORRECT_AMOUNT: 0.1,
  PAYMENT_BY_OTHER_MEANS: 0.1,
  CANCELED_RECURRING_BILLING: 0.1,
  OTHER: 0.1,
};

export const REASON_LABEL: Record<DisputeReason, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Not as described',
  UNAUTHORISED: 'Unauthorized payment',
  CREDIT_NOT_PROCESSED: 'Refund not processed',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
  INCORRECT_AMOUNT: 'Incorrect amount',
  PAYMENT_BY_OTHER_MEANS: 'Paid by other means',
  CANCELED_RECURRING_BILLING: 'Canceled subscription',
  OTHER: 'Other',
};

const amountOf = (facts: CaseFacts) => Number(facts.dispute.amount.value);

function norm(s?: string) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Same street line, postal code and country, ignoring punctuation and case. */
export function sameAddress(a?: Address, b?: Address): boolean {
  if (!a || !b) return false;
  return (
    norm(a.line1) === norm(b.line1) &&
    norm(a.postalCode) === norm(b.postalCode) &&
    norm(a.countryCode) === norm(b.countryCode)
  );
}

function bestTracker(trackers: Tracker[]): Tracker | undefined {
  const rank = (t: Tracker) =>
    (t.carrierStatus === 'DELIVERED' ? 4 : 0) + (t.uploadedToPayPal ? 2 : 0) + (t.signatureConfirmed ? 1 : 0);
  return [...trackers].sort((a, b) => rank(b) - rank(a))[0];
}

function check(
  id: string,
  label: string,
  status: EvidenceCheck['status'],
  weight: number,
  detail: string,
  fix?: string,
): EvidenceCheck {
  return { id, label, status, weight, detail, fix };
}

function fulfilmentChecks(facts: CaseFacts, requireDelivery: boolean): EvidenceCheck[] {
  const order = facts.order;
  const amount = amountOf(facts);
  if (!order) {
    return [check('order', 'Order found', 'fail', 0.2, 'No order matches the disputed transaction.', 'Link the order in your store records.')];
  }
  if (order.intangible) {
    return [
      check('intangible', 'Digital or service delivery record', 'unknown', 0.3,
        'This order has no shipment. Seller Protection does not cover intangible goods, so access logs or proof of service carry the case.',
        'Attach download or login logs that show the buyer used the purchase.'),
    ];
  }
  const t = bestTracker(order.trackers);
  const checks: EvidenceCheck[] = [];
  checks.push(
    t
      ? check('tracking', 'Tracking number on file', 'pass', 0.15, `${t.carrier} ${t.trackingNumber}.`)
      : check('tracking', 'Tracking number on file', 'fail', 0.15, 'No tracking number was recorded for this order.', 'Paste the shipping confirmation in Protection so the agent can attach it.'),
  );
  checks.push(
    t?.uploadedToPayPal
      ? check('uploaded', 'Tracking uploaded to PayPal', 'pass', 0.1, `Uploaded ${t.uploadedAt?.slice(0, 10) ?? ''}.`.trim())
      : check('uploaded', 'Tracking uploaded to PayPal', t ? 'fail' : 'na', 0.1,
          t ? 'Tracking exists but PayPal does not have it yet.' : 'Nothing to upload yet.',
          t ? 'Approve the agent\'s tracking upload.' : undefined),
  );
  if (requireDelivery) {
    checks.push(
      t?.carrierStatus === 'DELIVERED'
        ? check('delivered', 'Carrier confirms delivery', 'pass', 0.3, `Delivered ${t.deliveredAt?.slice(0, 10) ?? ''}.`.trim())
        : check('delivered', 'Carrier confirms delivery', t ? 'fail' : 'na', 0.3,
            t ? `Latest carrier status is ${t.carrierStatus ?? 'unknown'}.` : 'No shipment to check.'),
    );
    const addrOk = t?.deliveredTo ? sameAddress(t.deliveredTo, order.shippingAddress) : undefined;
    checks.push(
      addrOk === undefined
        ? check('address', 'Delivered to the PayPal shipping address', t?.carrierStatus === 'DELIVERED' ? 'unknown' : 'na', 0.15,
            'The carrier did not report a delivery address.')
        : addrOk
          ? check('address', 'Delivered to the PayPal shipping address', 'pass', 0.15, 'Carrier delivery address matches the address on the PayPal transaction.')
          : check('address', 'Delivered to the PayPal shipping address', 'fail', 0.15,
              'The carrier delivered to a different address than the one on the PayPal transaction, which voids Seller Protection.'),
    );
  }
  if (amount >= SIGNATURE_THRESHOLD_USD) {
    checks.push(
      t?.signatureConfirmed
        ? check('signature', 'Signature confirmation', 'pass', 0.15, `Required at $${SIGNATURE_THRESHOLD_USD}+ and present.`)
        : check('signature', 'Signature confirmation', 'fail', 0.15,
            `PayPal requires signature confirmation for orders of $${SIGNATURE_THRESHOLD_USD} or more, and this shipment has none.`,
            'Ship high-value orders with signature confirmation.'),
    );
  }
  return checks;
}

function buyerHistoryCheck(facts: CaseFacts, weight: number): EvidenceCheck {
  return facts.buyerPriorOrders > 0
    ? check('history', 'Buyer has undisputed past orders', 'pass', weight,
        `${facts.buyerPriorOrders} earlier order${facts.buyerPriorOrders === 1 ? '' : 's'} from the same buyer completed without a dispute.`)
    : check('history', 'Buyer has undisputed past orders', 'unknown', weight, 'First order from this buyer.');
}

function listingChecks(facts: CaseFacts): EvidenceCheck[] {
  const skus = new Set(facts.order?.items.map((i) => i.sku).filter(Boolean));
  const listings = facts.listings.filter((l) => skus.has(l.sku));
  const withPhotos = listings.filter((l) => l.photos.length > 0);
  const policy = listings.find((l) => l.returnPolicy) ?? (facts.storePolicy.returnWindowDays > 0 ? { returnPolicy: `${facts.storePolicy.returnWindowDays}-day returns` } : undefined);
  const buyerText = facts.dispute.messages.filter((m) => m.postedBy === 'BUYER').map((m) => m.content).join(' ');
  return [
    listings.length
      ? check('listing', 'Listing description saved', 'pass', 0.15, `${listings.length} listing snapshot${listings.length > 1 ? 's' : ''} on file.`)
      : check('listing', 'Listing description saved', 'fail', 0.15, 'No snapshot of what the buyer was shown.', 'Keep listing snapshots for every sale.'),
    withPhotos.length
      ? check('photos', 'Product photos', 'pass', 0.1, `${withPhotos.reduce((n, l) => n + l.photos.length, 0)} photos on file.`)
      : check('photos', 'Product photos', 'fail', 0.1, 'No product photos on file.'),
    policy
      ? check('returns', 'Return offered', 'pass', 0.1, `Store policy: ${policy.returnPolicy}. Offering a return usually closes "not as described" cases.`)
      : check('returns', 'Return offered', 'fail', 0.1, 'No return policy on file.'),
    buyerText
      ? check('buyer-claim', 'Buyer explained the problem', 'pass', 0, 'The buyer\'s message is available, so the response can answer it point by point.')
      : check('buyer-claim', 'Buyer explained the problem', 'unknown', 0, 'The buyer has not said what is wrong.', 'Ask the buyer for details and photos.'),
  ];
}

function refundCheck(facts: CaseFacts): EvidenceCheck {
  const refunds = facts.order?.refunds ?? [];
  return refunds.length
    ? check('refund', 'Refund already issued', 'pass', 0.6, `Refund ${refunds[0].id} of ${refunds[0].amount.value} ${refunds[0].amount.currency_code} on ${refunds[0].createdAt.slice(0, 10)}.`)
    : check('refund', 'Refund already issued', 'fail', 0.6, 'No refund is recorded for this order.');
}

export function evidenceChecks(facts: CaseFacts): EvidenceCheck[] {
  switch (facts.dispute.reason) {
    case 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED':
      return fulfilmentChecks(facts, true);
    case 'UNAUTHORISED':
      return [...fulfilmentChecks(facts, true), buyerHistoryCheck(facts, 0.15)];
    case 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED':
      // Shipment proof matters little here: the buyer agrees the item arrived.
      return [...listingChecks(facts), ...fulfilmentChecks(facts, false).filter((c) => c.id === 'tracking').map((c) => ({ ...c, weight: 0.05 }))];
    case 'CREDIT_NOT_PROCESSED':
      return [refundCheck(facts)];
    case 'DUPLICATE_TRANSACTION':
    case 'INCORRECT_AMOUNT':
      return [
        facts.order ? check('receipt', 'Order receipt matches the charge', 'pass', 0.4, `Order ${facts.order.id} totals ${facts.order.amount.value} ${facts.order.amount.currency_code}.`) : check('receipt', 'Order receipt matches the charge', 'fail', 0.4, 'No order found.'),
        refundCheck(facts),
      ];
    default:
      return [...fulfilmentChecks(facts, false), buyerHistoryCheck(facts, 0.1)];
  }
}

export function winProbability(reason: DisputeReason, checks: EvidenceCheck[]): number {
  let p = BASE_WIN[reason];
  for (const c of checks) {
    if (c.status === 'pass') p += c.weight;
    else if (c.status === 'unknown') p += c.weight * 0.3;
  }
  // A failed hard requirement caps the case.
  const hardFail = checks.some((c) => (c.id === 'address' || c.id === 'signature') && c.status === 'fail');
  if (hardFail) p = Math.min(p, 0.25);
  return Math.round(Math.max(0.02, Math.min(0.95, p)) * 100) / 100;
}

const money = (n: number) => Math.round(n * 100) / 100;

export function actionOptions(facts: CaseFacts, p: number): ActionOption[] {
  const amount = amountOf(facts);
  const { disputeFee, timeCostPerCase, costOfGoodsRatio, returnWindowDays } = facts.storePolicy;
  const reason = facts.dispute.reason;
  const options: ActionOption[] = [];

  options.push({
    kind: 'FIGHT',
    label: 'Fight with evidence',
    expectedLoss: money((1 - p) * (amount + disputeFee) + timeCostPerCase),
    explanation: `${Math.round(p * 100)}% estimated win. If lost: the ${amount.toFixed(2)} payment plus a ${disputeFee.toFixed(2)} fee.`,
  });

  // Refunding returns the money; for not-as-described the item normally comes back.
  const itemComesBack = reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' && returnWindowDays > 0;
  options.push({
    kind: 'REFUND',
    label: itemComesBack ? 'Accept and take the item back' : 'Refund in full',
    expectedLoss: money(itemComesBack ? amount * 0.12 : amount),
    explanation: itemComesBack
      ? 'Buyer returns the item. Loss is shipping and handling, estimated at 12% of the price.'
      : `Refund ${amount.toFixed(2)}. The buyer keeps the goods.`,
  });

  if (reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') {
    const offer = money(amount * 0.3);
    const accept = 0.55;
    options.push({
      kind: 'OFFER',
      label: `Offer a $${offer.toFixed(2)} partial refund`,
      expectedLoss: money(accept * offer + (1 - accept) * ((1 - p) * (amount + disputeFee) + timeCostPerCase)),
      explanation: `Buyer keeps the item at 30% off. Assumes about half of buyers accept; otherwise the case continues.`,
    });
  }
  if (reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' && facts.order && !facts.order.trackers.some((t) => t.carrierStatus === 'DELIVERED')) {
    options.push({
      kind: 'WAIT',
      label: 'Reship or wait for delivery',
      expectedLoss: money(amount * costOfGoodsRatio + 8),
      explanation: 'Send a replacement (cost of goods plus about 8.00 postage) and upload the new tracking.',
    });
  }
  return options.sort((a, b) => a.expectedLoss - b.expectedLoss);
}

export function evidenceFor(facts: CaseFacts): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const order = facts.order;
  const trackers = order?.trackers ?? [];
  if (trackers.length) {
    items.push({
      type: 'PROOF_OF_FULFILLMENT',
      summary: trackers.map((t) => `${t.carrier} ${t.trackingNumber} (${t.carrierStatus ?? 'status unknown'})`).join('; '),
      trackingInfo: trackers.map((t) => ({ carrier_name: t.carrier, tracking_number: t.trackingNumber })),
    });
  }
  if (order?.refunds.length) {
    items.push({ type: 'PROOF_OF_REFUND', summary: `Refund ${order.refunds.map((r) => r.id).join(', ')}`, refundIds: order.refunds.map((r) => r.id) });
  }
  if (facts.dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' && facts.listings.length) {
    items.push({ type: 'ITEM_DESCRIPTION', summary: facts.listings.map((l) => l.title).join('; ') });
    items.push({ type: 'RETURN_POLICY', summary: `${facts.storePolicy.returnWindowDays}-day returns` });
  }
  return items;
}

export function planCase(facts: CaseFacts, now = new Date()): CasePlan {
  const checks = evidenceChecks(facts);
  const p = winProbability(facts.dispute.reason, checks);
  const options = actionOptions(facts, p);
  let recommended: ActionKind = options[0].kind;
  // Small amounts: the seller's own rule wins unless evidence is very strong.
  if (amountOf(facts) <= facts.storePolicy.autoRefundBelow && p < 0.8) recommended = 'REFUND';
  return {
    disputeId: facts.dispute.id,
    winProbability: p,
    checks,
    options,
    recommended,
    evidence: evidenceFor(facts),
    generatedAt: now.toISOString(),
  };
}

/** Days left until the seller's response is due (negative when overdue). */
export function daysLeft(due: string | undefined, now = new Date()): number | undefined {
  if (!due) return undefined;
  return Math.round(((Date.parse(due) - now.getTime()) / 86_400_000) * 10) / 10;
}
