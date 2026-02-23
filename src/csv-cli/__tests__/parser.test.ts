import { describe, it, expect } from "vitest";
import { parseCsv } from "../parser.js";

describe("parseCsv", () => {
  it("P1: empty string → rows: [], errors: [{ reason: empty_file }]", () => {
    const r = parseCsv("", { numericColumns: ["x"] });
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toBe("empty_file");
  });

  it("P2: valid header + data rows → ParsedRow with correct structure", () => {
    const r = parseCsv("name,price,quantity\nApple,1.5,10\nBanana,0.99,20", {
      numericColumns: ["price", "quantity"],
    });
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      rowIndex: 1,
      columns: ["name", "price", "quantity"],
      raw: { name: "Apple", price: "1.5", quantity: "10" },
      numeric: { price: 1.5, quantity: 10 },
    });
    expect(r.rows[1]).toMatchObject({
      rowIndex: 2,
      numeric: { price: 0.99, quantity: 20 },
    });
  });

  it("P3: non-numeric value → row omitted, ParseError with non_numeric", () => {
    const r = parseCsv("col\nabc", { numericColumns: ["col"] });
    expect(r.rows).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({
      rowIndex: 1,
      column: "col",
      rawValue: "abc",
      reason: "non_numeric",
    });
  });

  it("P4: unclosed quote → ParseError with malformed_csv", () => {
    const r = parseCsv('a,b\n"unclosed,c', { numericColumns: [] });
    expect(r.rows).toHaveLength(0);
    expect(r.errors.some((e) => e.reason === "malformed_csv")).toBe(true);
  });

  it("P5: no header (empty first line) → missing_header", () => {
    const r = parseCsv(",,\n1,2,3", { numericColumns: ["a", "b", "c"] });
    expect(r.rows).toHaveLength(0);
    expect(r.errors.some((e) => e.reason === "missing_header")).toBe(true);
  });

  it("P6: configurable numeric columns", () => {
    const r = parseCsv("a,b,c\n1,2,3", { numericColumns: ["b"] });
    expect(r.rows[0].numeric).toEqual({ b: 2 });
    expect(r.rows[0].raw).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("handles quoted fields with commas", () => {
    const r = parseCsv('x,y\n"a,b",2', { numericColumns: ["y"] });
    expect(r.rows[0].raw).toEqual({ x: "a,b", y: "2" });
    expect(r.rows[0].numeric).toEqual({ y: 2 });
  });

  it("handles inconsistent row lengths (fewer columns)", () => {
    const r = parseCsv("a,b\n1", { numericColumns: ["b"] });
    expect(r.rows[0].raw).toEqual({ a: "1", b: "" });
    expect(r.rows[0].numeric).toEqual({});
  });
});
