// PayPal REST client for the sandbox: Disputes, Orders, Payments and
// shipment tracking. Everything here runs inside the Cloudflare Worker,
// which holds the client secret; the browser never sees it.

import { PRICES, LISTINGS } from '../shared/fixtures';
import type { Dispute, DisputeReason, DisputeStage, DisputeStatus, Order } from '../shared/types';
import type { Db } from './db';
import type { Gateway, SellerAction } from './gateway';

export const SANDBOX = 'https://api-m.sandbox.paypal.com';

export class PayPalError extends Error {
  constructor(public status: number, public debugId: string | undefined, public details: unknown, message: string) {
    super(message);
  }
}

export class PayPalClient {
  private token?: { value: string; expires: number };
  constructor(private clientId: string, private secret: string, private base = SANDBOX) {}

  async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${this.clientId}:${this.secret}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new PayPalError(res.status, res.headers.get('paypal-debug-id') ?? undefined, await res.text(), `PayPal sign-in failed (${res.status})`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  async request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.accessToken()}`, ...extraHeaders };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.base}${path}`, { method, headers, body: payload });
    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      const d = data as { message?: string; name?: string; details?: { issue?: string; description?: string }[] };
      const detail = d.details?.map((x) => x.description ?? x.issue).filter(Boolean).join('; ');
      throw new PayPalError(res.status, res.headers.get('paypal-debug-id') ?? undefined, data, `PayPal ${method} ${path.split('?')[0]} failed (${res.status}): ${d.message ?? d.name ?? text.slice(0, 200)}${detail ? `. ${detail}` : ''}`);
    }
    return data as T;
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}

// ---- Disputes: PayPal JSON -> our model ---------------------------------

interface PpLink { rel: string; href: string; method?: string }
interface PpDispute {
  dispute_id: string;
  create_time: string;
  update_time: string;
  reason: DisputeReason;
  status: string;
  dispute_life_cycle_stage?: DisputeStage;
  dispute_amount: { currency_code: string; value: string };
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; buyer?: { email?: string; name?: string } }[];
  messages?: { posted_by: string; time_posted: string; content: string }[];
  dispute_outcome?: { outcome_code?: string };
  links?: PpLink[];
}

export function normaliseDispute(d: PpDispute): Dispute {
  const tx = d.disputed_transactions ?? [];
  const status: DisputeStatus = (['OPEN', 'WAITING_FOR_BUYER_RESPONSE', 'WAITING_FOR_SELLER_RESPONSE', 'UNDER_REVIEW', 'RESOLVED'] as const).includes(d.status as never)
    ? (d.status as DisputeStatus)
    : 'OTHER';
  return {
    id: d.dispute_id,
    reason: d.reason ?? 'OTHER',
    status,
    stage: d.dispute_life_cycle_stage ?? 'INQUIRY',
    amount: d.dispute_amount,
    createdAt: d.create_time,
    updatedAt: d.update_time,
    sellerResponseDueDate: d.seller_response_due_date,
    buyerResponseDueDate: d.buyer_response_due_date,
    sellerTransactionIds: tx.map((t) => t.seller_transaction_id).filter((x): x is string => !!x),
    buyerEmail: tx[0]?.buyer?.email,
    buyerName: tx[0]?.buyer?.name,
    messages: (d.messages ?? []).map((m) => ({ postedBy: (m.posted_by as 'BUYER' | 'SELLER') ?? 'PAYPAL', time: m.time_posted, content: m.content })),
    outcome: d.dispute_outcome?.outcome_code,
    allowedActions: (d.links ?? []).map((l) => l.rel).filter((r) => r !== 'self'),
  };
}

const TEST_CARD = { number: '4032039317984658', expiry: '2030-12', security_code: '123' };

export class SandboxGateway implements Gateway {
  mode = 'sandbox' as const;
  readonly pp: PayPalClient;
  private cache = new Map<string, { at: number; value: Dispute }>();

  constructor(
    private clientId: string,
    secret: string,
    private db: Db,
    private buyerEmail?: string,
    private merchantId?: string,
  ) {
    this.pp = new PayPalClient(clientId, secret);
  }

  /** The sandbox shop's merchant id, from config or from the payee of an order we created. */
  private learnMerchant(pu?: PpPurchaseUnit) {
    if (!this.merchantId && pu?.payee?.merchant_id) this.merchantId = pu.payee.merchant_id;
  }

