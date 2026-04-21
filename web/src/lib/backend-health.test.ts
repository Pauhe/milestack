import { describe, expect, it } from "vitest";

import {
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  type BackendFreshnessPayload,
} from "@/lib/backend";

function makeFreshness(
  overrides: Partial<BackendFreshnessPayload> = {}
): BackendFreshnessPayload {
  return {
    state: "fresh",
    degraded: false,
    indexedBlock: "10",
    chainHead: "10",
    lagBlocks: "0",
    lastSuccessfulAt: "2026-04-21T00:00:00.000Z",
    lastAttemptedAt: "2026-04-21T00:00:01.000Z",
    phase: "steady_sync",
    status: "healthy",
    isSyncing: false,
    syncLoopError: null,
    lastError: null,
    ...overrides,
  };
}

describe("getBackendFreshnessAssessment", () => {
  it("maps a healthy backend payload to non-degraded state", () => {
    const assessment = getBackendFreshnessAssessment(makeFreshness());

    expect(assessment.state).toBe("healthy");
    expect(assessment.degraded).toBe(false);
    expect(assessment.message).toContain("fresh");
  });

  it("maps stale payloads to stale degraded messaging", () => {
    const assessment = getBackendFreshnessAssessment(
      makeFreshness({ state: "stale", degraded: true, lagBlocks: "8" })
    );

    expect(assessment.state).toBe("stale");
    expect(assessment.degraded).toBe(true);
    expect(assessment.message).toContain("stale");
    expect(assessment.message).toContain("8 blocks");
  });

  it("maps rebuilding status to rebuilding state", () => {
    const assessment = getBackendFreshnessAssessment(
      makeFreshness({ state: "rebuilding", degraded: true, status: "rebuilding" })
    );

    expect(assessment.state).toBe("rebuilding");
    expect(assessment.degraded).toBe(true);
    expect(assessment.message).toContain("rebuilding");
  });

  it("maps failed status to failed state", () => {
    const assessment = getBackendFreshnessAssessment(
      makeFreshness({ state: "unavailable", status: "failed", degraded: true, lastError: "rpc error" })
    );

    expect(assessment.state).toBe("failed");
    expect(assessment.degraded).toBe(true);
    expect(assessment.error).toBe("rpc error");
  });

  it("returns unavailable for missing freshness payload", () => {
    const assessment = getBackendFreshnessAssessment(undefined);

    expect(assessment.state).toBe("unavailable");
    expect(assessment.degraded).toBe(true);
    expect(assessment.message).toContain("missing");
  });

  it("returns unavailable for malformed freshness status values", () => {
    const malformed = {
      ...makeFreshness(),
      state: "weird-state",
    } as unknown as BackendFreshnessPayload;

    const assessment = getBackendFreshnessAssessment(malformed);

    expect(assessment.state).toBe("unavailable");
    expect(assessment.degraded).toBe(true);
    expect(assessment.message).toContain("malformed");
  });
});

describe("getBackendUnavailableAssessment", () => {
  it("classifies timeout errors as unavailable timeout state", () => {
    const assessment = getBackendUnavailableAssessment(new Error("The operation timed out while fetching"));

    expect(assessment.state).toBe("unavailable");
    expect(assessment.message).toContain("timed out");
  });

  it("classifies generic fetch failures as unavailable", () => {
    const assessment = getBackendUnavailableAssessment(new Error("connect ECONNREFUSED 127.0.0.1:4000"));

    expect(assessment.state).toBe("unavailable");
    expect(assessment.message).toContain("unavailable");
    expect(assessment.error).toContain("ECONNREFUSED");
  });
});

describe("getBackendFreshnessBanner", () => {
  it("does not show banner for healthy state", () => {
    const assessment = getBackendFreshnessAssessment(makeFreshness());

    expect(getBackendFreshnessBanner("deal", assessment)).toBeNull();
  });

  it("explains live-contract fallback on deal pages during stale backend state", () => {
    const assessment = getBackendFreshnessAssessment(
      makeFreshness({ state: "stale", degraded: true, lagBlocks: "2" })
    );
    const banner = getBackendFreshnessBanner("deal", assessment);

    expect(banner).not.toBeNull();
    expect(banner?.title).toContain("stale");
    expect(banner?.body).toContain("live contract reads");
  });

  it("explains no direct aggregate fallback on profile pages", () => {
    const assessment = getBackendFreshnessAssessment(
      makeFreshness({ state: "rebuilding", degraded: true, status: "rebuilding" })
    );
    const banner = getBackendFreshnessBanner("profile", assessment);

    expect(banner).not.toBeNull();
    expect(banner?.body).toContain("no direct onchain aggregate fallback");
  });

  it("uses unavailable title when backend cannot be reached", () => {
    const assessment = getBackendUnavailableAssessment(new Error("network down"));
    const banner = getBackendFreshnessBanner("milestone", assessment);

    expect(banner).not.toBeNull();
    expect(banner?.title).toContain("unavailable");
    expect(banner?.body).toContain("live contract reads");
  });
});
