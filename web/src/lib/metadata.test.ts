import { afterEach, describe, expect, it, vi } from "vitest";

import { getDealMetadataUrl, loadAndVerifyDealMetadata } from "@/lib/metadata";

const readFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

describe("metadata helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    readFileMock.mockReset();
  });

  it("prefers explicit requested url", () => {
    expect(getDealMetadataUrl("https://example.com/metadata.json", true)).toBe(
      "https://example.com/metadata.json"
    );
  });

  it("uses demo env default when route is demo and request is absent", () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_DEAL_METADATA_PATH", "/metadata/demo.json");
    expect(getDealMetadataUrl(null, true)).toBe("/metadata/demo.json");
  });

  it("returns null when non-demo route has no requested metadata", () => {
    expect(getDealMetadataUrl(null, false)).toBeNull();
  });

  it("loads local metadata payload and verifies matching hash", async () => {
    const payload = { title: "Deal", milestoneCount: 1 };
    readFileMock.mockResolvedValue(JSON.stringify(payload));

    const { hashJson } = await import("@/lib/hash");
    const expectedHash = hashJson(payload);

    const result = await loadAndVerifyDealMetadata("/metadata/local.json", expectedHash);

    expect(result.verified).toBe(true);
    expect(result.payload).toEqual(payload);
    expect(result.error).toBeNull();
  });

  it("returns error when local metadata is not an object", async () => {
    readFileMock.mockResolvedValue(JSON.stringify(["not", "an", "object"]));

    const result = await loadAndVerifyDealMetadata(
      "/metadata/bad.json",
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );

    expect(result.verified).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.error).toContain("Metadata payload must be a JSON object");
  });

  it("loads remote metadata and verifies mismatch safely", async () => {
    const payload = { title: "Remote" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(payload),
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await loadAndVerifyDealMetadata(
      "https://example.com/metadata.json",
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/metadata.json", { cache: "no-store" });
    expect(result.verified).toBe(false);
    expect(result.payload).toEqual(payload);
    expect(result.error).toBeNull();
  });

  it("returns remote status errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadAndVerifyDealMetadata(
      "https://example.com/down.json",
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );

    expect(result.verified).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.error).toContain("status 503");
  });
});
