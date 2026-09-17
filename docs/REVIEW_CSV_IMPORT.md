# Importing product reviews from a CSV

Dashboard → **Reviews** → **Import CSV**. Nothing is saved until you click **Import** on the preview.

> These are **product reviews**: after approval they appear on the matching product's page and count towards its star rating. Homepage testimonials are a separate CMS section and are not affected by this importer.

## 1. Get the template

Click **Download CSV template** (on the Reviews page or inside the import dialog). It opens in Excel with the correct header row and two example rows — delete the examples before importing.

## 2. Fill in the columns

| Column        | Required | Rules |
|---------------|----------|-------|
| `productId`   | one of the two | The product's UUID (from the dashboard URL). |
| `productSlug` | one of the two | The last part of the product's shop URL, e.g. `/shop/synt-aura` → `synt-aura`. Pasting the full URL also works. **Product names are not matched** — a name in this column is rejected. |
| `userName`    | yes | 2–50 characters. Shown as the reviewer's name. |
| `rating`      | yes | A whole number from 1 to 5. `4.5` is rejected. |
| `comment`     | yes | 3–500 characters. Line breaks are fine. Longer comments are rejected, never trimmed. |
| `createdAt`   | no  | The review's original date — see format below. Leave empty to use the import time. |

If both `productId` and `productSlug` are filled they must point at the same product.

### `createdAt` format

Accepted, and only these:

- `2026-03-15` — date only. Stored as **12:00 UTC** so it displays as 15 March in every timezone.
- `2026-03-15 14:30` or `2026-03-15 14:30:00` — the time is treated as **UTC**.
- `2026-03-15T14:30:00+02:00` / `…Z` — explicit timezone.

Rejected: `15/03/2026`, `3/15/2026`, `March 15 2026`, dates in the future, dates before 2000, and impossible dates like `2026-02-30`.

**Excel warning:** Excel silently rewrites `2026-03-15` into its own date format. Before typing dates, select the column → *Format Cells* → **Text**. If a date already got converted, re-enter it as text.

## 3. Save from Excel

**File → Save As → file type "CSV UTF-8 (Comma delimited) (*.csv)"**.

Plain "CSV (Comma delimited)" is not UTF-8 and will corrupt Arabic text. `.xlsx` files are not accepted in this release — save as CSV.

Limits: **2 MB** and **2,000 rows** per file. Split larger files.

## 4. Upload and check the preview

Choose the file. The server reads it and shows every row as one of:

- **Valid** — will be imported. The resolved product name is shown so you can spot a wrong slug.
- **Duplicate** — skipped. Either the same review appears earlier in the file, or it was already imported by a previous upload. Re-uploading a file you already imported is safe: it imports nothing twice.
- **Error** — skipped, with the exact reason (missing product, rating out of range, bad date, comment too long, …). Row numbers match Excel's row numbers.

Fix errors in Excel, re-save, and choose the file again if you want those rows included. Rows with errors never block the valid ones.

## 5. Choose moderation, then Import

- **Unchecked (default):** reviews are imported as **Pending**. They are not visible on the site until you approve them on the Reviews page, exactly like reviews customers submit.
- **Publish imported reviews immediately:** reviews are imported as **Approved** and appear on product pages right away.

Click **Import N reviews**. The result shows **imported / skipped (duplicates) / failed (errors)** and the reviews list reloads with the new rows at the top. Imported rows are tagged *imported* in the list. They have no customer account attached and no "verified purchase" marker.

If the import reports a failure, nothing from that file was saved — fix the cause and upload again.

## Notes for developers

- Backend: `backend/products/import-reviews/` — `csv.ts` (RFC 4180 parser), `validate.ts` (shared validation, pure), `service.ts` (product lookup, duplicate lookup, transactional insert), `trpc.ts` (`product.previewReviewImport`, `product.importReviews`, both `adminProcedure`).
- The browser preview is informational only; `importReviews` re-parses and re-validates the raw CSV text.
- Duplicate protection: `product_review.import_key` = SHA-256 of (product id, lower-cased reviewer name, rating, comment, the `createdAt` text as supplied). Unique index `product_review_import_key_idx`; inserts use `ON CONFLICT DO NOTHING`, so retries and concurrent double-clicks converge on one copy. Storefront reviews have `import_key = NULL` and are unaffected.
- Migration `0055_review_import_key.sql` is additive (nullable column + unique index, both `IF NOT EXISTS`) and runs through the boot-time runner in `shared/database/auto-migrate.ts`.
- Integration tests (`service.integration.test.ts`) need `TEST_DATABASE_URL` — see `docs/MARKETING_SUITE_PLAN.md` → "Running the DB integration tests".
