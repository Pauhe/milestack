import { readFile } from "node:fs/promises";
import path from "node:path";

import { keccak256, stringToHex } from "viem";

export type VerifiedMetadata = {
  metadataUrl: string;
  verified: boolean;
  payload: Record<string, unknown> | null;
  error: string | null;
};

export type MetadataCacheRow = {
  metadata_hash: string;
  metadata_url: string;
  verified: number;
  payload_json: string | null;
  error: string | null;
  updated_at_block: string;
};

export type MetadataVerificationState = "verified" | "mismatched" | "missing" | "degraded" | "unverified";

export type MetadataTruth = {
  state: MetadataVerificationState;
  verified: boolean;
  degraded: boolean;
  metadataHash: string;
  metadataUrl: string | null;
  payload: Record<string, unknown> | null;
  payloadPresent: boolean;
  updatedAtBlock: string | null;
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

export function deriveMetadataTruth(metadataHash: string, cacheRow?: MetadataCacheRow): MetadataTruth {
  if (!cacheRow) {
    return {
      state: "missing",
      verified: false,
      degraded: true,
      metadataHash,
      metadataUrl: null,
      payload: null,
      payloadPresent: false,
      updatedAtBlock: null,
      error: "missing metadata cache",
    };
  }

  const parsedPayload = parsePayloadJson(cacheRow.payload_json);

  if (cacheRow.verified === 1) {
    if (!cacheRow.payload_json) {
      return {
        state: "degraded",
        verified: false,
        degraded: true,
        metadataHash,
        metadataUrl: cacheRow.metadata_url,
        payload: null,
        payloadPresent: false,
        updatedAtBlock: cacheRow.updated_at_block,
        error: "metadata cache verified without payload",
      };
    }

    if (parsedPayload.error) {
      return {
        state: "degraded",
        verified: false,
        degraded: true,
        metadataHash,
        metadataUrl: cacheRow.metadata_url,
        payload: null,
        payloadPresent: true,
        updatedAtBlock: cacheRow.updated_at_block,
        error: parsedPayload.error,
      };
    }

    return {
      state: "verified",
      verified: true,
      degraded: false,
      metadataHash,
      metadataUrl: cacheRow.metadata_url,
      payload: parsedPayload.payload,
      payloadPresent: true,
      updatedAtBlock: cacheRow.updated_at_block,
      error: null,
    };
  }

  if (parsedPayload.payload) {
    return {
      state: "mismatched",
      verified: false,
      degraded: false,
      metadataHash,
      metadataUrl: cacheRow.metadata_url,
      payload: parsedPayload.payload,
      payloadPresent: true,
      updatedAtBlock: cacheRow.updated_at_block,
      error: cacheRow.error,
    };
  }

  const inferredState = inferUnverifiedState(cacheRow.error);

  return {
    state: inferredState,
    verified: false,
    degraded: inferredState === "degraded",
    metadataHash,
    metadataUrl: cacheRow.metadata_url,
    payload: null,
    payloadPresent: false,
    updatedAtBlock: cacheRow.updated_at_block,
    error: cacheRow.error,
  };
}

function inferUnverifiedState(error: string | null): Exclude<MetadataVerificationState, "verified" | "missing" | "mismatched"> {
  if (!error) {
    return "unverified";
  }

  return /(timeout|request failed|parse|payload|malformed|missing|degraded)/i.test(error) ? "degraded" : "unverified";
}

function parsePayloadJson(payloadJson: string | null): { payload: Record<string, unknown> | null; error: string | null } {
  if (!payloadJson) {
    return { payload: null, error: null };
  }

  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!isRecord(parsed)) {
      return { payload: null, error: "metadata payload is not a JSON object" };
    }

    return { payload: parsed, error: null };
  } catch {
    return { payload: null, error: "metadata payload JSON parse failed" };
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
