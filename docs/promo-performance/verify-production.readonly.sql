-- ============================================================================
-- Promo Performance report — Production verification (READ ONLY)
-- ============================================================================
-- For an authorized operator with read access to the Production database.
--
--   psql "<read-only connection string>" -f verify-production.readonly.sql
--
-- * Everything runs inside one READ ONLY transaction that ends in ROLLBACK:
--   Postgres itself refuses any write. Prefer a read-only role / replica.
-- * Output is aggregates, promo codes and order references only — no customer
--   names, emails, phones or addresses.
-- * Period: edit the two dates in every `params` line below (Cairo calendar
--   days, both inclusive). Default: October 2026.
--
-- Q1 re-implements the report's classification
-- (backend/promo-performance/classify.ts) independently in SQL; the
-- integration test runs this file and requires its numbers to equal the
-- report's. Compare Q1 with the dashboard for the same period.
-- ============================================================================

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- ----------------------------------------------------------------------------
-- Q1. Per-code report figures (must equal the dashboard, row for row).
-- ----------------------------------------------------------------------------
WITH params AS (SELECT DATE '2026-10-01' AS d_from, DATE '2026-10-31' AS d_to),
scoped AS (
  SELECT o.id, o.reference, o.status::text AS status, o.payment_method::text AS payment_method,
         o.payment_status::text AS payment_status,
         o.subtotal, coalesce(o.discount, 0) AS disc, o.shipping, o.tax, o.total,
         o.bosta_status_code, o.fulfillment_hold, o.archived_at,
         p.code AS linked_code, a.promo_code AS attempt_code,
         a.id AS a_id, a.subtotal AS a_sub, coalesce(a.discount, 0) AS a_disc,
         a.promo_discount AS a_promo, a.offer_discount AS a_offer, a.total AS a_total
  FROM "order" o
  LEFT JOIN promo_code p ON p.id = o.promo_code_id
  LEFT JOIN payment_attempt a ON a.order_id = o.id
  CROSS JOIN params
  WHERE o.created_at >= (params.d_from::timestamp AT TIME ZONE 'Africa/Cairo')
    AND o.created_at <  ((params.d_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo')
    AND (o.promo_code_id IS NOT NULL OR a.promo_code IS NOT NULL OR coalesce(o.discount, 0) > 0)
),
logs AS (
  SELECT l.order_id,
         bool_or(l.action = 'bosta_status_updated' AND l.note LIKE '%(code 46)%') AS return_logged,
         bool_or(l.note LIKE 'Order edited by %') AS admin_edited
  FROM order_log l
  WHERE l.order_id IN (SELECT id FROM scoped)
  GROUP BY l.order_id
),
f AS (
  SELECT s.*,
         coalesce(s.linked_code, s.attempt_code) AS code,
         s.subtotal - s.disc AS net,
         (s.a_id IS NOT NULL AND s.a_sub = s.subtotal AND s.a_disc = s.disc AND s.a_total = s.total) AS attempt_matches,
         coalesce(l.admin_edited, false) AS admin_edited,
         (s.bosta_status_code = '46' OR coalesce(l.return_logged, false)) AS returned,
         (abs(s.total - (greatest(0, s.subtotal - s.disc) + s.shipping + s.tax)) > 0.01
          AND abs(s.total - greatest(0, s.subtotal + s.shipping + s.tax - s.disc)) > 0.01) AS total_mismatch
  FROM scoped s
  LEFT JOIN logs l ON l.order_id = s.id
),
g AS (
  SELECT f.*,
         CASE WHEN attempt_matches THEN CASE WHEN a_promo + a_offer = disc THEN a_promo END
              WHEN disc = 0 THEN 0 END AS promo_only,
         ((admin_edited AND NOT attempt_matches) OR total_mismatch OR net < 0 OR archived_at IS NOT NULL) AS money_flag
  FROM f
),
c AS (
  SELECT g.*,
         CASE
           WHEN status = 'cancelled' THEN CASE WHEN returned THEN 'returned' ELSE 'cancelled' END
           WHEN payment_status = 'refunded' THEN 'refunded'
           WHEN status = 'delivered' THEN
             CASE WHEN money_flag OR returned
                       OR (payment_method <> 'cod' AND payment_status <> 'paid')
                       OR (payment_method = 'cod' AND payment_status = 'failed')
                       OR fulfillment_hold IS NOT NULL
                  THEN 'review' ELSE 'eligible' END
           ELSE 'in_progress'
         END AS bucket
  FROM g
)
SELECT coalesce(code, '(unattributed)')                                   AS code,
       count(*)                                                          AS orders,
       sum(subtotal)                                                     AS gross_sales,
       sum(disc)                                                         AS total_discounts,
       coalesce(sum(promo_only), 0)                                      AS promo_only_discounts,
       count(promo_only)                                                 AS promo_only_known_orders,
       sum(net)                                                          AS net_sales,
       count(*) FILTER (WHERE bucket = 'eligible')                       AS eligible_orders,
       coalesce(sum(net) FILTER (WHERE bucket = 'eligible'), 0)          AS eligible_amount,
       count(*) FILTER (WHERE bucket = 'review')                         AS review_orders,
       coalesce(sum(net) FILTER (WHERE bucket = 'review'), 0)            AS review_amount,
       count(*) FILTER (WHERE bucket = 'in_progress')                    AS in_progress_orders,
       coalesce(sum(net) FILTER (WHERE bucket = 'in_progress'), 0)       AS in_progress_amount,
       count(*) FILTER (WHERE bucket = 'cancelled')                      AS cancelled_orders,
       coalesce(sum(net) FILTER (WHERE bucket = 'cancelled'), 0)         AS cancelled_amount,
       count(*) FILTER (WHERE bucket = 'returned')                       AS returned_orders,
       coalesce(sum(net) FILTER (WHERE bucket = 'returned'), 0)          AS returned_amount,
       count(*) FILTER (WHERE bucket = 'refunded')                       AS refunded_orders,
       coalesce(sum(net) FILTER (WHERE bucket = 'refunded'), 0)          AS refunded_amount
FROM c
GROUP BY 1
ORDER BY coalesce(code, '(unattributed)') COLLATE "C";

-- ----------------------------------------------------------------------------
-- Q2. Attribution coverage per Cairo month, all history.
--   promo_link      reliably attributed (order → promo_code)
--   payment_record  code deleted, recovered from the online payment attempt
--   unattributed    discount with no code: automatic offer OR deleted code
-- ----------------------------------------------------------------------------
SELECT to_char(o.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM')                            AS month,
       count(*)                                                                                AS all_orders,
       count(*) FILTER (WHERE o.promo_code_id IS NOT NULL)                                     AS promo_link,
       count(*) FILTER (WHERE o.promo_code_id IS NULL AND a.promo_code IS NOT NULL)            AS payment_record,
       count(*) FILTER (WHERE o.promo_code_id IS NULL AND a.promo_code IS NULL
                          AND coalesce(o.discount, 0) > 0)                                     AS unattributed,
       coalesce(sum(o.subtotal - coalesce(o.discount, 0)) FILTER (
         WHERE o.promo_code_id IS NULL AND a.promo_code IS NULL AND coalesce(o.discount, 0) > 0), 0) AS unattributed_net
FROM "order" o
LEFT JOIN payment_attempt a ON a.order_id = o.id
GROUP BY 1
ORDER BY 1;

-- ----------------------------------------------------------------------------
-- Q3. Could automatic offers have mixed into promo discounts?
--   order.discount = promo + offer. If no offer has ever existed, every
--   order.discount on a promo order is the promo-only discount. (A deleted
--   offer leaves no row — ask the store owner whether any offer was ever run.)
-- ----------------------------------------------------------------------------
SELECT count(*)                          AS offers_on_record,
       count(*) FILTER (WHERE is_active) AS active_now,
       min(created_at)                   AS first_created,
       max(coalesce(ends_at, now()))     AS latest_end
FROM cart_offer;

-- ----------------------------------------------------------------------------
-- Q4. Promo orders whose stored discount differs from what the code alone
--   would give today (all-product codes only; current code values). A
--   mismatch means offer stacking, an admin edit, or the code's value was
--   changed after the order.
-- ----------------------------------------------------------------------------
SELECT p.code,
       count(*) AS orders,
       count(*) FILTER (WHERE abs(coalesce(o.discount, 0) - CASE WHEN p.discount_type = 'percentage'
                                     THEN round(o.subtotal * p.discount_value / 100, 2)
                                     ELSE least(p.discount_value, o.subtotal) END) > 0.01) AS mismatched
FROM "order" o
JOIN promo_code p ON p.id = o.promo_code_id
WHERE p.applies_to_all_products
GROUP BY p.code
ORDER BY orders DESC;

-- ----------------------------------------------------------------------------
-- Q5. Financial-reliability counts over promo orders, all history.
-- ----------------------------------------------------------------------------
SELECT count(*)                                                                       AS promo_orders,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM order_log l WHERE l.order_id = o.id
                                        AND l.note LIKE 'Order edited by %'))          AS admin_edited,
       count(*) FILTER (WHERE o.payment_status = 'refunded')                          AS refunded,
       count(*) FILTER (WHERE o.archived_at IS NOT NULL)                              AS archived,
       count(*) FILTER (WHERE o.fulfillment_hold IS NOT NULL)                         AS on_hold,
       count(*) FILTER (WHERE o.bosta_status_code = '46')                             AS bosta_returned_now
FROM "order" o
LEFT JOIN payment_attempt a ON a.order_id = o.id
WHERE o.promo_code_id IS NOT NULL OR a.promo_code IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Q6. Promo usage counter vs. orders actually linked (informational only:
--   the counter is never used by the report).
-- ----------------------------------------------------------------------------
SELECT p.code, p.used_count, count(o.id) AS linked_orders
FROM promo_code p
LEFT JOIN "order" o ON o.promo_code_id = p.id
GROUP BY p.code, p.used_count
ORDER BY linked_orders DESC, p.code;

ROLLBACK;
