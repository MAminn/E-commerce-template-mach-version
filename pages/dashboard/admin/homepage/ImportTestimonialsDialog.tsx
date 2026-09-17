import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "#root/components/ui/alert";
import { Badge } from "#root/components/ui/badge";
import { Button } from "#root/components/ui/button";
import { Checkbox } from "#root/components/ui/checkbox";
import { Label } from "#root/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#root/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#root/components/ui/table";
import type {
  TestimonialImportAnalysis,
  TestimonialRowResult,
} from "#root/backend/homepage/import-testimonials/validate";
import type { ExistingTestimonialsInfo } from "#root/backend/homepage/import-testimonials/service";
import {
  TESTIMONIAL_CSV_COLUMNS,
  TESTIMONIAL_IMPORT_LIMITS,
  TESTIMONIAL_LIMITS,
} from "#root/backend/homepage/import-testimonials/constants";
import { csvEscape } from "#root/shared/utils/csv";
import { trpc } from "#root/shared/trpc/client";

/**
 * Homepage testimonials: choose a CSV from this computer → server preview →
 * "Import and publish" → the rows are appended to the homepage CMS block.
 *
 * Wiring notes, because a mix-up here is exactly the bug this dialog exists
 * to avoid: the upload control is a plain `type="button"` that opens a hidden
 * `<input type="file">` and nothing else; the template download is its own
 * `type="button"` with its own handler; there is no <form>, so no click can
 * submit anything, and neither handler calls the other.
 */

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  totalAfter: number;
  replaced: number;
  templateId: string;
  analysis: TestimonialImportAnalysis;
}

type Preview = TestimonialImportAnalysis & {
  existing: ExistingTestimonialsInfo;
  replaceExisting: boolean;
};

const TEMPLATE_ROWS: string[][] = [
  [
    "Sara M.",
    "5",
    "Great products and fast delivery. Noticed a difference within two weeks.",
    "سارة م.",
    "منتجات ممتازة وتوصيل سريع. لاحظت الفرق خلال أسبوعين.",
  ],
  [
    "Omar K.",
    "4",
    "Mixes well and tastes great.\nWill order again.",
    "",
    "",
  ],
];