  async listDisputes(): Promise<Dispute[]> {
    const out: Dispute[] = [];
    let path: string | undefined = '/v1/customer/disputes?page_size=50';
    for (let page = 0; path && page < 4; page++) {
      const r: { items?: PpDispute[]; links?: PpLink[] } = await this.pp.request('GET', path);
      for (const item of r.items ?? []) {
        // The list returns summaries; fetch details for anything new or changed.
        const cached = this.cache.get(item.dispute_id);
        if (cached && cached.value.updatedAt === item.update_time) out.push(cached.value);
        else out.push(await this.getDispute(item.dispute_id));
      }
      const next = r.links?.find((l) => l.rel === 'next')?.href;
      path = next ? next.replace(/^https:\/\/[^/]+/, '') : undefined;
    }
    return out;
  }

  async getDispute(id: string): Promise<Dispute> {
    const d = normaliseDispute(await this.pp.request<PpDispute>('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`));
    this.cache.set(id, { at: Date.now(), value: d });
    return d;
  }

  async respond(id: string, action: SellerAction): Promise<void> {
    const path = `/v1/customer/disputes/${encodeURIComponent(id)}`;
    if (action.kind === 'FIGHT') {
      const evidences = (action.evidence.length ? action.evidence : [{ type: 'OTHER' as const, summary: '' }]).map((e, i) => {
        const info: Record<string, unknown> = {};
        if (e.trackingInfo?.length) info.tracking_info = e.trackingInfo;
        if (e.refundIds?.length) info.refund_ids = e.refundIds;
        return {
          evidence_type: e.type,
          ...(Object.keys(info).length ? { evidence_info: info } : {}),
          // The written response rides on the first evidence item.
          notes: (i === 0 ? action.note : e.summary).slice(0, 2000),
        };
      });
      const form = new FormData();
      form.append('input', new Blob([JSON.stringify({ evidences })], { type: 'application/json' }));
      await this.pp.request('POST', `${path}/provide-evidence`, form);
    } else if (action.kind === 'REFUND') {
      await this.pp.request('POST', `${path}/accept-claim`, { note: action.note.slice(0, 2000), accept_claim_type: 'REFUND' });
    } else if (action.kind === 'OFFER') {
      const d = await this.getDispute(id);
      await this.pp.request('POST', `${path}/make-offer`, {
        note: action.note.slice(0, 2000),
        offer_amount: { currency_code: d.amount.currency_code, value: action.amount.toFixed(2) },
        offer_type: 'REFUND',
      });
    } else {
      const form = new FormData();
      form.append('input', new Blob([JSON.stringify({ message: action.text.slice(0, 2000) })], { type: 'application/json' }));
      await this.pp.request('POST', `${path}/send-message`, form);
    }
    this.cache.delete(id);
  }

  async addTracking(order: Order, carrier: string, trackingNumber: string): Promise<void> {
    if (!order.captureId) throw new Error(`Order ${order.id} has no PayPal capture to attach tracking to`);
    await this.pp.request('POST', `/v2/checkout/orders/${encodeURIComponent(order.id)}/track`, {
      capture_id: order.captureId,
      tracking_number: trackingNumber,
      carrier,
      notify_payer: false,
    });
  }

  /** Pays for a demo order with a sandbox test card (no buyer approval step), and refunds it if the scenario needs that. */
  async createPaidOrder(draft: Order): Promise<Order> {
    const item = draft.items[0];
    const created = await this.pp.request<{ id: string; status: string; purchase_units?: PpPurchaseUnit[] }>(
      'POST',
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [purchaseUnit(item.sku!, draft)],
        payment_source: { card: { ...TEST_CARD, name: draft.buyerName, billing_address: draft.shippingAddress && toPpAddress(draft.shippingAddress) } },
      },
      { 'PayPal-Request-Id': crypto.randomUUID(), Prefer: 'return=representation' },
    );
    this.learnMerchant(created.purchase_units?.[0]);
    let capture = created.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture) {
      const captured = await this.pp.request<{ purchase_units?: PpPurchaseUnit[] }>('POST', `/v2/checkout/orders/${created.id}/capture`, {}, { 'PayPal-Request-Id': crypto.randomUUID(), Prefer: 'return=representation' });
      this.learnMerchant(captured.purchase_units?.[0]);
      capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
    }
    if (!capture) throw new Error('PayPal did not return a capture for the demo order');
    const order: Order = { ...draft, id: created.id, captureId: capture.id };
    if (draft.refunds.length) {
      const refund = await this.pp.request<{ id: string; create_time?: string }>('POST', `/v2/payments/captures/${capture.id}/refund`, {}, { 'PayPal-Request-Id': crypto.randomUUID() });
      order.refunds = [{ id: refund.id, amount: draft.amount, createdAt: draft.refunds[0].createdAt }];
    }
    return order;
  }

