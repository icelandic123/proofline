// "Ask Proofline": a read-only, tool-using assistant over the seller's cases
// and orders, plus the shipping-email reader that closes tracking gaps.
// Neither can move money; actions always go through the approval screens.

import { REASON_LABEL, daysLeft } from '../shared/playbook';
import { validateTracking } from '../shared/tracking';
import type { Order } from '../shared/types';
import { isOpen, type Ctx } from './agent';
import type { ChatMessage, ToolSpec } from './llm';
import { parseJsonLoose } from './llm';

const TOOLS: ToolSpec[] = [
  { name: 'list_open_disputes', description: 'Open PayPal disputes with amount, reason, days left to respond, estimated win chance and the agent\'s recommendation.', parameters: { type: 'object', properties: {} } },
  { name: 'get_case', description: 'Full assessment of one dispute: evidence checks, options with expected loss, and the draft status.', parameters: { type: 'object', properties: { dispute_id: { type: 'string' } }, required: ['dispute_id'] } },
  { name: 'protection_report', description: 'Seller Protection coverage: shipped orders, how many have tracking uploaded to PayPal, and which ones are missing it.', parameters: { type: 'object', properties: {} } },
  { name: 'recent_activity', description: 'The latest actions taken by the agent, the seller and PayPal.', parameters: { type: 'object', properties: { limit: { type: 'number' } } } },
];

export async function runTool(ctx: Ctx, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_open_disputes': {
      const cases = new Map((await ctx.db.listCases()).map((c) => [c.disputeId, c]));
      return (await ctx.gw.listDisputes()).filter(isOpen).map((d) => {
        const c = cases.get(d.id);
        return {
          id: d.id,
          reason: REASON_LABEL[d.reason],
          amount: `${d.amount.value} ${d.amount.currency_code}`,
          days_left: daysLeft(d.sellerResponseDueDate),
          status: c?.status ?? 'new',
          win_estimate: c?.plan?.winProbability,
          recommended: c?.plan?.recommended,
        };
      });
    }
    case 'get_case': {
      const id = String(args.dispute_id ?? '');
      const c = await ctx.db.getCase(id);
      if (!c?.plan) return { error: `No assessment for ${id} yet.` };
      return {
        id,
        status: c.status,
        win_estimate: c.plan.winProbability,
        recommended: c.plan.recommended,
        checks: c.plan.checks.map((k) => ({ check: k.label, result: k.status, detail: k.detail, fix: k.fix })),
        options: c.plan.options.map((o) => ({ action: o.label, expected_loss: o.expectedLoss, why: o.explanation })),
        draft_verified: c.draft?.grounding.ok,
      };
    }
    case 'protection_report':
      return protectionReport(await ctx.db.listOrders(200));
    case 'recent_activity':
      return (await ctx.db.activity(Math.min(Number(args.limit ?? 10), 25))).map((a) => ({ when: a.ts, who: a.actor, what: a.text }));
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export function protectionReport(orders: Order[]) {
  const physical = orders.filter((o) => !o.intangible);
  const shipped = physical.filter((o) => o.trackers.length);
  const covered = shipped.filter((o) => o.trackers.some((t) => t.uploadedToPayPal));
  const missing = physical.filter((o) => !o.trackers.some((t) => t.uploadedToPayPal));
  const atRisk = missing.reduce((s, o) => s + Number(o.amount.value), 0);
  return {
    physical_orders: physical.length,
    shipped: shipped.length,
    tracking_on_paypal: covered.length,
    coverage_pct: physical.length ? Math.round((covered.length / physical.length) * 100) : 100,
    unprotected_amount: Math.round(atRisk * 100) / 100,
    missing: missing.slice(0, 20).map((o) => ({ order: o.id, buyer: o.buyerName, amount: o.amount.value, has_tracking_not_uploaded: o.trackers.length > 0 })),
  };
}

const ASK_SYSTEM = `You are Proofline, the dispute and Seller Protection assistant for a small PayPal seller.
Answer the seller's question using the tools; never guess numbers. Keep answers under 120 words, in plain sentences.
You cannot submit responses, refund or move money. If the seller wants an action, tell them which screen to approve it on.`;

