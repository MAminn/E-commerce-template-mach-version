import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#root/lib/utils";

/**
 * Premium Quiet Luxury Button System
 *
 * Design principles:
 * - High-end editorial aesthetic
 * - No loud colors, no rounded pills, no heavy shadows
 * - Buttons feel like luxury fashion e-commerce
 * - Three-tier hierarchy: primary, secondary, tertiary
 */

// Every `mach-dark:` class below applies only inside the Mach storefront's
// dark scope (`.mach-theme-dark`, layouts/style.css): the stone variants are
// literal colours rather than tokens, so on the Mach ink ground they would
// otherwise render black-on-black. Outside that scope — every other template,
// and the dashboard — they compile to selectors that never match.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-light tracking-wide transition-all duration-200 disabled:pointer-events-none disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none cursor-pointer",
  {
    variants: {
      variant: {
        // PRIMARY: Main CTA (hero, add to cart, checkout)
        // Solid black background, white text, sharp edges
        primary:
          "bg-stone-900 text-stone-50 border border-stone-900 rounded-none shadow-none hover:bg-stone-800 active:translate-y-[1px] focus-visible:ring-1 focus-visible:ring-stone-900/40 mach-dark:border-white mach-dark:bg-white mach-dark:text-[var(--mach-ink)] mach-dark:hover:bg-white/85 mach-dark:focus-visible:ring-white/40",

        // SECONDARY: Supporting CTA (view collection, learn more)
        // Transparent with border, inverts on hover
        secondary:
          "bg-transparent text-stone-900 border border-stone-900 rounded-none shadow-none hover:bg-stone-900 hover:text-stone-50 active:translate-y-[1px] focus-visible:ring-1 focus-visible:ring-stone-900/30 mach-dark:border-white mach-dark:text-white mach-dark:hover:bg-white mach-dark:hover:text-[var(--mach-ink)] mach-dark:focus-visible:ring-white/40",

        // TERTIARY: Low emphasis (view details, back, remove)
        // Text only, subtle underline on hover
        tertiary:
          "bg-transparent text-stone-700 border-none shadow-none hover:text-stone-900 hover:underline decoration-1 underline-offset-4 active:opacity-80 focus-visible:underline focus-visible:ring-0 px-0 mach-dark:text-white/70 mach-dark:hover:text-white",

        // LIGHT VARIANTS (for dark backgrounds like hero sections)
        "primary-light":
          "bg-stone-50 text-stone-900 border border-stone-50 rounded-none shadow-none hover:bg-white active:translate-y-[1px] focus-visible:ring-1 focus-visible:ring-stone-50/40",

        "secondary-light":
          "bg-transparent text-stone-50 border border-stone-50 rounded-none shadow-none hover:bg-stone-50 hover:text-stone-900 active:translate-y-[1px] focus-visible:ring-1 focus-visible:ring-stone-50/30",

        // LEGACY VARIANTS (for compatibility, but discouraged)
        outline:
          "border border-stone-300 bg-transparent text-stone-900 rounded-none shadow-none hover:bg-stone-50 hover:border-stone-900 mach-dark:border-white/30 mach-dark:text-white mach-dark:hover:border-white mach-dark:hover:bg-white/10",
        ghost:
          "bg-transparent text-stone-700 hover:bg-stone-100 hover:text-stone-900 rounded-none shadow-none mach-dark:text-white/70 mach-dark:hover:bg-white/10 mach-dark:hover:text-white",
        link: "text-stone-700 underline-offset-4 hover:underline hover:text-stone-900 px-0 mach-dark:text-white/70 mach-dark:hover:text-white",

        // Keep destructive for error states
        destructive:
          "bg-red-900 text-white border border-red-900 rounded-none shadow-none hover:bg-red-800 active:translate-y-[1px] focus-visible:ring-1 focus-visible:ring-red-900/40",
      },
      size: {
        sm: "h-9 px-6 py-2 text-xs sm:text-sm has-[>svg]:px-4",
        md: "h-11 px-8 py-4 text-sm sm:text-base has-[>svg]:px-6",
        lg: "h-14 px-10 py-5 text-sm sm:text-base has-[>svg]:px-8",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
