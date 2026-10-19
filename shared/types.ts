// Domain types shared by the worker (API + agent) and the web app.

export type DisputeReason =
  | 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED'
  | 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED'
  | 'UNAUTHORISED'
  | 'CREDIT_NOT_PROCESSED'
  | 'DUPLICATE_TRANSACTION'
  | 'INCORRECT_AMOUNT'
  | 'PAYMENT_BY_OTHER_MEANS'
  | 'CANCELED_RECURRING_BILLING'
  | 'OTHER';

export type DisputeStatus =
  | 'OPEN'
  | 'WAITING_FOR_BUYER_RESPONSE'
  | 'WAITING_FOR_SELLER_RESPONSE'
  | 'UNDER_REVIEW'
  | 'RESOLVED'
  | 'OTHER';

export type DisputeStage = 'INQUIRY' | 'CHARGEBACK' | 'PRE_ARBITRATION' | 'ARBITRATION';

export interface Money {
  currency_code: string;
  value: string;
}

export interface DisputeMessage {
  postedBy: 'BUYER' | 'SELLER' | 'PAYPAL';
  time: string;
  content: string;
}

/** A dispute normalised from PayPal's Disputes API. */
export interface Dispute {
  id: string;
  reason: DisputeReason;
  status: DisputeStatus;
  stage: DisputeStage;
  amount: Money;
  createdAt: string;
  updatedAt: string;
  sellerResponseDueDate?: string;
  buyerResponseDueDate?: string;
  /** Seller-side transaction (capture) ids the dispute is about. */
  sellerTransactionIds: string[];
  buyerEmail?: string;
  buyerName?: string;
  messages: DisputeMessage[];
  outcome?: 'RESOLVED_BUYER_FAVOUR' | 'RESOLVED_SELLER_FAVOUR' | 'RESOLVED_WITH_PAYOUT' | 'CANCELED_BY_BUYER' | 'ACCEPTED' | 'DENIED' | 'NONE' | string;
  /** Actions PayPal currently allows on this dispute (from HATEOAS links). */
  allowedActions: string[];
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
}

export interface OrderItem {
  name: string;
  sku?: string;
  quantity: number;
  unitAmount: Money;
  description?: string;
}

export interface Tracker {
  carrier: string;
  trackingNumber: string;
  /** Uploaded to PayPal (counts towards Seller Protection). */
  uploadedToPayPal: boolean;
  uploadedAt?: string;
  shippedAt?: string;
  /** Latest carrier status. */
  carrierStatus?: 'PRE_TRANSIT' | 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION' | 'UNKNOWN';
  deliveredAt?: string;
  deliveredTo?: Address;
  signatureConfirmed?: boolean;
}

export interface Order {
  id: string;
  captureId?: string;
  createdAt: string;
  amount: Money;
  items: OrderItem[];
  buyerEmail?: string;
  buyerName?: string;
  shippingAddress?: Address;
  trackers: Tracker[];
  refunds: { id: string; amount: Money; createdAt: string }[];
  /** True for digital goods / services (no shipment). */
  intangible?: boolean;
}

export interface Listing {
  sku: string;
  title: string;
  description: string;
  photos: string[];
  returnPolicy?: string;
}

/** Everything the agent knows about one case, each fact traceable to a source. */
export interface CaseFacts {
  dispute: Dispute;
  order?: Order;
  listings: Listing[];
  /** How many earlier orders this buyer completed without a dispute. */
  buyerPriorOrders: number;
  storePolicy: StorePolicy;
}

export interface StorePolicy {
  storeName: string;
  returnWindowDays: number;
  /** Disputes at or under this amount are refunded rather than fought, unless evidence is very strong. */
  autoRefundBelow: number;
  /** Fee PayPal may charge the seller when a dispute or chargeback is lost (configurable; check your agreement). */
  disputeFee: number;
  /** Seller's estimate of their time cost per contested case. */
  timeCostPerCase: number;
  /** Cost of goods as a share of price, used when the buyer keeps the item. */
  costOfGoodsRatio: number;
}

export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'na';

export interface EvidenceCheck {
  id: string;
  label: string;
  status: CheckStatus;
  weight: number;
  /** Plain-language reason, citing the fact used. */
  detail: string;
  /** What the seller can do to turn a fail into a pass. */
  fix?: string;
}

export type ActionKind = 'FIGHT' | 'REFUND' | 'OFFER' | 'ASK_BUYER' | 'WAIT';

export interface ActionOption {
  kind: ActionKind;
  label: string;
  /** Expected money lost by the seller (lower is better). */
  expectedLoss: number;
  explanation: string;
}

export interface CasePlan {
  disputeId: string;
  winProbability: number;
  checks: EvidenceCheck[];
  options: ActionOption[];
  recommended: ActionKind;
  /** Evidence PayPal will receive if the seller fights. */
  evidence: EvidenceItem[];
  generatedAt: string;
}

export type EvidenceType =
  | 'PROOF_OF_FULFILLMENT'
  | 'PROOF_OF_REFUND'
  | 'PROOF_OF_DELIVERY_SIGNATURE'
  | 'PROOF_OF_RECEIPT_COPY'
  | 'RETURN_POLICY'
  | 'BILLING_AGREEMENT'
  | 'PROOF_OF_RESHIPMENT'
  | 'ITEM_DESCRIPTION'
  | 'POLICE_REPORT'
  | 'AFFIDAVIT'
  | 'PAID_WITH_OTHER_METHOD'
  | 'COPY_OF_CONTRACT'
  | 'TERMINAL_ATM_RECEIPT'
  | 'PRICE_DIFFERENCE_REASON'
  | 'SOURCE_CONVERSION_RATE'
  | 'BANK_STATEMENT'
  | 'CREDIT_DUE_REASON'
  | 'REQUEST_CREDIT_RECEIPT'
  | 'PROOF_OF_RETURN'
  | 'CREATE'
  | 'CHANGE_REASON'
  | 'OTHER';

export interface EvidenceItem {
  type: EvidenceType;
  summary: string;
  trackingInfo?: { carrier_name: string; tracking_number: string }[];
  refundIds?: string[];
}

export interface GroundingIssue {
  text: string;
  kind: 'amount' | 'date' | 'identifier' | 'claim';
  message: string;
}

export interface Draft {
  disputeId: string;
  /** Text sent to PayPal as the seller's response notes. */
  response: string;
  /** Optional message to the buyer. */
  buyerMessage?: string;
  model: string;
  grounding: { ok: boolean; issues: GroundingIssue[]; checkedTokens: number };
  generatedAt: string;
}
