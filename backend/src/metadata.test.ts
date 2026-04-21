import assert from "node:assert/strict";
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
