/**
 * Optional override for the order email templates (minimal + default). When
 * absent the templates render exactly the normal "Order Confirmation".
 * Used for a PAID order on a fulfillment hold, where "we're processing your
 * order" would not be true.
 */
export interface OrderEmailNotice {
  /** Document title and header label, e.g. "Payment Received". */
  title: string;
  preview: string;
  /** Replaces the confirmation paragraphs under the greeting. */
  paragraphs: string[];
  /** Unmistakable red banner lines (operational/admin copy). */
  alert?: string[];
  /** e.g. "#3F9A01C2" */
  orderNumber?: string;
}

/** Customer copy for a paid order held for stock review — no fulfillment promises. */
export function paidUnderReviewCustomerNotice(orderNumber: string): OrderEmailNotice {
  return {
    title: "Payment Received",
    preview: "Payment received — your order is under review.",
    paragraphs: [
      "Payment received.",
      "Your order is currently under review.",
      "We'll contact you shortly regarding availability.",
    ],
    orderNumber,
  };
}

/** Admin copy for the same case — the hold must be impossible to miss. */
export function paidOnHoldAdminNotice(orderNumber: string, holdNote: string | null): OrderEmailNotice {
  return {
    title: "Paid Order On Hold",
    preview: `PAID — STOCK ISSUE — DO NOT PREPARE (${orderNumber})`,
    alert: [
      "PAID — STOCK ISSUE",
      "DO NOT PREPARE · MANUAL REVIEW REQUIRED",
      ...(holdNote ? [holdNote] : []),
    ],
    paragraphs: [
      `Order ${orderNumber} was paid online, but stock ran out while the customer was paying.`,
      "It has NOT been sent to Bosta. Restock and release the hold in the dashboard, or cancel and refund the customer.",
    ],
    orderNumber,
  };
}
