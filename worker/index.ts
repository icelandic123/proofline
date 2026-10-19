import { LISTINGS, PRICES, STORE_POLICY } from '../shared/fixtures';
import { checkGrounding } from '../shared/grounding';
import { daysLeft, planCase } from '../shared/playbook';
import { validateTracking } from '../shared/tracking';
import type { DisputeReason, Order } from '../shared/types';
import { analyzeCase, isOpen, loadFacts, submitCase, sweep, type Ctx } from './agent';
import { ask, parseShipments, protectionReport } from './assistant';
import { Db } from './db';
import { scenarioOrder, SCENARIOS, type ScenarioId } from './demo';
import { OfflineGateway, type Gateway } from './gateway';
import { Llm } from './llm';
import { SandboxGateway } from './paypal';
import { studioAgent } from './studio';

export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS?: Fetcher;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  /** Sandbox personal account used to open demo disputes. */
  PAYPAL_BUYER_EMAIL?: string;
  AI_MODEL?: string;
  /** Max demo actions (simulated disputes, verdicts) per hour across all visitors. */
  DEMO_HOURLY_LIMIT?: string;
}

function context(env: Env): Ctx {
  const db = new Db(env.DB);
  const gw: Gateway = env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET
    ? new SandboxGateway(env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET, db, env.PAYPAL_BUYER_EMAIL)
    : new OfflineGateway(db);
  return { db, gw, llm: new Llm(env.AI, env.AI_MODEL || undefined) };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Expected a JSON body');
  }
}

async function demoBudget(ctx: Ctx, env: Env) {
  const limit = Number(env.DEMO_HOURLY_LIMIT ?? 40);
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const recent = (await ctx.db.activity(200)).filter((a) => a.actor === 'demo' && a.ts > since).length;
  if (recent >= limit) throw new HttpError(429, 'The demo is busy. Please try again in a few minutes.');
}

async function overview(ctx: Ctx) {
  const [disputes, cases, orders] = await Promise.all([ctx.gw.listDisputes(), ctx.db.listCases(), ctx.db.listOrders(200)]);
  const byId = new Map(cases.map((c) => [c.disputeId, c]));
  const rows = disputes
    .map((d) => {
      const c = byId.get(d.id);
      return {
        dispute: d,
        caseStatus: c?.status ?? 'new',
        winProbability: c?.plan?.winProbability,
        recommended: c?.plan?.recommended,
        expectedLoss: c?.plan?.options.find((o) => o.kind === c.plan?.recommended)?.expectedLoss,
        verified: c?.draft?.grounding.ok,
        decision: c?.decision,
        daysLeft: daysLeft(d.sellerResponseDueDate),
      };
    })
    .sort((a, b) => (a.dispute.createdAt < b.dispute.createdAt ? 1 : -1));
  const open = rows.filter((r) => isOpen(r.dispute));
  const resolved = rows.filter((r) => !isOpen(r.dispute));
  const won = resolved.filter((r) => r.dispute.outcome === 'RESOLVED_SELLER_FAVOUR').length;
  const lost = resolved.filter((r) => r.dispute.outcome === 'RESOLVED_BUYER_FAVOUR').length;
  return {
    mode: ctx.gw.mode,
    rows,
    stats: {
      open: open.length,
      atRisk: Math.round(open.reduce((s, r) => s + Number(r.dispute.amount.value), 0) * 100) / 100,
      dueSoon: open.filter((r) => (r.daysLeft ?? 99) <= 3 && r.caseStatus !== 'submitted').length,
      awaitingApproval: open.filter((r) => r.caseStatus === 'ready' || r.caseStatus === 'needs_edit').length,
      won,
      lost,
      winRate: won + lost ? Math.round((won / (won + lost)) * 100) : undefined,
    },
    protection: protectionReport(orders),
  };
}

