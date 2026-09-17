import { useCallback, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "#root/components/ui/alert";
import { Badge } from "#root/components/ui/badge";
import { Button } from "#root/components/ui/button";
import { Checkbox } from "#root/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#root/components/ui/dialog";
import { Input } from "#root/components/ui/input";
import { Label } from "#root/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#root/components/ui/table";
import type {
  ImportAnalysis,
  ImportRowResult,
} from "#root/backend/products/import-reviews/validate";
import {
  CREATED_AT_FORMAT_HINT,
  REVIEW_IMPORT_COLUMNS,
  REVIEW_IMPORT_LIMITS,
} from "#root/backend/products/import-reviews/constants";
import { csvEscape } from "#root/shared/utils/csv";
import { trpc } from "#root/shared/trpc/client";

/**
 * Upload → server preview → explicit Import → result.
 *
 * The browser only reads the file as text and shows what the server says
 * about it; every decision (product resolution, validation, duplicates) is
 * made server-side, and the import call re-runs that from the raw text.
 */

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  status: "pending" | "approved";
  analysis: ImportAnalysis;
}

const TEMPLATE_ROWS: string[][] = [
  [
    "",
    "synt-aura",
    "Sara M.",
    "5",
    "Great product, noticed a difference within two weeks.",
    "2026-03-15",
  ],
  [
    "",
    "synt-aura",
    "أحمد محمد",
    "4",
    "منتج ممتاز، والتوصيل سريع.\nأنصح به.",
    "2026-04-02 14:30",
  ],
];

