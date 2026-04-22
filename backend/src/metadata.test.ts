import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { deriveMetadataTruth, loadAndVerifyMetadata } from "./metadata.js";

test("loadAndVerifyMetadata verifies local metadata against expected hash", async () => {
  const expectedHash = "0x6104564d6681687f9a7c30ad862fbbfca86c58bd6a2e15bdcc36186fa5e70ec7";
  const result = await loadAndVerifyMetadata("/demo/deal-metadata.json", expectedHash);

  assert.equal(result.verified, true);
  assert.equal(result.error, null);
  assert.equal(result.payload?.title, "Website redesign for ExampleCo");
});

test("deriveMetadataTruth classifies verified cache rows", () => {
  const truth = deriveMetadataTruth("0xhash", {
    metadata_hash: "0xhash",
    metadata_url: "mock://metadata",
    verified: 1,
    payload_json: JSON.stringify({ version: 1, milestones: [] }),
    error: null,
    updated_at_block: "44",
  });

  assert.equal(truth.state, "verified");
  assert.equal(truth.verified, true);
  assert.equal(truth.degraded, false);
  assert.equal(truth.payloadPresent, true);
});

test("deriveMetadataTruth surfaces degraded verified-without-payload rows", () => {
  const truth = deriveMetadataTruth("0xhash", {
    metadata_hash: "0xhash",
    metadata_url: "mock://metadata",
    verified: 1,
    payload_json: null,
    error: null,
    updated_at_block: "45",
  });

  assert.equal(truth.state, "degraded");
  assert.equal(truth.verified, false);
  assert.equal(truth.degraded, true);
  assert.match(truth.error ?? "", /verified without payload/);
});

test("deriveMetadataTruth marks missing cache rows explicitly", () => {
  const truth = deriveMetadataTruth("0xmissing");

  assert.equal(truth.state, "missing");
  assert.equal(truth.degraded, true);
  assert.match(truth.error ?? "", /missing metadata cache/);
});

test("deriveMetadataTruth distinguishes mismatched hash rows from degraded rows", () => {
  const truth = deriveMetadataTruth("0xmismatch", {
    metadata_hash: "0xmismatch",
    metadata_url: "mock://metadata",
    verified: 0,
    payload_json: JSON.stringify({ title: "exists but hash mismatched" }),
    error: "hash mismatch",
    updated_at_block: "46",
  });

  assert.equal(truth.state, "mismatched");
  assert.equal(truth.degraded, false);
  assert.ok(truth.payload);
});

test("deriveMetadataTruth marks verified rows with malformed payload JSON as degraded", () => {
  const truth = deriveMetadataTruth("0xmalformed", {
    metadata_hash: "0xmalformed",
    metadata_url: "mock://metadata",
    verified: 1,
    payload_json: "{malformed",
    error: null,
    updated_at_block: "47",
  });

  assert.equal(truth.state, "degraded");
  assert.equal(truth.degraded, true);
  assert.equal(truth.payloadPresent, true);
  assert.match(truth.error ?? "", /JSON parse failed/);
});

test("deriveMetadataTruth classifies non-object payload JSON as degraded when verified and as unverified when not verified", () => {
  const degradedVerifiedTruth = deriveMetadataTruth("0xarray", {
    metadata_hash: "0xarray",
    metadata_url: "mock://metadata",
    verified: 1,
    payload_json: JSON.stringify(["not", "an", "object"]),
    error: null,
    updated_at_block: "48",
  });

  assert.equal(degradedVerifiedTruth.state, "degraded");
  assert.equal(degradedVerifiedTruth.degraded, true);
  assert.match(degradedVerifiedTruth.error ?? "", /not a JSON object/);

  const unverifiedTruth = deriveMetadataTruth("0xarray", {
    metadata_hash: "0xarray",
    metadata_url: "mock://metadata",
    verified: 0,
    payload_json: JSON.stringify(["still", "not", "an", "object"]),
    error: "signature mismatch",
    updated_at_block: "49",
  });

  assert.equal(unverifiedTruth.state, "unverified");
  assert.equal(unverifiedTruth.degraded, false);
  assert.equal(unverifiedTruth.payloadPresent, false);
});

