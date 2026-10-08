import { cn } from "#root/lib/utils.js";
import type React from "react";
import { usePageContext } from "vike-react/usePageContext";
import { adminEntryRel } from "#root/lib/admin-navigation";

export function Link({
  href,
  children,
  className,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const pageContext = usePageContext();
  const { urlPathname } = pageContext;
  const isActive =
    href === "/" ? urlPathname === href : urlPathname.startsWith(href);
  return (
    <a
      href={href}
      // Storefront → dashboard is a full document load (Vike skips
      // rel="external"), so storefront-only scripts cannot follow into admin.
      rel={adminEntryRel(href, urlPathname)}
      className={cn(isActive ? "is-active" : undefined, `${className}`)}
      onClick={onClick}>
      {children}
    </a>
  );
}
