// End-to-end check against the real PayPal sandbox, run from GitHub Actions:
// pays a demo order, uploads tracking, opens a dispute, answers it with
// evidence and has PayPal decide it. Prints each step so failures are easy
// to read in the job log.
//
//   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_BUYER_EMAIL=... npx tsx scripts/probe.ts [scenario]

import { scenarioOrder, SCENARIOS, type ScenarioId } from '../worker/demo';
import { PayPalError, SandboxGateway } from '../worker/paypal';
import type { Db } from '../worker/db';
import { planCase } from '../shared/playbook';
import { LISTINGS, STORE_POLICY } from '../shared/fixtures';

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BUYER_EMAIL } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET');
  process.exit(2);
}

const gw = new SandboxGateway(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, {} as Db, PAYPAL_BUYER_EMAIL);
const scenarios = (process.argv[2] ? [process.argv[2]] : Object.keys(SCENARIOS)) as ScenarioId[];
let failures = 0;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t = Date.now();
  try {
    const v = await fn();
    console.log(`  ok   ${name} (${Date.now() - t} ms)${v !== undefined ? ` -> ${JSON.stringify(v).slice(0, 300)}` : ''}`);
    return v;
  } catch (e) {
    failures++;
    const pe = e as PayPalError;
    console.log(`  FAIL ${name}: ${pe.message}`);
    if (pe.details) console.log(`       debug_id=${pe.debugId} details=${JSON.stringify(pe.details).slice(0, 1500)}`);
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await step('oauth token', async () => (await gw.pp.accessToken()).slice(0, 8) + '…');
await step('list disputes', async () => (await gw.listDisputes()).map((d) => `${d.id}:${d.status}`));

for (const id of scenarios) {
  console.log(`\n== ${id}: ${SCENARIOS[id].title}`);
  const order = await step('pay demo order with sandbox card', () => gw.createPaidOrder(scenarioOrder(id)));
  if (!order) continue;
  console.log(`       order=${order.id} capture=${order.captureId} refunds=${order.refunds.map((r) => r.id).join(',')}`);
  for (const t of order.trackers.filter((x) => x.uploadedToPayPal)) {
    await step(`upload ${t.carrier} tracking`, () => gw.addTracking(order, t.carrier, t.trackingNumber));
  }
  const disputeId = await step('buyer opens dispute', () => gw.openDispute(order, SCENARIOS[id].reason, SCENARIOS[id].buyerNote));
  if (!disputeId) continue;
  let d = await step('read dispute', () => gw.getDispute(disputeId));
  for (let i = 0; d && d.status !== 'WAITING_FOR_SELLER_RESPONSE' && i < 6; i++) {
    await sleep(5000);
    d = await step(`re-read dispute (status ${d.status})`, () => gw.getDispute(disputeId));
  }
  if (!d) continue;
  console.log(`       status=${d.status} stage=${d.stage} actions=${d.allowedActions.join(',')} due=${d.sellerResponseDueDate}`);
  const plan = planCase({ dispute: d, order, listings: LISTINGS, buyerPriorOrders: 0, storePolicy: STORE_POLICY });
  console.log(`       plan: ${plan.recommended} at ${plan.winProbability}, evidence=${plan.evidence.map((e) => e.type).join(',')}`);
  if (process.env.PROBE_RESPOND !== 'false') {
    await step('send buyer message', () => gw.respond(disputeId, { kind: 'MESSAGE', text: 'Hi, we are looking into this now and will update you shortly.' }));
    await step('provide evidence', () => gw.respond(disputeId, { kind: 'FIGHT', note: `Probe response for ${disputeId}.`, evidence: plan.evidence }));
    await step('adjudicate (seller wins)', () => gw.adjudicate(disputeId, true));
    await step('final state', async () => {
      const f = await gw.getDispute(disputeId);
      return `${f.status} ${f.outcome ?? ''}`;
    });
  }
}

console.log(`\n${failures} failed step(s)`);
process.exit(failures ? 1 : 0);
