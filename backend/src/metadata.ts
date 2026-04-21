import { readFile } from "node:fs/promises";
import path from "node:path";

import { keccak256, stringToHex } from "viem";

export type VerifiedMetadata = {
  metadataUrl: string;
  verified: boolean;
  payload: Record<string, unknown> | null;
  error: string | null;
};

export async function loadAndVerifyMetadata(metadataUrl: string, expectedHash: string): Promise<VerifiedMetadata> {
  try {
    const payload = await loadMetadataPayload(metadataUrl);
    const actualHash = hashJson(payload);

    return {
      metadataUrl,
      verified: actualHash === expectedHash,
      payload,
      error: null,
    };
  } catch (error) {
    return {
      metadataUrl,
      verified: false,
      payload: null,
      error: error instanceof Error ? error.message : "Unknown metadata load failure",
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadMetadataPayload(metadataUrl: string): Promise<Record<string, unknown>> {
  if (metadataUrl.startsWith("/")) {
    const filePath = path.join(process.cwd(), "..", "web", "public", metadataUrl.slice(1));
    const contents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(contents) as unknown;

    if (!isRecord(parsed)) {
      throw new Error("Metadata payload must be a JSON object.");
    }

    return parsed;
  }

  const response = await fetch(metadataUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Metadata request failed with status ${response.status}.`);
  }

  const parsed = (await response.json()) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Metadata payload must be a JSON object.");
  }

  return parsed;
}

function hashJson(value: unknown): `0x${string}` {
  return keccak256(stringToHex(JSON.stringify(value)));
}
