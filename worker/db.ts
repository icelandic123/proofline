import type { CasePlan, Dispute, Draft, Order } from '../shared/types';

export type CaseStatus = 'new' | 'ready' | 'needs_edit' | 'submitted' | 'resolved';

export interface CaseRow {
  disputeId: string;
  status: CaseStatus;
  plan?: CasePlan;
  draft?: Draft;
  decision?: { kind: string; at: string; note?: string; amount?: number; auto?: boolean };
  updatedAt: string;
}

export interface Activity {
  id?: number;
  ts: string;
  actor: 'agent' | 'seller' | 'paypal' | 'demo';
  kind: string;
  disputeId?: string;
  orderId?: string;
  text: string;
  detail?: unknown;
}

const parse = <T>(s: unknown): T | undefined => (typeof s === 'string' && s ? (JSON.parse(s) as T) : undefined);

export class Db {
  constructor(private d1: D1Database) {}

  async getCase(id: string): Promise<CaseRow | undefined> {
    const r = await this.d1.prepare('SELECT * FROM cases WHERE dispute_id = ?').bind(id).first<Record<string, string>>();
    return r ? this.toCase(r) : undefined;
  }

  async listCases(): Promise<CaseRow[]> {
    const { results } = await this.d1.prepare('SELECT * FROM cases').all<Record<string, string>>();
    return results.map((r) => this.toCase(r));
  }

  private toCase(r: Record<string, string>): CaseRow {
    return {
      disputeId: r.dispute_id,
      status: r.status as CaseStatus,
      plan: parse(r.plan),
      draft: parse(r.draft),
      decision: parse(r.decision),
      updatedAt: r.updated_at,
    };
  }

  async putCase(c: CaseRow) {
    await this.d1
      .prepare(
        `INSERT INTO cases (dispute_id, status, plan, draft, decision, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(dispute_id) DO UPDATE SET status = ?2, plan = ?3, draft = ?4, decision = ?5, updated_at = ?6`,
      )
      .bind(c.disputeId, c.status, JSON.stringify(c.plan ?? null), JSON.stringify(c.draft ?? null), JSON.stringify(c.decision ?? null), c.updatedAt)
      .run();
  }

  async putOrder(o: Order) {
    await this.d1
      .prepare(
        `INSERT INTO orders (id, capture_id, buyer_email, created_at, data) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET capture_id = ?2, buyer_email = ?3, data = ?5`,
      )
      .bind(o.id, o.captureId ?? null, o.buyerEmail ?? null, o.createdAt, JSON.stringify(o))
      .run();
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const r = await this.d1.prepare('SELECT data FROM orders WHERE id = ? OR capture_id = ?').bind(id, id).first<{ data: string }>();
    return parse<Order>(r?.data);
  }

  async listOrders(limit = 200): Promise<Order[]> {
    const { results } = await this.d1.prepare('SELECT data FROM orders ORDER BY created_at DESC LIMIT ?').bind(limit).all<{ data: string }>();
    return results.map((r) => JSON.parse(r.data) as Order);
  }

  async countBuyerOrders(email: string, excludeOrderId?: string): Promise<number> {
    const r = await this.d1
      .prepare('SELECT COUNT(*) AS n FROM orders WHERE buyer_email = ? AND id != ?')
      .bind(email, excludeOrderId ?? '')
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async log(a: Omit<Activity, 'ts'> & { ts?: string }) {
    await this.d1
      .prepare('INSERT INTO activity (ts, actor, kind, dispute_id, order_id, text, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(a.ts ?? new Date().toISOString(), a.actor, a.kind, a.disputeId ?? null, a.orderId ?? null, a.text, a.detail === undefined ? null : JSON.stringify(a.detail))
      .run();
  }

  async activity(limit = 60, disputeId?: string): Promise<Activity[]> {
    const stmt = disputeId
      ? this.d1.prepare('SELECT * FROM activity WHERE dispute_id = ? ORDER BY id DESC LIMIT ?').bind(disputeId, limit)
      : this.d1.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?').bind(limit);
    const { results } = await stmt.all<Record<string, string | number>>();
    return results.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      actor: r.actor as Activity['actor'],
      kind: r.kind as string,
      disputeId: (r.dispute_id as string) ?? undefined,
      orderId: (r.order_id as string) ?? undefined,
      text: r.text as string,
      detail: parse(r.detail),
    }));
  }

  async simDisputes(): Promise<Dispute[]> {
    const { results } = await this.d1.prepare('SELECT data FROM sim_disputes').all<{ data: string }>();
    return results.map((r) => JSON.parse(r.data) as Dispute);
  }

  async putSimDispute(d: Dispute) {
    await this.d1.prepare('INSERT INTO sim_disputes (id, data) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data = ?2').bind(d.id, JSON.stringify(d)).run();
  }

  async getSetting(key: string): Promise<string | undefined> {
    const r = await this.d1.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    return r?.value;
  }

  async setSetting(key: string, value: string) {
    await this.d1.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2').bind(key, value).run();
  }
}
