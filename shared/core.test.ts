import { describe, expect, it } from 'vitest';
import { demoCases } from './fixtures';
import { checkGrounding } from './grounding';
import { planCase } from './playbook';
import { validateTracking } from './tracking';

const now = new Date('2026-10-20T12:00:00Z');
const cases = demoCases(now);
const byId = (id: string) => cases.find((c) => c.dispute.id === id)!;

describe('playbook', () => {
  it('recommends fighting a delivered, tracked INR case', () => {
    const plan = planCase(byId('PP-D-41207'), now);
    expect(plan.winProbability).toBeGreaterThan(0.7);
    expect(plan.recommended).toBe('FIGHT');
    expect(plan.evidence[0].type).toBe('PROOF_OF_FULFILLMENT');
  });
  it('does not fight an in-transit INR case with tracking missing from PayPal', () => {
    const plan = planCase(byId('PP-D-41213'), now);
    expect(plan.recommended).not.toBe('FIGHT');
    expect(plan.checks.find((c) => c.id === 'uploaded')?.status).toBe('fail');
  });
  it('treats a missing signature on a high-value parcel as a weakness, not a disqualifier', () => {
    const plan = planCase(byId('PP-D-41188'), now);
    expect(plan.checks.find((c) => c.id === 'signature')?.status).toBe('unknown');
    expect(plan.recommended).toBe('FIGHT');
  });
  it('counts Seller Protection: a covered "not received" claim costs only time to fight', () => {
    const plan = planCase(byId('PP-D-41207'), now);
    expect(plan.checks.find((c) => c.id === 'protection')?.status).toBe('pass');
    expect(plan.options.find((o) => o.kind === 'FIGHT')?.expectedLoss).toBe(6);
  });
  it('does not count Seller Protection for card chargebacks of "not received"', () => {
    const c = byId('PP-D-41207');
    const plan = planCase({ ...c, dispute: { ...c.dispute, stage: 'CHARGEBACK' } }, now);
    expect(plan.checks.find((k) => k.id === 'protection')?.status).toBe('fail');
  });
  it('rules out protection when the parcel went to another address', () => {
    const c = byId('PP-D-41207');
    const order = structuredClone(c.order!);
    order.trackers[0].deliveredTo = { line1: '9 Other St', postalCode: '10001', countryCode: 'US' };
    const plan = planCase({ ...c, order }, now);
    expect(plan.checks.find((k) => k.id === 'address')?.status).toBe('fail');
    expect(plan.winProbability).toBeLessThanOrEqual(0.25);
  });
  it('offers options for not-as-described and sorts them by expected loss', () => {
    const plan = planCase(byId('PP-D-41219'), now);
    const losses = plan.options.map((o) => o.expectedLoss);
    expect([...losses].sort((a, b) => a - b)).toEqual(losses);
    expect(plan.options.some((o) => o.kind === 'OFFER')).toBe(true);
  });
  it('wins a refund-not-processed case with a recorded refund', () => {
    const plan = planCase(byId('PP-D-41222'), now);
    expect(plan.evidence.some((e) => e.type === 'PROOF_OF_REFUND')).toBe(true);
    expect(plan.winProbability).toBeGreaterThan(0.6);
  });
});

describe('grounding', () => {
  const f = byId('PP-D-41207');
  it('accepts a response that only states case facts', () => {
    const text = 'The bowls (order 5UX02719M3482110C, $88.00) shipped with USPS tracking 9400 1118 9922 3344 5566 77, which was uploaded to PayPal, and the carrier shows the parcel was delivered on ' + f.order!.trackers[0].deliveredAt!.slice(0, 10) + ' to the address on the transaction.';
    const r = checkGrounding(text, f);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('flags invented amounts, dates, ids and claims', () => {
    const text = 'We refunded $45.50 on 2026-09-01. Tracking 1Z999AA10999999999 was signed for by the buyer.';
    const r = checkGrounding(text, f);
    const kinds = r.issues.map((i) => i.kind).sort();
    expect(kinds).toEqual(['amount', 'claim', 'claim', 'date', 'identifier']);
  });
  it('flags "delivered" when the carrier never delivered', () => {
    const r = checkGrounding('The vase was delivered to your address.', byId('PP-D-41213'));
    expect(r.ok).toBe(false);
  });
});

describe('tracking validation', () => {
  it('accepts well-formed numbers for the named carrier', () => {
    expect(validateTracking('UPS', '1Z 999A A101 2345 6784').ok).toBe(true);
    expect(validateTracking('usps', '9400 1118 9922 3344 5566 77').carrier).toBe('USPS');
    expect(validateTracking('FedEx', '771234567890').ok).toBe(true);
  });
  it('rejects a number that does not fit the named carrier', () => {
    expect(validateTracking('UPS', '9400111899223344556677').ok).toBe(false);
  });
  it('infers the carrier when only one format fits', () => {
    expect(validateTracking(undefined, '1Z999AA10123456784').carrier).toBe('UPS');
  });
});
