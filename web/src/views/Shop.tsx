import { loadScript, type PayPalNamespace } from '@paypal/paypal-js';
import { useEffect, useRef, useState } from 'react';
import { api, fmtMoney, type Config } from '../api';
import { go } from '../App';

const ART: Record<string, { emoji: string; bg: string }> = {
  'FH-MUG-SAGE': { emoji: '☕', bg: '#dfe8dc' },
  'FH-BOWL-SET': { emoji: '🥣', bg: '#efe6d8' },
  'FH-VASE-TALL': { emoji: '🏺', bg: '#d9e1ee' },
  'FH-DINNER-12': { emoji: '🍽', bg: '#ecebe7' },
  'FH-CLASS-GIFT': { emoji: '🎟', bg: '#f1e2dc' },
};

function BuyButton({ sku, paypal, onPaid }: { sku: string; paypal: PayPalNamespace; onPaid: (orderId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !paypal.Buttons) return;
    const buttons = paypal.Buttons({
      style: { layout: 'horizontal', height: 36, tagline: false, label: 'pay' },
      createOrder: async () => (await api.shopCreate(sku)).id,
      onApprove: async (data) => {
        const r = await api.shopCapture(data.orderID);
        onPaid(r.order.id);
      },
    });
    buttons.render(ref.current).catch(() => undefined);
    return () => {
      buttons.close().catch(() => undefined);
    };
  }, [sku, paypal, onPaid]);
  return <div ref={ref} />;
}

export function ShopView({ config }: { config?: Config }) {
  const [paypal, setPaypal] = useState<PayPalNamespace | null>(null);
  const [paid, setPaid] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!config?.paypalClientId) return;
    loadScript({ clientId: config.paypalClientId, currency: 'USD', intent: 'capture', components: 'buttons' })
      .then((p) => setPaypal(p), (e) => setError(`PayPal could not load: ${e.message}`));
  }, [config?.paypalClientId]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{config?.store.storeName ?? 'Demo shop'}</h1>
          <p>A small storefront wired to PayPal Checkout (sandbox). Every purchase lands in Rebuttal's Protection screen, where the agent makes sure it ships with tracking on PayPal.</p>
        </div>
      </div>
      {config?.mode !== 'sandbox' && <div className="banner warn">The shop needs PayPal sandbox credentials, so it is disabled in offline mode.</div>}
      {config?.mode === 'sandbox' && <div className="banner info">Pay with the sandbox buyer account shown in the README. No real money moves.</div>}
      {error && <div className="banner warn">{error}</div>}
      {paid && (
        <div className="banner good">
          Order {paid} is paid. It now shows as exposed until it ships with tracking.
          <a href="#/protection" onClick={(e) => { e.preventDefault(); go('/protection'); }} style={{ marginLeft: 'auto' }}>See it in Protection →</a>
        </div>
      )}
      <div className="shop-grid">
        {config?.listings.map((l) => (
          <div key={l.sku} className="card product">
            <div className="art" style={{ background: ART[l.sku]?.bg }} aria-hidden>{ART[l.sku]?.emoji}</div>
            <div className="body">
              <div style={{ fontWeight: 600 }}>{l.title}</div>
              <div className="small muted">{l.description}</div>
              <div className="row" style={{ marginTop: 'auto' }}>
                <span style={{ fontWeight: 600 }}>{fmtMoney(l.price)}</span>
              </div>
              {paypal && <BuyButton sku={l.sku} paypal={paypal} onPaid={setPaid} />}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
