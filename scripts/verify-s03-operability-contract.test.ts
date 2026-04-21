import assert from "node:assert/strict";
import test from "node:test";

type AnyRecord = Record<string, unknown>;

function validateOperabilityContracts(params: {
  rehearsal: AnyRecord;
  recovery: AnyRecord;
  browserEvidence: Set<string>;
  thresholds: {
    maxLagBlocks: number;
    allowDegraded: boolean;
    requiredSyncStatus: string;
    maxStaleHealthSnapshots: number;
    maxMissingBrowserEvidence: number;
  };
}) {
  const { rehearsal, recovery, browserEvidence, thresholds } = params;

  if (rehearsal.ok !== true) {
    throw new Error("rehearsal artifact not ok=true");
  }
  if (recovery.ok !== true) {
    throw new Error("recovery artifact not ok=true");
  }

  if (typeof rehearsal.execute !== "object" || rehearsal.execute === null || Array.isArray(rehearsal.execute)) {
    throw new Error("rehearsal artifact missing execute payload");
  }

  const requiredExecute: Record<string, string[]> = {
    happyPath: ["escrowAddress", "submitTxHash", "approveTxHash"],
    timeoutPath: ["escrowAddress", "submitTxHash", "claimTxHash"],
    disputePath: ["escrowAddress", "submitTxHash", "openDisputeTxHash", "resolveDisputeTxHash"],
  };

  for (const [route, fields] of Object.entries(requiredExecute)) {
    const routePayload = (rehearsal.execute as AnyRecord)[route];
    if (typeof routePayload !== "object" || routePayload === null || Array.isArray(routePayload)) {
      throw new Error(`rehearsal execute missing ${route}`);
    }

    for (const field of fields) {
      const value = (routePayload as AnyRecord)[field];
      if (typeof value !== "string" || !value.startsWith("0x")) {
        throw new Error(`rehearsal execute ${route}.${field} malformed`);
      }
    }
  }

  for (const field of ["failurePhase", "failureReason", "healthSnapshots", "browserArtifacts", "phases", "continuity"]) {
    if (!(field in recovery)) {
      throw new Error(`recovery artifact missing ${field}`);
    }
  }

  const healthSnapshots = recovery.healthSnapshots;
  if (typeof healthSnapshots !== "object" || healthSnapshots === null || Array.isArray(healthSnapshots)) {
    throw new Error("recovery healthSnapshots malformed");
  }

  let staleSnapshots = 0;
  for (const name of ["beforeRestart", "duringRecovery", "afterRecovery"]) {
    const snapshot = (healthSnapshots as AnyRecord)[name];
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
      throw new Error(`recovery health snapshot missing ${name}`);
    }

    const sync = (snapshot as AnyRecord).sync;
    if (typeof sync !== "object" || sync === null || Array.isArray(sync)) {
      throw new Error(`recovery health snapshot ${name}.sync missing`);
    }

    for (const key of ["freshness", "degraded", "phase", "status", "lagBlocks", "lastError"]) {
      if (!(key in (sync as AnyRecord))) {
        throw new Error(`recovery health snapshot ${name}.sync missing ${key}`);
      }
    }

    if ((sync as AnyRecord).freshness === "stale") {
      staleSnapshots += 1;
    }
  }

  const browserArtifacts = recovery.browserArtifacts;
  if (typeof browserArtifacts !== "object" || browserArtifacts === null || Array.isArray(browserArtifacts)) {
    throw new Error("recovery browserArtifacts malformed");
  }

  const requiredScreenshots = (browserArtifacts as AnyRecord).requiredScreenshots;
  if (!Array.isArray(requiredScreenshots) || requiredScreenshots.length === 0) {
    throw new Error("recovery requiredScreenshots missing");
  }

  let missingScreenshots = 0;
  for (const screenshot of requiredScreenshots) {
    if (typeof screenshot !== "string") {
      throw new Error("recovery requiredScreenshots entry malformed");
    }
    if (!browserEvidence.has(screenshot)) {
      missingScreenshots += 1;
    }
  }

  if (missingScreenshots > thresholds.maxMissingBrowserEvidence) {
    throw new Error(
      `missing browser evidence exceeds abort threshold: missing=${missingScreenshots} threshold=${thresholds.maxMissingBrowserEvidence}`
    );
  }

  if (staleSnapshots > thresholds.maxStaleHealthSnapshots) {
    throw new Error(
      `abort threshold breached: staleSnapshots=${staleSnapshots} threshold=${thresholds.maxStaleHealthSnapshots}`
    );
  }

  const afterRecovery = (healthSnapshots as AnyRecord).afterRecovery as AnyRecord;
  const afterSync = afterRecovery.sync as AnyRecord;

  const lagBlocks = Number(afterSync.lagBlocks);
  if (!Number.isInteger(lagBlocks)) {
    throw new Error(`afterRecovery lagBlocks malformed: ${String(afterSync.lagBlocks)}`);
  }

  if (lagBlocks > thresholds.maxLagBlocks) {
    throw new Error(`abort threshold breached: lagBlocks=${lagBlocks} threshold=${thresholds.maxLagBlocks}`);
  }

  const status = String(afterSync.status ?? "").toLowerCase();
  if (thresholds.requiredSyncStatus && status !== thresholds.requiredSyncStatus.toLowerCase()) {
    throw new Error(`abort threshold breached: status=${status} required=${thresholds.requiredSyncStatus}`);
  }

  const degraded = Boolean(afterSync.degraded);
  const freshness = String(afterSync.freshness ?? "");
  if (!thresholds.allowDegraded && degraded) {
    throw new Error("abort threshold breached: degraded=true and allowDegraded=false");
  }
  if (!thresholds.allowDegraded && freshness !== "fresh") {
    throw new Error(`abort threshold breached: freshness=${freshness} requires fresh`);
  }
}

