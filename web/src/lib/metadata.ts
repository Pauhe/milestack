import { readFile } from "node:fs/promises";
import path from "node:path";

import { hashJson } from "@/lib/hash";

export type VerifiedDealMetadata = {
  url: string;
  verified: boolean;
  payload: Record<string, unknown> | null;
  error: string | null;
};

// NOTE: This helper is intentionally non-authoritative for user-facing truth surfaces.
// Deal/milestone/dispute/profile pages must consume backend truth contracts from /escrows and /users APIs.
// Keep this utility only for local tooling or future non-canonical preview workflows.
export async function loadAndVerifyDealMetadata(
  metadataUrl: string,
  expectedHash: `0x${string}`
): Promise<VerifiedDealMetadata> {
  try {
    const payload = await loadMetadataPayload(metadataUrl);
    const actualHash = hashJson(payload);

    return {
      url: metadataUrl,
      verified: actualHash === expectedHash,
      payload,
      error: null,
    };
  } catch (error) {
    return {
      url: metadataUrl,
      verified: false,
      payload: null,
      error: error instanceof Error ? error.message : "Unknown metadata load failure",
    };
  }
}

export function getDealMetadataUrl(requested: string | null, isDemoRoute: boolean): string | null {
  if (requested) return requested;

  if (isDemoRoute) {
    return process.env.NEXT_PUBLIC_DEFAULT_DEAL_METADATA_PATH ?? null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadMetadataPayload(metadataUrl: string): Promise<Record<string, unknown>> {
  if (metadataUrl.startsWith("/")) {
    const filePath = path.join(process.cwd(), "public", metadataUrl.slice(1));
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
