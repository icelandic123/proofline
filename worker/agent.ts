// The dispute agent: gathers the facts for a case, scores it with the
// deterministic playbook, has the model write the response, checks every
// fact in the draft, and queues it for the seller's approval.

import { checkGrounding } from '../shared/grounding';
import { LISTINGS, STORE_POLICY } from '../shared/fixtures';
import { planCase, REASON_LABEL } from '../shared/playbook';
import type { CaseFacts, CasePlan, Dispute, Draft } from '../shared/types';
import type { CaseRow, Db } from './db';
import type { Gateway, SellerAction } from './gateway';
import { Llm, type ChatMessage } from './llm';

export interface Ctx {
  db: Db;
  gw: Gateway;
  llm: Llm;
}

const OPEN = new Set(['OPEN', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE', 'UNDER_REVIEW']);
export const isOpen = (d: Dispute) => OPEN.has(d.status);

export async function loadFacts(ctx: Ctx, disputeId: string, dispute?: Dispute): Promise<CaseFacts> {
  const d = dispute ?? (await ctx.gw.getDispute(disputeId));
  let order;
  for (const tx of d.sellerTransactionIds) {
    order = await ctx.db.getOrder(tx);
    if (order) break;
  }
  const email = order?.buyerEmail ?? d.buyerEmail;
  const prior = email ? await ctx.db.countBuyerOrders(email, order?.id) : 0;
  return { dispute: d, order, listings: LISTINGS, buyerPriorOrders: prior, storePolicy: STORE_POLICY };
}

const SYSTEM = `You are Rebuttal, an agent that answers PayPal disputes for a small online shop.
You write to PayPal's dispute team on the seller's behalf.
Rules:
- Use ONLY facts from the FACTS JSON. Never invent dates, amounts, tracking numbers, ids, signatures, photos or refunds.
- Write dates as YYYY-MM-DD and amounts as 12.34 USD, copied exactly from FACTS.
- Address the buyer's specific complaint when they gave one.
- Plain, calm, factual. No legal threats, no speculation about the buyer.
- "response" is at most 1200 characters: one sentence stating the seller's position, then numbered evidence points, then one sentence asking PayPal to decide in the seller's favour (or, if the plan is to refund or offer, explaining that choice).
- "buyer_message" is a short, friendly message to the buyer (at most 400 characters) that matches the chosen action.
Return only JSON: {"response": string, "buyer_message": string}`;

function factsForPrompt(facts: CaseFacts, plan: CasePlan) {
  const o = facts.order;
  return {
    store: facts.storePolicy.storeName,
    dispute: {
      id: facts.dispute.id,
      reason: REASON_LABEL[facts.dispute.reason],
      amount: `${facts.dispute.amount.value} ${facts.dispute.amount.currency_code}`,
      opened: facts.dispute.createdAt.slice(0, 10),
      buyer_messages: facts.dispute.messages.filter((m) => m.postedBy === 'BUYER').map((m) => m.content),
    },
    order: o && {
      id: o.id,
      capture_id: o.captureId,
      paid: o.createdAt.slice(0, 10),
      total: `${o.amount.value} ${o.amount.currency_code}`,
      items: o.items.map((i) => `${i.quantity} x ${i.name}`),
      ships_to: o.shippingAddress ? [o.shippingAddress.line1, o.shippingAddress.city, o.shippingAddress.state, o.shippingAddress.postalCode].filter(Boolean).join(', ') : 'digital delivery',
      shipments: o.trackers.map((t) => ({
        carrier: t.carrier,
        tracking_number: t.trackingNumber,
        shipped: t.shippedAt?.slice(0, 10),
        uploaded_to_paypal: t.uploadedToPayPal,
        carrier_status: t.carrierStatus,
        delivered: t.deliveredAt?.slice(0, 10),
        signature_confirmed: !!t.signatureConfirmed,
      })),
      refunds: o.refunds.map((r) => ({ id: r.id, amount: `${r.amount.value} ${r.amount.currency_code}`, date: r.createdAt.slice(0, 10) })),
    },
    listing: facts.listings
      .filter((l) => o?.items.some((i) => i.sku === l.sku))
      .map((l) => ({ title: l.title, description: l.description, photos_on_file: l.photos.length, return_policy: l.returnPolicy })),
    buyer_prior_orders_without_dispute: facts.buyerPriorOrders,
    plan: {
      recommended_action: plan.recommended,
      estimated_win_probability: plan.winProbability,
      evidence_checks: plan.checks.map((c) => `${c.status.toUpperCase()}: ${c.label}. ${c.detail}`),
    },
  };
}

/** Deterministic writer used when the model is unavailable or keeps failing the fact check. */
export function templateDraft(facts: CaseFacts, plan: CasePlan): { response: string; buyerMessage: string } {
  const d = facts.dispute;
  const o = facts.order;
  const amt = `${d.amount.value} ${d.amount.currency_code}`;
  const points: string[] = [];
  if (o) points.push(`Order ${o.id} was paid on ${o.createdAt.slice(0, 10)} for ${o.amount.value} ${o.amount.currency_code}.`);
  for (const t of o?.trackers ?? []) {
    let s = `Shipped with ${t.carrier}, tracking ${t.trackingNumber}`;
    if (t.uploadedToPayPal) s += ', uploaded to PayPal';
    if (t.carrierStatus === 'DELIVERED' && t.deliveredAt) s += `; the carrier shows it delivered on ${t.deliveredAt.slice(0, 10)} to the address on the transaction`;
    points.push(s + '.');
  }
  for (const r of o?.refunds ?? []) points.push(`Refund ${r.id} for ${r.amount.value} ${r.amount.currency_code} was issued on ${r.createdAt.slice(0, 10)}.`);
  if (d.reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED') points.push(`The listing states that each piece is handmade and varies, and the store offers ${facts.storePolicy.returnWindowDays}-day returns.`);
  if (facts.buyerPriorOrders > 0) points.push(`The buyer completed ${facts.buyerPriorOrders} earlier orders without a dispute.`);
  const fight = plan.recommended === 'FIGHT';
  const position = fight
    ? `${facts.storePolicy.storeName} contests this ${REASON_LABEL[d.reason].toLowerCase()} claim for ${amt}.`
    : `${facts.storePolicy.storeName} will resolve this ${REASON_LABEL[d.reason].toLowerCase()} claim for ${amt} directly with the buyer.`;
  const response = [position, ...points.map((p, i) => `${i + 1}. ${p}`), fight ? 'We ask PayPal to close this case in the seller\'s favour.' : ''].filter(Boolean).join('\n');
  const buyerMessage = fight
    ? `Hi ${d.buyerName?.split(' ')[0] ?? 'there'}, we're sorry for the trouble. Our records show the order was fulfilled, and we've shared the details with PayPal. If something is wrong with the item, reply here and we'll help.`
    : `Hi ${d.buyerName?.split(' ')[0] ?? 'there'}, we're sorry about this. We're sorting it out now and will confirm here once it's done.`;
  return { response, buyerMessage };
}

export async function draftCase(ctx: Ctx, facts: CaseFacts, plan: CasePlan): Promise<Draft> {
  const base = { disputeId: facts.dispute.id, generatedAt: new Date().toISOString() };
  if (ctx.llm.available) {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `FACTS:\n${JSON.stringify(factsForPrompt(facts, plan), null, 1)}` },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { value, model } = await ctx.llm.json<{ response: string; buyer_message?: string }>(messages);
        const text = String(value.response ?? '').slice(0, 2000);
        const grounding = checkGrounding(`${text}\n${value.buyer_message ?? ''}`, facts);
        if (grounding.ok || attempt === 1) {
          return { ...base, response: text, buyerMessage: value.buyer_message, model, grounding };
        }
        messages.push(
          { role: 'assistant', content: JSON.stringify(value) },
          { role: 'user', content: `The fact check rejected this draft:\n${grounding.issues.map((i) => `- ${i.message}`).join('\n')}\nRewrite it using only facts from FACTS. Return only JSON.` },
        );
      } catch (e) {
        if (attempt === 1) break;
      }
    }
  }
  const t = templateDraft(facts, plan);
  return { ...base, response: t.response, buyerMessage: t.buyerMessage, model: 'template', grounding: checkGrounding(`${t.response}\n${t.buyerMessage}`, facts) };
}

