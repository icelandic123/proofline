# Rebuttal

**An AI agent that answers PayPal disputes with verified evidence, and keeps every order eligible for Seller Protection.**

Small sellers lose disputes they should win. They miss the response deadline, never upload tracking to PayPal, or send a vague reply without the proof PayPal needs. Rebuttal watches the seller's PayPal account, and for each new dispute it:

1. **Gathers the facts** from PayPal (the dispute, the order, the capture, refunds, messages, tracking) and from the store's own records (carrier events, listing snapshots).
2. **Scores the case** against an explainable evidence playbook per dispute reason. For example, an "item not received" claim needs tracking on the PayPal transaction, carrier-confirmed delivery to the address on the transaction, and signature confirmation at $750 or more.
3. **Compares the options** by expected cost (fight, refund, partial refund, reship) and suggests the cheapest. It does not fight cases that cost more to fight than to settle.
4. **Writes the response** with an LLM, then **checks every fact in it**: each amount, date, tracking number and id must appear in the case record, and claims like "delivered", "signed for" or "refunded" must be backed by the matching record. A draft that fails the check cannot be sent until the seller fixes it.
5. **Waits for the seller's approval**, then submits the evidence to PayPal through the Disputes API (or accepts the claim, or makes an offer) and follows the case to PayPal's decision.

Between disputes, the agent closes Seller Protection gaps: it reads pasted shipping emails, validates each tracking number against the carrier's format, and uploads it to the PayPal order.

## Try it

- **Live demo:** _URL added at deploy time_
- **Demo lab:** pick a scenario and a sandbox buyer opens a real PayPal sandbox dispute against a real sandbox payment. Watch the agent assess it, approve the response, then play PayPal's dispute team and decide the case.
- **Demo shop:** buy a mug with the sandbox buyer below and see the order appear on the Protection screen.

Sandbox buyer for the demo shop: _added at deploy time_ (PayPal sandbox, no real money).

## What's inside

| Area | What it does | Where |
|---|---|---|
| Evidence playbook | Per-reason checks, win estimate, expected-cost options | `shared/playbook.ts` |
| Fact checker | Verifies amounts, dates, ids and claims in AI drafts | `shared/grounding.ts` |
| Tracking validator | Carrier formats for UPS, USPS, FedEx, DHL, Royal Mail, Canada Post | `shared/tracking.ts` |
| Agent | Gather, assess, draft, verify, queue; autopilot sweep every 10 minutes | `worker/agent.ts` |
| Ask Rebuttal | Read-only tool-calling assistant over cases and orders | `worker/assistant.ts` |
| PayPal client | Disputes, Orders, Payments, tracking, sandbox dispute simulation | `worker/paypal.ts` |
| Web app | Cases, case detail, deadlines, insights, protection, ask, demo lab, shop | `web/src` |

## PayPal integration

- **Disputes API:** list and show disputes, `provide-evidence` (proof of fulfilment with tracking, proof of refund, item description, return policy), `accept-claim`, `make-offer`, `send-message`.
- **Sandbox dispute simulation:** `POST /v1/customer/disputes`, `process-chargeback`, `require-evidence` and `adjudicate`, so the whole lifecycle runs live in the demo.
- **Orders v2 and Payments:** checkout for the demo shop (PayPal JS SDK buttons with server-side create and capture), card payments for demo orders, refunds.
- **Shipment tracking:** `POST /v2/checkout/orders/{id}/track` so orders qualify for Seller Protection.

## AI

- **Model:** Llama 3.3 70B on Cloudflare Workers AI (free tier). If the model is unavailable, a deterministic template writer takes over, so the demo never breaks.
- **What the model does:** writes dispute responses and buyer messages from structured facts, reads messy shipping emails, and answers the seller's questions through tool calls.
- **What the model never does:** set the win estimate, choose the action, or move money. Those come from the deterministic playbook and the seller's approval. Every AI draft passes the fact checker before it can be sent.

## Run it locally

```bash
npm install
npm run db:local          # create the local D1 database
npm run build             # build the web app into dist/
npx wrangler dev --local  # API + app on http://localhost:8787
```

Without PayPal credentials the app runs in offline mode with five demo cases. To use your own PayPal sandbox, create a `.dev.vars` file:

```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_BUYER_EMAIL=...   # a sandbox personal account, for demo disputes
```

Tests: `npm test`. Type check: `npm run typecheck`. `scripts/probe.ts` runs the full dispute lifecycle against the sandbox.

## Tools used to build it

- **Claude Code (Anthropic)** wrote and tested the code, researched the PayPal APIs and drafted this README, working with the author.
- **Cloudflare Workers AI** runs the model inside the app.
- **Bryntum Scheduler** (trial) draws the deadline board, and **AG Studio** (trial) draws the insights dashboard.

## Licence

MIT for this repository's code. Bryntum Scheduler and AG Studio are commercial components used under their trial licences and are installed from npm, not included in this repository.