/** BOM-prefixed so Excel opens the Arabic example correctly. */
export function buildTestimonialTemplateCsv(): string {
  const lines = [
    TESTIMONIAL_CSV_COLUMNS.join(","),
    ...TEMPLATE_ROWS.map((r) => r.map(csvEscape).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadTestimonialTemplateCsv() {
  const blob = new Blob([buildTestimonialTemplateCsv()], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "homepage-testimonials-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function RowStatusBadge({ row }: { row: TestimonialRowResult }) {
  if (row.status === "valid")
    return (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
        Will add
      </Badge>
    );
  if (row.status === "duplicate")
    return (
      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
        Duplicate
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Error</Badge>
  );
}

function PreviewTable({ rows }: { rows: TestimonialRowResult[] }) {
  return (
    <div className="max-h-72 w-full overflow-auto rounded-md border">
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">Row</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-12">★</TableHead>
            <TableHead className="min-w-[260px]">Review / problem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.row}
              className={
                row.status === "invalid"
                  ? "bg-red-50/60"
                  : row.status === "duplicate"
                    ? "bg-slate-50"
                    : undefined
              }>
              <TableCell className="align-top text-sm text-slate-500">
                {row.row}
                {row.line !== row.row && (
                  <span className="block text-[10px] text-slate-400">
                    line {row.line}
                  </span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <RowStatusBadge row={row} />
              </TableCell>
              {row.status === "invalid" ? (
                <TableCell colSpan={3} className="align-top">
                  <ul className="list-disc space-y-0.5 pl-4 text-sm text-red-700">
                    {row.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </TableCell>
              ) : (
                <>
                  <TableCell className="align-top text-sm font-medium">
                    <span dir="auto">{row.item.name}</span>
                    {row.item.nameAr && (
                      <span dir="rtl" className="block text-xs text-slate-500">
                        {row.item.nameAr}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-sm">{row.item.rating}</TableCell>
                  <TableCell className="align-top">
                    {row.status === "duplicate" && (
                      <p className="mb-1 text-xs text-slate-500">
                        {row.reason === "in-file"
                          ? `Same as row ${row.duplicateOfRow} — will be skipped.`
                          : "Already on the homepage — will be skipped."}
                      </p>
                    )}
                    <p dir="auto" className="line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">
                      {row.item.review}
                    </p>
                    {row.item.reviewAr && (
                      <p dir="rtl" className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">
                        {row.item.reviewAr}
                      </p>
                    )}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Instructions() {
  return (
    <div className="space-y-2 rounded-md border bg-slate-50 p-3 text-xs text-slate-600">
      <p>
        <strong>What this does:</strong> adds customer quotes to the homepage
        “Testimonials” section of the landing page. These are not product
        reviews and need no product IDs — for reviews on product pages use
        Reviews → Import CSV instead.
      </p>
      <p>
        <strong>Columns:</strong> <code>name</code> (required, 2–
        {TESTIMONIAL_LIMITS.name.max} chars), <code>rating</code> (whole number
        1–5), <code>review</code> (required, 3–{TESTIMONIAL_LIMITS.review.max}{" "}
        chars), <code>nameAr</code> and <code>reviewAr</code> (optional
        Arabic). <code>userName</code>/<code>comment</code> headers are accepted
        too; <code>productId</code>, <code>productSlug</code> and{" "}
        <code>createdAt</code> columns are ignored.
      </p>
      <p>
        <strong>From Excel:</strong> File → Save As →{" "}
        <em>CSV UTF-8 (Comma delimited)</em>. Plain “CSV” loses Arabic text.
        Limits: {TESTIMONIAL_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB and{" "}
        {TESTIMONIAL_IMPORT_LIMITS.maxRows} rows per file. Existing
        testimonials are kept; rows already on the homepage are skipped.
      </p>
    </div>
  );
}

export function ImportTestimonialsDialog({
  open,
  onOpenChange,
  templateId,
  hasUnsavedChanges,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Landing template whose homepage content receives the rows. */
  templateId: string;
  /** The homepage form has edits that would be overwritten by the reload. */
  hasUnsavedChanges: boolean;
  onImported: () => void | Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  /** Set once per chosen file so a re-preview does not re-tick the box. */
  const [replaceDecided, setReplaceDecided] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = useCallback(() => {
    setFileName(null);
    setCsvText(null);
    setPreview(null);
    setPreviewing(false);
    setImporting(false);
    setResult(null);
    setReplaceExisting(false);
    setReplaceDecided(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleClose = (next: boolean) => {
    if (importing) return;
    if (!next) reset();
    onOpenChange(next);
  };

  /** Only ever opens the OS file picker. */
  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const runPreview = async (text: string, replace: boolean) => {
    setPreviewing(true);
    try {
      const res = await trpc.homepage.previewTestimonialImport.mutate({
        csvText: text,
        templateId,
        replaceExisting: replace,
      });
      if (!res.success) {
        toast.error(res.error || "Could not read the file");
        return null;
      }
      return res.result;
    } catch (err) {
      console.error("Testimonial preview failed:", err);
      toast.error("Could not read the file");
      return null;
    } finally {
      setPreviewing(false);
    }
  };

  const handleReplaceToggle = async (next: boolean) => {
    setReplaceExisting(next);
    setReplaceDecided(true);
    if (!csvText) return;
    const p = await runPreview(csvText, next);
    if (p) setPreview(p);
  };

  const handleFile = async (file: File | null) => {
    setPreview(null);
    setResult(null);
    setCsvText(null);
    setReplaceDecided(false);
    setFileName(file?.name ?? null);
    if (!file) return;

    if (file.size > TESTIMONIAL_IMPORT_LIMITS.maxFileBytes) {
      toast.error(
        `File is larger than ${TESTIMONIAL_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB. Split it into smaller files.`,
      );
      return;
    }

    const text = await file.text();
    setCsvText(text);
    const first = await runPreview(text, false);
    if (!first) return;
    // Shipped sample quotes must not go live beside real customers: when
    // that is all the section holds, default to replacing them (still an
    // explicit, visible, untickable choice) and re-run the preview so the
    // counts reflect it.
    if (first.existing.shippedSamples) {
      setReplaceExisting(true);
      setReplaceDecided(true);
      const again = await runPreview(text, true);
      setPreview(again ?? first);
      return;
    }
    setReplaceExisting(false);
    setPreview(first);
  };

  const handleImport = async () => {
    if (!csvText || importing) return;
    setImporting(true);
    try {
      const res = await trpc.homepage.importTestimonials.mutate({
        csvText,
        templateId,
        replaceExisting,
      });
      if (!res.success) {
        toast.error(res.error || "Import failed — nothing was published.");
        return;
      }
      setResult(res.result);
      setPreview((prev) =>
        prev ? { ...prev, ...res.result.analysis } : prev,
      );
      toast.success(
        `Published ${res.result.imported} testimonial${res.result.imported === 1 ? "" : "s"} to the homepage`,
      );
      await onImported();
    } catch (err) {
      console.error("Testimonial import failed:", err);
      toast.error("Import failed — nothing was published. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const canImport =
    !!preview &&
    preview.fileErrors.length === 0 &&
    preview.summary.valid > 0 &&
    !hasUnsavedChanges;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Upload homepage testimonials from CSV</DialogTitle>
          <DialogDescription>
            Choose a CSV from this computer, check the preview, then click
            “Import and publish”. Nothing changes on the site until you do.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <Instructions />

          {/* Hidden picker. The visible button below opens it; nothing else
              is attached to it. */}
          <input
            ref={fileInputRef}
            id="testimonials-csv-file"
            data-testid="testimonials-csv-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            tabIndex={-1}
            disabled={previewing || importing}
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              type="button"
              data-testid="testimonials-choose-file"
              onClick={openFilePicker}
              disabled={previewing || importing}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Choose CSV file from this computer
            </Button>
            <span className="text-sm text-slate-500">
              {fileName ?? "No file chosen"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sm:ml-auto text-slate-600"
              data-testid="testimonials-download-template"
              onClick={downloadTestimonialTemplateCsv}>
              <Download className="mr-2 h-4 w-4" />
              Download template (optional)
            </Button>
          </div>

          {previewing && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking {fileName}…
            </div>
          )}

          {preview && preview.fileErrors.length > 0 && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>This file cannot be imported</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {preview.fileErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {preview && preview.warnings.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Notes</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert className="border-emerald-300 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <AlertTitle>Published to the homepage</AlertTitle>
              <AlertDescription>
                <span className="font-medium">{result.imported} added</span> ·{" "}
                {result.skipped} skipped as duplicates · {result.failed} with
                errors{result.replaced > 0 ? ` · ${result.replaced} previous testimonial${result.replaced === 1 ? "" : "s"} removed` : ""}.
                The Testimonials section is on and now holds{" "}
                {result.totalAfter} testimonial{result.totalAfter === 1 ? "" : "s"}.
                Open the storefront homepage to see them.
              </AlertDescription>
            </Alert>
          )}

          {preview && preview.fileErrors.length === 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-slate-500" />
                <span className="font-medium">{fileName}</span>
                <span className="text-slate-500">· {preview.summary.total} rows</span>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  {preview.summary.valid} will be added
                </Badge>
                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                  {preview.summary.duplicate} duplicate
                </Badge>
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                  {preview.summary.invalid} with errors
                </Badge>
              </div>

              <PreviewTable rows={preview.rows} />

              {!result && (
                <>
                  {hasUnsavedChanges && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Save or discard your homepage edits first</AlertTitle>
                      <AlertDescription>
                        This page has unsaved changes. Importing reloads the
                        homepage content from the server, which would drop
                        them.
                      </AlertDescription>
                    </Alert>
                  )}
                  {preview.existing.count > 0 && (
                    <div
                      className={`space-y-2 rounded-md border p-3 ${preview.existing.shippedSamples ? "border-amber-300 bg-amber-50" : "bg-slate-50"}`}
                      data-testid="testimonials-existing-panel">
                      <p className="text-sm text-slate-700">
                        The section already holds{" "}
                        <strong>{preview.existing.count}</strong> testimonial
                        {preview.existing.count === 1 ? "" : "s"}
                        {preview.existing.enabled ? " (currently shown on the homepage)" : " (section currently off)"}:{" "}
                        <span className="text-slate-500">
                          {preview.existing.names.slice(0, 6).join(", ")}
                          {preview.existing.names.length > 6 ? ", …" : ""}
                        </span>
                      </p>
                      {preview.existing.shippedSamples && (
                        <p className="text-sm font-medium text-amber-800">
                          These are the template's sample quotes, not real
                          customers. Publishing would show them on the site, so
                          replacing them is pre-selected.
                        </p>
                      )}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="replace-existing-testimonials"
                          data-testid="testimonials-replace-existing"
                          checked={replaceExisting}
                          disabled={previewing || importing}
                          onCheckedChange={(v) => handleReplaceToggle(v === true)}
                        />
                        <Label htmlFor="replace-existing-testimonials" className="cursor-pointer text-sm leading-tight">
                          Remove the {preview.existing.count} existing testimonial
                          {preview.existing.count === 1 ? "" : "s"} and keep only
                          the ones in this file
                          <span className="block text-xs font-normal text-slate-500">
                            Unchecked: the file is added after the existing ones
                            (default).
                          </span>
                        </Label>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600" data-testid="testimonials-import-summary">
                      {replaceExisting ? (
                        <>
                          Import removes the <strong>{preview.existing.count}</strong>{" "}
                          existing, adds <strong>{preview.summary.valid}</strong> →{" "}
                          <strong>{preview.summary.afterImport}</strong> total, and
                          turns the section on.
                        </>
                      ) : (
                        <>
                          Homepage has <strong>{preview.summary.existing}</strong>{" "}
                          testimonial{preview.summary.existing === 1 ? "" : "s"} now.
                          Import adds <strong>{preview.summary.valid}</strong> →{" "}
                          <strong>{preview.summary.afterImport}</strong> total, and
                          turns the section on. Existing ones are kept.
                        </>
                      )}
                    </p>
                    <Button
                      type="button"
                      data-testid="testimonials-import-publish"
                      onClick={handleImport}
                      disabled={!canImport || importing}>
                      {importing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Import and publish {preview.summary.valid} testimonial
                      {preview.summary.valid === 1 ? "" : "s"}
                    </Button>
                  </div>
                </>
              )}

              {result && (
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={reset}>
                    Upload another file
                  </Button>
                  <Button type="button" onClick={() => handleClose(false)}>
                    Done
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
