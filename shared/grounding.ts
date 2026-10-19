// Grounding check for AI-written dispute responses. Every amount, date and
// identifier in a draft must appear in the case facts, and factual claims
// (delivered, signed, refunded...) must be backed by the matching fact.
// A draft with issues cannot be submitted until the seller edits it.

import type { CaseFacts, GroundingIssue } from './types';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((v) => collectStrings(v, out));
  return out;
}

const normId = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

function factIndex(facts: CaseFacts) {
  const strings = collectStrings(facts);
  const ids = new Set<string>();
  const amounts = new Set<string>();
  const dates = new Set<string>();
  for (const s of strings) {
    for (const tok of s.split(/[\s,;:()]+/)) {
      const id = normId(tok);
      if (id.length >= 6 && /\d/.test(id)) ids.add(id);
    }
    const whole = normId(s);
    if (whole.length >= 6 && /\d/.test(whole)) ids.add(whole);
    for (const m of s.matchAll(/\d+(?:\.\d+)?/g)) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) amounts.add(n.toFixed(2));
    }
    for (const m of s.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) dates.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  // Derived amounts the agent may legitimately state.
  const amount = Number(facts.dispute.amount.value);
  amounts.add((amount + facts.storePolicy.disputeFee).toFixed(2));
  return { ids, amounts, dates };
}

function parseDate(text: string, knownDates: Set<string>): string[] {
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return [text];
  const m1 = text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i);
  const m2 = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:,?\s+(\d{4}))?$/i);
  const [monthName, day, year] = m1 ? [m1[1], m1[2], m1[3]] : m2 ? [m2[2], m2[1], m2[3]] : [];
  if (!monthName) return [];
  const mi = MONTHS.findIndex((mn) => mn.startsWith(monthName.toLowerCase().slice(0, 3)));
  if (mi < 0) return [];
  const mmdd = `${String(mi + 1).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
  if (year) return [`${year}-${mmdd}`];
  return [...knownDates].filter((d) => d.endsWith(mmdd)).concat(knownDates.size ? [] : [`????-${mmdd}`]);
}

const MONTH_RE = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

interface ClaimRule {
  pattern: RegExp;
  holds: (f: CaseFacts) => boolean;
  message: string;
}

const trackers = (f: CaseFacts) => f.order?.trackers ?? [];

const CLAIMS: ClaimRule[] = [
  {
    pattern: /\b(?<!not\s|never\s|wasn't\s|was not\s)(?:was|were|been|confirmed|shows?|marked)\s+(?:as\s+)?delivered\b|\bdelivered\s+on\b|\bproof of delivery\b|\bdelivery (?:was )?confirmed\b/i,
    holds: (f) => trackers(f).some((t) => t.carrierStatus === 'DELIVERED'),
    message: 'Says the item was delivered, but no carrier record shows delivery.',
  },
  {
    pattern: /\bsignature\b|\bsigned for\b/i,
    holds: (f) => trackers(f).some((t) => t.signatureConfirmed),
    message: 'Mentions a signature, but no shipment has signature confirmation.',
  },
  {
    pattern: /\b(?:we|i)\s+(?:have\s+)?(?:already\s+)?(?:issued|processed|sent)\s+(?:a\s+|the\s+)?(?:full\s+|partial\s+)?refund\b|\brefund (?:was|has been) (?:issued|processed)\b|\b(?:we|i) (?:have )?refunded\b/i,
    holds: (f) => (f.order?.refunds.length ?? 0) > 0,
    message: 'Says a refund was issued, but none is recorded.',
  },
  {
    pattern: /\btracking (?:number )?(?:was|has been) (?:uploaded|added|provided) to paypal\b|\buploaded (?:the )?tracking\b/i,
    holds: (f) => trackers(f).some((t) => t.uploadedToPayPal),
    message: 'Says tracking was uploaded to PayPal, but it was not.',
  },
  {
    pattern: /\bphotos?\b|\bpictures?\b|\bimages?\b/i,
    holds: (f) => f.listings.some((l) => l.photos.length > 0),
    message: 'Mentions photos, but none are on file.',
  },
];

export function checkGrounding(text: string, facts: CaseFacts): { ok: boolean; issues: GroundingIssue[]; checkedTokens: number } {
  const idx = factIndex(facts);
  const issues: GroundingIssue[] = [];
  let checked = 0;

  // Money amounts: anything with a currency marker or two decimals.
  const amountRe = /(?:\$|US\$|USD\s?|€|£)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|\b(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\b(?:\s?(?:USD|EUR|GBP))?/g;
  for (const m of text.matchAll(amountRe)) {
    const raw = (m[1] ?? m[2]).replace(/,/g, '');
    checked++;
    const v = Number(raw).toFixed(2);
    if (!idx.amounts.has(v)) issues.push({ text: m[0].trim(), kind: 'amount', message: `${m[0].trim()} does not match any amount in the case.` });
  }

  // Dates.
  const dateRe = new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+\\d{4})?\\b`, 'gi');
  for (const m of text.matchAll(dateRe)) {
    checked++;
    const candidates = parseDate(m[0].replace(/\s+/g, ' ').trim(), idx.dates);
    if (!candidates.some((d) => idx.dates.has(d))) issues.push({ text: m[0], kind: 'date', message: `${m[0]} is not a date in the case record.` });
  }

  // Identifiers: tracking numbers, order, capture and dispute ids.
  for (const m of text.matchAll(/\b[A-Z0-9][A-Z0-9-]{6,}[A-Z0-9]\b/gi)) {
    const id = normId(m[0]);
    if (!/\d/.test(id) || !/[A-Z]/i.test(m[0]) && id.length < 9) continue;
    if (/^\d{4}\d{2}\d{2}$/.test(id) && /-/.test(m[0])) continue; // ISO date
    checked++;
    if (!idx.ids.has(id)) issues.push({ text: m[0], kind: 'identifier', message: `${m[0]} does not match any tracking number or id in the case.` });
  }

  for (const rule of CLAIMS) {
    const m = text.match(rule.pattern);
    if (!m) continue;
    checked++;
    if (!rule.holds(facts)) issues.push({ text: m[0], kind: 'claim', message: rule.message });
  }

  return { ok: issues.length === 0, issues, checkedTokens: checked };
}
