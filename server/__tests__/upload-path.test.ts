import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUploadPath } from "../upload-path";

/**
 * `/uploads/*` serves files uploaded since boot. Its wildcard arrives decoded,
 * so before this check `/uploads/..%2Fpackage.json` read the app's own source
 * (verified against a production-mode server: 200, 4704 bytes).
 */
const ROOT = path.resolve("/srv/app/uploads");

describe("resolveUploadPath", () => {
  it("serves files inside uploads/", () => {
    expect(resolveUploadPath(ROOT, "homepage/hero-1.mp4")).toBe(
      path.join(ROOT, "homepage", "hero-1.mp4"),
    );
    expect(resolveUploadPath(ROOT, "logo.webp")).toBe(path.join(ROOT, "logo.webp"));
  });

  it.each([
    "../package.json",
    "homepage/../../package.json",
    "../../../etc/passwd",
    // Windows separators, which `resolve` honours on the dev machines.
    ...(path.sep === "\\" ? ["..\\..\\.env"] : []),
    "../uploads-other/x.mp4",
    "..",
    "",
    "/etc/passwd",
    "../../../../../../proc/self/environ",
    "homepage/../../../proc/self/environ",
    "homepage/x.mp4\u0000.png",
  ])("refuses %j", (requested) => {
    expect(resolveUploadPath(ROOT, requested)).toBeNull();
  });

  it("allows a name that merely contains dots", () => {
    expect(resolveUploadPath(ROOT, "homepage/a..b.mp4")).toBe(
      path.join(ROOT, "homepage", "a..b.mp4"),
    );
  });
});