async function createScenario(ctx: Ctx, env: Env, scenario: ScenarioId) {
  await demoBudget(ctx, env);
  const s = SCENARIOS[scenario];
  if (!s) throw new HttpError(400, 'Unknown scenario');
  // 1. A real (sandbox) payment for the order.
  const draftOrder = scenarioOrder(scenario);
  const order: Order = ctx.gw instanceof SandboxGateway ? await ctx.gw.createPaidOrder(draftOrder) : { ...draftOrder, id: randomId(17), captureId: randomId(17) };
  // 2. The store's fulfilment record (carrier events come from the shipping provider in production; simulated here).
  for (const t of order.trackers) {
    if (t.uploadedToPayPal) {
      t.uploadedToPayPal = false;
      await ctx.gw.addTracking(order, t.carrier, t.trackingNumber);
      t.uploadedToPayPal = true;
      t.uploadedAt = new Date().toISOString();
    }
  }
  await ctx.db.putOrder(order);
  // 3. The buyer opens a dispute.
  const disputeId = await ctx.gw.openDispute(order, s.reason as DisputeReason, s.buyerNote);
  await ctx.db.log({ actor: 'demo', kind: 'dispute', disputeId, orderId: order.id, text: `Demo buyer opened ${disputeId} (${s.title}) on order ${order.id}.` });
  return { disputeId, orderId: order.id };
}