test("deriveMetadataTruth infers degraded state for unverified timeout errors and unverified for other errors", () => {
  const degradedTruth = deriveMetadataTruth("0xslow", {
    metadata_hash: "0xslow",
    metadata_url: "https://example.com/slow.json",
    verified: 0,
    payload_json: null,
    error: "request failed due to timeout",
    updated_at_block: "50",
  });

  assert.equal(degradedTruth.state, "degraded");
  assert.equal(degradedTruth.degraded, true);

  const unverifiedTruth = deriveMetadataTruth("0xsig", {
    metadata_hash: "0xsig",
    metadata_url: "https://example.com/sig.json",
    verified: 0,
    payload_json: null,
    error: "signature mismatch",
    updated_at_block: "51",
  });

  assert.equal(unverifiedTruth.state, "unverified");
  assert.equal(unverifiedTruth.degraded, false);
});

test("loadAndVerifyMetadata returns remote failure status text when fetch is not ok", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 503,
    }) as Response) as typeof fetch;

  try {
    const result = await loadAndVerifyMetadata("https://example.com/metadata.json", "0xdeadbeef");

    assert.equal(result.verified, false);
    assert.equal(result.payload, null);
    assert.match(result.error ?? "", /status 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadAndVerifyMetadata degrades when remote JSON payload is not an object", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ["nope"],
    }) as Response) as typeof fetch;

  try {
    const result = await loadAndVerifyMetadata("https://example.com/not-object.json", "0xdeadbeef");

    assert.equal(result.verified, false);
    assert.equal(result.payload, null);
    assert.match(result.error ?? "", /must be a JSON object/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadAndVerifyMetadata degrades when local metadata payload is malformed JSON", async () => {
  const cwd = process.cwd();
  const scratchRoot = await mkdtemp(path.join(tmpdir(), "milestack-metadata-malformed-"));
  const projectRoot = path.join(scratchRoot, "project");
  const localPublicDir = path.join(scratchRoot, "web", "public", "tmp");
  const malformedPath = path.join(localPublicDir, "metadata-malformed.json");

  await mkdir(projectRoot, { recursive: true });
  await mkdir(localPublicDir, { recursive: true });
  await writeFile(malformedPath, "{invalid", "utf8");

  process.chdir(projectRoot);

  try {
    const result = await loadAndVerifyMetadata("/tmp/metadata-malformed.json", "0xdeadbeef");

    assert.equal(result.verified, false);
    assert.equal(result.payload, null);
    assert.match(result.error ?? "", /Unexpected token|JSON/);
  } finally {
    process.chdir(cwd);
    await rm(scratchRoot, { recursive: true, force: true });
  }
});

test("loadAndVerifyMetadata degrades when local metadata payload is not an object", async () => {
  const cwd = process.cwd();
  const scratchRoot = await mkdtemp(path.join(tmpdir(), "milestack-metadata-nonobject-"));
  const projectRoot = path.join(scratchRoot, "project");
  const localPublicDir = path.join(scratchRoot, "web", "public", "tmp");
  const nonObjectPath = path.join(localPublicDir, "metadata-array.json");

  await mkdir(projectRoot, { recursive: true });
  await mkdir(localPublicDir, { recursive: true });
  await writeFile(nonObjectPath, JSON.stringify(["array"]), "utf8");

  process.chdir(projectRoot);

  try {
    const result = await loadAndVerifyMetadata("/tmp/metadata-array.json", "0xdeadbeef");

    assert.equal(result.verified, false);
    assert.equal(result.payload, null);
    assert.match(result.error ?? "", /must be a JSON object/);
  } finally {
    process.chdir(cwd);
    await rm(scratchRoot, { recursive: true, force: true });
  }
});
