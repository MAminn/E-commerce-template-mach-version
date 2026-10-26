import type { Config } from "vike/types";

// Pre-rendering is disabled because +data.ts reads the page content and the
// live catalogue from the database on every request.
export default {
  prerender: false,
} satisfies Config;