  /**
   * Sandbox: the demo buyer files a dispute. PayPal's buyer-side create call
   * needs scopes most developer apps don't have, so we try it first and fall
   * back to a simulated card chargeback, which only needs the seller's token.
   * Demo orders are paid by card, so both routes apply.
   */
  async openDispute(order: Order, reason: DisputeReason, buyerNote: string): Promise<string> {
    if (!order.captureId) throw new Error('Order has no capture');
    if (reason !== 'UNAUTHORISED' && this.buyerEmail) {
      try {
        return await this.openBuyerDispute(order, reason, buyerNote);
      } catch (e) {
        if (!(e instanceof PayPalError) || e.status >= 500) throw e;
      }
    }
    return this.openChargeback(order, reason);
  }

  async openBuyerDispute(order: Order, reason: DisputeReason, buyerNote: string): Promise<string> {
    const form = new FormData();
    const input = {
      disputed_transactions: [{ buyer_transaction_id: order.captureId }],
      reason,
      dispute_amount: order.amount,
      extensions: {
        merchant_contacted: true,
        merchant_contacted_outcome: 'NO_RESPONSE',
        ...(reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' || reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED'
          ? { merchandize_dispute_properties: { issue_type: order.intangible ? 'SERVICE' : 'PRODUCT' } }
          : {}),
      },
      evidences: [{ evidence_type: 'OTHER', notes: buyerNote.slice(0, 2000) }],
    };
    form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    const r = await this.pp.request<{ links?: PpLink[]; dispute_id?: string }>('POST', '/v1/customer/disputes', form, {
      'PayPal-Auth-Assertion': authAssertion(this.clientId, this.buyerEmail!),
    });
    return r.dispute_id ?? idFromLinks(r.links);
  }

  async openChargeback(order: Order, reason: DisputeReason): Promise<string> {
    if (!this.merchantId) throw new Error('Set PAYPAL_MERCHANT_ID (the sandbox business account\'s merchant id) to simulate chargebacks');
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
    const r = await this.pp.request<{ dispute_id?: string; links?: PpLink[] }>('POST', '/v2/customer-support/process-chargeback', {
      adjacency: 'PAYPAL',
      file_layout: 'ATCK_CB',
      merchant_id: this.merchantId,
      financial_institution: { processor: 'FDMS' },
      transaction: { id_enc: order.captureId, amount: order.amount },
      instrument: { instrument_type: 'CARD', card_brand: 'VISA', credit_card_transaction_id: digits(16), external: false },
      dispute: {
        id: null,
        stage: 'CHARGEBACK',
        status: '2',
        amount: order.amount,
        receive_date: iso(now),
        money_movement_date: iso(now),
        response_date: iso(now + 10 * 86_400_000),
        event_code: 'CHARGEBACK_INITIATED',
        event_type: 'DEBIT',
        chargeback_type: 'REPORTED_TO_PROCESSOR',
        processor_info: { reference_number: digits(23), reason_code: CHARGEBACK_REASON[reason] ?? '1330', notes: 'PROOFLINE_DEMO' },
      },
    });
    return r.dispute_id ?? idFromLinks(r.links);
  }

  /**
   * Sandbox: PayPal decides the case. PayPal only allows this once the case
   * is UNDER_REVIEW, which can take a few minutes after the seller answers.
   */
  async adjudicate(id: string, sellerWins: boolean): Promise<void> {
    const path = `/v1/customer/disputes/${encodeURIComponent(id)}`;
    this.cache.delete(id);
    const d = await this.getDispute(id);
    if (!d.allowedActions.includes('adjudicate')) {
      throw new PayPalError(409, undefined, { status: d.status, actions: d.allowedActions }, `PayPal is not ready to decide ${id} yet (status ${d.status}). Try again in a few minutes.`);
    }
    await this.pp.request('POST', `${path}/adjudicate`, { adjudication_outcome: sellerWins ? 'SELLER_FAVOR' : 'BUYER_FAVOR' });
    this.cache.delete(id);
  }

  // ---- Checkout for the demo shop -------------------------------------