function baseRehearsalArtifact(): AnyRecord {
  return {
    ok: true,
    execute: {
      happyPath: { escrowAddress: "0x1", submitTxHash: "0xa", approveTxHash: "0xb" },
      timeoutPath: { escrowAddress: "0x2", submitTxHash: "0xc", claimTxHash: "0xd" },
      disputePath: { escrowAddress: "0x3", submitTxHash: "0xe", openDisputeTxHash: "0xf", resolveDisputeTxHash: "0x10" },
    },
  };
}

function baseRecoveryArtifact(): AnyRecord {
  const healthySync = {
    freshness: "fresh",
    degraded: false,
    phase: "idle",
    status: "healthy",
    lagBlocks: "0",
    lastError: null,
  };

  return {
    ok: true,
    failurePhase: null,
    failureReason: null,
    continuity: { assertionsPassed: true },
    phases: [],
    healthSnapshots: {
      beforeRestart: { sync: healthySync },
      duringRecovery: { sync: healthySync },
      afterRecovery: { sync: healthySync },
    },
    browserArtifacts: {
      requiredScreenshots: [
        "recovery-degraded-deal.png",
        "recovery-healthy-milestone.png",
        "recovery-healthy-dispute.png",
      ],
    },
  };
}

const strictThresholds = {
  maxLagBlocks: 0,
  allowDegraded: false,
  requiredSyncStatus: "healthy",
  maxStaleHealthSnapshots: 0,
  maxMissingBrowserEvidence: 0,
};

const browserEvidenceComplete = new Set([
  "recovery-degraded-deal.png",
  "recovery-healthy-milestone.png",
  "recovery-healthy-dispute.png",
]);

test("operability contract validator accepts complete healthy artifacts", () => {
  validateOperabilityContracts({
    rehearsal: baseRehearsalArtifact(),
    recovery: baseRecoveryArtifact(),
    browserEvidence: browserEvidenceComplete,
    thresholds: strictThresholds,
  });
});

test("operability contract validator fails closed when recovery health payload is partial", () => {
  const recovery = baseRecoveryArtifact();
  delete ((recovery.healthSnapshots as AnyRecord).afterRecovery as AnyRecord).sync;

  assert.throws(
    () =>
      validateOperabilityContracts({
        rehearsal: baseRehearsalArtifact(),
        recovery,
        browserEvidence: browserEvidenceComplete,
        thresholds: strictThresholds,
      }),
    /afterRecovery\.sync missing/
  );
});

test("operability contract validator fails closed on missing browser evidence", () => {
  const partialEvidence = new Set(["recovery-degraded-deal.png"]);

  assert.throws(
    () =>
      validateOperabilityContracts({
        rehearsal: baseRehearsalArtifact(),
        recovery: baseRecoveryArtifact(),
        browserEvidence: partialEvidence,
        thresholds: strictThresholds,
      }),
    /missing browser evidence exceeds abort threshold/
  );
});

test("operability contract validator enforces lag/status/degraded abort thresholds", () => {
  const recovery = baseRecoveryArtifact();
  const afterSync = (((recovery.healthSnapshots as AnyRecord).afterRecovery as AnyRecord).sync as AnyRecord);
  afterSync.lagBlocks = "3";
  afterSync.status = "stale";
  afterSync.freshness = "stale";
  afterSync.degraded = true;

  assert.throws(
    () =>
      validateOperabilityContracts({
        rehearsal: baseRehearsalArtifact(),
        recovery,
        browserEvidence: browserEvidenceComplete,
        thresholds: {
          ...strictThresholds,
          maxStaleHealthSnapshots: 3,
        },
      }),
    /lagBlocks=3 threshold=0/
  );
});

test("operability contract validator enforces stale snapshot boundary", () => {
  const recovery = baseRecoveryArtifact();
  ((recovery.healthSnapshots as AnyRecord).beforeRestart as AnyRecord).sync = {
    freshness: "stale",
    degraded: true,
    phase: "idle",
    status: "stale",
    lagBlocks: "0",
    lastError: null,
  };

  assert.throws(
    () =>
      validateOperabilityContracts({
        rehearsal: baseRehearsalArtifact(),
        recovery,
        browserEvidence: browserEvidenceComplete,
        thresholds: strictThresholds,
      }),
    /staleSnapshots=1 threshold=0/
  );
});
