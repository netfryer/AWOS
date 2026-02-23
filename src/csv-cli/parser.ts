/**
 * CSV Parser module for CSV→JSON CLI.
 * Parses CSV content, validates structure, produces ParsedRow[] with configurable numeric columns.
 */

/** A single validated row from the CSV. */
export interface ParsedRow {
  /** Original 0-based row index in the source file (for error reporting) */
  rowIndex: number;
  /** Column name → string value (raw). Keys match header. */
  raw: Record<string, string>;
  /** Column name → parsed number. Only columns declared numeric are present. */
  numeric: Record<string, number>;
  /** All column names in order (for deterministic iteration) */
  columns: string[];
}

export type ParseErrorReason =
  | "empty_file"
  | "malformed_csv"
  | "non_numeric"
  | "missing_header";

export interface ParseError {
  rowIndex: number;
  column: string;
  rawValue: string;
  reason: ParseErrorReason;
}

export interface ParserOptions {
  /** Columns to parse as numbers; others remain as strings in raw only */
  numericColumns: string[];
  /** Field delimiter; default "," */
  delimiter?: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
}

const DEFAULT_DELIMITER = ",";

/**
 * Parse a single CSV field, handling quoted strings and escaped quotes.
 * Returns the parsed value and the index after the field, or null if malformed.
 */
function parseField(
  line: string,
  start: number,
  delimiter: string
): { value: string; end: number } | null {
  if (start >= line.length) return { value: "", end: start };

  if (line[start] === '"') {
    let i = start + 1;
    const parts: string[] = [];
    while (i < line.length) {
      const ch = line[i];
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          parts.push('"');
          i += 2;
          continue;
        }
        let end = i + 1;
        if (end < line.length && line[end] === delimiter) end++;
        return { value: parts.join(""), end };
      }
      if (ch === "\n" || ch === "\r") {
        return null;
      }
      parts.push(ch);
      i++;
    }
    return null;
  }

  const idx = line.indexOf(delimiter, start);
  const end = idx === -1 ? line.length : idx;
  const value = line.slice(start, end).replace(/^"|"$/g, "").trim();
  return { value, end: idx === -1 ? end : idx + 1 };
}

/**
 * Parse a single CSV line into an array of field values.
 * Returns null if the line is malformed (e.g. unclosed quote).
 */
function parseLine(
  line: string,
  delimiter: string
): string[] | null {
  const fields: string[] = [];
  let pos = 0;
  while (pos <= line.length) {
    const result = parseField(line, pos, delimiter);
    if (result === null) return null;
    fields.push(result.value);
    pos = result.end;
    if (pos >= line.length) break;
  }
  return fields;
}

function isNumeric(value: string): boolean {
  if (value.trim() === "") return false;
  const n = Number(value);
  return Number.isFinite(n);
}

/**
 * Parse CSV content into structured rows with optional numeric parsing.
 */
export function parseCsv(content: string, options: ParserOptions): ParseResult {
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER;
  const numericSet = new Set(options.numericColumns);
  const errors: ParseError[] = [];
  const rows: ParsedRow[] = [];

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    errors.push({
      rowIndex: 0,
      column: "",
      rawValue: "",
      reason: "empty_file",
    });
    return { rows: [], errors };
  }

  const lines = trimmed.split(/\r?\n/);
  if (lines.length === 0) {
    errors.push({
      rowIndex: 0,
      column: "",
      rawValue: "",
      reason: "empty_file",
    });
    return { rows: [], errors };
  }

  const headerResult = parseLine(lines[0], delimiter);
  if (headerResult === null) {
    errors.push({
      rowIndex: 0,
      column: "",
      rawValue: lines[0].slice(0, 50),
      reason: "malformed_csv",
    });
    return { rows: [], errors };
  }

  const columns = headerResult;
  if (columns.length === 0 || columns.every((c) => c.trim() === "")) {
    errors.push({
      rowIndex: 0,
      column: "",
      rawValue: "",
      reason: "missing_header",
    });
    return { rows: [], errors };
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const fieldResult = parseLine(line, delimiter);
    if (fieldResult === null) {
      errors.push({
        rowIndex: i,
        column: "",
        rawValue: line.slice(0, 80),
        reason: "malformed_csv",
      });
      continue;
    }

    const raw: Record<string, string> = {};
    const numeric: Record<string, number> = {};
    let rowValid = true;

    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const val = fieldResult[c] ?? "";
      raw[col] = val;

      if (numericSet.has(col)) {
        if (isNumeric(val)) {
          numeric[col] = Number(val);
        } else if (val.trim() !== "") {
          errors.push({
            rowIndex: i,
            column: col,
            rawValue: val,
            reason: "non_numeric",
          });
          rowValid = false;
        }
      }
    }

    if (rowValid) {
      rows.push({
        rowIndex: i,
        raw,
        numeric,
        columns,
      });
    }
  }

  return { rows, errors };
}