  async createCheckoutOrder(sku: string): Promise<{ id: string }> {
    const listing = LISTINGS.find((l) => l.sku === sku)!;
    const r = await this.pp.request<{ id: string }>(
      'POST',
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: sku,
            description: listing.title,
            amount: { currency_code: 'USD', value: PRICES[sku], breakdown: { item_total: { currency_code: 'USD', value: PRICES[sku] } } },
            items: [{ name: listing.title, sku, quantity: '1', unit_amount: { currency_code: 'USD', value: PRICES[sku] }, category: sku === 'FH-CLASS-GIFT' ? 'DIGITAL_GOODS' : 'PHYSICAL_GOODS' }],
          },
        ],
        payment_source: { paypal: { experience_context: { shipping_preference: sku === 'FH-CLASS-GIFT' ? 'NO_SHIPPING' : 'GET_FROM_FILE', brand_name: 'Fernhill Ceramics', user_action: 'PAY_NOW' } } },
      },
      { 'PayPal-Request-Id': crypto.randomUUID() },
    );
    return { id: r.id };
  }

  async captureCheckoutOrder(orderId: string): Promise<Order> {
    const r = await this.pp.request<PpOrder>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, { 'PayPal-Request-Id': `cap-${orderId}`, Prefer: 'return=representation' });
    this.learnMerchant(r.purchase_units?.[0]);
    return orderFromPayPal(r);
  }
}

interface PpPurchaseUnit {
  reference_id?: string;
  payee?: { merchant_id?: string; email_address?: string };
  amount?: { currency_code: string; value: string };
  items?: { name: string; sku?: string; quantity: string; unit_amount: { currency_code: string; value: string } }[];
  shipping?: { name?: { full_name?: string }; address?: { address_line_1?: string; address_line_2?: string; admin_area_2?: string; admin_area_1?: string; postal_code?: string; country_code?: string } };
  payments?: { captures?: { id: string; status: string; create_time?: string; amount?: { currency_code: string; value: string } }[] };
}
interface PpOrder {
  id: string;
  create_time?: string;
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  purchase_units?: PpPurchaseUnit[];
}

export function orderFromPayPal(r: PpOrder): Order {
  const pu = r.purchase_units?.[0] ?? {};
  const cap = pu.payments?.captures?.[0];
  const a = pu.shipping?.address;
  const sku = pu.items?.[0]?.sku ?? pu.reference_id;
  return {
    id: r.id,
    captureId: cap?.id,
    createdAt: cap?.create_time ?? r.create_time ?? new Date().toISOString(),
    amount: cap?.amount ?? pu.amount ?? { currency_code: 'USD', value: sku ? PRICES[sku] : '0.00' },
    items: (pu.items ?? []).map((i) => ({ name: i.name, sku: i.sku, quantity: Number(i.quantity), unitAmount: i.unit_amount })),
    buyerEmail: r.payer?.email_address,
    buyerName: [r.payer?.name?.given_name, r.payer?.name?.surname].filter(Boolean).join(' ') || pu.shipping?.name?.full_name,
    shippingAddress: a ? { line1: a.address_line_1, line2: a.address_line_2, city: a.admin_area_2, state: a.admin_area_1, postalCode: a.postal_code, countryCode: a.country_code } : undefined,
    intangible: sku === 'FH-CLASS-GIFT',
    trackers: [],
    refunds: [],
  };
}

function purchaseUnit(sku: string, draft: Order) {
  const listing = LISTINGS.find((l) => l.sku === sku)!;
  const value = PRICES[sku];
  return {
    reference_id: sku,
    description: listing.title,
    amount: { currency_code: 'USD', value, breakdown: { item_total: { currency_code: 'USD', value } } },
    items: [{ name: listing.title, sku, quantity: '1', unit_amount: { currency_code: 'USD', value }, category: draft.intangible ? 'DIGITAL_GOODS' : 'PHYSICAL_GOODS' }],
    ...(draft.shippingAddress ? { shipping: { name: { full_name: draft.buyerName }, address: toPpAddress(draft.shippingAddress) } } : {}),
  };
}

function toPpAddress(a: NonNullable<Order['shippingAddress']>) {
  return { address_line_1: a.line1, address_line_2: a.line2, admin_area_2: a.city, admin_area_1: a.state, postal_code: a.postalCode, country_code: a.countryCode };
}

/** Unsigned JWT naming the sandbox buyer, as PayPal's sandbox dispute-creation docs describe. */
export function authAssertion(clientId: string, email: string) {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: clientId, email })}.`;
}

// Visa reason codes in PayPal's four-digit form (13.1 -> 1310); PayPal's own sample uses 1330.
const CHARGEBACK_REASON: Partial<Record<DisputeReason, string>> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: '1310',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: '1330',
  CREDIT_NOT_PROCESSED: '1360',
  UNAUTHORISED: '1040',
};

function idFromLinks(links?: PpLink[]): string {
  const href = links?.find((l) => /disputes\//.test(l.href))?.href ?? '';
  const id = href.match(/disputes\/([^/?]+)/)?.[1];
  if (!id) throw new Error('PayPal created the dispute but did not return its id');
  return id;
}
