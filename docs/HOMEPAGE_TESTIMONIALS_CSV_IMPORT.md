# Uploading homepage testimonials from a CSV

Dashboard → **Homepage** → scroll to the **Testimonials** card (or use the
"Homepage testimonials" link on the Reviews page) → **Upload testimonials CSV**.

These are the customer quotes shown in the **Testimonials** section of the
Mach landing page. They are **not** product reviews and need **no product IDs
or slugs**. (Product-page reviews are imported from Reviews → Import CSV — see
`REVIEW_CSV_IMPORT.md`.)

## 1. Prepare the file

Columns (header row, any order; case does not matter):

| Column     | Required | Rules |
|------------|----------|-------|
| `name`     | yes | 2–80 characters. `userName` is accepted as an alias. |
| `rating`   | yes | Whole number 1–5. |
| `review`   | yes | 3–600 characters, line breaks allowed. `comment` is accepted as an alias. |
| `nameAr`   | no  | Arabic name, shown next to the name. |
| `reviewAr` | no  | Arabic version of the quote, shown under it. |

`productId`, `productSlug` and `createdAt` columns are ignored, so a file made
for the product-review importer can be reused as-is.

**Save from Excel as "CSV UTF-8 (Comma delimited)"** — plain "CSV" corrupts
Arabic. Limits: 1 MB, 300 rows per file, 300 testimonials on the homepage in
total. **Download template** gives you the exact header with two example rows;
delete the examples before uploading.

## 2. Upload → preview → publish

1. **Upload testimonials CSV** opens the dialog. **Choose CSV file from this
   computer** opens your file picker. Nothing is downloaded and nothing is
   saved at this point.
2. The preview lists every row as **Will add**, **Duplicate** (same name +
   quote already on the homepage or earlier in the file — skipped) or
   **Error** (with the Excel row number and the reason).
3. The dialog shows how many testimonials the section holds now and how many
   it will hold after the import. Existing testimonials are **kept** by
   default; the file is appended after them.
   - If the section only contains the template's sample quotes ("Sarah
     Mitchell", "James Cooper", …), the dialog says so and pre-ticks
     **Remove the existing testimonials and keep only the ones in this file**,
     so placeholder quotes never go live. Untick it to keep them anyway.
4. Click **Import and publish N testimonials**. This saves the rows and turns
   the Testimonials section **on**. Open the storefront homepage to see them.

Re-uploading the same file later adds nothing — every row shows as Duplicate
and the Import button stays disabled.

If the Homepage page has unsaved edits, the Import button is disabled until you
save or discard them (the import reloads the editor from the server).

## 3. Editing afterwards

In the same Testimonials card you can edit any name/quote/rating, move an
entry up or down, remove it, change the section title (English/Arabic) or
switch the whole section off, then **Save Changes**. The landing page reflects
the saved state on the next load.

## Notes for developers

- Backend: `backend/homepage/import-testimonials/` — `validate.ts` (pure, uses
  `shared/utils/csv.ts`), `service.ts` (locks the homepage row, writes only
  `content.testimonials` with `jsonb_set`), tRPC `homepage.previewTestimonialImport`
  / `homepage.importTestimonials` (`adminProcedure`).
- Storefront: `components/template-system/mach/sections/MachTestimonials.tsx`,
  rendered by `LandingTemplateMach` for the new orderable section key
  `testimonials` (default position: after Why Mach). Older saved section
  orders get it spliced in there automatically.
- Nothing here touches `product_review`.
- Integration tests need `TEST_DATABASE_URL`; the browser walkthrough used
  `docs/examples/TEST-ONLY-homepage-testimonials.csv`.
