import assert from "node:assert/strict";
import test from "node:test";

import { loadAndVerifyMetadata } from "./metadata.js";

test("loadAndVerifyMetadata verifies local metadata against expected hash", async () => {
  const expectedHash = "0x6104564d6681687f9a7c30ad862fbbfca86c58bd6a2e15bdcc36186fa5e70ec7";
  const result = await loadAndVerifyMetadata("/demo/deal-metadata.json", expectedHash);

  assert.equal(result.verified, true);
  assert.equal(result.error, null);
  assert.equal(result.payload?.title, "Website redesign for ExampleCo");
});

test("loadAndVerifyMetadata surfaces hash mismatch clearly", async () => {
  const result = await loadAndVerifyMetadata(
    "/demo/deal-metadata.json",
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  );

  assert.equal(result.verified, false);
  assert.equal(result.error, null);
  assert.ok(result.payload);
});