export async function analyzeCase(ctx: Ctx, disputeId: string, dispute?: Dispute): Promise<CaseRow> {
  const facts = await loadFacts(ctx, disputeId, dispute);
  const plan = planCase(facts);
  await ctx.db.log({ actor: 'agent', kind: 'assess', disputeId, text: `Assessed ${REASON_LABEL[facts.dispute.reason].toLowerCase()} claim for ${facts.dispute.amount.value} ${facts.dispute.amount.currency_code}: ${Math.round(plan.winProbability * 100)}% estimated win, recommends ${plan.recommended.toLowerCase()}.`, detail: { checks: plan.checks.map((c) => [c.label, c.status]) } });
  const draft = await draftCase(ctx, facts, plan);
  await ctx.db.log({
    actor: 'agent',
    kind: 'draft',
    disputeId,
    text: draft.grounding.ok
      ? `Drafted the response (${draft.model === 'template' ? 'template' : 'AI'}); all ${draft.grounding.checkedTokens} facts in it check out.`
      : `Drafted the response, but ${draft.grounding.issues.length} statement${draft.grounding.issues.length > 1 ? 's' : ''} could not be verified. Waiting for an edit.`,
  });
  const prev = await ctx.db.getCase(disputeId);
  const row: CaseRow = {
    disputeId,
    status: prev?.status === 'submitted' || prev?.status === 'resolved' ? prev.status : draft.grounding.ok ? 'ready' : 'needs_edit',
    plan,
    draft,
    decision: prev?.decision,
    updatedAt: new Date().toISOString(),
  };
  await ctx.db.putCase(row);
  return row;
}

