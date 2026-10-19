// Demo scenarios a visitor can trigger. Each one makes a real sandbox payment,
// records the store's shipment, and has the sandbox buyer open a dispute.
// Carrier delivery events are simulated (in production they come from the
// shipping provider's webhooks).

import { LISTINGS, PRICES } from '../shared/fixtures';
import type { Address, DisputeReason, Order, Tracker } from '../shared/types';

export type ScenarioId = 'inr-delivered' | 'inr-in-transit' | 'snad-colour' | 'unauthorised-no-signature' | 'refund-already-sent';

interface Scenario {
  title: string;
  expect: string;
  reason: DisputeReason;
  sku: string;
  buyerNote: string;
  shipment?: { carrier: 'USPS' | 'UPS' | 'FEDEX'; uploaded: boolean; status: Tracker['carrierStatus']; signature?: boolean; daysAgo: number };
  refunded?: boolean;
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  'inr-delivered': {
    title: '"Never arrived", but the carrier delivered it',
    expect: 'Agent fights with proof of delivery',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    sku: 'FH-BOWL-SET',
    buyerNote: 'My bowls never arrived. It has been two weeks. I want a refund.',
    shipment: { carrier: 'USPS', uploaded: true, status: 'DELIVERED', daysAgo: 9 },
  },
  'inr-in-transit': {
    title: '"Where is my order?" while the parcel is still moving',
    expect: 'Agent uploads the missing tracking and advises waiting, not fighting',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    sku: 'FH-VASE-TALL',
    buyerNote: 'The tracking has not updated in days. Where is my vase?',
    shipment: { carrier: 'UPS', uploaded: false, status: 'IN_TRANSIT', daysAgo: 4 },
  },
  'snad-colour': {
    title: '"Not as described": the glaze looks darker',
    expect: 'Agent compares the options and suggests a partial refund',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    sku: 'FH-MUG-SAGE',
    buyerNote: 'The mug is much darker green than the photo and has a dark spot near the rim.',
    shipment: { carrier: 'USPS', uploaded: true, status: 'DELIVERED', daysAgo: 6 },
  },
  'unauthorised-no-signature': {
    title: '"I didn\'t make this payment" on an $840 order',
    expect: 'Agent flags the missing signature and weighs a weak fight against losing the full $840',
    reason: 'UNAUTHORISED',
    sku: 'FH-DINNER-12',
    buyerNote: 'I do not recognise this payment.',
    shipment: { carrier: 'FEDEX', uploaded: true, status: 'DELIVERED', signature: false, daysAgo: 12 },
  },
  'refund-already-sent': {
    title: '"Refund never came" after a cancelled class',
    expect: 'Agent proves the refund with PayPal\'s own refund record',
    reason: 'CREDIT_NOT_PROCESSED',
    sku: 'FH-CLASS-GIFT',
    buyerNote: 'I cancelled the class and never got my money back.',
    refunded: true,
  },
};

const BUYERS: { name: string; email: string; address: Address }[] = [
  { name: 'Sam Ortiz', email: 'sam.ortiz@example.com', address: { line1: '41 Maple Row', city: 'Portland', state: 'OR', postalCode: '97205', countryCode: 'US' } },
  { name: 'Jo Whitfield', email: 'j.whitfield@example.com', address: { line1: '1209 Birch Street Apt 4', city: 'Austin', state: 'TX', postalCode: '78704', countryCode: 'US' } },
  { name: 'Casey Lund', email: 'casey.lund@example.com', address: { line1: '77 Harbor View Rd', city: 'Duluth', state: 'MN', postalCode: '55802', countryCode: 'US' } },
];

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const alnum = (n: number) => Array.from({ length: n }, () => '0123456789ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 33)]).join('');

export function fakeTracking(carrier: 'USPS' | 'UPS' | 'FEDEX') {
  if (carrier === 'USPS') return `9400${digits(18)}`;
  if (carrier === 'UPS') return `1Z${alnum(6)}03${digits(8)}`;
  return digits(12);
}

/** The order a scenario sells, before PayPal assigns real ids. */
export function scenarioOrder(id: ScenarioId, now = Date.now()): Order {
  const s = SCENARIOS[id];
  const listing = LISTINGS.find((l) => l.sku === s.sku)!;
  const buyer = BUYERS[Math.floor(Math.random() * BUYERS.length)];
  const amount = { currency_code: 'USD', value: PRICES[s.sku] };
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const trackers: Tracker[] = [];
  if (s.shipment) {
    const sh = s.shipment;
    trackers.push({
      carrier: sh.carrier,
      trackingNumber: fakeTracking(sh.carrier),
      uploadedToPayPal: sh.uploaded,
      uploadedAt: sh.uploaded ? iso(sh.daysAgo) : undefined,
      shippedAt: iso(sh.daysAgo),
      carrierStatus: sh.status,
      deliveredAt: sh.status === 'DELIVERED' ? iso(Math.max(0, sh.daysAgo - 3)) : undefined,
      deliveredTo: sh.status === 'DELIVERED' ? buyer.address : undefined,
      signatureConfirmed: sh.signature,
    });
  }
  return {
    id: '',
    // Store-side history is back-dated so the carrier timeline reads naturally; the PayPal payment itself is real and current.
    createdAt: iso((s.shipment?.daysAgo ?? 3) + 1),
    amount,
    items: [{ name: listing.title, sku: listing.sku, quantity: 1, unitAmount: amount }],
    buyerEmail: buyer.email,
    buyerName: buyer.name,
    shippingAddress: s.sku === 'FH-CLASS-GIFT' ? undefined : buyer.address,
    intangible: s.sku === 'FH-CLASS-GIFT',
    trackers,
    refunds: s.refunded ? [{ id: '', amount, createdAt: iso(1) }] : [],
  };
}
