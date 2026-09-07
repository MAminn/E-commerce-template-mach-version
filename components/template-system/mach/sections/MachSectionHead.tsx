import type { ReactNode } from "react";
import { Link } from "#root/components/utils/Link";
import { isPlaceholderLink } from "#root/shared/types/layout-settings";
import {
  EYEBROW,
  HEADING,
  HEADING_SHELF,
  HEADING_XL,
  LINK_ACTION,
} from "../machTokens";

/**
 * Shared section header: eyebrow tick, oversized headline, optional subtitle,
 * and an optional trailing action.
 *
 * Every string is passed in by the caller from CMS content — this component
 * owns the typography, never the words. The action renders only when it has
 * both a label and a destination that actually exists, so an unconfigured
 * "view all" disappears instead of shipping a dead link.
 */
export function MachSectionHead({
  eyebrow,
  title,
  subtitle,
  actionLabel,
  actionHref,
  onDark = false,
  size = "default",
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionHref?: string;
  onDark?: boolean;
  /**
   * "sm" is the compact merchandising header: a shelf where the products are
   * the point and the heading only has to name them. "xl" is a full-width
   * statement header.
   */
  size?: "default" | "sm" | "xl";
  children?: ReactNode;
}) {
  const showAction =
    Boolean(actionLabel?.trim()) && !isPlaceholderLink(actionHref);

  const headingCls = onDark ? "text-white" : "text-[var(--mach-ink)]";
  const subtitleCls = onDark ? "text-white/55" : "text-[var(--mach-mute)]";
  const eyebrowCls = onDark ? "text-white/70" : "text-[var(--mach-ink)]/70";
  const tickCls = onDark ? "bg-white" : "bg-[var(--mach-ink)]";
  const actionCls = onDark ? "text-white" : "text-[var(--mach-ink)]";

  const headingSize =
    size === "xl" ? HEADING_XL : size === "sm" ? HEADING_SHELF : HEADING;
  // A compact header pulls its supporting line in tight; at the default size
  // the subtitle keeps the air it has always had.
  const isCompact = size === "sm";

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-end sm:justify-between ${
        isCompact ? "gap-3" : "gap-6"
      }`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className={`${EYEBROW} ${eyebrowCls}`}>
            <span
              aria-hidden="true"
              className={`inline-block h-[2px] w-6 shrink-0 ${tickCls}`}
            />
            {eyebrow}
          </p>
        )}
        <h2 className={`${isCompact ? "mt-3" : "mt-4"} ${headingSize} ${headingCls}`}>
          {title}
        </h2>
        {subtitle && (
          <p
            className={`max-w-xl leading-relaxed ${
              isCompact
                ? "mt-2 text-[13px] sm:text-[14px]"
                : "mt-5 text-[15px] sm:text-base"
            } ${subtitleCls}`}>
            {subtitle}
          </p>
        )}
        {children}
      </div>

      {showAction && (
        <Link
          href={actionHref as string}
          /* On the compact header the action hugs its own text on a phone
             instead of stretching the rule across the column. Only the compact
             size changes; the other rows keep the header they already had. */
          className={`${LINK_ACTION} ${actionCls} shrink-0 border-b-2 pb-1 ${
            isCompact ? "self-start sm:self-auto" : ""
          } ${
            onDark ? "border-white" : "border-[var(--mach-ink)]"
          }`}>
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