export async function ask(ctx: Ctx, question: string) {
  const trace: { tool: string; args: Record<string, unknown> }[] = [];
  if (!ctx.llm.available) {
    const disputes = (await runTool(ctx, 'list_open_disputes', {})) as { id: string }[];
    return { answer: `AI is offline right now. You have ${disputes.length} open disputes; open the Cases screen for details.`, trace, model: 'none' };
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: ASK_SYSTEM },
    { role: 'user', content: question.slice(0, 800) },
  ];
  for (let step = 0; step < 4; step++) {
    const r = await ctx.llm.chat(messages, { tools: TOOLS, maxTokens: 500 });
    if (!r.toolCalls.length) return { answer: r.text.trim(), trace, model: r.model };
    messages.push({ role: 'assistant', content: JSON.stringify({ tool_calls: r.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments })) }) });
    for (const call of r.toolCalls.slice(0, 3)) {
      trace.push({ tool: call.name, args: call.arguments });
      const result = await runTool(ctx, call.name, call.arguments);
      messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  const final = await ctx.llm.chat([...messages, { role: 'user', content: 'Answer now from the tool results above.' }], { maxTokens: 400 });
  return { answer: final.text.trim(), trace, model: final.model };
}

export interface TrackingProposal {
  orderId?: string;
  buyer?: string;
  carrier?: string;
  trackingNumber: string;
  valid: boolean;
  reason: string;
}

const PARSE_SYSTEM = `Extract every shipment from the pasted shipping confirmations.
Return only JSON: {"shipments": [{"order_ref": string|null, "buyer_name": string|null, "carrier": string|null, "tracking_number": string}]}
Copy tracking numbers exactly as written. Do not invent shipments.`;

/** Reads pasted shipping emails or label exports and matches each shipment to an order. */
export async function parseShipments(ctx: Ctx, text: string): Promise<{ proposals: TrackingProposal[]; model: string }> {
  let found: { order_ref?: string | null; buyer_name?: string | null; carrier?: string | null; tracking_number: string }[] = [];
  let model = 'pattern';
  if (ctx.llm.available) {
    try {
      const r = await ctx.llm.chat([{ role: 'system', content: PARSE_SYSTEM }, { role: 'user', content: text.slice(0, 6000) }], { maxTokens: 700 });
      found = parseJsonLoose<{ shipments: typeof found }>(r.text).shipments ?? [];
      model = r.model;
    } catch {
      found = [];
    }
  }
  if (!found.length) {
    // Fallback: anything shaped like a tracking number.
    for (const m of text.matchAll(/\b(1Z[0-9A-Z]{16}|9\d{21}|\d{12}|\d{10})\b/g)) found.push({ tracking_number: m[1] });
  }
  const orders = await ctx.db.listOrders(200);
  const proposals = found.map((s) => {
    const v = validateTracking(s.carrier ?? undefined, s.tracking_number);
    const ref = (s.order_ref ?? '').toUpperCase();
    const order =
      orders.find((o) => ref && (o.id.toUpperCase() === ref || ref.includes(o.id.toUpperCase()))) ??
      orders.find((o) => s.buyer_name && o.buyerName && o.buyerName.toLowerCase() === s.buyer_name.toLowerCase() && !o.trackers.some((t) => t.uploadedToPayPal));
    // Only fill in from the order when the AI extraction was not grounded in the text.
    const inText = text.replace(/[\s-]/g, '').toUpperCase().includes(v.trackingNumber);
    return {
      orderId: order?.id,
      buyer: order?.buyerName ?? s.buyer_name ?? undefined,
      carrier: v.carrier ?? s.carrier ?? undefined,
      trackingNumber: v.trackingNumber,
      valid: v.ok && inText && !!order,
      reason: !inText ? 'This number does not appear in the pasted text.' : !order ? 'No matching order found.' : v.reason,
    };
  });
  return { proposals, model };
}
