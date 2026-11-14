/**
 * valU installments at checkout — a UI-only payment choice.
 *
 * valU is NOT a gateway of ours. It is one of the methods the customer can
 * pick on Fawaterak's hosted payment page, so choosing it here only changes
 * what the checkout shows; placing the order goes through the existing
 * Fawaterak payment-attempt flow unchanged. That is why this value is not in
 * PAYMENT_METHODS / the DB `payment_method` enum and must never be sent to
 * the server — resolveCheckoutPaymentMethod() maps it back to "fawaterak".
 *
 * Fawaterak's public docs give no documented way to preselect valU on the
 * hosted page (createTransaction is sent without payment_method_id on
 * purpose), so the customer selects valU again on Fawaterak's page.
 *
 * Env-free: imported from browser bundles.
 */

export const VALU_INSTALLMENTS_METHOD_ID = "valu_installments" as const;

/** The gateway that actually takes a valU payment. */
export const VALU_INSTALLMENTS_GATEWAY = "fawaterak" as const;

export const VALU_INSTALLMENT_MONTHS = 3;

/** Shown only when the gateway valU runs through is available. */
export function isValuInstallmentsAvailable(
  methods: ReadonlyArray<{ id: string }> | null | undefined,
): boolean {
  return (methods ?? []).some((m) => m.id === VALU_INSTALLMENTS_GATEWAY);
}

/**
 * The payment method to submit for a checkout radio value. Every value except
 * valU's passes through untouched, so COD and Online Payment are unaffected.
 */
export function resolveCheckoutPaymentMethod(uiValue: string): string {
  return uiValue === VALU_INSTALLMENTS_METHOD_ID
    ? VALU_INSTALLMENTS_GATEWAY
    : uiValue;
}

/**
 * round(total / months, 2), computed in integer piasters so a float total
 * such as 1388.9999999 (subtraction noise) still gives 463.00. Returns null
 * when there is no positive total to estimate from — callers show the
 * "calculating" text instead of a number.
 */
export function estimateMonthlyInstallment(
  total: number,
  months: number = VALU_INSTALLMENT_MONTHS,
): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isInteger(months) || months <= 0) return null;
  const piasters = Math.round(total * 100);
  return Math.round(piasters / months) / 100;
}

/** Customer-facing copy. No zero-interest / zero-fee promises. */
export const VALU_INSTALLMENTS_COPY = {
  groupPayInFull: "Pay in full",
  groupInstallments: "Installments",
  title: "Installments with valU",
  term: `Pay over ${VALU_INSTALLMENT_MONTHS} months`,
  calculating: "Calculating installment estimate…",
  disclaimer:
    "Final installment amount and any applicable fees are confirmed by valU.",
  estimate: (formattedMonthly: string) =>
    `Estimated ${formattedMonthly}/month for ${VALU_INSTALLMENT_MONTHS} months`,
} as const;