/** Excel opens a UTF-8 CSV correctly only when it starts with a BOM. */
export function buildTemplateCsv(): string {
  const lines = [
    REVIEW_IMPORT_COLUMNS.join(","),
    ...TEMPLATE_ROWS.map((r) => r.map(csvEscape).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadTemplateCsv() {
  const blob = new Blob([buildTemplateCsv()], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "product-reviews-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function RowStatusBadge({ row }: { row: ImportRowResult }) {
  if (row.status === "valid") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
        Valid
      </Badge>
    );
  }
  if (row.status === "duplicate") {
    return (
      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
        Duplicate
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Error</Badge>
  );
}

function formatDate(d: Date | string | null) {
  if (!d) return "import time";
  return new Date(d).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PreviewTable({ rows }: { rows: ImportRowResult[] }) {
  return (
    <div className="max-h-72 w-full overflow-auto rounded-md border">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Row</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Reviewer</TableHead>
            <TableHead className="w-12">★</TableHead>
            <TableHead className="min-w-[220px]">Comment / problem</TableHead>
            <TableHead className="whitespace-nowrap">Date</TableHead>
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
              <TableCell className="text-sm text-slate-500 whitespace-nowrap align-top">
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
                <TableCell colSpan={5} className="align-top">
                  <ul className="list-disc pl-4 text-sm text-red-700 space-y-0.5">
                    {row.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </TableCell>
              ) : (
                <>
                  <TableCell className="text-sm font-medium align-top max-w-[160px] truncate">
                    {row.review.productName}
                  </TableCell>
                  <TableCell className="text-sm align-top whitespace-nowrap">
                    {row.review.userName}
                  </TableCell>
                  <TableCell className="text-sm align-top">
                    {row.review.rating}
                  </TableCell>
                  <TableCell className="align-top">
                    {row.status === "duplicate" && (
                      <p className="text-xs text-slate-500 mb-1">
                        {row.reason === "in-file"
                          ? `Same review as row ${row.duplicateOfRow} — will be skipped.`
                          : "Already imported previously — will be skipped."}
                      </p>
                    )}
                    <p className="line-clamp-2 text-sm text-slate-600 whitespace-pre-wrap">
                      {row.review.comment}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 align-top whitespace-nowrap">
                    {formatDate(row.review.createdAt)}
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
    <div className="rounded-md border bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
      <p>
        <strong>What this imports:</strong> product reviews — they appear on
        each product's page once approved. Homepage testimonials are a
        separate CMS section and are not touched.
      </p>
      <p>
        <strong>From Excel:</strong> File → Save As →{" "}
        <em>CSV UTF-8 (Comma delimited) (*.csv)</em>. Plain "CSV" loses Arabic
        text. Only .csv files are accepted (not .xlsx).
      </p>
      <p>
        <strong>Columns:</strong>{" "}
        <code>productId</code> or <code>productSlug</code> (one is required;
        the slug is the last part of the product URL — product names are not
        matched), <code>userName</code> (2–50 chars), <code>rating</code>{" "}
        (whole number 1–5), <code>comment</code> (3–500 chars, never
        truncated), <code>createdAt</code> (optional).
      </p>
      <p>
        <strong>createdAt:</strong> {CREATED_AT_FORMAT_HINT} Leave it empty to
        use the import time. Set the column to <em>Text</em> in Excel so it
        does not reformat dates.
      </p>
      <p>
        <strong>Limits:</strong> {REVIEW_IMPORT_LIMITS.maxFileBytes / 1024 / 1024}{" "}
        MB and {REVIEW_IMPORT_LIMITS.maxRows} rows per file. Re-uploading a
        file never creates duplicates — identical rows are skipped.
      </p>
    </div>
  );
}

export function ImportReviewsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportAnalysis | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [publishImmediately, setPublishImmediately] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const reset = useCallback(() => {
    setFileName(null);
    setCsvText(null);
    setPreview(null);
    setPreviewing(false);
    setImporting(false);
    setPublishImmediately(false);
    setResult(null);
    setInputKey((k) => k + 1);
  }, []);

  const handleClose = (next: boolean) => {
    if (importing) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFile = async (file: File | null) => {
    setPreview(null);
    setResult(null);
    setCsvText(null);
    setFileName(file?.name ?? null);
    if (!file) return;

    if (file.size > REVIEW_IMPORT_LIMITS.maxFileBytes) {
      toast.error(
        `File is larger than ${REVIEW_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB. Split it into smaller files.`,
      );
      return;
    }

    setPreviewing(true);
    try {
      // Decoded as UTF-8 regardless of extension; the server strips the BOM.
      const text = await file.text();
      setCsvText(text);
      const res = await trpc.product.previewReviewImport.mutate({ csvText: text });
      if (!res.success) {
        toast.error(res.error || "Could not read the file");
        return;
      }
      setPreview(res.result);
    } catch (err) {
      console.error("Preview failed:", err);
      toast.error("Could not read the file");
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!csvText || importing) return;
    setImporting(true);
    try {
      const res = await trpc.product.importReviews.mutate({
        csvText,
        publishImmediately,
      });
      if (!res.success) {
        toast.error(
          res.error ||
            "Import failed — nothing was saved. Check the file and try again.",
        );
        return;
      }
      setResult(res.result);
      setPreview(res.result.analysis);
      toast.success(
        `Imported ${res.result.imported} review${res.result.imported === 1 ? "" : "s"}`,
      );
      onImported();
    } catch (err) {
      console.error("Import failed:", err);
      toast.error("Import failed — nothing was saved. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const canImport =
    !!preview && preview.fileErrors.length === 0 && preview.summary.valid > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Import product reviews from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV, check the preview, then click Import. Nothing is
            saved until you do.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <Instructions />

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="review-csv">CSV file</Label>
              <Input
                key={inputKey}
                id="review-csv"
                type="file"
                accept=".csv,text/csv"
                disabled={previewing || importing}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button type="button" variant="outline" onClick={downloadTemplateCsv}>
              <Download className="h-4 w-4 mr-2" />
              Download CSV template
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
                <ul className="list-disc pl-4 space-y-0.5">
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
                <ul className="list-disc pl-4 space-y-0.5">
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
              <AlertTitle>Import complete</AlertTitle>
              <AlertDescription>
                <span className="font-medium">{result.imported} imported</span>{" "}
                as {result.status === "approved" ? "approved (now public)" : "pending (not public until approved)"} ·{" "}
                {result.skipped} skipped as duplicates · {result.failed} failed
                validation.
              </AlertDescription>
            </Alert>
          )}

          {preview && preview.fileErrors.length === 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-slate-500" />
                <span className="font-medium">{fileName}</span>
                <span className="text-slate-500">
                  · {preview.summary.total} rows
                </span>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  {preview.summary.valid} valid
                </Badge>
                <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                  <Copy className="h-3 w-3 mr-1" />
                  {preview.summary.duplicate} duplicate
                </Badge>
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                  {preview.summary.invalid} with errors
                </Badge>
              </div>

              <PreviewTable rows={preview.rows} />

              {!result && (
                <>
                  <div className="flex items-start gap-2 rounded-md border p-3">
                    <Checkbox
                      id="publish-immediately"
                      checked={publishImmediately}
                      disabled={importing}
                      onCheckedChange={(v) => setPublishImmediately(v === true)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="publish-immediately" className="cursor-pointer">
                        Publish imported reviews immediately
                      </Label>
                      <p className="text-xs text-slate-500">
                        Unchecked (default): reviews are imported as{" "}
                        <strong>pending</strong> and stay hidden until you
                        approve them here. Checked: they are imported as
                        approved and show on product pages right away.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      {preview.summary.invalid > 0 &&
                        `${preview.summary.invalid} row${preview.summary.invalid === 1 ? "" : "s"} with errors will be skipped. `}
                      {preview.summary.duplicate > 0 &&
                        `${preview.summary.duplicate} duplicate${preview.summary.duplicate === 1 ? "" : "s"} will be skipped. `}
                      {preview.summary.valid === 0 && "Nothing to import."}
                    </p>
                    <Button
                      type="button"
                      onClick={handleImport}
                      disabled={!canImport || importing}>
                      {importing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Import {preview.summary.valid} review
                      {preview.summary.valid === 1 ? "" : "s"}
                      {publishImmediately ? " as approved" : " as pending"}
                    </Button>
                  </div>
                </>
              )}

              {result && (
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={reset}>
                    Import another file
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