export async function submitCase(ctx: Ctx, disputeId: string, choice: { kind: 'FIGHT' | 'REFUND' | 'OFFER'; response?: string; buyerMessage?: string; offerAmount?: number }) {
  const row = (await ctx.db.getCase(disputeId)) ?? (await analyzeCase(ctx, disputeId));
  const facts = await loadFacts(ctx, disputeId);
  const plan = row.plan ?? planCase(facts);
  const response = choice.response ?? row.draft?.response ?? templateDraft(facts, plan).response;
  const grounding = checkGrounding(response, facts);
  if (choice.kind === 'FIGHT' && !grounding.ok) {
    return { ok: false as const, issues: grounding.issues };
  }
  let action: SellerAction;
  if (choice.kind === 'FIGHT') action = { kind: 'FIGHT', note: response, evidence: plan.evidence };
  else if (choice.kind === 'OFFER') action = { kind: 'OFFER', note: choice.buyerMessage ?? row.draft?.buyerMessage ?? response, amount: choice.offerAmount ?? Math.round(Number(facts.dispute.amount.value) * 30) / 100 };
  else action = { kind: 'REFUND', note: response };
  await ctx.gw.respond(disputeId, action);
  if (choice.buyerMessage && choice.kind !== 'OFFER' && facts.dispute.allowedActions.includes('send-message')) {
    try {
      await ctx.gw.respond(disputeId, { kind: 'MESSAGE', text: choice.buyerMessage });
    } catch {
      // Messaging is best effort; the response itself went through.
    }
  }
  await ctx.db.putCase({ ...row, status: 'submitted', decision: { kind: choice.kind, at: new Date().toISOString(), note: response, amount: action.kind === 'OFFER' ? action.amount : undefined }, updatedAt: new Date().toISOString() });
  const verb = choice.kind === 'FIGHT' ? `Submitted evidence (${plan.evidence.map((e) => e.type.toLowerCase().replace(/_/g, ' ')).join(', ') || 'written response'})` : choice.kind === 'REFUND' ? 'Accepted the claim and refunded' : `Offered a ${action.kind === 'OFFER' ? action.amount.toFixed(2) : ''} partial refund`;
  await ctx.db.log({ actor: 'seller', kind: 'submit', disputeId, text: `${verb} for ${disputeId}.` });
  return { ok: true as const };
}

/** One pass of the agent's autopilot: tracking gaps get closed, then new or changed disputes get analysed. */
export async function sweep(ctx: Ctx, opts: { autoUploadTracking: boolean }) {
  let uploaded = 0;
  if (opts.autoUploadTracking) {
    for (const o of await ctx.db.listOrders(100)) {
      for (const t of o.trackers) {
        if (t.uploadedToPayPal || !o.captureId) continue;
        try {
          await ctx.gw.addTracking(o, t.carrier, t.trackingNumber);
          t.uploadedToPayPal = true;
          t.uploadedAt = new Date().toISOString();
          await ctx.db.putOrder(o);
          await ctx.db.log({ actor: 'agent', kind: 'tracking', orderId: o.id, text: `Uploaded ${t.carrier} tracking ${t.trackingNumber} to PayPal for order ${o.id}, so it qualifies for Seller Protection.` });
          uploaded++;
        } catch (e) {
          await ctx.db.log({ actor: 'agent', kind: 'error', orderId: o.id, text: `Could not upload tracking for order ${o.id}: ${(e as Error).message}` });
        }
      }
    }
  }
  const disputes = await ctx.gw.listDisputes();
  const cases = new Map((await ctx.db.listCases()).map((c) => [c.disputeId, c]));
  let analysed = 0;
  for (const d of disputes) {
    const c = cases.get(d.id);
    if (!isOpen(d)) {
      if (c && c.status !== 'resolved') {
        await ctx.db.putCase({ ...c, status: 'resolved', updatedAt: new Date().toISOString() });
        const won = d.outcome === 'RESOLVED_SELLER_FAVOUR';
        await ctx.db.log({ actor: 'paypal', kind: 'resolved', disputeId: d.id, text: `PayPal closed ${d.id}: ${won ? 'decided in the seller\'s favour' : (d.outcome ?? 'resolved').toLowerCase().replace(/_/g, ' ')}.` });
      }
      continue;
    }
    // Re-assess when PayPal updated the case or new tracking changed the evidence.
    if (!c || (c.status !== 'submitted' && (c.updatedAt < d.updatedAt || uploaded > 0))) {
      await analyzeCase(ctx, d.id, d);
      analysed++;
    }
  }
  return { analysed, uploaded, disputes: disputes.length };
}