function randomId(n: number) {
  const chars = '0123456789ABCDEFGHJKLMNPRSTUVWXY';
  return Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function route(req: Request, env: Env, ctx: Ctx, exec: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '');
  const m = (re: RegExp) => p.match(re);
  const method = req.method;

  if (p === '/api/config') {
    return json({
      mode: ctx.gw.mode,
      paypalClientId: env.PAYPAL_CLIENT_ID ?? null,
      store: STORE_POLICY,
      model: ctx.llm.available ? ctx.llm.model : null,
      listings: LISTINGS.map((l) => ({ ...l, price: PRICES[l.sku] })),
      scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, title: s.title, expect: s.expect })),
    });
  }
  if (p === '/api/overview') return json(await overview(ctx));
  if (p === '/api/orders') return json({ orders: await ctx.db.listOrders(200), protection: protectionReport(await ctx.db.listOrders(200)) });
  if (p === '/api/activity') return json({ activity: await ctx.db.activity(Number(url.searchParams.get('limit') ?? 60), url.searchParams.get('dispute') ?? undefined) });

  let r;
  if ((r = m(/^\/api\/cases\/([\w-]+)$/)) && method === 'GET') {
    const id = r[1];
    const facts = await loadFacts(ctx, id);
    let row = await ctx.db.getCase(id);
    if (!row && isOpen(facts.dispute)) row = await analyzeCase(ctx, id, facts.dispute);
    return json({ facts, case: row ?? null, plan: row?.plan ?? planCase(facts), activity: await ctx.db.activity(30, id) });
  }
  if ((r = m(/^\/api\/cases\/([\w-]+)\/analyze$/)) && method === 'POST') return json({ case: await analyzeCase(ctx, r[1]) });
  if ((r = m(/^\/api\/cases\/([\w-]+)\/check$/)) && method === 'POST') {
    const { text } = await body<{ text: string }>(req);
    return json(checkGrounding(text ?? '', await loadFacts(ctx, r[1])));
  }
  if ((r = m(/^\/api\/cases\/([\w-]+)\/submit$/)) && method === 'POST') {
    const b = await body<{ kind: 'FIGHT' | 'REFUND' | 'OFFER'; response?: string; buyerMessage?: string; offerAmount?: number }>(req);
    if (!['FIGHT', 'REFUND', 'OFFER'].includes(b.kind)) throw new HttpError(400, 'kind must be FIGHT, REFUND or OFFER');
    const out = await submitCase(ctx, r[1], b);
    return json(out, out.ok ? 200 : 422);
  }
  if (p === '/api/tracking/parse' && method === 'POST') {
    const { text } = await body<{ text: string }>(req);
    return json(await parseShipments(ctx, String(text ?? '')));
  }
  if (p === '/api/tracking/apply' && method === 'POST') {
    const b = await body<{ orderId: string; carrier: string; trackingNumber: string }>(req);
    const order = await ctx.db.getOrder(b.orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    const v = validateTracking(b.carrier, b.trackingNumber);
    if (!v.ok) throw new HttpError(422, v.reason);
    await ctx.gw.addTracking(order, v.carrier!, v.trackingNumber);
    const existing = order.trackers.find((t) => t.trackingNumber === v.trackingNumber);
    if (existing) Object.assign(existing, { uploadedToPayPal: true, uploadedAt: new Date().toISOString() });
    else order.trackers.push({ carrier: v.carrier!, trackingNumber: v.trackingNumber, uploadedToPayPal: true, uploadedAt: new Date().toISOString(), shippedAt: new Date().toISOString(), carrierStatus: 'PRE_TRANSIT' });
    await ctx.db.putOrder(order);
    await ctx.db.log({ actor: 'seller', kind: 'tracking', orderId: order.id, text: `Uploaded ${v.carrier} tracking ${v.trackingNumber} to PayPal for order ${order.id}.` });
    return json({ ok: true, order });
  }
  if (p === '/api/ask' && method === 'POST') {
    const { question } = await body<{ question: string }>(req);
    return json(await ask(ctx, String(question ?? '')));
  }
  if (p === '/api/sweep' && method === 'POST') return json(await sweep(ctx, { autoUploadTracking: true }));
  if (p === '/api/demo/dispute' && method === 'POST') {
    const { scenario } = await body<{ scenario: ScenarioId }>(req);
    const out = await createScenario(ctx, env, scenario);
    exec.waitUntil(analyzeCase(ctx, out.disputeId).then(() => undefined, () => undefined));
    return json(out);
  }
  if ((r = m(/^\/api\/demo\/adjudicate\/([\w-]+)$/)) && method === 'POST') {
    await demoBudget(ctx, env);
    const { sellerWins } = await body<{ sellerWins: boolean }>(req);
    await ctx.gw.adjudicate(r[1], !!sellerWins);
    await ctx.db.log({ actor: 'demo', kind: 'adjudicate', disputeId: r[1], text: `Sandbox: PayPal decided ${r[1]} in the ${sellerWins ? 'seller' : 'buyer'}'s favour.` });
    await sweep(ctx, { autoUploadTracking: false });
    return json({ ok: true });
  }
  if (p === '/api/shop/orders' && method === 'POST') {
    if (!(ctx.gw instanceof SandboxGateway)) throw new HttpError(409, 'The shop needs PayPal sandbox credentials.');
    const { sku } = await body<{ sku: string }>(req);
    if (!PRICES[sku]) throw new HttpError(400, 'Unknown item');
    return json(await ctx.gw.createCheckoutOrder(sku));
  }
  if ((r = m(/^\/api\/shop\/orders\/([\w-]+)\/capture$/)) && method === 'POST') {
    if (!(ctx.gw instanceof SandboxGateway)) throw new HttpError(409, 'The shop needs PayPal sandbox credentials.');
    const order = await ctx.gw.captureCheckoutOrder(r[1]);
    await ctx.db.putOrder(order);
    await ctx.db.log({ actor: 'paypal', kind: 'order', orderId: order.id, text: `New order ${order.id} for ${order.amount.value} ${order.amount.currency_code} from ${order.buyerName ?? 'a buyer'}. No tracking yet.` });
    return json({ order });
  }
  if (p === '/api/studio-agent' && method === 'POST') return json(await studioAgent(ctx, await body(req)));
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(req);
      return new Response('Not found', { status: 404 });
    }
    const ctx = context(env);
    try {
      return await route(req, env, ctx, exec);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = (e as Error).message || 'Something went wrong';
      if (status >= 500) console.error(e);
      return json({ error: message }, status);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, exec: ExecutionContext) {
    exec.waitUntil(sweep(context(env), { autoUploadTracking: true }).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
