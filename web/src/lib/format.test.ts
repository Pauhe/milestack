import { describe, expect, it } from "vitest";

import { formatUsdc, formatTimestamp } from "@/lib/format";

describe("formatUsdc", () => {
  it("formats whole-dollar amounts without a fractional part", () => {
    expect(formatUsdc(0n)).toBe("0 USDC");
    expect(formatUsdc(1_000_000n)).toBe("1 USDC");
    expect(formatUsdc(1_000_000_000_000n)).toBe("1000000 USDC");
  });

  it("trims trailing zeros from the fractional part", () => {
    expect(formatUsdc(1_500_000n)).toBe("1.5 USDC");
    expect(formatUsdc(1_230_000n)).toBe("1.23 USDC");
    expect(formatUsdc(250_500_000n)).toBe("250.5 USDC");
  });

  it("preserves leading fractional zeros down to the smallest USDC unit", () => {
    expect(formatUsdc(1n)).toBe("0.000001 USDC");
    expect(formatUsdc(1_000_001n)).toBe("1.000001 USDC");
    expect(formatUsdc(999_999n)).toBe("0.999999 USDC");
  });
});

describe("formatTimestamp", () => {
  it("reports an unset label for a zero timestamp", () => {
    expect(formatTimestamp(0n)).toBe("Not set");
  });

  it("formats a non-zero unix timestamp as a localized date-time string", () => {
    const unixSeconds = 1_700_000_000n;
    const expected = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(Number(unixSeconds) * 1000);

    expect(formatTimestamp(unixSeconds)).toBe(expected);
  });
});
