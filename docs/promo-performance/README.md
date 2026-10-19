# Promo Performance report

Dashboard → Marketing → **Promo Performance** (`/dashboard/promo-performance`).
Admins and superadmins only. It is read-only and reads orders as stored. Live requests require both
date bounds, allow at most 31 days, run without parallel workers, and are cancelled by PostgreSQL
after 1.5 seconds. This is a temporary safety boundary while the production report indexes are
missing.

| Piece | File |
|---|---|
| Rules, shared types, Cairo date ranges | `shared/promo-performance/report.ts` |
| Classification and exact totals (pure) | `backend/promo-performance/classify.ts` |
| Read-only queries | `backend/promo-performance/service.ts` |
| tRPC (`promoPerformance.summary`, `.orders`) | `backend/promo-performance/trpc.ts` |
| Page | `pages/dashboard/promo-performance/+Page.tsx` |
| Production verification (operator, read-only) | `docs/promo-performance/verify-production.readonly.sql` |

## Rules

**Period.** An order belongs to the Cairo calendar day on which it was created
(`order.created_at`, `Africa/Cairo`, DST-aware). A month runs from the 1st 00:00 Cairo up to,
but not including, the 1st of the next month.

**In scope.** An order is in scope if it:
- links a promo code (`order.promo_code_id`),
- came from an online payment attempt that recorded a code (`payment_attempt.promo_code`), or
- has any discount.

**Amounts.** Money is summed in integer piastres from the stored `numeric(10,2)` values, never
as floats.

| Figure | Definition |
|---|---|
| Gross product sales | `subtotal` (after product sale prices) |
| Total discounts | `discount`: the promo plus any automatic cart offer, as stored |
| Promo-only discounts | The promo part, only where it was recorded separately. See [Promo-only discount](#promo-only-discount). |
| Net product sales | `subtotal − discount`, the commission base. Shipping and tax are excluded. |

**Buckets.** Each order lands in exactly one bucket, so the buckets always add up to net sales.
The rules are checked in order and the first match wins:
1. **Returned:** `status = cancelled`, and Bosta reported "Returned to business". That shows as
   `bosta_status_code = '46'`, or as an `order_log` line containing `(code 46)`, which survives
   later Bosta states.
2. **Cancelled:** any other `status = cancelled`.
3. **Refunded:** `payment_status = refunded`. It's excluded and flagged, because refund amounts
   aren't recorded, so a partial refund can't be told apart from a full one.
4. **Commission-eligible (verified):** `delivered` (COD), or `delivered` and `paid` (online), with
   no financial flag.
5. **Requires review:** `delivered`, but any of these flags applies:
   - edited in the admin edit panel (`order_log` "Order edited by …"), unless it is an online order
     whose amounts still equal its payment record
   - the stored total ≠ `subtotal − discount + shipping + tax` (1 piastre of rounding tolerated)
   - the discount is larger than the subtotal
   - an online order isn't paid, or a COD order is marked failed
   - a fulfillment hold
   - an archived order
   - a Bosta return on an order that isn't cancelled
6. **Not yet delivered:** pending, processing or shipped.

**Reconciliation.** The summary and the drill-down run every order through the same
`classifyOrder` and `sumTotals`. The page shows "Totals match the summary row" after comparing
them field by field. The promo usage counter (`used_count`) is never used.

## Historical coverage

| Category | Which orders | How the report treats them |
|---|---|---|
| Reliably attributable | `promo_code_id` set | Credited to the code |
| Recoverable from existing records | The code was deleted, but the online payment attempt kept its text (Fawaterak, from 7 Oct 2026) | Credited to the code, marked "via payment record" / "Deleted code" |
| Attributable but financially uncertain | The review flags above, plus refunded orders | "Requires review" or "Refunded"; never in the eligible amount |
| Not reliably recoverable | Discounted orders with no code and no payment record (an automatic offer, or a COD order whose code was deleted) | Shown separately as **Unattributed**, never credited |
| Not available at all | Orders deleted from the dashboard (hard delete) | Can't be reported |

### Promo-only discount
`order.discount` stores the promo and the automatic offers combined. The promo part is known only
in two cases:
- **The order came from a payment attempt and is unchanged since.** Its split
  (`payment_attempt.promo_discount` and `offer_discount`) must still add up to the order's
  discount.
- **The order has no discount at all.**

Elsewhere the report shows "promo + offers combined" and never presents the combined figure as
promo-only. The commission base doesn't depend on this split, because it subtracts the full
discount once.

## Production verification (operator)

No production access was available while building this, so the figures have **not** been checked
against Production records.

To check them:
1. Run `verify-production.readonly.sql`. It is one `READ ONLY` transaction ending in `ROLLBACK`,
   it outputs no customer data, and you set the period in its `params` lines.
2. Open the dashboard for the same month and compare Q1 row by row. The integration test proves
   Q1 and the report agree on the same data.
3. Q2–Q6 measure, across all history:
   - attribution coverage per month
   - whether any automatic offer ever existed (if none did, the stored discount on promo orders is
     the promo-only discount)
   - discount mismatches against the code's own value
   - how many promo orders were edited, refunded, held or archived
   - the gap between `used_count` and the number of linked orders

## Required before removing the temporary query limits

Production must have indexes on `order(created_at)`, `order(promo_code_id)` and
`order_log(order_id)`, created through a separately reviewed low-lock migration with a verified
backup/rollback plan. Until then, do not enable all-time or open-ended ranges and do not raise the
statement timeout.

## Future data reliability (not implemented)

These are the minimal order-level additions that would make every future month fully
verifiable. They need a migration and a checkout change, so they are out of scope here.

- `order.promo_code_text text`: the code exactly as applied, written at checkout. It survives
  promo deletion. Backfill it from `promo_code.code` and `payment_attempt.promo_code`, and leave
  it NULL where unknown.
- `order.promo_discount numeric(10,2)` and `order.offer_discount numeric(10,2)`: the split
  `priceCheckout` already computes. `discount` stays equal to their sum. Backfill only from intact
  payment attempts and never estimate.
- `order_adjustment` (append-only), with columns:
  - `order_id`, `kind` (`refund`, `partial_refund` or `manual_adjustment`)
  - `amount numeric(10,2)`, `reason`
  - `created_by`, `created_at`

  It records refunds and other money changes with their amounts.
- Admin edits should log the money values before and after (subtotal, discount, shipping, total)
  instead of only "Order edited by admin".
- Promo deletion should become a soft delete (for example, a status), so order links survive.
