// Tracking-number validation. The AI reads messy shipping emails; these
// checks decide whether what it extracted is a real-looking tracking number
// for the carrier it named before anything is uploaded to PayPal.

export interface CarrierRule {
  /** PayPal carrier enum value. */
  paypal: string;
  label: string;
  patterns: RegExp[];
}

export const CARRIERS: CarrierRule[] = [
  { paypal: 'UPS', label: 'UPS', patterns: [/^1Z[0-9A-Z]{16}$/, /^T\d{10}$/] },
  { paypal: 'USPS', label: 'USPS', patterns: [/^(94|93|92|95|94|82|70|23|03)\d{18,20}$/, /^[A-Z]{2}\d{9}US$/] },
  { paypal: 'FEDEX', label: 'FedEx', patterns: [/^\d{12}$/, /^\d{15}$/, /^\d{20}$/, /^\d{22}$/] },
  { paypal: 'DHL', label: 'DHL Express', patterns: [/^\d{10}$/, /^JJD\d{18}$/] },
  { paypal: 'ROYAL_MAIL', label: 'Royal Mail', patterns: [/^[A-Z]{2}\d{9}GB$/] },
  { paypal: 'CANADA_POST', label: 'Canada Post', patterns: [/^\d{16}$/, /^[A-Z]{2}\d{9}CA$/] },
];

export function normaliseTracking(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function carrierByName(name: string): CarrierRule | undefined {
  const n = name.toUpperCase().replace(/[^A-Z]/g, '');
  return CARRIERS.find((c) => c.paypal.replace(/_/g, '') === n || c.label.toUpperCase().replace(/[^A-Z]/g, '') === n || (n.startsWith(c.paypal.replace(/_/g, '')) && n.length < 12));
}

export function detectCarriers(tracking: string): CarrierRule[] {
  const t = normaliseTracking(tracking);
  return CARRIERS.filter((c) => c.patterns.some((p) => p.test(t)));
}

export interface TrackingVerdict {
  ok: boolean;
  carrier?: string;
  trackingNumber: string;
  reason: string;
}

/** Accept the AI's extraction only if the number fits the named carrier (or exactly one carrier when none was named). */
export function validateTracking(carrierName: string | undefined, tracking: string): TrackingVerdict {
  const t = normaliseTracking(tracking);
  const fits = detectCarriers(t);
  if (carrierName) {
    const c = carrierByName(carrierName);
    if (!c) return { ok: false, trackingNumber: t, reason: `Unknown carrier "${carrierName}".` };
    if (fits.includes(c)) return { ok: true, carrier: c.paypal, trackingNumber: t, reason: `Matches the ${c.label} format.` };
    return { ok: false, carrier: c.paypal, trackingNumber: t, reason: `${t} does not look like a ${c.label} tracking number.` };
  }
  if (fits.length === 1) return { ok: true, carrier: fits[0].paypal, trackingNumber: t, reason: `Format identifies ${fits[0].label}.` };
  if (fits.length > 1) return { ok: false, trackingNumber: t, reason: `Could be ${fits.map((f) => f.label).join(' or ')}; the carrier must be named.` };
  return { ok: false, trackingNumber: t, reason: `${t} does not match any supported carrier format.` };
}
