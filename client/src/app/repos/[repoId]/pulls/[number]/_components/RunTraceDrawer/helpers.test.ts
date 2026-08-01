import { describe, it, expect } from "vitest";
import { formatCost, formatTotalTokens } from "./helpers";

describe("formatCost", () => {
  it("returns en-dash for null", () => {
    expect(formatCost(null)).toBe("–");
  });

  it("returns en-dash for undefined", () => {
    expect(formatCost(undefined)).toBe("–");
  });

  it("uses 4 decimal places for sub-cent values (< $0.01)", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.0099)).toBe("$0.0099");
  });

  it("uses 3 decimal places for sub-dollar values ($0.01–$0.99)", () => {
    expect(formatCost(0.01)).toBe("$0.010");
    expect(formatCost(0.06)).toBe("$0.060");
    expect(formatCost(0.999)).toBe("$0.999");
  });

  it("uses 2 decimal places for dollar values (>= $1)", () => {
    expect(formatCost(1.23)).toBe("$1.23");
    expect(formatCost(10)).toBe("$10.00");
    expect(formatCost(999.99)).toBe("$999.99");
  });

  it("handles zero as sub-cent", () => {
    expect(formatCost(0)).toBe("$0.0000");
  });
});

describe("formatTotalTokens", () => {
  it("sums tokens and appends 'tok'", () => {
    const result = formatTotalTokens(9000, 119);
    expect(result).toContain("9");
    expect(result).toContain("119");
    expect(result).toContain("tok");
  });

  it("handles zero tokens", () => {
    expect(formatTotalTokens(0, 0)).toBe("0 tok");
  });
});
