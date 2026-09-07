import { Star } from "lucide-react";

/**
 * Rating summary and approved-review list.
 *
 * Reads the existing reviews infrastructure (product.getReviews already
 * filters to status "approved" and computes the average) — this is
 * presentation only, not a second reviews system. Image/video UGC expansion
 * is deliberately out of scope for this pass.
 */

export interface ProductReviewItem {
  id: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: string | Date;
  imageUrl?: string | null;
}

function Stars({
  value,
  className = "",
}: { value: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className}`}
      aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={
            i <= Math.round(value)
              ? "h-3.5 w-3.5 fill-[var(--mach-ink)] text-[var(--mach-ink)]"
              : "h-3.5 w-3.5 text-[var(--mach-ink)]/25"
          }
        />
      ))}
    </span>
  );
}

/** Compact inline summary for the purchase column. Hidden when there are none. */
export function ProductRatingSummary({
  rating = 0,
  reviewCount = 0,
  className = "",
}: {
  rating?: number;
  reviewCount?: number;
  className?: string;
}) {
  if (!reviewCount) return null;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Stars value={rating} />
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--mach-mute)]">
        {rating.toFixed(1)} ({reviewCount}
        {reviewCount === 1 ? " review" : " reviews"})
      </span>
    </div>
  );
}

/** Full approved-review list. Renders nothing when there are no reviews. */
export function ProductReviewsSection({
  reviews,
  rating = 0,
  reviewCount = 0,
  heading = "Reviews",
  className = "",
}: {
  reviews?: ProductReviewItem[];
  rating?: number;
  reviewCount?: number;
  heading?: string;
  className?: string;
}) {
  const items = reviews ?? [];
  if (items.length === 0) return null;

  return (
    <section
      className={`border-t border-[var(--mach-ink)]/12 pt-12 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="text-[clamp(1.5rem,3vw,2.25rem)] font-black uppercase leading-[0.95] tracking-[-0.02em] text-[var(--mach-ink)]">
          {heading}
        </h2>
        <ProductRatingSummary rating={rating} reviewCount={reviewCount} />
      </div>
      {/* Two columns from tablet up: reviews are short, and a single stacked
          list of them pushes everything below the fold for no reason. */}
      <ul className="mt-8 grid gap-x-10 gap-y-0 sm:grid-cols-2">
        {items.map((r) => (
          <li
            key={r.id}
            className="border-b border-[var(--mach-ink)]/12 py-5 first:pt-0 sm:first:pt-5 sm:[&:nth-child(2)]:pt-0">
            <div className="flex items-center gap-2.5">
              <Stars value={r.rating} />
              <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--mach-ink)]">
                {r.userName}
              </span>
            </div>
            {r.comment && (
              <p className="mt-2.5 whitespace-pre-line text-sm leading-relaxed text-[var(--mach-mute)]">
                {r.comment}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
