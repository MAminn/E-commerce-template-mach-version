import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

/**
 * The absolute path `/uploads/*` may serve for a request, or null.
 *
 * Fastify hands the wildcard over already decoded, so `/uploads/..%2F.env`
 * arrives as `../.env`. Anything that resolves outside the uploads directory
 * is treated as not existing — not a 403 that confirms the file is there.
 */
export function resolveUploadPath(
  uploadsRoot: string,
  requested: string,
): string | null {
  // A NUL byte never names a real upload; refuse it before `resolve` sees it.
  if (requested.includes("\0")) return null;
  const base = resolve(uploadsRoot);
  const full = resolve(base, requested);
  return full.startsWith(`${base}${sep}`) ? full : null;
}

/**
 * Whether an existing file, with every symlink and junction followed, is still
 * inside the uploads directory. `resolveUploadPath` only checks the spelling;
 * this checks where the bytes actually are.
 */
export async function isCanonicallyInsideUploads(
  uploadsRoot: string,
  fullPath: string,
): Promise<boolean> {
  try {
    const [base, real] = await Promise.all([
      realpath(uploadsRoot),
      realpath(fullPath),
    ]);
    return real.startsWith(`${base}${sep}`);
  } catch {
    return false;
  }
}
