/**
 * Frozen checkout snapshot stored on a payment_attempt. Everything needed to
 * materialize the exact order the customer paid for, without re-pricing.
 */

/** One cart line exactly as priced when the attempt was created. */
export interface PaymentAttemptItemSnapshot {
  productId: string;
  /** "Size: L, Color: Red" — as the checkout sent it, if any. */
  selectedOptions: string | null;
  /** Display name stored on order_item (includes the options suffix). */
  name: string;
  quantity: number;
  /** product.price at checkout time (order_item.price). */
  listPrice: string;
  /** product.discountPrice at checkout time (order_item.discount_price). */
  discountPrice: string | null;
  /** The unit price the subtotal was computed from (discountPrice ?? listPrice). */
  unitPrice: number;
  lineTotal: number;
}

/** Order-row fields that are not money and not payment. */
export interface PaymentAttemptOrderSnapshot {
  userId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string | null | undefined;
  shippingDistrict: string | undefined;
  shippingPostalCode: string | null | undefined;
  shippingCountry: string | null | undefined;
  notes: string | null | undefined;
  /** Automatic offers applied at checkout — audit only. */
  appliedOffers: Array<{ id?: string; name?: string; discountAmount: number; freeShipping?: boolean }>;
}
