import assert from "node:assert/strict";
import test from "node:test";

type VerifyInput = {
  docs: string[];
  exists: Set<string>;
};

const DOCS_SCOPE = [
  "README.md",
  "PRODUCT_SPEC.md",
  "docs/DELIVERY_PLAN.md",
  "docs/RUNBOOKS.md",
  "docs/LOCAL_STACK_RUNBOOK.md",
  "docs/TESTING_AND_DEPLOYMENT_STRATEGY.md",
] as const;

const REQUIRED_FIXED = [
  "bash scripts/verify-s02-recovery.sh",
  "bash scripts/verify-s03-operability.sh",
  "deployments/rehearsal-local/rehearsal-recovery-verification.json",
  "deployments/rehearsal-local/operability-verification.json",
  "/health.sync.freshness",
  "/health.sync.degraded",
  "/health.sync.status",
  "/health.sync.phase",
  "/health.sync.lagBlocks",
  "/health.sync.lastError",
] as const;

function verifyM006S02Docs(input: VerifyInput): void {
  for (const doc of DOCS_SCOPE) {
    if (!input.exists.has(doc)) {
      throw new Error(`missing required doc: ${doc}`);
    }
  }

  const docBlob = input.docs.join("\n\n");

  if (/TODO|TBD/.test(docBlob)) {
    throw new Error("unresolved TODO/TBD marker detected in closure docs");
  }

  for (const required of REQUIRED_FIXED) {
    if (!docBlob.includes(required)) {
      throw new Error(`missing required reference: ${required}`);
    }
  }

  if (!/no-launch|no launch/.test(docBlob)) {
    throw new Error("missing fail-closed no-launch wording");
  }

  if (!/canary abort/.test(docBlob)) {
    throw new Error("missing canary abort wording");
  }

  if (!/offchain-only rollback|offchain only rollback/.test(docBlob)) {
    throw new Error("missing offchain-only rollback wording");
  }

  for (const doc of input.docs) {
    if (/mainnet canary|production canary|staging canary/.test(doc)) {
      if (!/rehearsal-local|rehearsal local/.test(doc)) {
        throw new Error("broad canary wording without rehearsal-local boundary");
      }
    }
  }
}

const validDocs = [
  `Canonical truth source:\n` +
    `bash scripts/verify-s02-recovery.sh\n` +
    `bash scripts/verify-s03-operability.sh\n` +
    `deployments/rehearsal-local/rehearsal-recovery-verification.json\n` +
    `deployments/rehearsal-local/operability-verification.json\n` +
    `/health.sync.freshness\n` +
    `/health.sync.degraded\n` +
    `/health.sync.status\n` +
    `/health.sync.phase\n` +
    `/health.sync.lagBlocks\n` +
    `/health.sync.lastError\n` +
    `If canary abort threshold trips, verdict is no-launch. Rollback is offchain-only rollback.\n` +
    `This is rehearsal-local evidence only.`,
  `First-reader summary says launch decisions are fail-closed and must stay no launch when evidence is missing.`,
  `Boundary doc includes production canary planning language but states rehearsal-local evidence boundary explicitly for launch truth.`,
  `Operator note: canary abort decisions are explicit and conservative.`,
  `Field glossary for sync and evidence references lives in canonical docs.`,
  `Artifact guidance references rehearsal-local verification outputs for audits.`,
];

const fullExists = new Set<string>(DOCS_SCOPE);

test("verifier contract accepts complete closure set evidence", () => {
  verifyM006S02Docs({ docs: validDocs, exists: fullExists });
});

test("verifier contract fails on missing doc file", () => {
  const missing = new Set<string>(DOCS_SCOPE.filter((d) => d !== "PRODUCT_SPEC.md"));
  assert.throws(() => verifyM006S02Docs({ docs: validDocs, exists: missing }), /missing required doc: PRODUCT_SPEC\.md/);
});

test("verifier contract fails on missing artifact path", () => {
  const docs = validDocs.map((d, idx) => (idx === 0 ? d.replace("deployments/rehearsal-local/operability-verification.json", "") : d));
  assert.throws(
    () => verifyM006S02Docs({ docs, exists: fullExists }),
    /missing required reference: deployments\/rehearsal-local\/operability-verification\.json/
  );
});

test("verifier contract fails on missing /health sync field", () => {
  const docs = validDocs.map((d, idx) => (idx === 0 ? d.replace("/health.sync.lastError", "") : d));
  assert.throws(() => verifyM006S02Docs({ docs, exists: fullExists }), /missing required reference: \/health\.sync\.lastError/);
});

test("verifier contract fails on generic rollback wording without offchain-only boundary", () => {
  const docs = validDocs.map((d, idx) => (idx === 0 ? d.replace("offchain-only rollback", "rollback") : d));
  assert.throws(() => verifyM006S02Docs({ docs, exists: fullExists }), /missing offchain-only rollback wording/);
});

test("verifier contract fails when broad canary claim omits rehearsal-local boundary", () => {
  const docs = [
    ...validDocs.slice(0, 2),
    "This section claims production canary readiness and mainnet canary confidence.",
    ...validDocs.slice(3),
  ];

  assert.throws(
    () => verifyM006S02Docs({ docs, exists: fullExists }),
    /broad canary wording without rehearsal-local boundary/
  );
});

test("verifier contract fails on TODO/TBD markers", () => {
  const docs = [...validDocs];
  docs[5] = `${docs[5]}\nTODO: fill this later.`;
  assert.throws(() => verifyM006S02Docs({ docs, exists: fullExists }), /unresolved TODO\/TBD marker/);
});
