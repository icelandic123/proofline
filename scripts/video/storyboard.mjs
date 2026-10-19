// The demo video, scene by scene: what the narrator says and what happens on
// screen while they say it. record.mjs plays this against a running Proofline.
// Keep the total narration under 2:50 so the video stays under 3 minutes.

export const scenes = [
  {
    id: 'title',
    say: 'A PayPal dispute gives a small seller about ten days to answer. Most of them lose money twice: fighting cases they cannot win, and refunding cases they would have won. Proofline is an AI agent that handles disputes for them, and it only says what it can prove.',
    run: async (v) => {
      await v.go('/cases');
      await v.overlay('Proofline', 'An AI agent that defends PayPal sellers in disputes, and only says what it can prove.');
      // Warm the heavy Insights screen behind the title card so it opens instantly later.
      await v.hash('/insights');
      await v.wait(6000);
      await v.hash('/cases');
    },
  },
  {
    id: 'cases',
    say: 'Every open dispute comes in through the PayPal Disputes API. The agent has already read each one, with the order, the capture, the tracking and the store policy, and it gives a win chance and a recommendation. Nothing is sent to PayPal until the seller approves.',
    run: async (v) => {
      await v.clearOverlay();
      await v.point('table tbody tr:nth-child(1) td:nth-child(5)');
      await v.wait(2500);
      await v.point('table tbody tr:has-text("PP-D-41188") td:nth-child(6)');
    },
  },
  {
    id: 'case-facts',
    say: 'Take this eight hundred and forty dollar chargeback. The timeline holds only facts, each tagged with its source: the PayPal order, the uploaded tracking, the carrier. The evidence check shows what Seller Protection needs, and what is missing.',
    run: async (v) => {
      await v.click('table tbody tr:has-text("PP-D-41188") td:nth-child(1)');
      await v.wait(1200);
      await v.point('.facts-tl li:nth-child(3)');
      await v.wait(2500);
      await v.scrollTo('.checks');
      await v.point('.checks li:nth-child(6)');
    },
  },
  {
    id: 'case-decision',
    say: 'Proofline does not just say fight. It prices every option, including PayPal fees and the seller\'s time, and suggests the cheapest. This case is covered by Seller Protection, so fighting costs about six dollars, against eight hundred and forty for a refund.',
    run: async (v) => {
      await v.scrollTop();
      await v.point('.option.rec');
      await v.wait(3000);
      await v.point('.option:not(.rec)');
    },
  },
  {
    id: 'grounding',
    say: 'Llama on Cloudflare Workers AI writes the response. Then a fact checker compares every amount, date, tracking number and claim with the PayPal record. If anyone adds a claim the record cannot back, like a signature that never happened, it is flagged, and the send button stays locked.',
    run: async (v) => {
      await v.scrollTo('.editor textarea');
      await v.point('.verify .chip');
      await v.wait(2500);
      await v.typeAtEnd('.editor textarea', ' The buyer signed for the parcel on 2026-10-04.');
      await v.wait(2200);
      await v.point('.verify .chip');
    },
  },
  {
    id: 'refund',
    say: 'And when fighting costs more than it saves, it says so. For this thirty four dollar mug, the cheapest move is to accept the claim and take the mug back.',
    run: async (v) => {
      await v.go('/cases');
      await v.click('table tbody tr:has-text("PP-D-41219") td:nth-child(1)');
      await v.wait(1000);
      await v.point('.option.rec');
    },
  },
  {
    id: 'deadlines',
    say: 'The deadline board, built with Bryntum Scheduler, puts every response window on one timeline, so nothing slips past PayPal\'s due date.',
    run: async (v) => {
      await v.nav('Deadlines');
      await v.wait(1500);
      await v.point('.b-sch-event-wrap:last-child');
    },
  },
  {
    id: 'protection',
    say: 'Prevention matters most. PayPal only protects a sale when tracking is on the transaction. Paste a shipping email, the AI pulls out the tracking numbers, a format check confirms each one, and Proofline uploads it with PayPal\'s tracking API.',
    run: async (v) => {
      await v.nav('Protection');
      await v.click('button.btn.ghost');
      await v.wait(600);
      await v.click('button.btn.primary');
      await v.wait(2500);
      await v.click('button.btn.small.primary');
    },
  },
  {
    id: 'insights',
    say: 'Insights runs on AG Studio, with Proofline\'s own deadline radar and coverage widgets. Click any chart to cross filter, or ask its AI assistant to build a new view.',
    run: async (v) => {
      await v.nav('Insights');
      await v.wait(4000);
      await v.point('text=Deadline radar');
      await v.wait(1800);
      await v.click('button:has-text("Unauthorized payment")');
    },
  },
  {
    id: 'demo-lab',
    say: 'Everything runs on the PayPal sandbox. In the demo lab, anyone can have a test buyer open a real dispute, watch the agent pick it up within seconds, approve the response, and then let PayPal decide the case.',
    run: async (v) => {
      await v.nav('Demo lab');
      await v.wait(800);
      await v.click('.scenario >> nth=0');
      await v.wait(4000);
      await v.click('text=Open the case');
    },
  },
  {
    id: 'close',
    say: 'Proofline. Fewer lost disputes, no invented evidence, and an agent that knows when not to fight.',
    run: async (v) => {
      await v.overlay('Proofline', 'Built with the PayPal REST APIs, Cloudflare Workers AI, Bryntum Scheduler and AG Studio.');
    },
  },
];
