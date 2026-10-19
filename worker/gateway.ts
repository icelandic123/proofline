// The seam between the agent and PayPal. SandboxGateway (paypal.ts) talks to
// the real PayPal sandbox; OfflineGateway keeps everything in D1 so the app
// runs locally and in tests without credentials.

import type { DisputeReason, Dispute, EvidenceItem, Order } from '../shared/types';
import { demoCases } from '../shared/fixtures';
import type { Db } from './db';

export type SellerAction =
  | { kind: 'FIGHT'; note: string; evidence: EvidenceItem[] }
  | { kind: 'REFUND'; note: string }
  | { kind: 'OFFER'; note: string; amount: number }
  | { kind: 'MESSAGE'; text: string };

export interface Gateway {
  mode: 'sandbox' | 'offline';
  listDisputes(): Promise<Dispute[]>;
  getDispute(id: string): Promise<Dispute>;
  respond(id: string, action: SellerAction): Promise<void>;
  /** Uploads tracking for a captured payment so it counts toward Seller Protection. */
  addTracking(order: Order, carrier: string, trackingNumber: string): Promise<void>;
  /** Sandbox only: open a dispute against an order as the buyer would. */
  openDispute(order: Order, reason: DisputeReason, buyerNote: string): Promise<string>;
  /** Sandbox only: PayPal decides the case. */
  adjudicate(id: string, sellerWins: boolean): Promise<void>;
}

const now = () => new Date().toISOString();

export class OfflineGateway implements Gateway {
  mode = 'offline' as const;
  constructor(private db: Db) {}

  /** Loads the five demo cases on first use. */
  async ensureSeeded() {
    if (await this.db.getSetting('offline_seeded')) return;
    for (const c of demoCases()) {
      await this.db.putSimDispute(c.dispute);
      if (c.order) await this.db.putOrder(c.order);
    }
    await this.db.setSetting('offline_seeded', now());
  }

  async listDisputes() {
    await this.ensureSeeded();
    return this.db.simDisputes();
  }

  async getDispute(id: string) {
    const d = (await this.listDisputes()).find((x) => x.id === id);
    if (!d) throw new Error(`Dispute ${id} not found`);
    return d;
  }

  async respond(id: string, action: SellerAction) {
    const d = await this.getDispute(id);
    if (action.kind === 'MESSAGE') {
      d.messages.push({ postedBy: 'SELLER', time: now(), content: action.text });
    } else if (action.kind === 'REFUND') {
      d.status = 'RESOLVED';
      d.outcome = 'ACCEPTED';
      d.allowedActions = [];
    } else if (action.kind === 'OFFER') {
      d.status = 'WAITING_FOR_BUYER_RESPONSE';
      d.allowedActions = ['send-message'];
      d.messages.push({ postedBy: 'SELLER', time: now(), content: action.note });
    } else {
      d.status = 'UNDER_REVIEW';
      d.allowedActions = ['adjudicate'];
    }
    d.updatedAt = now();
    await this.db.putSimDispute(d);
  }

  async addTracking(order: Order, carrier: string, trackingNumber: string) {
    const t = order.trackers.find((x) => x.trackingNumber === trackingNumber);
    if (t) {
      t.uploadedToPayPal = true;
      t.uploadedAt = now();
    } else {
      order.trackers.push({ carrier, trackingNumber, uploadedToPayPal: true, uploadedAt: now(), shippedAt: now(), carrierStatus: 'PRE_TRANSIT' });
    }
    await this.db.putOrder(order);
  }

  async openDispute(order: Order, reason: DisputeReason, buyerNote: string) {
    const id = `PP-D-${Math.floor(50000 + Math.random() * 40000)}`;
    const t = Date.now();
    await this.db.putSimDispute({
      id,
      reason,
      status: 'WAITING_FOR_SELLER_RESPONSE',
      stage: 'INQUIRY',
      amount: order.amount,
      createdAt: new Date(t).toISOString(),
      updatedAt: new Date(t).toISOString(),
      sellerResponseDueDate: new Date(t + 10 * 86_400_000).toISOString(),
      sellerTransactionIds: order.captureId ? [order.captureId] : [],
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      messages: buyerNote ? [{ postedBy: 'BUYER', time: new Date(t).toISOString(), content: buyerNote }] : [],
      allowedActions: ['provide-evidence', 'accept-claim', 'make-offer', 'send-message'],
    });
    return id;
  }

  async adjudicate(id: string, sellerWins: boolean) {
    const d = await this.getDispute(id);
    d.status = 'RESOLVED';
    d.outcome = sellerWins ? 'RESOLVED_SELLER_FAVOUR' : 'RESOLVED_BUYER_FAVOUR';
    d.allowedActions = [];
    d.updatedAt = now();
    await this.db.putSimDispute(d);
  }
}
