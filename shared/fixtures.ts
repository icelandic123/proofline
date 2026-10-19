// The demo store: a small, fictional ceramics shop. Used by the offline
// simulator, by tests, and as the catalog the sandbox seeder sells from.

import type { CaseFacts, Dispute, Listing, Order, StorePolicy } from './types';

export const STORE_POLICY: StorePolicy = {
  storeName: 'Fernhill Ceramics',
  returnWindowDays: 30,
  autoRefundBelow: 15,
  disputeFee: 15,
  timeCostPerCase: 6,
  costOfGoodsRatio: 0.35,
};

export const LISTINGS: Listing[] = [
  {
    sku: 'FH-MUG-SAGE',
    title: 'Sage glaze mug, 12 oz',
    description: 'Wheel-thrown stoneware mug in a matte sage glaze. Holds 12 oz. Each piece is handmade, so glaze pooling and small speckles vary from the photos. Dishwasher safe.',
    photos: ['mug-sage-front.jpg', 'mug-sage-side.jpg', 'mug-sage-scale.jpg'],
    returnPolicy: '30-day returns on unused items',
  },
  {
    sku: 'FH-BOWL-SET',
    title: 'Speckled serving bowls, set of 3',
    description: 'Three nesting bowls (6, 8 and 10 inch) in an oatmeal speckled glaze. Food safe, dishwasher safe, not for the microwave.',
    photos: ['bowls-stack.jpg', 'bowls-top.jpg'],
    returnPolicy: '30-day returns on unused items',
  },
  {
    sku: 'FH-VASE-TALL',
    title: 'Tall ribbed vase, ink blue',
    description: 'A 14 inch ribbed vase in a deep ink-blue glaze, watertight. One of a kind.',
    photos: ['vase-blue.jpg'],
    returnPolicy: '30-day returns on unused items',
  },
  {
    sku: 'FH-DINNER-12',
    title: 'Dinnerware set for six (18 pieces)',
    description: 'Six dinner plates, six side plates and six bowls in a satin white glaze. Made to order in 3 to 4 weeks.',
    photos: ['dinner-set.jpg', 'dinner-detail.jpg'],
    returnPolicy: '30-day returns on unused items',
  },
  {
    sku: 'FH-CLASS-GIFT',
    title: 'Gift card: beginner wheel class (digital)',
    description: 'A two-hour beginner pottery class voucher, delivered by email as a PDF.',
    photos: [],
  },
];

export const PRICES: Record<string, string> = {
  'FH-MUG-SAGE': '34.00',
  'FH-BOWL-SET': '88.00',
  'FH-VASE-TALL': '126.00',
  'FH-DINNER-12': '840.00',
  'FH-CLASS-GIFT': '65.00',
};

const ADDR = {
  maple: { line1: '41 Maple Row', city: 'Portland', state: 'OR', postalCode: '97205', countryCode: 'US' },
  birch: { line1: '1209 Birch Street Apt 4', city: 'Austin', state: 'TX', postalCode: '78704', countryCode: 'US' },
  harbor: { line1: '77 Harbor View Rd', city: 'Duluth', state: 'MN', postalCode: '55802', countryCode: 'US' },
};

const day = (base: Date, d: number) => new Date(base.getTime() + d * 86_400_000).toISOString();

function dispute(id: string, partial: Partial<Dispute> & Pick<Dispute, 'reason' | 'amount' | 'sellerTransactionIds'>, now: Date, openedDaysAgo: number): Dispute {
  return {
    id,
    status: 'WAITING_FOR_SELLER_RESPONSE',
    stage: 'INQUIRY',
    createdAt: day(now, -openedDaysAgo),
    updatedAt: day(now, -openedDaysAgo),
    sellerResponseDueDate: day(now, 10 - openedDaysAgo),
    messages: [],
    allowedActions: ['provide-evidence', 'accept-claim', 'make-offer', 'send-message'],
    ...partial,
  };
}

