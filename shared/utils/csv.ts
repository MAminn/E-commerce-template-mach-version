/**
 * Minimal RFC 4180 CSV reader shared by the CSV importers (product reviews,
 * homepage testimonials). Browser-safe: no Node imports.
 *
 * Deliberately a character-level state machine rather than `split(",")`:
 * Excel's "CSV UTF-8" export produces quoted fields containing commas,
 * doubled quotes (`""`) for a literal quote, CRLF line endings, and raw
 * newlines inside quoted cells (multi-line comments), all of which a
 * split-based reader gets wrong.
 *
 * Every record carries the 1-based line number it started on, so
 * validation errors can point the admin at the exact line in their file
 * even when earlier rows spanned several lines.
 */

export interface CsvRecord {
  /** 1-based line in the source file where this record starts. */
  line: number;
  fields: string[];
}

export interface CsvParseResult {
  records: CsvRecord[];
  /** Fatal structural problems (unterminated quote etc.). */
  errors: { line: number; message: string }[];
}

const BOM = "\uFEFF";

export function parseCsv(input: string): CsvParseResult {
  const text = input.startsWith(BOM) ? input.slice(1) : input;

  const records: CsvRecord[] = [];
  const errors: CsvParseResult["errors"] = [];

  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  /** True once the current field opened with a quote — a quote appearing
   * later in an unquoted field is kept literally (Excel does this). */
  let fieldWasQuoted = false;
  let line = 1;
  let recordStartLine = 1;
  let i = 0;

  const endField = () => {
    fields.push(field);
    field = "";
    fieldWasQuoted = false;
  };

  const endRecord = () => {
    endField();
    // A blank line yields a single empty field — drop it rather than
    // reporting "missing columns" for every trailing newline Excel adds.
    const isBlank = fields.length === 1 && (fields[0] ?? "").trim() === "";
    if (!isBlank) records.push({ line: recordStartLine, fields });
    fields = [];
    recordStartLine = line;
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      else if (ch === "\r" && text[i + 1] !== "\n") line++;
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field.length === 0 && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      line++;
      endRecord();
      continue;
    }
    field += ch;
    i++;
  }

  if (inQuotes) {
    errors.push({
      line: recordStartLine,
      message:
        'Unterminated quoted field — a cell starting with " never closes. Check for a stray quote in this row.',
    });
    return { records, errors };
  }

  // Flush the final record if the file doesn't end with a newline.
  if (field.length > 0 || fields.length > 0) endRecord();

  return { records, errors };
}

/** Quote a single value for CSV output (used by the template download). */
export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
