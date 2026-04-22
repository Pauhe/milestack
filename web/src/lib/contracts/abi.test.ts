import { describe, expect, it } from "vitest";

import { escrowFactoryAbi } from "@/lib/contracts/escrow-factory-abi";
import { milestoneEscrowAbi } from "@/lib/contracts/milestone-escrow-abi";

describe("contract ABI exports", () => {
  it("exports non-empty escrow factory ABI", () => {
    expect(Array.isArray(escrowFactoryAbi)).toBe(true);
    expect(escrowFactoryAbi.length).toBeGreaterThan(0);
  });

  it("exports non-empty milestone escrow ABI", () => {
    expect(Array.isArray(milestoneEscrowAbi)).toBe(true);
    expect(milestoneEscrowAbi.length).toBeGreaterThan(0);
  });
});