/** Five realistic cases that exercise every branch of the playbook. */
export function demoCases(now = new Date()): CaseFacts[] {
  const orders: Order[] = [
    {
      id: '5UX02719M3482110C', captureId: '8MC585209K746392H', createdAt: day(now, -16),
      amount: { currency_code: 'USD', value: '88.00' },
      items: [{ name: 'Speckled serving bowls, set of 3', sku: 'FH-BOWL-SET', quantity: 1, unitAmount: { currency_code: 'USD', value: '88.00' } }],
      buyerEmail: 'sam.ortiz@example.com', buyerName: 'Sam Ortiz', shippingAddress: ADDR.maple,
      trackers: [{ carrier: 'USPS', trackingNumber: '9400111899223344556677', uploadedToPayPal: true, uploadedAt: day(now, -15), shippedAt: day(now, -15), carrierStatus: 'DELIVERED', deliveredAt: day(now, -11), deliveredTo: ADDR.maple }],
      refunds: [],
    },
    {
      id: '2WD71882KK0019443', captureId: '3LT90416PF1203517', createdAt: day(now, -9),
      amount: { currency_code: 'USD', value: '126.00' },
      items: [{ name: 'Tall ribbed vase, ink blue', sku: 'FH-VASE-TALL', quantity: 1, unitAmount: { currency_code: 'USD', value: '126.00' } }],
      buyerEmail: 'j.whitfield@example.com', buyerName: 'Jo Whitfield', shippingAddress: ADDR.birch,
      trackers: [{ carrier: 'UPS', trackingNumber: '1Z999AA10123456784', uploadedToPayPal: false, shippedAt: day(now, -8), carrierStatus: 'IN_TRANSIT' }],
      refunds: [],
    },
    {
      id: '7HG44120BN5501128', captureId: '0RS22871WX4410925', createdAt: day(now, -21),
      amount: { currency_code: 'USD', value: '840.00' },
      items: [{ name: 'Dinnerware set for six (18 pieces)', sku: 'FH-DINNER-12', quantity: 1, unitAmount: { currency_code: 'USD', value: '840.00' } }],
      buyerEmail: 'casey.lund@example.com', buyerName: 'Casey Lund', shippingAddress: ADDR.harbor,
      trackers: [{ carrier: 'FEDEX', trackingNumber: '771234567890', uploadedToPayPal: true, uploadedAt: day(now, -19), shippedAt: day(now, -19), carrierStatus: 'DELIVERED', deliveredAt: day(now, -16), deliveredTo: ADDR.harbor, signatureConfirmed: false }],
      refunds: [],
    },
    {
      id: '9KP11873CD2280014', captureId: '6YU77310QA9921846', createdAt: day(now, -12),
      amount: { currency_code: 'USD', value: '34.00' },
      items: [{ name: 'Sage glaze mug, 12 oz', sku: 'FH-MUG-SAGE', quantity: 1, unitAmount: { currency_code: 'USD', value: '34.00' } }],
      buyerEmail: 'r.nakamura@example.com', buyerName: 'Riley Nakamura', shippingAddress: ADDR.birch,
      trackers: [{ carrier: 'USPS', trackingNumber: '9205590164917312751089', uploadedToPayPal: true, uploadedAt: day(now, -11), shippedAt: day(now, -11), carrierStatus: 'DELIVERED', deliveredAt: day(now, -8), deliveredTo: ADDR.birch }],
      refunds: [],
    },
    {
      id: '4AB90215EF7763301', captureId: '1CV55028ZT3389410', createdAt: day(now, -6),
      amount: { currency_code: 'USD', value: '65.00' },
      items: [{ name: 'Gift card: beginner wheel class (digital)', sku: 'FH-CLASS-GIFT', quantity: 1, unitAmount: { currency_code: 'USD', value: '65.00' } }],
      buyerEmail: 'alex.p@example.com', buyerName: 'Alex Petrov', intangible: true,
      trackers: [],
      refunds: [{ id: '5TR4419001KD88231', amount: { currency_code: 'USD', value: '65.00' }, createdAt: day(now, -3) }],
    },
  ];

  const disputes: Dispute[] = [
    dispute('PP-D-41207', { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: orders[0].amount, sellerTransactionIds: [orders[0].captureId!], buyerEmail: orders[0].buyerEmail, buyerName: orders[0].buyerName,
      messages: [{ postedBy: 'BUYER', time: day(now, -3), content: 'It has been over two weeks and my bowls never arrived. Please refund me.' }] }, now, 3),
    dispute('PP-D-41213', { reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', amount: orders[1].amount, sellerTransactionIds: [orders[1].captureId!], buyerEmail: orders[1].buyerEmail, buyerName: orders[1].buyerName,
      messages: [{ postedBy: 'BUYER', time: day(now, -1), content: 'Where is my vase? The tracking hasn\'t moved in days.' }] }, now, 1),
    dispute('PP-D-41188', { reason: 'UNAUTHORISED', stage: 'CHARGEBACK', amount: orders[2].amount, sellerTransactionIds: [orders[2].captureId!], buyerEmail: orders[2].buyerEmail, buyerName: orders[2].buyerName }, now, 8),
    dispute('PP-D-41219', { reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', amount: orders[3].amount, sellerTransactionIds: [orders[3].captureId!], buyerEmail: orders[3].buyerEmail, buyerName: orders[3].buyerName,
      messages: [{ postedBy: 'BUYER', time: day(now, -2), content: 'The mug is much darker green than the photo and has a dark spot near the rim. Not what I ordered.' }] }, now, 2),
    dispute('PP-D-41222', { reason: 'CREDIT_NOT_PROCESSED', amount: orders[4].amount, sellerTransactionIds: [orders[4].captureId!], buyerEmail: orders[4].buyerEmail, buyerName: orders[4].buyerName,
      messages: [{ postedBy: 'BUYER', time: day(now, -1), content: 'I cancelled the class but never got my money back.' }] }, now, 1),
  ];

  const prior: Record<string, number> = { 'casey.lund@example.com': 3, 'sam.ortiz@example.com': 1 };
  return disputes.map((d, i) => ({
    dispute: d,
    order: orders[i],
    listings: LISTINGS,
    buyerPriorOrders: prior[d.buyerEmail ?? ''] ?? 0,
    storePolicy: STORE_POLICY,
  }));
}
