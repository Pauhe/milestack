import { describe, expect, it } from "vitest";

import {
  getBackendFreshnessAssessment,
  getBackendFreshnessBanner,
  getBackendUnavailableAssessment,
  getHashContextAssessment,
  getMetadataTruthAssessment,
  getMilestoneMetadataVerificationAssessment,
  getReputationTruthAssessment,
  getTimelineTruthNote,
  type BackendFreshnessPayload,
  type BackendHashContextTruth,
  type BackendMetadataTruth,
  type BackendMilestoneMetadataVerificationTruth,
  type BackendReputationTruth,
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

function makeMetadataTruth(
  overrides: Partial<BackendMetadataTruth> = {}
): BackendMetadataTruth {
  return {
    state: "verified",
    verified: true,
    degraded: false,
    metadataHash: "0xabc",
    metadataUrl: "https://example.com/metadata.json",
    payload: { title: "Deal" },
    payloadPresent: true,
    updatedAtBlock: "123",
    error: null,
    ...overrides,
  };
}

function makeMilestoneMetadataTruth(
  overrides: Partial<BackendMilestoneMetadataVerificationTruth> = {}
): BackendMilestoneMetadataVerificationTruth {
  return {
    state: "verified",
    verified: true,
    titleVerified: true,
    descriptionVerified: true,
    degraded: false,
    reason: null,
    ...overrides,
  };
}

function makeHashTruth(
  overrides: Partial<BackendHashContextTruth> = {}
): BackendHashContextTruth {
  return {
    state: "present",
    hash: "0x123",
    verified: false,
    degraded: false,
    ambiguity: null,
    reason: null,
    ...overrides,
  };
}

function makeReputationTruth(
  overrides: Partial<BackendReputationTruth> = {}
): BackendReputationTruth {
  return {
    canonicalSource: "derived_from_events",
    ambiguityPolicy: "claim_attribution_ambiguous_without_adjacent_same_milestone_approval",
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

  it("maps degraded=true fresh payloads to stale for conservative route messaging", () => {
    const assessment = getBackendFreshnessAssessment(
      makeFreshness({ state: "fresh", degraded: true, lagBlocks: "1" })
    );

    expect(assessment.state).toBe("stale");
    expect(assessment.degraded).toBe(true);
    expect(assessment.message).toContain("stale");
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

describe("getMetadataTruthAssessment", () => {
  it("maps verified metadata to healthy message", () => {
    const assessment = getMetadataTruthAssessment(makeMetadataTruth());

    expect(assessment.state).toBe("verified");
    expect(assessment.verified).toBe(true);
    expect(assessment.degraded).toBe(false);
  });

  it("maps mismatched metadata without hiding payload", () => {
    const assessment = getMetadataTruthAssessment(
      makeMetadataTruth({ state: "mismatched", verified: false, degraded: false })
    );

    expect(assessment.state).toBe("mismatched");
    expect(assessment.degraded).toBe(false);
    expect(assessment.message).toContain("does not match");
  });

  it("treats degraded metadata verification as degraded", () => {
    const assessment = getMetadataTruthAssessment(
      makeMetadataTruth({ state: "degraded", verified: false, degraded: true, error: "timeout" })
    );

    expect(assessment.state).toBe("degraded");
    expect(assessment.degraded).toBe(true);
    expect(assessment.detail).toContain("timeout");
  });

  it("treats missing metadata truth as unavailable", () => {
    const assessment = getMetadataTruthAssessment(undefined);

    expect(assessment.state).toBe("unavailable");
    expect(assessment.degraded).toBe(true);
  });

  it("treats unknown metadata state as malformed", () => {
    const malformed = { ...makeMetadataTruth(), state: "mystery" } as unknown as BackendMetadataTruth;
    const assessment = getMetadataTruthAssessment(malformed);

    expect(assessment.state).toBe("unavailable");
    expect(assessment.message).toContain("malformed");
  });
});

describe("getMilestoneMetadataVerificationAssessment", () => {
  it("maps verified milestone metadata correctly", () => {
    const assessment = getMilestoneMetadataVerificationAssessment(makeMilestoneMetadataTruth());

    expect(assessment.state).toBe("verified");
    expect(assessment.verified).toBe(true);
    expect(assessment.degraded).toBe(false);
  });

  it("maps missing milestone metadata as degraded", () => {
    const assessment = getMilestoneMetadataVerificationAssessment(
      makeMilestoneMetadataTruth({ state: "missing", verified: false, degraded: true, reason: "missing entry" })
    );

    expect(assessment.state).toBe("missing");
    expect(assessment.degraded).toBe(true);
    expect(assessment.reason).toContain("missing entry");
  });

  it("treats malformed milestone metadata truth as unavailable", () => {
    const malformed = { ...makeMilestoneMetadataTruth(), state: "odd" } as unknown as BackendMilestoneMetadataVerificationTruth;
    const assessment = getMilestoneMetadataVerificationAssessment(malformed);

    expect(assessment.state).toBe("unavailable");
    expect(assessment.message).toContain("malformed");
  });
});

describe("getHashContextAssessment", () => {
  it("marks ambiguous hash context as degraded", () => {
    const assessment = getHashContextAssessment(
      makeHashTruth({ ambiguity: "not-verifiable-from-onchain-hash", reason: "no payload" }),
      "evidence"
    );

    expect(assessment.state).toBe("present");
    expect(assessment.degraded).toBe(true);
    expect(assessment.message).toContain("ambiguous");
  });

  it("maps missing dispute hash without degradation", () => {
    const assessment = getHashContextAssessment(
      makeHashTruth({ state: "missing", hash: null }),
      "dispute"
    );

    expect(assessment.state).toBe("missing");
    expect(assessment.degraded).toBe(false);
    expect(assessment.message).toContain("No dispute hash");
  });

  it("treats malformed hash context as unavailable", () => {
    const malformed = { ...makeHashTruth(), state: "unknown" } as unknown as BackendHashContextTruth;
    const assessment = getHashContextAssessment(malformed, "evidence");

    expect(assessment.state).toBe("unavailable");
    expect(assessment.degraded).toBe(true);
  });
});

describe("timeline and reputation truth helpers", () => {
  it("returns ambiguity note for timeline ambiguity", () => {
    const note = getTimelineTruthNote({ ambiguity: "claim-attribution-ambiguous" });

    expect(note).toContain("claim-attribution-ambiguous");
  });

  it("returns unavailable note for missing timeline truth", () => {
    const note = getTimelineTruthNote(undefined);

    expect(note).toContain("unavailable");
  });

  it("keeps malformed timeline truth payload conservative", () => {
    const note = getTimelineTruthNote("bad-payload" as unknown as Record<string, unknown>);

    expect(note).toContain("unavailable");
  });

  it("maps healthy reputation truth metadata", () => {
    const assessment = getReputationTruthAssessment(makeReputationTruth());

    expect(assessment.state).toBe("healthy");
    expect(assessment.message).toContain("Canonical source");
  });

  it("maps malformed reputation truth metadata to degraded", () => {
    const assessment = getReputationTruthAssessment({ canonicalSource: "derived_from_events" } as BackendReputationTruth);

    expect(assessment.state).toBe("degraded");
    expect(assessment.message).toContain("malformed");
  });

  it("maps missing reputation truth metadata to degraded", () => {
    const assessment = getReputationTruthAssessment(undefined);

    expect(assessment.state).toBe("degraded");
    expect(assessment.message).toContain("unavailable");
  });
});
