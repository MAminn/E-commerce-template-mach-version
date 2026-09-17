import { describe, expect, it } from "vitest";
import { csvEscape, parseCsv } from "../csv";

describe("parseCsv", () => {
  it("parses simple LF rows", () => {
    const { records, errors } = parseCsv("a,b,c\n1,2,3\n");
    expect(errors).toEqual([]);
    expect(records).toEqual([
      { line: 1, fields: ["a", "b", "c"] },
      { line: 2, fields: ["1", "2", "3"] },
    ]);
  });

  it("handles CRLF (Excel) line endings", () => {
    const { records } = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(records.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  it("strips Excel's UTF-8 BOM and keeps Arabic intact", () => {
    const { records } = parseCsv("\uFEFFuserName,comment\nأحمد,منتج ممتاز جدا\n");
    expect(records[0]?.fields[0]).toBe("userName");
    expect(records[1]?.fields).toEqual(["أحمد", "منتج ممتاز جدا"]);
  });

  it("handles quoted commas, escaped quotes and multiline cells", () => {
    const text =
      'name,comment\r\n"Doe, Jane","She said ""wow"".\r\nSecond line, still same cell"\r\nBob,plain\r\n';
    const { records, errors } = parseCsv(text);
    expect(errors).toEqual([]);
    expect(records).toHaveLength(3);
    expect(records[1]?.fields).toEqual([
      "Doe, Jane",
      'She said "wow".\r\nSecond line, still same cell',
    ]);
    // Bob's record starts on physical line 4 because the previous one spanned two.
    expect(records[2]).toEqual({ line: 4, fields: ["Bob", "plain"] });
  });

  it("drops blank lines but keeps rows with empty cells", () => {
    const { records } = parseCsv("a,b\n\n1,\n\n\n,2\n   \n");
    expect(records.map((r) => r.fields)).toEqual([
      ["a", "b"],
      ["1", ""],
      ["", "2"],
    ]);
  });

  it("handles a final record without trailing newline", () => {
    const { records } = parseCsv("a,b\n1,2");
    expect(records).toHaveLength(2);
    expect(records[1]?.fields).toEqual(["1", "2"]);
  });

  it("keeps a quote that appears mid-field literally", () => {
    const { records } = parseCsv('a\n5" screen\n');
    expect(records[1]?.fields).toEqual(['5" screen']);
  });

  it("reports an unterminated quote with the starting line", () => {
    const { errors } = parseCsv('a,b\n1,"open\n2,3\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(2);
  });
});

describe("csvEscape", () => {
  it("quotes only when needed", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
  });

  it("round-trips through parseCsv", () => {
    const values = ['x, "y"', "multi\r\nline", "عربي", ""];
    const text = `${values.map(csvEscape).join(",")}\n`;
    expect(parseCsv(text).records[0]?.fields).toEqual(values);
  });
});
